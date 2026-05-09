package relayer

import (
	"context"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/supabase"
	"github.com/tessera-bridge/tessera/internal/transform"
)

const (
	challengeWindow = 65 * time.Second // 60 s window + 5 s buffer before executing
)

// runSubmitter runs the event listener + submission handler for a source→dest direction.
// For each event it executes: VerifyConsensus → FetchProof → Transform → Submit → schedule Execute.
func (r *Runner) runSubmitter(ctx context.Context, src, dst chain.Plugin) error {
	events, err := src.SubscribeEvents(ctx, r.cfg.FromBlock)
	if err != nil {
		return fmt.Errorf("runSubmitter SubscribeEvents %s: %w", src.ChainID(), err)
	}

	slog.Info("submitter started",
		"source", src.ChainID(), "dest", dst.ChainID(),
		"from_block", r.cfg.FromBlock)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev, ok := <-events:
			if !ok {
				slog.Info("submitter: event channel closed",
					"source", src.ChainID(), "dest", dst.ChainID())
				return nil
			}
			if err := r.handleEvent(ctx, src, dst, ev); err != nil {
				// Inline the err string into the message so Railway's
				// JSON-log truncation doesn't drop the actual cause.
				slog.Error(fmt.Sprintf("submitter: handleEvent failed: %v", err),
					"source", src.ChainID(), "dest", dst.ChainID(),
					"nonce", ev.Nonce, "tx", ev.TxHash)
			}
		}
	}
}

// handleEvent processes a single cross-chain event through the full relay pipeline.
func (r *Runner) handleEvent(ctx context.Context, src, dst chain.Plugin, ev chain.Event) error {
	slog.Info("handleEvent: received cross-chain event",
		"source", src.ChainID(), "dest", dst.ChainID(),
		"nonce", ev.Nonce, "tx", ev.TxHash, "height", ev.BlockHeight)

	// S-3: go-silent fault — skip this submission so the other relayer can take over.
	if r.IsSilent() {
		slog.Warn("handleEvent: SILENT FAULT active — skipping submission (S-3 scenario)",
			"nonce", ev.Nonce, "source", src.ChainID())
		return nil
	}

	// Record raw event in DB.
	r.dbAppendEvent(ctx, ev)

	// Step 1: Write message row to DB (upsert so retries are idempotent).
	msgDBID := r.dbUpsertMessage(ctx, ev)

	// Step 2: Verify consensus on the source block.
	if err := src.VerifyConsensus(ctx, ev.BlockHeight); err != nil {
		return fmt.Errorf("handleEvent VerifyConsensus height=%d: %w", ev.BlockHeight, err)
	}

	// Step 3: Fetch the source inclusion proof.
	proof, err := src.FetchProof(ctx, ev, ev.BlockHeight)
	if err != nil {
		return fmt.Errorf("handleEvent FetchProof: %w", err)
	}

	// Step 4: Build the canonical envelope and transform the proof.
	env := chain.MessageEnvelope{
		SourceChainID: ev.SourceChainID,
		SourceApp:     ev.SourceApp,
		DestChainID:   ev.DestChainID,
		DestApp:       ev.DestApp,
		Action:        ev.Action,
		Payload:       ev.Payload,
		Nonce:         ev.Nonce,
	}

	transformedProof, err := src.TranslateProofTo(proof, dst.ChainID())
	if err != nil {
		return fmt.Errorf("handleEvent TranslateProofTo: %w", err)
	}

	// S-2: wrong-fingerprint fault — tamper the transformed root before submission.
	if r.HasWrongFingerprintFault() {
		original := append([]byte(nil), transformedProof.StateRoot...)
		for i := range transformedProof.StateRoot {
			transformedProof.StateRoot[i] ^= 0xFF // flip all bits — guaranteed mismatch
		}
		slog.Warn("handleEvent: WRONG FINGERPRINT FAULT active — tampered root (S-2 scenario)",
			"nonce", ev.Nonce,
			"original_root", hex.EncodeToString(original),
			"tampered_root", hex.EncodeToString(transformedProof.StateRoot))
	}

	fingerprint := transform.FingerprintHex(transformedProof)
	slog.Info("handleEvent: proof transformed",
		"source", src.ChainID(), "dest", dst.ChainID(),
		"nonce", ev.Nonce,
		"transformed_root", fingerprint,
		"proof_bytes", len(transformedProof.ProofBytes))

	// Step 5: Submit to the destination verifier.
	txHash, submissionID, err := dst.SubmitMessage(ctx, env, transformedProof)
	if err != nil {
		return fmt.Errorf("handleEvent SubmitMessage: %w", err)
	}
	// Guard against a zero submissionID (e.g. stub returning [32]byte{}) which
	// would collide with the zero value of any uninitialized pending entry.
	if submissionID == ([32]byte{}) {
		slog.Warn("handleEvent: SubmitMessage returned zero submissionID — skipping pending registration",
			"dest", dst.ChainID(), "nonce", ev.Nonce, "tx_hash", txHash)
		r.dbUpdateMessageStatus(ctx, msgDBID, "submitted")
		return nil
	}
	// Update message status only after confirmed submission.
	r.dbUpdateMessageStatus(ctx, msgDBID, "submitted")

	slog.Info("handleEvent: message submitted",
		"dest", dst.ChainID(), "nonce", ev.Nonce,
		"tx_hash", txHash,
		"submission_id", hex.EncodeToString(submissionID[:]))

	// Step 6: Write submission row + update message status.
	subDBID := r.dbInsertSubmission(ctx, supabase.SubmissionRow{
		MessageID:        msgDBID,
		SubmitterAddress: r.cfg.RelayerAddr,
		Fingerprint:      fingerprint,
		DestTxHash:       txHash,
		Status:           "pending",
	})
	r.dbUpdateMessageStatus(ctx, msgDBID, "challenge_window")

	// Step 7: Register with challenger for the 60-second watch window.
	ps := &pendingSubmission{
		SubmissionID:   submissionID,
		SubmissionDBID: subDBID,
		MessageDBID:    msgDBID,
		SourceChainID:  src.ChainID(),
		BlockHeight:    ev.BlockHeight,
		Nonce:          ev.Nonce,
		Deadline:       time.Now().Add(60 * time.Second),
		Env:            env,
		Proof:          transformedProof,
		DestPlugin:     dst,
		TxHash:         txHash,
	}
	r.addPending(ps)

	// Step 8: Schedule executeMessage after challenge window + buffer.
	r.execWg.Add(1)
	go func() {
		defer r.execWg.Done()
		r.scheduleExecuteMessage(ctx, ps)
	}()

	return nil
}

// scheduleExecuteMessage waits for the challenge window to close, then calls
// ExecuteMessage on the destination chain (Scenario S-1: honest delivery).
func (r *Runner) scheduleExecuteMessage(ctx context.Context, ps *pendingSubmission) {
	waitUntil := ps.Deadline.Add(5 * time.Second) // 5 s buffer past 60 s window
	select {
	case <-ctx.Done():
		return
	case <-time.After(time.Until(waitUntil)):
	}

	// If the submission was already removed (challenged/slashed), skip.
	r.mu.Lock()
	_, stillPending := r.pending[ps.SubmissionID]
	r.mu.Unlock()
	if !stillPending {
		slog.Info("scheduleExecuteMessage: submission no longer pending (challenged?)",
			"submission_id", hex.EncodeToString(ps.SubmissionID[:]))
		return
	}

	slog.Info("scheduleExecuteMessage: challenge window elapsed, executing",
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]),
		"nonce", ps.Nonce)

	execTxHash, err := ps.DestPlugin.ExecuteMessage(ctx, ps.SubmissionID, ps.Proof)
	if err != nil {
		slog.Error("scheduleExecuteMessage: ExecuteMessage failed",
			"submission_id", hex.EncodeToString(ps.SubmissionID[:]),
			"err", err)
		return
	}

	slog.Info("scheduleExecuteMessage: message executed",
		"exec_tx_hash", execTxHash,
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]))

	r.removePending(ps.SubmissionID)
	r.dbUpdateSubmissionStatus(ctx, ps.SubmissionDBID, "confirmed", execTxHash)
	r.dbUpdateMessageStatus(ctx, ps.MessageDBID, "executed")
}

// ─── DB write helpers — all log on error, never crash the hot path ───────────

func (r *Runner) dbUpsertMessage(ctx context.Context, ev chain.Event) int64 {
	if r.cfg.DB == nil {
		return 0
	}
	// messages.payload is `bytea NOT NULL` in PostgreSQL. We send the empty
	// hex literal `\\x` (matches what every existing row uses, including
	// rows the bridge-widget recorder writes). MessageRow.Payload is now a
	// `string` rather than `[]byte` so Go's JSON encoder doesn't fight with
	// PostgREST over base64 vs hex — see supabase/client.go for the full
	// rationale.
	payloadHex := "\\x"
	if len(ev.Payload) > 0 {
		payloadHex = "\\x" + hex.EncodeToString(ev.Payload)
	}
	id, err := r.cfg.DB.UpsertMessage(ctx, supabase.MessageRow{
		Nonce:              ev.Nonce,
		SourceChainID:      ev.SourceChainID,
		SourceApp:          ev.SourceApp,
		DestinationChainID: ev.DestChainID,
		DestinationApp:     ev.DestApp,
		Action:             hex.EncodeToString(ev.Action[:]),
		Payload:            payloadHex,
		Sender:             ev.Sender,
		Recipient:          "", // filled by destination app on mint/release
		Amount:             "0",
		SourceTxHash:       ev.TxHash,
		SourceBlock:        ev.BlockHeight,
		Status:             "pending",
	})
	if err != nil {
		// Inline the err so Railway's JSON-log truncation can't drop the
		// real cause (e.g. a PostgREST 4xx body with the constraint name).
		slog.Error(fmt.Sprintf("db UpsertMessage failed: %v", err), "nonce", ev.Nonce)
	}
	return id
}

func (r *Runner) dbUpdateMessageStatus(ctx context.Context, id int64, status string) {
	if r.cfg.DB == nil || id == 0 {
		return
	}
	if err := r.cfg.DB.UpdateMessageStatus(ctx, id, status); err != nil {
		slog.Error(fmt.Sprintf("db UpdateMessageStatus failed: %v", err), "id", id, "status", status)
	}
}

func (r *Runner) dbInsertSubmission(ctx context.Context, sub supabase.SubmissionRow) int64 {
	if r.cfg.DB == nil {
		return 0
	}
	id, err := r.cfg.DB.InsertSubmission(ctx, sub)
	if err != nil {
		slog.Error(fmt.Sprintf("db InsertSubmission failed: %v", err), "message_id", sub.MessageID)
	}
	return id
}

func (r *Runner) dbUpdateSubmissionStatus(ctx context.Context, id int64, status, txHash string) {
	if r.cfg.DB == nil || id == 0 {
		return
	}
	if err := r.cfg.DB.UpdateSubmissionStatus(ctx, id, status, txHash); err != nil {
		slog.Error(fmt.Sprintf("db UpdateSubmissionStatus failed: %v", err), "id", id)
	}
}

func (r *Runner) dbAppendEvent(ctx context.Context, ev chain.Event) {
	if r.cfg.DB == nil {
		return
	}
	err := r.cfg.DB.AppendEvent(ctx, supabase.EventRow{
		ChainID:         ev.SourceChainID,
		BlockNumber:     ev.BlockHeight,
		TxHash:          ev.TxHash,
		EventType:       "Locked",
		ContractAddress: ev.SourceApp,
		RawData: map[string]any{
			"nonce":    ev.Nonce,
			"sender":   ev.Sender,
			"dest":     ev.DestChainID,
			"dest_app": ev.DestApp,
		},
	})
	if err != nil {
		slog.Error(fmt.Sprintf("db AppendEvent failed: %v", err), "tx", ev.TxHash)
	}
}

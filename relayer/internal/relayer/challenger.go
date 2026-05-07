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

// ChallengeRecord tracks a pending submission that the challenger is watching.
type ChallengeRecord struct {
	SubmissionID   string
	SubmissionDBID int64
	SubmitterAddr  string
	ClaimedRoot    [32]byte
	SourceChainID  string
	BlockHeight    uint64
	Nonce          uint64
	Deadline       time.Time
}

// runChallenger monitors submitted messages and:
//  1. Challenges any whose transformed root does not match the independently recomputed root (S-2).
//  2. Claims absence slash when the challenge window expires without execution (S-3).
func (r *Runner) runChallenger(ctx context.Context) {
	slog.Info("challenger goroutine started")
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("challenger goroutine exiting")
			return
		case <-ticker.C:
			r.scanForChallenges(ctx)
		}
	}
}

// scanForChallenges iterates all pending submissions and:
//   - Independently re-derives the transformed root.
//   - If the re-derived root differs, files an on-chain challenge (S-2).
//   - If the submission is past deadline with no execution recorded, claims absence slash (S-3).
func (r *Runner) scanForChallenges(ctx context.Context) {
	for _, ps := range r.pendingList() {
		// Re-verify the submitted proof.
		rec := ChallengeRecord{
			SubmissionID:   hex.EncodeToString(ps.SubmissionID[:]),
			SubmissionDBID: ps.SubmissionDBID,
			SubmitterAddr:  r.cfg.RelayerAddr,
			ClaimedRoot:    [32]byte(ps.Proof.StateRoot[:32]),
			SourceChainID:  ps.SourceChainID,
			BlockHeight:    ps.BlockHeight,
			Nonce:          ps.Nonce,
			Deadline:       ps.Deadline,
		}
		if n := copy(rec.ClaimedRoot[:], ps.Proof.StateRoot); n < 32 {
			// proof StateRoot shorter than 32 bytes — keep remainder as zeros
		}

		matches, ourRoot, err := r.VerifySubmission(ctx, rec)
		if err != nil {
			slog.Error("challenger: VerifySubmission failed",
				"submission_id", rec.SubmissionID, "err", err)
			continue
		}

		if !matches {
			// S-2: fraud detected — file on-chain challenge.
			r.handleFraud(ctx, ps, ourRoot)
			continue
		}

		// S-3: check absence — if past deadline + still in pending (not executed by us),
		// claim absence slash so the submission is removed and the original submitter slashed.
		// NOTE: In the honest-path (S-1), scheduleExecuteMessage removes the entry before
		// this deadline check fires. Only truly absent submissions reach here.
		if time.Now().After(ps.Deadline.Add(30 * time.Second)) {
			r.handleAbsence(ctx, ps)
		}
	}
}

// handleFraud files an on-chain challenge for a fraudulent submission (S-2).
func (r *Runner) handleFraud(ctx context.Context, ps *pendingSubmission, ourRoot [32]byte) {
	slog.Warn("FRAUD DETECTED: filing on-chain challenge",
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]),
		"claimed_root", hex.EncodeToString(ps.Proof.StateRoot),
		"our_root", hex.EncodeToString(ourRoot[:]),
		"nonce", ps.Nonce)

	// Build counter-proof using our independently computed root.
	counterProof := ps.Proof
	counterProof.StateRoot = ourRoot[:]

	txHash, err := ps.DestPlugin.SubmitChallenge(ctx, ps.SubmissionID, counterProof)
	if err != nil {
		slog.Error("handleFraud: SubmitChallenge failed",
			"submission_id", hex.EncodeToString(ps.SubmissionID[:]), "err", err)
		return
	}

	slog.Info("handleFraud: challenge filed",
		"tx_hash", txHash,
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]))

	r.removePending(ps.SubmissionID)
	r.dbUpdateSubmissionStatus(ctx, ps.SubmissionDBID, "challenged", txHash)
	r.dbUpdateMessageStatus(ctx, ps.MessageDBID, "challenged")

	// Record dispute in DB.
	if r.cfg.DB != nil && ps.SubmissionDBID != 0 {
		disputeID, err := r.cfg.DB.InsertDispute(ctx, supabase.DisputeRow{
			SubmissionID:       ps.SubmissionDBID,
			ChallengerAddress:  r.cfg.RelayerAddr,
			CorrectFingerprint: hex.EncodeToString(ourRoot[:]),
			DisputeTxHash:      txHash,
			Outcome:            "pending",
		})
		if err != nil {
			slog.Error("db InsertDispute failed", "err", err)
			return
		}
		slog.Debug("db: dispute recorded", "dispute_id", disputeID)
	}
}

// handleAbsence claims an absence slash when the assigned submitter did not act (S-3).
func (r *Runner) handleAbsence(ctx context.Context, ps *pendingSubmission) {
	slog.Warn("absence detected: claiming slash",
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]),
		"nonce", ps.Nonce,
		"deadline_expired", time.Now().After(ps.Deadline))

	txHash, err := ps.DestPlugin.ClaimAbsenceSlash(ctx, ps.SubmissionID)
	if err != nil {
		slog.Error("handleAbsence: ClaimAbsenceSlash failed",
			"submission_id", hex.EncodeToString(ps.SubmissionID[:]), "err", err)
		return
	}

	slog.Info("handleAbsence: absence slash claimed",
		"tx_hash", txHash,
		"submission_id", hex.EncodeToString(ps.SubmissionID[:]))

	r.removePending(ps.SubmissionID)
	r.dbUpdateSubmissionStatus(ctx, ps.SubmissionDBID, "slashed", txHash)
	r.dbUpdateMessageStatus(ctx, ps.MessageDBID, "reverted")
}

// VerifySubmission independently verifies a submission's transformed root (R-52).
// Returns (true, ourRoot, nil) if our computed root matches the claimed root.
// Returns (false, ourRoot, nil) if a mismatch is detected — caller should file dispute.
func (r *Runner) VerifySubmission(ctx context.Context, rec ChallengeRecord) (bool, [32]byte, error) {
	src, dst := r.pluginForChain(rec.SourceChainID)
	if src == nil {
		return false, [32]byte{}, errUnknownChain(rec.SourceChainID)
	}

	ev := chain.Event{
		SourceChainID: rec.SourceChainID,
		BlockHeight:   rec.BlockHeight,
		Nonce:         rec.Nonce,
	}
	proof, err := src.FetchProof(ctx, ev, rec.BlockHeight)
	if err != nil {
		return false, [32]byte{}, fmt.Errorf("VerifySubmission FetchProof: %w", err)
	}

	destChainID := ""
	if dst != nil {
		destChainID = dst.ChainID()
	}
	transformed, err := src.TranslateProofTo(proof, destChainID)
	if err != nil {
		return false, [32]byte{}, fmt.Errorf("VerifySubmission TranslateProofTo: %w", err)
	}

	var ourRoot [32]byte
	copy(ourRoot[:], transformed.StateRoot)
	matches := ourRoot == rec.ClaimedRoot

	if !matches {
		slog.Warn("FRAUD DETECTED: submitted root differs from independently computed root",
			"submission_id", rec.SubmissionID,
			"claimed_root", fmt.Sprintf("%x", rec.ClaimedRoot),
			"our_root", fmt.Sprintf("%x", ourRoot),
			"source", rec.SourceChainID,
			"height", rec.BlockHeight,
			"nonce", rec.Nonce)
	}
	return matches, ourRoot, nil
}

// dbUpdateDisputeOutcome updates a dispute row after on-chain resolution.
func (r *Runner) dbUpdateDisputeOutcome(ctx context.Context, id int64, outcome, txHash string) {
	if r.cfg.DB == nil || id == 0 {
		return
	}
	if err := r.cfg.DB.UpdateDisputeOutcome(ctx, id, outcome, txHash); err != nil {
		slog.Error("db UpdateDisputeOutcome failed", "id", id, "err", err)
	}
}

// Compile-time reference to transform package (ensures it is imported).
var _ = transform.FlagSHA256

package relayer

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// runSubmitter runs the event listener + submission handler for a source→dest direction.
// For each event received, it executes the fetch → verifyConsensus → fetchProof →
// transform → submit pipeline. The loop runs until ctx is cancelled or the event
// channel is closed.
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
				// Log and continue — a single event failure must not crash the loop.
				slog.Error("submitter: handleEvent failed",
					"source", src.ChainID(), "dest", dst.ChainID(),
					"nonce", ev.Nonce, "tx", ev.TxHash, "err", err)
			}
		}
	}
}

// handleEvent processes a single cross-chain event through the full relay pipeline:
//  1. VerifyConsensus — confirms the source block has sufficient validator consensus.
//  2. FetchProof — retrieves the native inclusion proof from the source chain.
//  3. TranslateProofTo — converts the proof to the TesseraProof wire format.
//  4. SubmitMessage — submits the envelope + proof to the destination verifier.
func (r *Runner) handleEvent(ctx context.Context, src, dst chain.Plugin, ev chain.Event) error {
	slog.Info("handleEvent: received cross-chain event",
		"source", src.ChainID(), "dest", dst.ChainID(),
		"nonce", ev.Nonce, "tx", ev.TxHash, "height", ev.BlockHeight)

	// Step 1: Verify consensus on the source block.
	// For Tendermint this is a real Ed25519 2/3+ check; for EVM it trusts the RPC (R-54).
	if err := src.VerifyConsensus(ctx, ev.BlockHeight); err != nil {
		return fmt.Errorf("handleEvent VerifyConsensus height=%d: %w", ev.BlockHeight, err)
	}

	// Step 2: Fetch the source inclusion proof.
	proof, err := src.FetchProof(ctx, ev, ev.BlockHeight)
	if err != nil {
		return fmt.Errorf("handleEvent FetchProof: %w", err)
	}

	// Step 3: Build the canonical envelope and transform the proof to the destination format.
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

	fingerprint := transform.FingerprintHex(transformedProof)
	slog.Info("handleEvent: proof transformed",
		"source", src.ChainID(), "dest", dst.ChainID(),
		"nonce", ev.Nonce,
		"transformed_root", fingerprint,
		"proof_bytes", len(transformedProof.ProofBytes))

	// Step 4: Submit to the destination verifier.
	txHash, err := dst.SubmitMessage(ctx, env, transformedProof)
	if err == chain.ErrNotImplemented {
		// Expected until P-6 wires real contract submission.
		slog.Info("handleEvent: SubmitMessage not implemented yet (P-6 will wire this)",
			"dest", dst.ChainID(), "nonce", ev.Nonce)
		return nil
	}
	if err != nil {
		return fmt.Errorf("handleEvent SubmitMessage: %w", err)
	}

	slog.Info("handleEvent: message submitted",
		"dest", dst.ChainID(), "nonce", ev.Nonce, "tx_hash", txHash)
	return nil
}

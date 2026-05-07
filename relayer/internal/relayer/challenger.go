package relayer

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// ChallengeRecord tracks a pending submission that the challenger is watching.
// A relayer independently re-derives the transformed root to detect fraud.
type ChallengeRecord struct {
	SubmissionID  string
	SubmitterAddr string
	ClaimedRoot   [32]byte
	SourceChainID string
	BlockHeight   uint64
	Nonce         uint64
	Deadline      time.Time // challenge window closes at this time (60 s on testnet)
}

// runChallenger monitors submitted messages and challenges any whose claimed
// transformed root does not match the independently recomputed root (R-53).
// In P-4 the watcher loop is established; real on-chain challenge filing is P-7.
func (r *Runner) runChallenger(ctx context.Context) {
	slog.Info("challenger goroutine started")
	ticker := time.NewTicker(15 * time.Second)
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

// scanForChallenges re-verifies recent submissions by independently replicating
// the proof transformation and comparing to the submitted fingerprint.
// P-4: logs intent. P-7 wires real on-chain challenge submission.
func (r *Runner) scanForChallenges(ctx context.Context) {
	// P-4: The scanning logic identifies the intent; the on-chain challenge call
	// is implemented in P-7. The transform package is referenced here to confirm
	// the dependency is wired correctly.
	slog.Debug("challenger: scanning for fraudulent submissions (P-7 will file disputes)",
		"eth_chain", r.cfg.EthPlugin.ChainID(),
		"tm_chain", r.cfg.TmPlugin.ChainID())
	_ = transform.FlagSHA256 // confirms transform package is wired
	_ = ctx                  // consumed in P-7 when making RPC calls
}

// VerifySubmission independently verifies a submission's transformed root.
// Returns (true, ourRoot, nil) if our computed root matches the claimed root.
// Returns (false, ourRoot, nil) if a mismatch is detected — the caller should
// file a dispute (P-7 implementation).
//
// The algorithm:
//  1. Look up the source plugin by chainID.
//  2. Re-fetch the source proof at the recorded block height.
//  3. Re-run the same transformation used by the submitter.
//  4. Compare the computed root to the claimed root.
func (r *Runner) VerifySubmission(ctx context.Context, rec ChallengeRecord) (bool, [32]byte, error) {
	src, _ := r.pluginForChain(rec.SourceChainID)
	if src == nil {
		return false, [32]byte{}, errUnknownChain(rec.SourceChainID)
	}

	// Re-fetch the source proof using a minimal Event.
	// P-6 will supply the full event from on-chain state; here we use what we know.
	ev := chain.Event{
		SourceChainID: rec.SourceChainID,
		BlockHeight:   rec.BlockHeight,
		Nonce:         rec.Nonce,
	}
	proof, err := src.FetchProof(ctx, ev, rec.BlockHeight)
	if err != nil {
		return false, [32]byte{}, fmt.Errorf("VerifySubmission FetchProof: %w", err)
	}

	// Re-run the transformation with the source plugin.
	// TranslateProofTo uses the same deterministic algorithm as the original submitter (R-52).
	transformed, err := src.TranslateProofTo(proof, rec.SourceChainID)
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
			"nonce", rec.Nonce,
			"p7_note", "filing on-chain dispute is P-7 work")
	}
	return matches, ourRoot, nil
}

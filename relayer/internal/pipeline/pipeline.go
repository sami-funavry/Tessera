// Package pipeline wires the multi-stage relay pipeline together.
// In P-3 it demonstrates the full data flow using real chain fingerprints
// with stub transforms (P-4 fills PatriciaToIAVL / IAVLToPatricia) and stub
// submissions (P-6 fills SubmitMessage / SubmitChallenge).
package pipeline

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/tessera-bridge/tessera/internal/chain"
)

// Runner orchestrates the multi-stage relay pipeline.
// EthPlugin is the Sepolia adapter; TmPlugin is the Neutron adapter.
type Runner struct {
	EthPlugin chain.Plugin
	TmPlugin  chain.Plugin
}

// RunMockSepoliaToNeutron demonstrates the Sepolia→Neutron pipeline (R-51).
//
// Stages:
//  1. Verify Sepolia consensus (stub: trusts RPC per R-54/R-122)
//  2. Fetch Sepolia block fingerprint (real stateRoot)
//  3. Construct a mock Locked event (P-6 replaces with real subscribed events)
//  4. Fetch Patricia proof via eth_getProof (placeholder address until P-5)
//  5. Transform proof Patricia→IAVL (stub — P-4 implements)
//  6. Submit to Neutron verifier (stub — P-6 implements)
func (r *Runner) RunMockSepoliaToNeutron(ctx context.Context) error {
	slog.Info("pipeline: Sepolia→Neutron mock run starting")

	// Stage 1: Verify Sepolia consensus.
	// Stub per R-54: logs a warning and returns nil (trusts RPC).
	sepoliaHeight, err := r.EthPlugin.LatestBlock(ctx)
	if err != nil {
		return fmt.Errorf("pipeline Sepolia→Neutron stage 1 LatestBlock: %w", err)
	}
	if err := r.EthPlugin.VerifyConsensus(ctx, sepoliaHeight); err != nil {
		return fmt.Errorf("pipeline Sepolia→Neutron stage 1 VerifyConsensus: %w", err)
	}
	slog.Info("pipeline: stage 1 consensus verified", "chain", "sepolia", "height", sepoliaHeight)

	// Stage 2: Fetch Sepolia block fingerprint (real stateRoot from chain).
	fp, err := r.EthPlugin.FetchBlockFingerprint(ctx, sepoliaHeight)
	if err != nil {
		return fmt.Errorf("pipeline Sepolia→Neutron stage 2 FetchBlockFingerprint: %w", err)
	}
	slog.Info("pipeline: stage 2 fingerprint fetched",
		"chain", "sepolia",
		"height", fp.Height,
		"root_prefix", fmt.Sprintf("0x%x...", fp.Root[:4]),
		"timestamp", fp.Timestamp.UTC())

	// Stage 3: Construct a mock Locked event.
	// P-6 will replace this with events received from SubscribeEvents.
	// P-5 will replace placeholder addresses with deployed contract addresses.
	mockEvent := chain.Event{
		SourceChainID: "sepolia",
		DestChainID:   "pion-1",
		SourceApp:     "<BRIDGE_VAULT_PLACEHOLDER>",     // P-5: deployed BridgeVault address
		DestApp:       "<BRIDGE_MINT_PLACEHOLDER>",      // P-5: deployed BridgeMint contract addr
		Action:        [4]byte{0x12, 0x34, 0x56, 0x78}, // P-5: real Locked event selector
		Payload:       []byte(`{"recipient":"neutron1placeholder","amount":"1000000","nonce":0}`),
		Nonce:         0,
		BlockHeight:   sepoliaHeight,
	}
	slog.Info("pipeline: stage 3 mock lock event constructed",
		"nonce", mockEvent.Nonce, "source", mockEvent.SourceChainID, "dest", mockEvent.DestChainID)

	// Stage 4: Fetch Patricia proof via eth_getProof.
	// Uses placeholder address (zero address) until P-5 deploys BridgeVault.
	proof, err := r.EthPlugin.FetchProof(ctx, mockEvent, sepoliaHeight)
	if err != nil {
		// Non-fatal in P-3: placeholder address will likely return a valid but
		// uninteresting proof. Log the error and continue to demonstrate the pipeline.
		slog.Warn("pipeline: stage 4 proof fetch error (placeholder address expected in P-3)",
			"err", err)
		proof = chain.Proof{ChainID: "sepolia", BlockNumber: sepoliaHeight}
	} else {
		slog.Info("pipeline: stage 4 Patricia proof fetched",
			"bytes", len(proof.ProofBytes), "state_root", fmt.Sprintf("0x%x...", proof.StateRoot[:4]))
	}

	// Stage 5: Transform proof Patricia→IAVL.
	// ErrNotImplemented is expected here until P-4.
	transformed, transformErr := r.EthPlugin.TranslateProofTo(proof, "pion-1")
	if errors.Is(transformErr, chain.ErrNotImplemented) {
		slog.Info("pipeline: stage 5 transform stub (P-4 will implement PatriciaToIAVL here)",
			"status", "P-4 pending")
	} else if transformErr != nil {
		return fmt.Errorf("pipeline Sepolia→Neutron stage 5 TranslateProofTo: %w", transformErr)
	} else {
		slog.Info("pipeline: stage 5 transform complete", "bytes", len(transformed.ProofBytes))
	}

	// Stage 6: Submit to Neutron verifier.
	// ErrNotImplemented is expected until P-6.
	_, submitErr := r.TmPlugin.SubmitMessage(ctx, chain.MessageEnvelope{
		SourceChainID: "sepolia",
		DestChainID:   "pion-1",
		SourceApp:     mockEvent.SourceApp,
		DestApp:       mockEvent.DestApp,
		Action:        mockEvent.Action,
		Payload:       mockEvent.Payload,
		Nonce:         mockEvent.Nonce,
	}, proof)
	if errors.Is(submitErr, chain.ErrNotImplemented) {
		slog.Info("pipeline: stage 6 submit stub (P-6 will call Neutron verifier here)",
			"status", "P-6 pending")
	} else if submitErr != nil {
		return fmt.Errorf("pipeline Sepolia→Neutron stage 6 SubmitMessage: %w", submitErr)
	}

	slog.Info("pipeline: Sepolia→Neutron mock run COMPLETE — ready for P-4 transform")
	return nil
}

// RunMockNeutronToSepolia demonstrates the Neutron→Sepolia pipeline (R-51).
//
// Stages:
//  1. Verify Neutron consensus (real Ed25519 2/3+ check per R-55)
//  2. Fetch Neutron block fingerprint (real AppHash)
//  3. Construct a mock Burned event
//  4. Fetch IAVL proof via ABCI query (placeholder path until P-5)
//  5. Transform proof IAVL→Patricia (stub — P-4 implements)
//  6. Submit to Sepolia verifier (stub — P-6 implements)
func (r *Runner) RunMockNeutronToSepolia(ctx context.Context) error {
	slog.Info("pipeline: Neutron→Sepolia mock run starting")

	// Stage 1: Verify Neutron consensus.
	// This calls real Ed25519 verification against the Neutron testnet validators.
	neutronHeight, err := r.TmPlugin.LatestBlock(ctx)
	if err != nil {
		return fmt.Errorf("pipeline Neutron→Sepolia stage 1 LatestBlock: %w", err)
	}
	if err := r.TmPlugin.VerifyConsensus(ctx, neutronHeight); err != nil {
		// Degraded path: log and continue. VerifyConsensus failure is surfaced but
		// does not abort the mock run so the pipeline shape is still demonstrated.
		slog.Warn("pipeline: stage 1 Neutron consensus verification failed (may be a transient RPC issue)",
			"err", err, "height", neutronHeight)
	} else {
		slog.Info("pipeline: stage 1 Ed25519 consensus verified",
			"chain", "pion-1", "height", neutronHeight)
	}

	// Stage 2: Fetch Neutron block fingerprint (real AppHash from chain).
	fp, err := r.TmPlugin.FetchBlockFingerprint(ctx, neutronHeight)
	if err != nil {
		return fmt.Errorf("pipeline Neutron→Sepolia stage 2 FetchBlockFingerprint: %w", err)
	}
	appHashPrefix := "<empty>"
	if len(fp.Root) >= 4 {
		appHashPrefix = fmt.Sprintf("0x%x...", fp.Root[:4])
	}
	slog.Info("pipeline: stage 2 fingerprint fetched",
		"chain", "pion-1", "height", fp.Height,
		"app_hash_prefix", appHashPrefix,
		"timestamp", fp.Timestamp.UTC())

	// Stage 3: Construct a mock Burned event.
	// P-6 will replace this with events from SubscribeEvents.
	mockEvent := chain.Event{
		SourceChainID: "pion-1",
		DestChainID:   "sepolia",
		SourceApp:     "<BRIDGE_BURN_PLACEHOLDER>",      // P-5: deployed bridge burn contract addr
		DestApp:       "<BRIDGE_UNLOCK_PLACEHOLDER>",    // P-5: deployed BridgeVault address
		Action:        [4]byte{0xAB, 0xCD, 0xEF, 0x01}, // P-5: real Burned event type
		Payload:       []byte(`{"recipient":"0xplaceholder","amount":"1000000","nonce":0}`),
		Nonce:         0,
		BlockHeight:   neutronHeight,
	}
	slog.Info("pipeline: stage 3 mock burned event constructed",
		"nonce", mockEvent.Nonce, "source", mockEvent.SourceChainID, "dest", mockEvent.DestChainID)

	// Stage 4: Fetch IAVL proof via ABCI query.
	// Uses placeholder path until P-5 deploys the bridge CosmWasm contract.
	proof, err := r.TmPlugin.FetchProof(ctx, mockEvent, neutronHeight)
	if err != nil {
		slog.Warn("pipeline: stage 4 ABCI proof fetch error (placeholder path expected in P-3)",
			"err", err)
		proof = chain.Proof{ChainID: "pion-1", BlockNumber: neutronHeight}
	} else {
		slog.Info("pipeline: stage 4 IAVL proof fetched",
			"bytes", len(proof.ProofBytes), "app_hash_prefix", appHashPrefix)
	}

	// Stage 5: Transform proof IAVL→Patricia.
	// ErrNotImplemented expected until P-4.
	transformed, transformErr := r.TmPlugin.TranslateProofTo(proof, "sepolia")
	if errors.Is(transformErr, chain.ErrNotImplemented) {
		slog.Info("pipeline: stage 5 transform stub (P-4 will implement IAVLToPatricia here)",
			"status", "P-4 pending")
	} else if transformErr != nil {
		return fmt.Errorf("pipeline Neutron→Sepolia stage 5 TranslateProofTo: %w", transformErr)
	} else {
		slog.Info("pipeline: stage 5 transform complete", "bytes", len(transformed.ProofBytes))
	}

	// Stage 6: Submit to Sepolia verifier.
	// ErrNotImplemented expected until P-6.
	_, submitErr := r.EthPlugin.SubmitMessage(ctx, chain.MessageEnvelope{
		SourceChainID: "pion-1",
		DestChainID:   "sepolia",
		SourceApp:     mockEvent.SourceApp,
		DestApp:       mockEvent.DestApp,
		Action:        mockEvent.Action,
		Payload:       mockEvent.Payload,
		Nonce:         mockEvent.Nonce,
	}, proof)
	if errors.Is(submitErr, chain.ErrNotImplemented) {
		slog.Info("pipeline: stage 6 submit stub (P-6 will call Sepolia verifier here)",
			"status", "P-6 pending")
	} else if submitErr != nil {
		return fmt.Errorf("pipeline Neutron→Sepolia stage 6 SubmitMessage: %w", submitErr)
	}

	slog.Info("pipeline: Neutron→Sepolia mock run COMPLETE — ready for P-4 transform")
	return nil
}

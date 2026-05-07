// Package tendermint implements the Tessera chain plugin for Neutron/Cosmos chains.
// It uses CometBFT v0.38.x for RPC access and ABCI queries for IAVL proofs.
package tendermint

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	rpcclient "github.com/cometbft/cometbft/rpc/client"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	"github.com/cometbft/cometbft/types"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// Plugin is the Neutron/Tendermint chain adapter.
// It dials the RPC endpoint lazily on first use.
type Plugin struct {
	rpcURL  string
	chainID string
	mu      sync.Mutex
	client  *rpchttp.HTTP
}

// New returns a new Tendermint plugin. The RPC connection is established lazily
// on the first method call that requires it.
func New(rpcURL, chainID string) *Plugin {
	return &Plugin{
		rpcURL:  rpcURL,
		chainID: chainID,
	}
}

// connect establishes the CometBFT HTTP RPC connection if not already connected.
// It is idempotent: concurrent callers block on the mutex but only one dials.
//
// Note: Start() is only needed for WebSocket event subscriptions. For RPC-only
// use (LatestBlock, FetchBlockFingerprint, VerifyConsensus) we do not call Start.
func (p *Plugin) connect() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.client != nil {
		return nil
	}
	c, err := rpchttp.New(p.rpcURL, "/websocket")
	if err != nil {
		return fmt.Errorf("tendermint plugin dial %s: %w", p.rpcURL, err)
	}
	p.client = c
	slog.Info("tendermint plugin connected", "chain", p.chainID, "rpc", p.rpcURL)
	return nil
}

// ChainID returns the canonical chain identifier.
func (p *Plugin) ChainID() string { return p.chainID }

// LatestBlock returns the latest block height on the Tendermint/CometBFT chain.
func (p *Plugin) LatestBlock(ctx context.Context) (uint64, error) {
	if err := p.connect(); err != nil {
		return 0, err
	}
	status, err := p.client.Status(ctx)
	if err != nil {
		return 0, fmt.Errorf("tendermint LatestBlock: %w", err)
	}
	return uint64(status.SyncInfo.LatestBlockHeight), nil
}

// FetchBlockFingerprint retrieves the AppHash of the block at height.
// The AppHash is the 32-byte Merkle root of the Cosmos application state (IAVL).
func (p *Plugin) FetchBlockFingerprint(ctx context.Context, height uint64) (chain.Fingerprint, error) {
	if err := p.connect(); err != nil {
		return chain.Fingerprint{}, err
	}
	h := int64(height)
	result, err := p.client.Block(ctx, &h)
	if err != nil {
		return chain.Fingerprint{}, fmt.Errorf("tendermint FetchBlockFingerprint height=%d: %w", height, err)
	}
	return chain.Fingerprint{
		ChainID:   p.chainID,
		Height:    height,
		Root:      result.Block.Header.AppHash, // IAVL app hash, sha256, up to 32 bytes
		Timestamp: result.Block.Header.Time,
	}, nil
}

// FetchProof retrieves an IAVL inclusion proof via ABCI query for the given event.
//
// P-5 note: the ABCI query path and key are placeholders until the bridge CosmWasm
// contract is deployed to Neutron. After P-5, replace path and key with the real
// contract store path and nonce key.
func (p *Plugin) FetchProof(ctx context.Context, event chain.Event, height uint64) (chain.Proof, error) {
	if err := p.connect(); err != nil {
		return chain.Proof{}, err
	}

	// P-5: replace with real CosmWasm contract store path, e.g. "/store/wasm/key".
	path := "/store/bank/key"
	// P-5: replace with real nonce→recipient key from the bridge contract state.
	key := []byte("placeholder-key")
	slog.Warn("tendermint FetchProof using placeholder ABCI path/key — replace with bridge contract after P-5",
		"chain", p.chainID, "height", height, "path", path)

	opts := rpcclient.ABCIQueryOptions{Height: int64(height), Prove: true}
	result, err := p.client.ABCIQueryWithOptions(ctx, path, key, opts)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof ABCIQuery height=%d: %w", height, err)
	}
	if result.Response.IsErr() {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof ABCI error code=%d log=%s",
			result.Response.Code, result.Response.Log)
	}

	// Fetch the AppHash to embed in the proof as the authoritative state root.
	fp, err := p.FetchBlockFingerprint(ctx, height)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof fingerprint: %w", err)
	}

	// Serialise all proof ops as JSON so the transform layer can access every op.
	// The tendermintProofJSON format is shared with the transform package.
	type tendermintProofJSON struct {
		Value    hexutil.Bytes   `json:"value"`
		ProofOps []hexutil.Bytes `json:"proof_ops"`
	}
	var opData []hexutil.Bytes
	if result.Response.ProofOps != nil {
		for _, op := range result.Response.ProofOps.GetOps() {
			opData = append(opData, op.Data)
		}
	}
	tmProof := tendermintProofJSON{
		Value:    result.Response.Value,
		ProofOps: opData,
	}
	proofBytes, err := json.Marshal(tmProof)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof marshal proof: %w", err)
	}

	return chain.Proof{
		ChainID:     p.chainID,
		BlockNumber: height,
		StateRoot:   fp.Root,
		ProofBytes:  proofBytes, // JSON-encoded all proof ops (P-5 fills with real data)
		KeyPath:     key,
		Value:       result.Response.Value,
	}, nil
}

// VerifyConsensus verifies that 2/3+ of the validators signed the block at height
// using Ed25519 signatures.
//
// This is the critical Ed25519 bypass (R-55): the EVM cannot verify Ed25519 at
// acceptable gas cost, so we verify Tendermint consensus off-chain in Go.
// The result (a verified AppHash) is then embedded in the proof submitted to
// the Solidity verifier, which only needs to verify the Patricia walk.
func (p *Plugin) VerifyConsensus(ctx context.Context, height uint64) error {
	if err := p.connect(); err != nil {
		return err
	}
	h := int64(height)

	// Fetch the signed commit for this block.
	commitResult, err := p.client.Commit(ctx, &h)
	if err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Commit height=%d: %w", height, err)
	}

	// Fetch all validators at this height. Pagination nil/nil fetches up to 100 by default.
	valResult, err := p.client.Validators(ctx, &h, nil, nil)
	if err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Validators height=%d: %w", height, err)
	}

	// Build the full validator set for this height.
	valSet := types.NewValidatorSet(valResult.Validators)

	// VerifyCommit checks that 2/3+ of the voting power in valSet signed the commit
	// using Ed25519 signatures. This is what makes the bypass possible — Ed25519
	// verification happens here in Go, not in the EVM Solidity verifier.
	if err := valSet.VerifyCommit(
		p.chainID,
		commitResult.SignedHeader.Commit.BlockID,
		h,
		commitResult.SignedHeader.Commit,
	); err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Ed25519 check failed height=%d: %w", height, err)
	}

	slog.Info("tendermint VerifyConsensus: 2/3+ Ed25519 signatures verified",
		"chain", p.chainID, "height", height,
		"validators", len(valResult.Validators))
	return nil
}

// SubscribeEvents watches for cross-chain Burned events emitted by the bridge CosmWasm contract.
//
// P-5 note: the contract address and event filter are placeholders until the bridge
// contract is deployed to Neutron. In P-3, the subscription returns an open (but empty)
// channel that closes when ctx is cancelled.
func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.Event, error) {
	if err := p.connect(); err != nil {
		return nil, err
	}
	slog.Warn("tendermint SubscribeEvents using stub — no contract address until P-5",
		"chain", p.chainID, "from_block", fromBlock)

	ch := make(chan chain.Event)
	go func() {
		defer close(ch)
		// P-3: polling via TxSearch would go here. P-5 adds real event type filter.
		// For now we just hold until context cancellation.
		_ = fromBlock // consumed in P-5
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				slog.Info("tendermint SubscribeEvents goroutine exiting", "chain", p.chainID)
				return
			case <-ticker.C:
				// P-5: scan new blocks for Burned events here.
			}
		}
	}()
	return ch, nil
}

// TranslateProofTo converts the IAVL proof into a TesseraProof for destChainID.
// Implemented in P-4 using IAVLToPatricia (Keccak256 hashing for Sepolia verifier).
// The MessageEnvelope is partially constructed from the proof; P-6 will supply
// the full envelope from the event.
func (p *Plugin) TranslateProofTo(proof chain.Proof, destChainID string) (chain.Proof, error) {
	env := chain.MessageEnvelope{
		SourceChainID: p.chainID, // "pion-1"
		DestChainID:   destChainID,
	}
	return transform.IAVLToPatricia(proof, env)
}

// SubmitMessage submits a message and proof to the Sepolia verifier contract.
// Stub — implemented in P-6.
func (p *Plugin) SubmitMessage(ctx context.Context, env chain.MessageEnvelope, proof chain.Proof) (string, error) {
	return "", chain.ErrNotImplemented
}

// SubmitChallenge files a dispute against a submitted message on Neutron.
// Stub — implemented in P-7.
func (p *Plugin) SubmitChallenge(ctx context.Context, msgID string, counterProof chain.Proof) (string, error) {
	return "", chain.ErrNotImplemented
}

// Compile-time assertion: Plugin implements chain.Plugin.
var _ chain.Plugin = (*Plugin)(nil)

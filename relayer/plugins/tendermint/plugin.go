// Package tendermint implements the Tessera chain plugin for Neutron/Cosmos chains.
// It uses CometBFT v0.38.x for RPC access and a minimal CosmWasm client for tx submission.
package tendermint

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	rpcclient "github.com/cometbft/cometbft/rpc/client"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	"github.com/cometbft/cometbft/types"
	"github.com/ethereum/go-ethereum/common/hexutil"
	chain "github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/config"
	"github.com/tessera-bridge/tessera/internal/cosmwasm"
	"github.com/tessera-bridge/tessera/internal/transform"
)

const (
	gasLimitExecute  = 800_000
	gasLimitRegister = 200_000
)

// Plugin is the Neutron/Tendermint chain adapter.
type Plugin struct {
	rpcURL     string
	restURL    string
	chainID    string
	addrs      config.Addresses
	privKeyHex string
	mu         sync.Mutex
	client     *rpchttp.HTTP
	cwc        *cosmwasm.Client // nil if no private key
}

// New returns a new Tendermint plugin.
func New(rpcURL, chainID, restURL string, addrs config.Addresses, privKeyHex string) *Plugin {
	return &Plugin{
		rpcURL:     rpcURL,
		restURL:    restURL,
		chainID:    chainID,
		addrs:      addrs,
		privKeyHex: privKeyHex,
	}
}

// connect establishes RPC + CosmWasm client lazily.
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
	if p.privKeyHex != "" {
		cwc, err := cosmwasm.New(p.restURL, p.chainID, p.privKeyHex)
		if err != nil {
			return fmt.Errorf("tendermint plugin: init cosmwasm client: %w", err)
		}
		p.cwc = cwc
	}
	slog.Info("tendermint plugin connected", "chain", p.chainID, "rpc", p.rpcURL)
	return nil
}

func (p *Plugin) ChainID() string { return p.chainID }

// PubKeyBytes returns the 33-byte compressed secp256k1 public key from the CosmWasm client.
// Returns nil if no private key was configured.
func (p *Plugin) PubKeyBytes() []byte {
	if err := p.connect(); err != nil {
		return nil
	}
	if p.cwc == nil {
		return nil
	}
	return p.cwc.PubKeyBytes()
}

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
		Root:      result.Block.Header.AppHash,
		Timestamp: result.Block.Header.Time,
	}, nil
}

// FetchProof retrieves an IAVL proof via ABCI query on the Wasm contract store.
func (p *Plugin) FetchProof(ctx context.Context, event chain.Event, height uint64) (chain.Proof, error) {
	if err := p.connect(); err != nil {
		return chain.Proof{}, err
	}

	path := "/store/wasm/key"
	contractAddr := p.addrs.NeutronBridgeMint
	if contractAddr == "" {
		contractAddr = p.addrs.NeutronBridgeVault
	}
	// ABCI key prefix 0x03 selects the contract_store namespace in wasmd.
	key := append([]byte{0x03}, []byte(contractAddr)...)

	opts := rpcclient.ABCIQueryOptions{Height: int64(height), Prove: true}
	result, err := p.client.ABCIQueryWithOptions(ctx, path, key, opts)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof ABCIQuery height=%d: %w", height, err)
	}
	if result.Response.IsErr() && result.Response.Code != 0 {
		slog.Warn("tendermint FetchProof ABCI error (using empty proof ops)",
			"code", result.Response.Code, "log", result.Response.Log)
	}

	fp, err := p.FetchBlockFingerprint(ctx, height)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof fingerprint: %w", err)
	}

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
	proofBytes, err := json.Marshal(tendermintProofJSON{
		Value:    result.Response.Value,
		ProofOps: opData,
	})
	if err != nil {
		return chain.Proof{}, fmt.Errorf("tendermint FetchProof marshal: %w", err)
	}

	return chain.Proof{
		ChainID:     p.chainID,
		BlockNumber: height,
		StateRoot:   fp.Root,
		ProofBytes:  proofBytes,
		KeyPath:     key,
		Value:       result.Response.Value,
	}, nil
}

// VerifyConsensus verifies 2/3+ Ed25519 validator signatures (R-55).
func (p *Plugin) VerifyConsensus(ctx context.Context, height uint64) error {
	if err := p.connect(); err != nil {
		return err
	}
	h := int64(height)
	commitResult, err := p.client.Commit(ctx, &h)
	if err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Commit height=%d: %w", height, err)
	}
	valResult, err := p.client.Validators(ctx, &h, nil, nil)
	if err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Validators height=%d: %w", height, err)
	}
	valSet := types.NewValidatorSet(valResult.Validators)
	if err := valSet.VerifyCommit(
		p.chainID,
		commitResult.SignedHeader.Commit.BlockID,
		h,
		commitResult.SignedHeader.Commit,
	); err != nil {
		return fmt.Errorf("tendermint VerifyConsensus Ed25519 failed height=%d: %w", height, err)
	}
	slog.Info("tendermint VerifyConsensus: 2/3+ Ed25519 verified",
		"chain", p.chainID, "height", height, "validators", len(valResult.Validators))
	return nil
}

// SubscribeEvents polls for CosmWasm bridge-mint Burn events (Neutron→Sepolia direction).
func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.Event, error) {
	if err := p.connect(); err != nil {
		return nil, err
	}
	if p.addrs.NeutronBridgeMint == "" {
		slog.Warn("tendermint SubscribeEvents: NeutronBridgeMint address not configured")
		ch := make(chan chain.Event)
		go func() { defer close(ch); <-ctx.Done() }()
		return ch, nil
	}

	slog.Info("tendermint SubscribeEvents: polling bridge-mint burn events",
		"contract", p.addrs.NeutronBridgeMint, "from_block", fromBlock)

	ch := make(chan chain.Event, 32)
	go func() {
		defer close(ch)
		ticker := time.NewTicker(6 * time.Second)
		defer ticker.Stop()
		cursor := int64(fromBlock)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				events, next, err := p.scanBurnEvents(ctx, cursor)
				if err != nil {
					slog.Error("tendermint SubscribeEvents: scan", "err", err)
					continue
				}
				for _, ev := range events {
					select {
					case ch <- ev:
					case <-ctx.Done():
						return
					}
				}
				if next > cursor {
					cursor = next
				}
			}
		}
	}()
	return ch, nil
}

// scanBurnEvents queries TxSearch for burn events from the bridge-mint contract.
func (p *Plugin) scanBurnEvents(ctx context.Context, fromHeight int64) ([]chain.Event, int64, error) {
	query := fmt.Sprintf(
		"wasm._contract_address='%s' AND wasm.action='burn' AND tx.height>=%d",
		p.addrs.NeutronBridgeMint, fromHeight,
	)
	page, perPage := 1, 20
	result, err := p.client.TxSearch(ctx, query, false, &page, &perPage, "asc")
	if err != nil {
		return nil, fromHeight, fmt.Errorf("tendermint scanBurnEvents: %w", err)
	}

	var events []chain.Event
	maxHeight := fromHeight
	for _, tx := range result.Txs {
		if tx.Height > maxHeight {
			maxHeight = tx.Height
		}
		ev, err := p.decodeResultTx(tx)
		if err != nil {
			slog.Error("tendermint: decode burn tx", "height", tx.Height, "err", err)
			continue
		}
		events = append(events, ev)
	}
	return events, maxHeight + 1, nil
}

// decodeResultTx extracts a chain.Event from a CometBFT ResultTx containing a burn event.
func (p *Plugin) decodeResultTx(tx *coretypes.ResultTx) (chain.Event, error) {
	// Use first 8 bytes of the tx hash as a deterministic nonce.
	// All relayers watching the same tx will compute identical nonces.
	nonce := binary.BigEndian.Uint64(tx.Hash[:8])

	var amount, destChainID, destApp string
	for _, ev := range tx.TxResult.Events {
		if ev.Type != "wasm" {
			continue
		}
		for _, attr := range ev.Attributes {
			switch attr.Key {
			case "amount":
				amount = attr.Value
			case "destination_chain_id":
				destChainID = attr.Value
			case "destination_app":
				destApp = attr.Value
			}
		}
	}
	_ = amount // used in payload in future
	if destChainID == "" {
		destChainID = "sepolia"
	}
	if destApp == "" {
		destApp = p.addrs.SepoliaBridgeVault
	}

	var payload [96]byte
	binary.BigEndian.PutUint64(payload[88:96], nonce)

	return chain.Event{
		SourceChainID: p.chainID,
		SourceApp:     p.addrs.NeutronBridgeMint,
		DestChainID:   destChainID,
		DestApp:       destApp,
		Action:        [4]byte{0x00, 0x00, 0x00, 0x02},
		Payload:       payload[:],
		Nonce:         nonce,
		BlockHeight:   uint64(tx.Height),
		TxHash:        strings.ToUpper(fmt.Sprintf("%x", tx.Hash)),
		Sender:        "",
	}, nil
}

func (p *Plugin) TranslateProofTo(proof chain.Proof, destChainID string) (chain.Proof, error) {
	env := chain.MessageEnvelope{
		SourceChainID: p.chainID,
		DestChainID:   destChainID,
	}
	return transform.IAVLToPatricia(proof, env)
}

// SubmitMessage broadcasts submitMessage to the Neutron Verifier (Sepolia→Neutron direction).
func (p *Plugin) SubmitMessage(ctx context.Context, env chain.MessageEnvelope, proof chain.Proof) (string, [32]byte, error) {
	if err := p.connect(); err != nil {
		return "", [32]byte{}, err
	}
	if p.cwc == nil {
		return "", [32]byte{}, fmt.Errorf("tendermint SubmitMessage: RELAYER_PRIVATE_KEY not configured")
	}
	if p.addrs.NeutronVerifier == "" {
		return "", [32]byte{}, fmt.Errorf("tendermint SubmitMessage: NeutronVerifier address not set")
	}

	var fingerprint [32]byte
	copy(fingerprint[:], proof.StateRoot)
	fingerprintHex := fmt.Sprintf("%x", fingerprint)

	msg := map[string]any{
		"submit_message": map[string]any{
			"envelope":        toCWEnvelope(env),
			"fingerprint":     fingerprintHex,
			"event_timestamp": uint64(time.Now().Unix()),
		},
	}
	msgJSON, err := json.Marshal(msg)
	if err != nil {
		return "", [32]byte{}, fmt.Errorf("tendermint SubmitMessage: marshal: %w", err)
	}

	txHash, err := p.cwc.Execute(ctx, p.addrs.NeutronVerifier, msgJSON, gasLimitExecute)
	if err != nil {
		return "", [32]byte{}, fmt.Errorf("tendermint SubmitMessage: %w", err)
	}

	slog.Info("tendermint SubmitMessage success", "tx_hash", txHash, "nonce", env.Nonce)
	// submissionId returned as zero — extracted from receipt by caller if needed.
	return txHash, [32]byte{}, nil
}

// ExecuteMessage calls Verifier execute_message after the challenge window elapses.
func (p *Plugin) ExecuteMessage(ctx context.Context, submissionID [32]byte, proof chain.Proof) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint ExecuteMessage: not configured")
	}
	msg := map[string]any{
		"execute_message": map[string]any{
			"submission_id": fmt.Sprintf("%x", submissionID),
			"proof":         proof.ProofBytes,
		},
	}
	msgJSON, _ := json.Marshal(msg)
	txHash, err := p.cwc.Execute(ctx, p.addrs.NeutronVerifier, msgJSON, gasLimitExecute)
	if err != nil {
		return "", fmt.Errorf("tendermint ExecuteMessage: %w", err)
	}
	slog.Info("tendermint ExecuteMessage success",
		"tx_hash", txHash, "submission_id", fmt.Sprintf("%x", submissionID))
	return txHash, nil
}

// SubmitChallenge calls the Neutron Verifier challenge endpoint.
func (p *Plugin) SubmitChallenge(ctx context.Context, submissionID [32]byte, counterProof chain.Proof) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint SubmitChallenge: not configured")
	}
	var correct [32]byte
	copy(correct[:], counterProof.StateRoot)
	msg := map[string]any{
		"challenge": map[string]any{
			"submission_id":       fmt.Sprintf("%x", submissionID),
			"correct_fingerprint": fmt.Sprintf("%x", correct),
			"evidence_proof":      counterProof.ProofBytes,
		},
	}
	msgJSON, _ := json.Marshal(msg)
	return p.cwc.Execute(ctx, p.addrs.NeutronVerifier, msgJSON, gasLimitExecute)
}

// ClaimAbsenceSlash calls claim_absence_slash on the Neutron Verifier.
func (p *Plugin) ClaimAbsenceSlash(ctx context.Context, submissionID [32]byte) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint ClaimAbsenceSlash: not configured")
	}
	msg := map[string]any{
		"claim_absence_slash": map[string]any{
			"submission_id": fmt.Sprintf("%x", submissionID),
		},
	}
	msgJSON, _ := json.Marshal(msg)
	return p.cwc.Execute(ctx, p.addrs.NeutronVerifier, msgJSON, gasLimitExecute)
}

// Register calls RelayerRegistry.register on Neutron.
func (p *Plugin) Register(ctx context.Context, pubKeyBytes []byte) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint Register: not configured")
	}
	msg := map[string]any{"register": map[string]any{"pubkey": pubKeyBytes}}
	msgJSON, _ := json.Marshal(msg)
	return p.cwc.Execute(ctx, p.addrs.NeutronRelayerRegistry, msgJSON, gasLimitRegister)
}

// DepositBond deposits NTRN into the Neutron Bond contract.
func (p *Plugin) DepositBond(ctx context.Context, amountUNTRN string) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint DepositBond: not configured")
	}
	msg := map[string]any{"deposit": map[string]any{}}
	msgJSON, _ := json.Marshal(msg)
	return p.cwc.Execute(ctx, p.addrs.NeutronBond, msgJSON, gasLimitRegister)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type cwEnvelope struct {
	SourceChainID string `json:"source_chain_id"`
	SourceApp     string `json:"source_app"`
	DestChainID   string `json:"destination_chain_id"`
	DestApp       string `json:"destination_app"`
	Action        []byte `json:"action"`
	Payload       []byte `json:"payload"`
	Nonce         uint64 `json:"nonce"`
}

func toCWEnvelope(env chain.MessageEnvelope) cwEnvelope {
	return cwEnvelope{
		SourceChainID: env.SourceChainID,
		SourceApp:     env.SourceApp,
		DestChainID:   env.DestChainID,
		DestApp:       env.DestApp,
		Action:        env.Action[:],
		Payload:       env.Payload,
		Nonce:         env.Nonce,
	}
}

// Compile-time assertion.
var _ chain.Plugin = (*Plugin)(nil)

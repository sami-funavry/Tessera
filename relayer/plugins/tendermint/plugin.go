// Package tendermint implements the Tessera chain plugin for Neutron/Cosmos chains.
// It uses CometBFT v0.38.x for RPC access and a minimal CosmWasm client for tx submission.
package tendermint

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
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

	// subIDs maps the relayer-internal [32]byte submission ID (sha256 of the
	// CosmWasm-emitted submission_id string) back to the original string the
	// contract uses as its state map key. The chain.Plugin interface forces a
	// fixed-width [32]byte ID, but the verifier contract emits and accepts a
	// variable-length string of the form "sub:msg:<chain>:<app>:<nonce>:<addr>:<nanos>"
	// (see contracts-cosmwasm/packages/tessera-types/src/envelope.rs::submission_id).
	// We hash it deterministically for in-memory tracking and look up the
	// original string when we need to call back into the contract.
	subIDsMu sync.RWMutex
	subIDs   map[[32]byte]string
}

// New returns a new Tendermint plugin.
func New(rpcURL, chainID, restURL string, addrs config.Addresses, privKeyHex string) *Plugin {
	return &Plugin{
		rpcURL:     rpcURL,
		restURL:    restURL,
		chainID:    chainID,
		addrs:      addrs,
		privKeyHex: privKeyHex,
		subIDs:     make(map[[32]byte]string),
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
//
// P-10.10: bridge-mint's Burn handler now emits a `destination_recipient`
// attribute (the user's Sepolia 0x… address). The relayer reads it and packs
// it into the cross-chain payload as the abi-encoded `address recipient` —
// Sepolia's BridgeVault.onCrossChainMessage decodes the payload as
// (address, uint256, uint64) and releases tokens to that address. Without
// the recipient attribute we'd be back to writing zero bytes and the release
// would either revert or transfer to address(0).
func (p *Plugin) decodeResultTx(tx *coretypes.ResultTx) (chain.Event, error) {
	// Use first 8 bytes of the tx hash as a deterministic nonce.
	// All relayers watching the same tx will compute identical nonces.
	nonce := binary.BigEndian.Uint64(tx.Hash[:8])

	var amount, destChainID, destApp, destRecipient string
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
			case "destination_recipient":
				destRecipient = attr.Value
			}
		}
	}
	if destChainID == "" {
		destChainID = "sepolia"
	}
	if destApp == "" {
		destApp = p.addrs.SepoliaBridgeVault
	}

	// P-10.8d: parse the Burn amount attribute (uTUSDC, base-10 string) into
	// big.Int so dbUpsertMessage can write the real source amount instead
	// of "0". Falls back to nil on parse failure (caller coalesces).
	var amountBI *big.Int
	if amount != "" {
		bi, ok := new(big.Int).SetString(amount, 10)
		if ok {
			amountBI = bi
		}
	}

	// Pack abi.encode(address recipient, uint256 amount, uint64 nonce) per the
	// Sepolia BridgeVault.onCrossChainMessage decoder.  Empty / non-hex
	// recipient falls through to all-zero address — bridge-vault will revert
	// (ZeroAmount/recipient) which is loud but safe.
	payload := buildBurnPayload(destRecipient, amountBI, nonce)

	return chain.Event{
		SourceChainID: p.chainID,
		SourceApp:     p.addrs.NeutronBridgeMint,
		DestChainID:   destChainID,
		DestApp:       destApp,
		Action:        [4]byte{0x00, 0x00, 0x00, 0x02},
		Payload:       payload,
		Nonce:         nonce,
		BlockHeight:   uint64(tx.Height),
		TxHash:        strings.ToUpper(fmt.Sprintf("%x", tx.Hash)),
		Sender:        "",
		Amount:        amountBI,
	}, nil
}

// buildBurnPayload encodes (address recipient, uint256 amount, uint64 nonce)
// as abi-encoded 96 bytes — the format Sepolia BridgeVault.release decodes.
// `recipientHex` is a 0x-prefixed 20-byte hex string from the Burn event
// attributes; malformed values produce a zero address (the destination
// contract will revert). `amount` may be nil (treated as zero).
//
// Scales the 6-decimal Neutron uTUSDC amount up to 18-decimal Sepolia wei
// by multiplying by 10^12; the symmetric scale-down lives in
// ethereum/plugin.go::buildBridgePayloadForDest. Without this the user
// would receive amount/10^12 on Sepolia (10 tUSDC burned → 0.00000001
// tUSDC released).
func buildBurnPayload(recipientHex string, amount *big.Int, nonce uint64) []byte {
	var buf [96]byte
	if recipientHex != "" {
		// Strip 0x prefix; tolerate mixed case.
		hexBody := strings.TrimPrefix(strings.TrimPrefix(recipientHex, "0X"), "0x")
		if raw, err := hex.DecodeString(hexBody); err == nil && len(raw) == 20 {
			copy(buf[12:32], raw)
		}
	}
	if amount != nil {
		sepoliaAmount := new(big.Int).Mul(amount, big.NewInt(1_000_000_000_000))
		sepoliaAmount.FillBytes(buf[32:64])
	}
	binary.BigEndian.PutUint64(buf[88:96], nonce)
	return buf[:]
}

// TranslateProofTo converts the IAVL proof to a TesseraProof for the
// destination verifier. The full envelope must be passed so IAVLToPatricia's
// computeSolidityMsgID gets the correct SourceApp/Nonce/Action/Payload —
// the Sepolia Verifier recomputes keccak(abi.encode(envelope)) from the
// stored Submission and rejects the proof if the embedded msgID differs.
func (p *Plugin) TranslateProofTo(proof chain.Proof, env chain.MessageEnvelope) (chain.Proof, error) {
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

	// Pull the submission_id attribute out of the wasm event. The contract emits
	// a variable-length string ID; we hash it sha256 to fit the [32]byte
	// chain.Plugin contract while caching the original for ExecuteMessage etc.
	subIDStr, err := p.fetchSubmissionIDFromTx(ctx, txHash)
	if err != nil {
		// Graceful degradation: log and return zero ID. The submitter has a
		// guard for the zero ID and will skip pending-registration; the tx
		// itself is still on-chain so no funds are stuck.
		slog.Warn("tendermint SubmitMessage: could not extract submission_id from tx",
			"tx_hash", txHash, "err", err)
		return txHash, [32]byte{}, nil
	}

	subID := sha256.Sum256([]byte(subIDStr))
	p.rememberSubID(subID, subIDStr)

	slog.Info("tendermint SubmitMessage success",
		"tx_hash", txHash,
		"nonce", env.Nonce,
		"submission_id_str", subIDStr,
		"submission_id_hash", hex.EncodeToString(subID[:]))
	return txHash, subID, nil
}

// rememberSubID stores the mapping from the relayer-internal [32]byte
// submission ID to the original CosmWasm string ID. Concurrency-safe.
func (p *Plugin) rememberSubID(id [32]byte, raw string) {
	p.subIDsMu.Lock()
	p.subIDs[id] = raw
	p.subIDsMu.Unlock()
}

// lookupSubID returns the original CosmWasm submission_id string for a given
// hashed ID. Returns ("", false) if the mapping is not present (e.g. after a
// relayer restart, since the cache is in-process only).
func (p *Plugin) lookupSubID(id [32]byte) (string, bool) {
	p.subIDsMu.RLock()
	raw, ok := p.subIDs[id]
	p.subIDsMu.RUnlock()
	return raw, ok
}

// fetchSubmissionIDFromTx polls Cometbft RPC for the tx by hash and extracts
// the wasm/submission_id attribute. It retries because broadcast-mode SYNC
// returns once the tx is in the mempool, before block inclusion.
func (p *Plugin) fetchSubmissionIDFromTx(ctx context.Context, txHashHex string) (string, error) {
	hashBytes, err := hex.DecodeString(strings.TrimPrefix(txHashHex, "0x"))
	if err != nil {
		return "", fmt.Errorf("decode tx hash hex: %w", err)
	}

	// Poll for up to ~30 s; Neutron blocks are ~2 s so this leaves headroom.
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		res, err := p.client.Tx(ctx, hashBytes, false)
		if err != nil {
			lastErr = err
			time.Sleep(2 * time.Second)
			continue
		}
		if res == nil {
			lastErr = fmt.Errorf("nil ResultTx")
			time.Sleep(2 * time.Second)
			continue
		}
		if res.TxResult.Code != 0 {
			return "", fmt.Errorf("tx failed on chain: code=%d log=%s",
				res.TxResult.Code, res.TxResult.Log)
		}
		id, ok := extractSubmissionID(res.TxResult.Events)
		if !ok {
			return "", fmt.Errorf("submission_id attribute not found in wasm events")
		}
		return id, nil
	}
	if lastErr != nil {
		return "", fmt.Errorf("timeout fetching tx: %w", lastErr)
	}
	return "", fmt.Errorf("timeout fetching tx")
}

// resolveSubID returns the original CosmWasm submission_id string for the
// given relayer-internal [32]byte ID. Falls back to hex encoding when the
// in-process cache has no entry (e.g. relayer restart). The fallback path
// is logged because it will not match any contract state — callers should
// treat it as best-effort recovery, not a correct success path.
func (p *Plugin) resolveSubID(id [32]byte, op string) string {
	if raw, ok := p.lookupSubID(id); ok {
		return raw
	}
	slog.Warn("tendermint: submission_id cache miss; falling back to hex (likely will not match contract state)",
		"op", op, "submission_id_hash", hex.EncodeToString(id[:]))
	return fmt.Sprintf("%x", id)
}

// ExecuteMessage calls Verifier execute_message after the challenge window elapses.
func (p *Plugin) ExecuteMessage(ctx context.Context, submissionID [32]byte, proof chain.Proof) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("tendermint ExecuteMessage: not configured")
	}
	subIDStr := p.resolveSubID(submissionID, "ExecuteMessage")
	msg := map[string]any{
		"execute_message": map[string]any{
			"submission_id": subIDStr,
			"proof":         proof.ProofBytes,
		},
	}
	msgJSON, _ := json.Marshal(msg)
	txHash, err := p.cwc.Execute(ctx, p.addrs.NeutronVerifier, msgJSON, gasLimitExecute)
	if err != nil {
		return "", fmt.Errorf("tendermint ExecuteMessage: %w", err)
	}
	slog.Info("tendermint ExecuteMessage success",
		"tx_hash", txHash, "submission_id", subIDStr)
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
	subIDStr := p.resolveSubID(submissionID, "SubmitChallenge")
	msg := map[string]any{
		"challenge": map[string]any{
			"submission_id":       subIDStr,
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
	subIDStr := p.resolveSubID(submissionID, "ClaimAbsenceSlash")
	msg := map[string]any{
		"claim_absence_slash": map[string]any{
			"submission_id": subIDStr,
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

// extractSubmissionID scans ABCI events for the wasm event emitted by the
// verifier's submit_message handler and returns the submission_id attribute
// value. Multiple wasm events may exist in a single tx; we match the first
// one whose action attribute is "submit_message" (or, as a fallback, any
// wasm event that has a submission_id attribute).
func extractSubmissionID(events []abci.Event) (string, bool) {
	var fallback string
	var fallbackFound bool
	for _, ev := range events {
		if ev.Type != "wasm" {
			continue
		}
		var action, subID string
		for _, attr := range ev.Attributes {
			switch attr.Key {
			case "action":
				action = attr.Value
			case "submission_id":
				subID = attr.Value
			}
		}
		if subID == "" {
			continue
		}
		if action == "submit_message" {
			return subID, true
		}
		if !fallbackFound {
			fallback = subID
			fallbackFound = true
		}
	}
	if fallbackFound {
		return fallback, true
	}
	return "", false
}

// cwEnvelope mirrors tessera_types::MessageEnvelope on the CosmWasm side.
// The two field types matter:
//
//   - `Action` is a fixed [4]byte (matches Rust's `[u8; 4]`). serde's default
//     for `[u8; N]` is a JSON array of numbers (`[0, 0, 0, 1]`). Go's
//     `json.Marshal` encodes a fixed-size byte array the same way (numeric
//     array), but encodes a `[]byte` slice as a base64 *string*. Using `[]byte`
//     here was the bug that produced
//     `Error parsing into type verifier::msg::ExecuteMsg: Invalid type` — serde
//     saw a string and expected a 4-element array.
//
//   - `Payload` stays `[]byte` because the Rust side is `cosmwasm_std::Binary`,
//     which IS a JSON-base64 string. Go's `[]byte` round-trips correctly
//     against `Binary`.
type cwEnvelope struct {
	SourceChainID string  `json:"source_chain_id"`
	SourceApp     string  `json:"source_app"`
	DestChainID   string  `json:"destination_chain_id"`
	DestApp       string  `json:"destination_app"`
	Action        [4]byte `json:"action"`
	Payload       []byte  `json:"payload"`
	Nonce         uint64  `json:"nonce"`
}

func toCWEnvelope(env chain.MessageEnvelope) cwEnvelope {
	return cwEnvelope{
		SourceChainID: env.SourceChainID,
		SourceApp:     env.SourceApp,
		DestChainID:   env.DestChainID,
		DestApp:       env.DestApp,
		Action:        env.Action,
		Payload:       env.Payload,
		Nonce:         env.Nonce,
	}
}

// ClaimTusdc calls the tUSDC `claim {}` ExecuteMsg on Neutron from the
// relayer's wallet. Used by /admin/claim-tusdc to top up the relayer's
// tUSDC balance for funding bridge demos. Subject to the contract's
// per-address daily rate limit.
func (p *Plugin) ClaimTusdc(ctx context.Context) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("ClaimTusdc: no private key configured")
	}
	if p.addrs.NeutronTUSDC == "" {
		return "", fmt.Errorf("ClaimTusdc: NeutronTusdc not configured")
	}
	const claimMsg = `{"claim":{}}`
	txHash, err := p.cwc.Execute(ctx, p.addrs.NeutronTUSDC, []byte(claimMsg), 250_000)
	if err != nil {
		return "", fmt.Errorf("ClaimTusdc: %w", err)
	}
	slog.Info("ClaimTusdc submitted", "tx", txHash)
	return txHash, nil
}

// BurnTusdc calls BridgeMint.Burn from the relayer's wallet, kicking off the
// Neutron→Sepolia bridge demo flow. The relayer's own SubscribeEvents loop
// (TxSearch for `wasm.action='burn'`) will then pick it up, fetch an IAVL
// proof, transform to Patricia, and submit to the Sepolia Verifier — same
// pipeline as the user-side bridge widget.
//
// amountTokens is whole tUSDC (decimals=6 on Neutron). destApp is the
// 0x-prefixed Sepolia BridgeVault address. recipientSepolia is the user's
// Sepolia EVM address that BridgeVault.release will credit on the Sepolia
// side — required since P-10.10 (the bridge-mint contract rejects empty
// recipients, and even if it didn't, BridgeVault would have nothing to
// release to).
func (p *Plugin) BurnTusdc(
	ctx context.Context,
	amountTokens uint64,
	destApp string,
	recipientSepolia string,
) (string, error) {
	if err := p.connect(); err != nil {
		return "", err
	}
	if p.cwc == nil {
		return "", fmt.Errorf("BurnTusdc: no private key configured")
	}
	if p.addrs.NeutronBridgeMint == "" {
		return "", fmt.Errorf("BurnTusdc: NeutronBridgeMint not configured")
	}
	if amountTokens == 0 {
		return "", fmt.Errorf("BurnTusdc: amount must be > 0")
	}
	if destApp == "" {
		return "", fmt.Errorf("BurnTusdc: destApp (Sepolia BridgeVault) is required")
	}
	if recipientSepolia == "" {
		return "", fmt.Errorf("BurnTusdc: recipientSepolia is required (BridgeVault.release would have nothing to credit)")
	}
	// Cosmos tUSDC has 6 decimals, so 1 whole token = 1_000_000 base units.
	amountBase := amountTokens * 1_000_000
	burnMsg := fmt.Sprintf(
		`{"burn":{"amount":"%d","destination_chain_id":"sepolia","destination_app":%q,"destination_recipient":%q}}`,
		amountBase, destApp, recipientSepolia,
	)
	txHash, err := p.cwc.Execute(ctx, p.addrs.NeutronBridgeMint, []byte(burnMsg), 350_000)
	if err != nil {
		return "", fmt.Errorf("BurnTusdc: %w", err)
	}
	slog.Info("BurnTusdc submitted",
		"tx", txHash, "amount_tokens", amountTokens, "dest_app", destApp, "recipient", recipientSepolia)
	return txHash, nil
}

// Compile-time assertion.
var _ chain.Plugin = (*Plugin)(nil)

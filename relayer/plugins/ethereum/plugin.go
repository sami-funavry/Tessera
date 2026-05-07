// Package ethereum implements the Tessera chain plugin for Sepolia/EVM chains.
// It uses go-ethereum v1.14.x for RPC access and eth_getProof for Patricia proofs.
package ethereum

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/ethclient/gethclient"
	"github.com/tessera-bridge/tessera/internal/chain"
)

// Plugin is the Sepolia/EVM chain adapter.
// It dials the RPC endpoint lazily on first use.
type Plugin struct {
	rpcURL     string
	chainID    string
	mu         sync.Mutex
	client     *ethclient.Client
	gethClient *gethclient.Client
}

// New returns a new Ethereum plugin. The RPC connection is established lazily
// on first method call that requires it.
func New(rpcURL string) *Plugin {
	return &Plugin{
		rpcURL:  rpcURL,
		chainID: "sepolia",
	}
}

// connect establishes the ethclient and gethclient connections if not already connected.
// It is idempotent: concurrent callers will block but only one dials.
func (p *Plugin) connect(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.client != nil {
		return nil
	}
	client, err := ethclient.DialContext(ctx, p.rpcURL)
	if err != nil {
		return fmt.Errorf("ethereum plugin dial %s: %w", p.rpcURL, err)
	}
	p.client = client
	p.gethClient = gethclient.New(client.Client())
	slog.Info("ethereum plugin connected", "chain", p.chainID, "rpc", p.rpcURL)
	return nil
}

// ChainID returns the canonical chain identifier.
func (p *Plugin) ChainID() string { return p.chainID }

// LatestBlock returns the current Sepolia chain-tip block number.
func (p *Plugin) LatestBlock(ctx context.Context) (uint64, error) {
	if err := p.connect(ctx); err != nil {
		return 0, err
	}
	num, err := p.client.BlockNumber(ctx)
	if err != nil {
		return 0, fmt.Errorf("ethereum LatestBlock: %w", err)
	}
	return num, nil
}

// FetchBlockFingerprint retrieves the stateRoot of the block at height.
// The stateRoot is the 32-byte root of the Patricia Merkle Trie for Sepolia state.
func (p *Plugin) FetchBlockFingerprint(ctx context.Context, height uint64) (chain.Fingerprint, error) {
	if err := p.connect(ctx); err != nil {
		return chain.Fingerprint{}, err
	}
	header, err := p.client.HeaderByNumber(ctx, big.NewInt(int64(height)))
	if err != nil {
		return chain.Fingerprint{}, fmt.Errorf("ethereum FetchBlockFingerprint height=%d: %w", height, err)
	}
	return chain.Fingerprint{
		ChainID:   p.chainID,
		Height:    height,
		Root:      header.Root.Bytes(), // stateRoot, keccak256, 32 bytes
		Timestamp: time.Unix(int64(header.Time), 0),
	}, nil
}

// FetchProof retrieves an eth_getProof (Patricia Merkle Trie inclusion proof)
// for the given event's source application at height.
//
// P-5 note: storageAddress is a placeholder zero address until the BridgeVault
// contract is deployed to Sepolia. After P-5, replace with the real vault address.
func (p *Plugin) FetchProof(ctx context.Context, event chain.Event, height uint64) (chain.Proof, error) {
	if err := p.connect(ctx); err != nil {
		return chain.Proof{}, err
	}

	// P-5: replace with deployed BridgeVault contract address.
	storageAddress := common.HexToAddress("0x0000000000000000000000000000000000000000")
	slog.Warn("ethereum FetchProof using placeholder address — replace with BridgeVault after P-5",
		"chain", p.chainID, "height", height, "placeholder_address", storageAddress.Hex())

	blockNum := big.NewInt(int64(height))
	// Storage slot 0 is a placeholder key until P-5 maps the real tUSDC nonce slot.
	storageKey := "0x0000000000000000000000000000000000000000000000000000000000000000"

	result, err := p.gethClient.GetProof(ctx, storageAddress, []string{storageKey}, blockNum)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("ethereum FetchProof eth_getProof height=%d: %w", height, err)
	}

	proofBytes, err := json.Marshal(result)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("ethereum FetchProof marshal AccountResult: %w", err)
	}

	// Fetch the stateRoot for the block so the proof carries its own root reference.
	header, err := p.client.HeaderByNumber(ctx, blockNum)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("ethereum FetchProof header height=%d: %w", height, err)
	}

	return chain.Proof{
		ChainID:     p.chainID,
		BlockNumber: height,
		StateRoot:   header.Root.Bytes(),
		ProofBytes:  proofBytes,
		KeyPath:     common.FromHex(storageKey),
		Value:       result.StorageHash.Bytes(),
	}, nil
}

// VerifyConsensus is a documented stub for Sepolia.
//
// R-54 / R-122: Ethereum sync committee verification requires ZK or light-client
// infrastructure that is out of scope for the hackathon demo. The relayer therefore
// trusts the configured RPC endpoint's view of the chain. This is the documented
// limitation; sync committee integration is future work.
func (p *Plugin) VerifyConsensus(ctx context.Context, height uint64) error {
	slog.Warn("R-54: Ethereum consensus verification trusts RPC; sync committee integration is future work (R-122)",
		"chain", p.chainID, "height", height)
	return nil
}

// SubscribeEvents watches for cross-chain Locked/Burned events emitted by the
// BridgeVault contract.
//
// P-5 note: contract address and event topics are placeholders until BridgeVault
// is deployed to Sepolia. In P-3, the subscription returns an open (but empty)
// channel that closes when ctx is cancelled.
func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.Event, error) {
	if err := p.connect(ctx); err != nil {
		return nil, err
	}
	slog.Warn("ethereum SubscribeEvents using placeholder filter — no contract address until P-5",
		"chain", p.chainID, "from_block", fromBlock)

	ch := make(chan chain.Event)
	go func() {
		defer close(ch)
		// P-3: scan blocks using FilterLogs with empty criteria as a connectivity check.
		// P-5 will narrow FilterQuery to the deployed BridgeVault address + Locked topic.
		query := ethereum_filterQuery(fromBlock)
		_ = query // suppress unused variable; actual filtering added in P-5.

		<-ctx.Done()
		slog.Info("ethereum SubscribeEvents goroutine exiting", "chain", p.chainID)
	}()
	return ch, nil
}

// ethereum_filterQuery builds a placeholder FilterQuery for P-3 connectivity checks.
// P-5 replaces this with a real query targeting BridgeVault + Locked/Burned topics.
func ethereum_filterQuery(fromBlock uint64) interface{} {
	return struct {
		FromBlock uint64
		// P-5: Addresses []common.Address  — add BridgeVault address here.
		// P-5: Topics    [][]common.Hash    — add Locked(bytes32,...) topic here.
	}{FromBlock: fromBlock}
}

// TranslateProofTo converts the Patricia proof to a format for destChainID.
// Stub — implemented in P-4 (PatriciaToIAVL).
func (p *Plugin) TranslateProofTo(proof chain.Proof, destChainID string) (chain.Proof, error) {
	return chain.Proof{}, chain.ErrNotImplemented
}

// SubmitMessage submits a message and proof to the Neutron verifier contract.
// Stub — implemented in P-6.
func (p *Plugin) SubmitMessage(ctx context.Context, env chain.MessageEnvelope, proof chain.Proof) (string, error) {
	return "", chain.ErrNotImplemented
}

// SubmitChallenge files a dispute against a submitted message.
// Stub — implemented in P-7.
func (p *Plugin) SubmitChallenge(ctx context.Context, msgID string, counterProof chain.Proof) (string, error) {
	return "", chain.ErrNotImplemented
}

// Compile-time assertion: Plugin implements chain.Plugin.
var _ chain.Plugin = (*Plugin)(nil)

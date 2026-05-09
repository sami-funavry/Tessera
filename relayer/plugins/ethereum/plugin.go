// Package ethereum implements the Tessera chain plugin for Sepolia/EVM chains.
// It uses go-ethereum v1.15.x for RPC access, event subscription, and transaction signing.
package ethereum

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/ethclient/gethclient"
	chain "github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/config"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// Plugin is the Sepolia/EVM chain adapter.
type Plugin struct {
	rpcURL       string
	chainID      string
	chainIDBig   *big.Int // numeric chain ID for transaction signing
	addrs        config.Addresses
	privKeyHex   string // hex, no 0x prefix
	mu           sync.Mutex
	client       *ethclient.Client
	gethClient   *gethclient.Client
	// parsed ABI instances, initialised lazily
	verifierABI   *abi.ABI
	registryABI   *abi.ABI
	bondABI       *abi.ABI
	vaultABI      *abi.ABI
	bridgeMintABI *abi.ABI
	erc20ABI      *abi.ABI
}

// New returns a new Ethereum plugin wired with deployed contract addresses and signer key.
// chainNumericID is the EIP-155 chain ID for transaction signing (11155111 for Sepolia).
func New(rpcURL string, addrs config.Addresses, privKeyHex string) *Plugin {
	return &Plugin{
		rpcURL:     rpcURL,
		chainID:    "sepolia",
		chainIDBig: big.NewInt(11155111), // Sepolia; updated from RPC in connect()
		addrs:      addrs,
		privKeyHex: privKeyHex,
	}
}

// connect establishes ethclient connections and parses ABI definitions.
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

	// Read the actual chain ID from the connected node; update the cached value.
	if cid, cidErr := client.ChainID(ctx); cidErr == nil {
		p.chainIDBig = cid
	}

	// Parse all ABIs once.
	vABI, err := abi.JSON(strings.NewReader(verifierABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse verifier ABI: %w", err)
	}
	rABI, err := abi.JSON(strings.NewReader(registryABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse registry ABI: %w", err)
	}
	bABI, err := abi.JSON(strings.NewReader(bondABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse bond ABI: %w", err)
	}
	vaABI, err := abi.JSON(strings.NewReader(bridgeVaultABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse vault ABI: %w", err)
	}
	bmABI, err := abi.JSON(strings.NewReader(bridgeMintABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse bridge-mint ABI: %w", err)
	}
	eABI, err := abi.JSON(strings.NewReader(erc20ABIJSON))
	if err != nil {
		return fmt.Errorf("ethereum plugin: parse erc20 ABI: %w", err)
	}
	p.verifierABI = &vABI
	p.registryABI = &rABI
	p.bondABI = &bABI
	p.vaultABI = &vaABI
	p.bridgeMintABI = &bmABI
	p.erc20ABI = &eABI

	slog.Info("ethereum plugin connected", "chain", p.chainID, "rpc", p.rpcURL)
	return nil
}

// ChainID returns the canonical chain identifier.
func (p *Plugin) ChainID() string { return p.chainID }

// SepoliaBridgeVaultAddr returns the deployed Sepolia BridgeVault address as
// a 0x-prefixed hex string. Used by the admin /trigger-burn handler to default
// the destination_app on Neutron→Sepolia demos.
func (p *Plugin) SepoliaBridgeVaultAddr() string { return p.addrs.SepoliaBridgeVault }

// RelayerSepoliaAddr returns the relayer's own Sepolia EVM address derived
// from the configured private key, as an EIP-55 0x-prefixed hex string.
// Returns "" when no private key is configured.  Used as a self-bridging
// fallback recipient for the admin /trigger-burn endpoint when no explicit
// recipient is supplied.
func (p *Plugin) RelayerSepoliaAddr() string {
	if p.privKeyHex == "" {
		return ""
	}
	privKeyBytes, err := hex.DecodeString(p.privKeyHex)
	if err != nil {
		return ""
	}
	privKey, err := crypto.ToECDSA(privKeyBytes)
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privKey.PublicKey).Hex()
}

// PubKeyBytes derives the 33-byte compressed secp256k1 public key from the private key.
// Returns nil if no private key is configured.
func (p *Plugin) PubKeyBytes() []byte {
	if p.privKeyHex == "" {
		return nil
	}
	privKeyBytes, err := hex.DecodeString(p.privKeyHex)
	if err != nil {
		return nil
	}
	privKey, err := crypto.ToECDSA(privKeyBytes)
	if err != nil {
		return nil
	}
	return crypto.CompressPubkey(&privKey.PublicKey)
}

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
		Root:      header.Root.Bytes(),
		Timestamp: time.Unix(int64(header.Time), 0),
	}, nil
}

// FetchProof retrieves an eth_getProof for the BridgeVault's lockedAmount storage slot.
// For Burned events on BridgeMint, it proofs the contract account itself.
func (p *Plugin) FetchProof(ctx context.Context, event chain.Event, height uint64) (chain.Proof, error) {
	if err := p.connect(ctx); err != nil {
		return chain.Proof{}, err
	}

	var contractAddr common.Address
	var storageKey string

	if event.SourceApp == p.addrs.SepoliaBridgeVault || event.SourceApp == "" {
		// Sepolia→Neutron direction: proof of lockedAmount[nonce] in BridgeVault.
		// Storage layout: lockedAmount is mapping at slot 0.
		contractAddr = common.HexToAddress(p.addrs.SepoliaBridgeVault)
		storageKey = "0x" + hex.EncodeToString(lockStorageSlot(event.Nonce))
	} else {
		// Neutron→Sepolia direction: proof of BridgeMint account (event came from Neutron).
		contractAddr = common.HexToAddress(p.addrs.SepoliaBridgeMint)
		storageKey = "0x0000000000000000000000000000000000000000000000000000000000000000"
	}

	if contractAddr == (common.Address{}) {
		// Addresses not configured yet — return a placeholder proof.
		slog.Warn("ethereum FetchProof: contract address not set in config, using placeholder")
		contractAddr = common.HexToAddress("0x0000000000000000000000000000000000000001")
	}

	blockNum := big.NewInt(int64(height))
	result, err := p.gethClient.GetProof(ctx, contractAddr, []string{storageKey}, blockNum)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("ethereum FetchProof eth_getProof height=%d addr=%s: %w",
			height, contractAddr.Hex(), err)
	}
	proofBytes, err := json.Marshal(result)
	if err != nil {
		return chain.Proof{}, fmt.Errorf("ethereum FetchProof marshal: %w", err)
	}
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

// lockStorageSlot computes keccak256(abi.encode(uint256(nonce), uint256(0))) —
// the storage slot for lockedAmount[nonce] in BridgeVault.
func lockStorageSlot(nonce uint64) []byte {
	var buf [64]byte
	binary.BigEndian.PutUint64(buf[24:32], nonce) // nonce padded to 32 bytes
	// slot index 0 at [32:64] is all zeros
	return crypto.Keccak256(buf[:])
}

// VerifyConsensus is a documented stub: EVM trusts the configured RPC provider (R-54 / R-122).
func (p *Plugin) VerifyConsensus(ctx context.Context, height uint64) error {
	slog.Warn("R-54: Ethereum consensus verification trusts RPC; sync committee integration is future work (R-122)",
		"chain", p.chainID, "height", height)
	return nil
}

// SubscribeEvents watches BridgeVault.Locked events (Sepolia→Neutron direction).
// Each event is decoded and sent on the returned channel until ctx is cancelled.
func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.Event, error) {
	if err := p.connect(ctx); err != nil {
		return nil, err
	}

	vaultAddr := common.HexToAddress(p.addrs.SepoliaBridgeVault)
	if p.addrs.SepoliaBridgeVault == "" {
		slog.Warn("ethereum SubscribeEvents: SepoliaBridgeVault address not configured")
		ch := make(chan chain.Event)
		go func() { defer close(ch); <-ctx.Done() }()
		return ch, nil
	}

	lockedTopic := p.vaultABI.Events["Locked"].ID

	query := ethereum.FilterQuery{
		FromBlock: big.NewInt(int64(fromBlock)),
		Addresses: []common.Address{vaultAddr},
		Topics:    [][]common.Hash{{lockedTopic}},
	}

	slog.Info("ethereum SubscribeEvents: subscribing to BridgeVault.Locked",
		"vault", vaultAddr.Hex(), "from_block", fromBlock)

	logCh := make(chan types.Log, 64)
	sub, err := p.client.SubscribeFilterLogs(ctx, query, logCh)
	if err != nil {
		// Fall back to polling if WebSocket subscription unavailable.
		slog.Warn("ethereum SubscribeEvents: WebSocket subscribe failed, falling back to polling",
			"err", err)
		return p.pollEvents(ctx, fromBlock, vaultAddr, lockedTopic)
	}

	ch := make(chan chain.Event, 32)
	go func() {
		defer close(ch)
		for {
			select {
			case <-ctx.Done():
				sub.Unsubscribe()
				return
			case err := <-sub.Err():
				slog.Error("ethereum SubscribeEvents: subscription error", "err", err)
				sub.Unsubscribe()
				return
			case log := <-logCh:
				ev, err := p.decodeLocked(log)
				if err != nil {
					slog.Error("ethereum SubscribeEvents: decode Locked log", "err", err)
					continue
				}
				select {
				case ch <- ev:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch, nil
}

// pollEvents is the polling fallback for non-WebSocket RPC providers.
func (p *Plugin) pollEvents(ctx context.Context, fromBlock uint64,
	vaultAddr common.Address, lockedTopic common.Hash) (<-chan chain.Event, error) {

	ch := make(chan chain.Event, 32)
	go func() {
		defer close(ch)
		ticker := time.NewTicker(12 * time.Second) // ~1 Ethereum block
		defer ticker.Stop()
		cursor := big.NewInt(int64(fromBlock))
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tip, err := p.client.BlockNumber(ctx)
				if err != nil {
					slog.Error("ethereum pollEvents: BlockNumber", "err", err)
					continue
				}
				to := big.NewInt(int64(tip))
				if cursor.Cmp(to) > 0 {
					continue
				}
				// Alchemy free tier rejects eth_getLogs ranges greater than 10
				// blocks with "Under the Free tier plan, you can make eth_getLogs
				// requests with up to a 10 block range" (-32600). 10 blocks per
				// 12s tick = 50 blocks/min, which still outpaces Sepolia's
				// 1-block/12s production rate, so the cursor catches up steadily.
				// If the operator upgrades to a paid Alchemy plan or swaps to a
				// different provider, raise this constant.
				const maxBatch int64 = 10
				maxTo := new(big.Int).Add(cursor, big.NewInt(maxBatch-1))
				if maxTo.Cmp(to) < 0 {
					to = maxTo
				}
				query := ethereum.FilterQuery{
					FromBlock: cursor,
					ToBlock:   to,
					Addresses: []common.Address{vaultAddr},
					Topics:    [][]common.Hash{{lockedTopic}},
				}
				logs, err := p.client.FilterLogs(ctx, query)
				if err != nil {
					// Don't advance the cursor on error — we'll retry the same
					// window next tick once the rate-limit / RPC blip clears.
					slog.Error("ethereum pollEvents: FilterLogs",
						"from", cursor.String(), "to", to.String(), "err", err)
					continue
				}
				for _, log := range logs {
					ev, err := p.decodeLocked(log)
					if err != nil {
						slog.Error("ethereum pollEvents: decode Locked", "err", err)
						continue
					}
					select {
					case ch <- ev:
					case <-ctx.Done():
						return
					}
				}
				cursor = new(big.Int).Add(to, big.NewInt(1))
			}
		}
	}()
	return ch, nil
}

// decodeLocked decodes a BridgeVault.Locked log into a chain.Event.
//
// P-10.10: the Locked event now carries a `destinationRecipient` bytes field —
// this is the user's address on the destination chain (Neutron bech32 string,
// captured by BridgeVault.lock). We read it off the log and use it as the
// `recipient` field of the JSON BridgePayload sent in the cross-chain
// envelope, so the Neutron BridgeMint contract knows who to mint tUSDC to.
// Without this field the destination dispatch reverts with `invalid bridge
// payload` even after proof verification succeeds.
func (p *Plugin) decodeLocked(log types.Log) (chain.Event, error) {
	// Unpack non-indexed fields from log.Data.
	data := map[string]any{}
	if err := p.vaultABI.UnpackIntoMap(data, "Locked", log.Data); err != nil {
		return chain.Event{}, fmt.Errorf("unpack Locked: %w", err)
	}
	// user is indexed (topics[1]).
	user := common.BytesToAddress(log.Topics[1].Bytes())
	amount := data["amount"].(*big.Int)
	nonce := data["nonce"].(uint64)
	destChainIDBytes32 := data["destinationChainId"].([32]byte)
	destApp := data["destinationApp"].([]byte)
	destRecipient, _ := data["destinationRecipient"].([]byte)

	// Convert bytes32 chainId to string (right-trim zeros).
	destChainIDStr := bytes32ToString(destChainIDBytes32)

	// Build the cross-chain payload in the format the destination app expects.
	// For Neutron destinations (the demo direction) bridge-mint deserialises a
	// JSON `BridgePayload { recipient, amount, nonce }`. Anything else
	// (legacy/test) falls back to the abi.encode shape, which is what
	// Sepolia's own BridgeVault.release expects on the reverse path.
	payload := buildBridgePayloadForDest(destChainIDStr, string(destRecipient), user, amount, nonce)

	return chain.Event{
		SourceChainID: p.chainID,
		SourceApp:     p.addrs.SepoliaBridgeVault,
		DestChainID:   destChainIDStr,
		DestApp:       string(destApp),
		Action:        [4]byte{0x00, 0x00, 0x00, 0x01}, // LOCK action
		Payload:       payload,
		Nonce:         nonce,
		BlockHeight:   log.BlockNumber,
		TxHash:        log.TxHash.Hex(),
		Sender:        user.Hex(),
		// P-10.8d: surface the amount so dbUpsertMessage can write it into
		// messages.amount instead of hardcoding "0". Dashboard's totalVolume
		// previously read 0 for every relayer-detected lock because of this.
		Amount: amount,
	}, nil
}

// TranslateProofTo converts the Patricia proof to a TesseraProof for the
// destination verifier. The full envelope must be passed so PatriciaToIAVL
// can embed sha256(message_id(envelope)) into the leaf — the Neutron verifier
// re-derives that exact hash from the stored Submission and rejects the
// proof if they don't match. Building a partial envelope here was P-10.9's
// "invalid proof" bug.
func (p *Plugin) TranslateProofTo(proof chain.Proof, env chain.MessageEnvelope) (chain.Proof, error) {
	return transform.PatriciaToIAVL(proof, env)
}

// SubmitMessage signs and sends Verifier.submitMessage to the Sepolia Verifier.
// This is called by the dst plugin for the Neutron→Sepolia direction.
func (p *Plugin) SubmitMessage(ctx context.Context, env chain.MessageEnvelope, proof chain.Proof) (string, [32]byte, error) {
	if err := p.connect(ctx); err != nil {
		return "", [32]byte{}, err
	}
	if p.privKeyHex == "" {
		return "", [32]byte{}, fmt.Errorf("ethereum SubmitMessage: RELAYER_PRIVATE_KEY not set")
	}

	var fingerprint [32]byte
	copy(fingerprint[:], proof.StateRoot)

	envelope := toEVMEnvelope(env)
	eventTimestamp := big.NewInt(time.Now().Unix())

	data, err := p.verifierABI.Pack("submitMessage", envelope, fingerprint, eventTimestamp)
	if err != nil {
		return "", [32]byte{}, fmt.Errorf("ethereum SubmitMessage ABI pack: %w", err)
	}

	txHash, err := p.sendTx(ctx, p.addrs.SepoliaVerifier, data, nil)
	if err != nil {
		return "", [32]byte{}, fmt.Errorf("ethereum SubmitMessage sendTx: %w", err)
	}

	// Decode submissionId from the receipt.
	submissionID, err := p.waitForSubmissionID(ctx, txHash)
	if err != nil {
		// Non-fatal: submissionId extraction might fail on some providers.
		slog.Warn("ethereum SubmitMessage: could not extract submissionId from receipt", "err", err)
	}

	slog.Info("ethereum SubmitMessage success",
		"tx_hash", txHash, "submission_id", hex.EncodeToString(submissionID[:]),
		"nonce", env.Nonce)
	return txHash, submissionID, nil
}

// ExecuteMessage calls Verifier.executeMessage after the challenge window elapses.
func (p *Plugin) ExecuteMessage(ctx context.Context, submissionID [32]byte, proof chain.Proof) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	data, err := p.verifierABI.Pack("executeMessage", submissionID, proof.ProofBytes)
	if err != nil {
		return "", fmt.Errorf("ethereum ExecuteMessage ABI pack: %w", err)
	}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaVerifier, data, nil)
	if err != nil {
		return "", fmt.Errorf("ethereum ExecuteMessage: %w", err)
	}
	slog.Info("ethereum ExecuteMessage success",
		"tx_hash", txHash, "submission_id", hex.EncodeToString(submissionID[:]))
	return txHash, nil
}

// SubmitChallenge calls Verifier.challenge with an independently re-derived proof.
func (p *Plugin) SubmitChallenge(ctx context.Context, submissionID [32]byte, counterProof chain.Proof) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	var correctFingerprint [32]byte
	copy(correctFingerprint[:], counterProof.StateRoot)
	data, err := p.verifierABI.Pack("challenge", submissionID, correctFingerprint, counterProof.ProofBytes)
	if err != nil {
		return "", fmt.Errorf("ethereum SubmitChallenge ABI pack: %w", err)
	}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaVerifier, data, nil)
	if err != nil {
		return "", fmt.Errorf("ethereum SubmitChallenge: %w", err)
	}
	slog.Info("ethereum SubmitChallenge success",
		"tx_hash", txHash, "submission_id", hex.EncodeToString(submissionID[:]))
	return txHash, nil
}

// ClaimAbsenceSlash calls Verifier.claimAbsenceSlash.
func (p *Plugin) ClaimAbsenceSlash(ctx context.Context, submissionID [32]byte) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	data, err := p.verifierABI.Pack("claimAbsenceSlash", submissionID)
	if err != nil {
		return "", fmt.Errorf("ethereum ClaimAbsenceSlash ABI pack: %w", err)
	}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaVerifier, data, nil)
	if err != nil {
		return "", fmt.Errorf("ethereum ClaimAbsenceSlash: %w", err)
	}
	return txHash, nil
}

// Register calls RelayerRegistry.register with this relayer's public key.
func (p *Plugin) Register(ctx context.Context, pubKeyBytes []byte) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	data, err := p.registryABI.Pack("register", pubKeyBytes)
	if err != nil {
		return "", fmt.Errorf("ethereum Register ABI pack: %w", err)
	}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaRelayerRegistry, data, nil)
	if err != nil {
		return "", fmt.Errorf("ethereum Register: %w", err)
	}
	slog.Info("ethereum Register success", "tx_hash", txHash)
	return txHash, nil
}

// DepositBond calls Bond.deposit() with the given ETH amount (in wei as decimal string).
func (p *Plugin) DepositBond(ctx context.Context, amountWei string) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	data, err := p.bondABI.Pack("deposit")
	if err != nil {
		return "", fmt.Errorf("ethereum DepositBond ABI pack: %w", err)
	}
	value := new(big.Int)
	if _, ok := value.SetString(amountWei, 10); !ok {
		return "", fmt.Errorf("ethereum DepositBond: invalid amount %q", amountWei)
	}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaBond, data, value)
	if err != nil {
		return "", fmt.Errorf("ethereum DepositBond: %w", err)
	}
	slog.Info("ethereum DepositBond success", "tx_hash", txHash, "amount_wei", amountWei)
	return txHash, nil
}

// ClaimTusdc calls the public tUSDC.claim() function on Sepolia from the
// relayer's wallet. Used by the admin /admin/claim-tusdc endpoint to top
// up the relayer's tUSDC balance for funding bridge demos.
//
// Returns the tx hash. Subject to the contract's per-address daily rate
// limit (1000 tUSDC / address / 24 h).
func (p *Plugin) ClaimTusdc(ctx context.Context) (string, error) {
	if err := p.connect(ctx); err != nil {
		return "", err
	}
	if p.privKeyHex == "" {
		return "", fmt.Errorf("ClaimTusdc: private key not configured")
	}
	if p.addrs.SepoliaTUSDC == "" {
		return "", fmt.Errorf("ClaimTusdc: SepoliaTUSDC not configured")
	}

	// claim() takes no args. Pure 4-byte selector: keccak256("claim()")[:4].
	claimSel := []byte{0x4e, 0x71, 0xd9, 0x2d}
	txHash, err := p.sendTx(ctx, p.addrs.SepoliaTUSDC, claimSel, nil)
	if err != nil {
		return "", fmt.Errorf("ClaimTusdc: %w", err)
	}
	slog.Info("ClaimTusdc submitted", "tx", txHash)
	return txHash, nil
}

// LockTusdc executes a tUSDC approve + BridgeVault.lock from the relayer's
// own wallet to bridge `amountWei` to the Neutron `recipient`. Used by the
// demo /admin/trigger-lock endpoint to kick off a real on-chain Sepolia
// event that the relayer's normal SubscribeEvents handler will then pick
// up and process per the active fault flags.
//
// Returns the lock tx hash and the nonce used.
func (p *Plugin) LockTusdc(
	ctx context.Context,
	recipientNeutron string,
	amountWei *big.Int,
) (string, uint64, error) {
	if err := p.connect(ctx); err != nil {
		return "", 0, err
	}
	if p.privKeyHex == "" {
		return "", 0, fmt.Errorf("LockTusdc: private key not configured")
	}
	if p.addrs.SepoliaTUSDC == "" || p.addrs.SepoliaBridgeVault == "" {
		return "", 0, fmt.Errorf("LockTusdc: tUSDC or vault address not configured")
	}

	// Step 1 — ensure allowance is sufficient. If not, approve max once.
	privKeyBytes, err := hex.DecodeString(p.privKeyHex)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: decode key: %w", err)
	}
	privKey, err := crypto.ToECDSA(privKeyBytes)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: parse key: %w", err)
	}
	from := crypto.PubkeyToAddress(privKey.PublicKey)
	tusdcAddr := common.HexToAddress(p.addrs.SepoliaTUSDC)
	vaultAddr := common.HexToAddress(p.addrs.SepoliaBridgeVault)

	allowanceData, err := p.erc20ABI.Pack("allowance", from, vaultAddr)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: pack allowance: %w", err)
	}
	allowanceRes, err := p.client.CallContract(ctx, ethereum.CallMsg{
		To: &tusdcAddr, Data: allowanceData,
	}, nil)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: read allowance: %w", err)
	}
	allowance := new(big.Int).SetBytes(allowanceRes)

	if allowance.Cmp(amountWei) < 0 {
		// Approve max so subsequent locks skip this step.
		maxUint := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
		approveData, err := p.erc20ABI.Pack("approve", vaultAddr, maxUint)
		if err != nil {
			return "", 0, fmt.Errorf("LockTusdc: pack approve: %w", err)
		}
		approveTx, err := p.sendTx(ctx, p.addrs.SepoliaTUSDC, approveData, nil)
		if err != nil {
			return "", 0, fmt.Errorf("LockTusdc: approve: %w", err)
		}
		// Wait for approve receipt before locking.
		if _, err := p.waitForReceipt(ctx, approveTx); err != nil {
			return "", 0, fmt.Errorf("LockTusdc: approve receipt: %w", err)
		}
		slog.Info("LockTusdc: approve confirmed", "tx", approveTx)
	}

	// Step 2 — lock. nonce is a monotonic timestamp (sec); collisions are
	// extremely unlikely for a demo-paced flow.
	nonce := uint64(time.Now().Unix())

	// destinationChainId is the right-padded ASCII bytes of "pion-1".
	var destChain [32]byte
	copy(destChain[:], []byte("pion-1"))

	// destinationApp is the UTF-8 bytes of the BridgeMint bech32 address.
	destApp := []byte(p.addrs.NeutronBridgeMint)
	if len(destApp) == 0 {
		return "", 0, fmt.Errorf("LockTusdc: NeutronBridgeMint not configured")
	}
	if recipientNeutron == "" {
		return "", 0, fmt.Errorf("LockTusdc: recipientNeutron is required (BridgeVault.lock would revert ZeroRecipient)")
	}
	// P-10.10: pass the Neutron recipient through to BridgeVault.lock so it
	// gets emitted on the Locked event. The relayer reads it back off the
	// log when constructing the BridgePayload sent to bridge-mint — without
	// this the payload arrives at bridge-mint with no recipient and the
	// cross-chain dispatch reverts with `invalid bridge payload`.
	destRecipient := []byte(recipientNeutron)

	lockData, err := p.vaultABI.Pack("lock", amountWei, nonce, destChain, destApp, destRecipient)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: pack lock: %w", err)
	}
	lockTx, err := p.sendTx(ctx, p.addrs.SepoliaBridgeVault, lockData, nil)
	if err != nil {
		return "", 0, fmt.Errorf("LockTusdc: lock: %w", err)
	}
	slog.Info("LockTusdc: lock submitted", "tx", lockTx, "nonce", nonce, "amount", amountWei.String(), "recipient", recipientNeutron)
	return lockTx, nonce, nil
}

// waitForReceipt polls for a tx receipt up to ~90 seconds. Used as a simple
// confirm step for the demo trigger-lock approve.
func (p *Plugin) waitForReceipt(ctx context.Context, txHashHex string) (uint64, error) {
	txHash := common.HexToHash(txHashHex)
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		default:
		}
		receipt, err := p.client.TransactionReceipt(ctx, txHash)
		if err == nil {
			return receipt.BlockNumber.Uint64(), nil
		}
		time.Sleep(3 * time.Second)
	}
	return 0, fmt.Errorf("waitForReceipt: timeout")
}

// ─── Internal helpers ────────────────────────────────────────────────────────

// sendTx signs and broadcasts a transaction to the given contract.
// Returns the transaction hash immediately (does not wait for confirmation).
func (p *Plugin) sendTx(ctx context.Context, toHex string, data []byte, value *big.Int) (string, error) {
	privKeyBytes, err := hex.DecodeString(p.privKeyHex)
	if err != nil {
		return "", fmt.Errorf("sendTx: decode private key: %w", err)
	}
	privKey, err := crypto.ToECDSA(privKeyBytes)
	if err != nil {
		return "", fmt.Errorf("sendTx: parse private key: %w", err)
	}
	from := crypto.PubkeyToAddress(privKey.PublicKey)
	to := common.HexToAddress(toHex)

	nonce, err := p.client.PendingNonceAt(ctx, from)
	if err != nil {
		return "", fmt.Errorf("sendTx: nonce: %w", err)
	}
	gasPrice, err := p.client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("sendTx: gas price: %w", err)
	}
	// Add 20% buffer to suggested gas price to avoid under-pricing.
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(12))
	gasPrice.Div(gasPrice, big.NewInt(10))

	msg := ethereum.CallMsg{From: from, To: &to, GasPrice: gasPrice, Data: data, Value: value}
	gasLimit, err := p.client.EstimateGas(ctx, msg)
	if err != nil {
		// Fallback gas limit for known-complex operations.
		gasLimit = 500_000
		slog.Warn("sendTx: EstimateGas failed, using fallback", "err", err, "gas_limit", gasLimit)
	}
	gasLimit = gasLimit * 15 / 10 // 50% safety buffer

	if value == nil {
		value = big.NewInt(0)
	}
	tx := types.NewTransaction(nonce, to, value, gasLimit, gasPrice, data)
	signer := types.NewLondonSigner(p.chainIDBig)
	signed, err := types.SignTx(tx, signer, privKey)
	if err != nil {
		return "", fmt.Errorf("sendTx: sign: %w", err)
	}
	if err := p.client.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("sendTx: broadcast: %w", err)
	}
	return signed.Hash().Hex(), nil
}

// waitForSubmissionID waits for a transaction receipt and extracts the submissionId
// from the MessageSubmitted event log.
func (p *Plugin) waitForSubmissionID(ctx context.Context, txHashHex string) ([32]byte, error) {
	txHash := common.HexToHash(txHashHex)
	// Poll for receipt up to 90 seconds.
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return [32]byte{}, ctx.Err()
		default:
		}
		receipt, err := p.client.TransactionReceipt(ctx, txHash)
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}
		for _, log := range receipt.Logs {
			if len(log.Topics) == 0 {
				continue
			}
			msgSubmittedID := p.verifierABI.Events["MessageSubmitted"].ID
			if log.Topics[0] == msgSubmittedID {
				// topics[1] = submissionId (indexed)
				var id [32]byte
				copy(id[:], log.Topics[1].Bytes())
				return id, nil
			}
		}
		return [32]byte{}, fmt.Errorf("MessageSubmitted event not found in receipt")
	}
	return [32]byte{}, fmt.Errorf("timeout waiting for receipt")
}

// evmEnvelope matches the Verifier ABI tuple layout.
type evmEnvelope struct {
	SourceChainId      [32]byte
	SourceApp          []byte
	DestinationChainId [32]byte
	DestinationApp     []byte
	Action             [4]byte
	Payload            []byte
	Nonce              uint64
}

// toEVMEnvelope converts a chain.MessageEnvelope to the EVM ABI struct.
func toEVMEnvelope(env chain.MessageEnvelope) evmEnvelope {
	return evmEnvelope{
		SourceChainId:      stringToBytes32(env.SourceChainID),
		SourceApp:          []byte(env.SourceApp),
		DestinationChainId: stringToBytes32(env.DestChainID),
		DestinationApp:     []byte(env.DestApp),
		Action:             env.Action,
		Payload:            env.Payload,
		Nonce:              env.Nonce,
	}
}

// stringToBytes32 encodes a string as a right-zero-padded bytes32.
func stringToBytes32(s string) [32]byte {
	var b [32]byte
	copy(b[:], []byte(s))
	return b
}

// bytes32ToString decodes a right-zero-padded bytes32 to a string.
func bytes32ToString(b [32]byte) string {
	return strings.TrimRight(string(b[:]), "\x00")
}

// buildLockPayload encodes abi.encode(recipient, amount, nonce) as the cross-chain payload.
// Used for EVM-destination dispatch (where the destination app expects abi-encoded bytes).
func buildLockPayload(user common.Address, amount *big.Int, nonce uint64) []byte {
	// ABI encode: (address, uint256, uint64)
	// Pad each to 32 bytes for simplicity (matches abi.encode in Solidity).
	var buf [96]byte
	copy(buf[12:32], user.Bytes()) // address: 20 bytes, left-padded
	amount.FillBytes(buf[32:64])
	binary.BigEndian.PutUint64(buf[88:96], nonce) // uint64 right-aligned in 32 bytes
	return buf[:]
}

// buildBridgePayloadForDest constructs the cross-chain payload in the format
// the destination app expects. The relayer carries this verbatim inside the
// MessageEnvelope.payload — the destination Verifier dispatches it untouched
// to the destination app, which deserialises it natively.
//
//   - Neutron destinations (`pion-1`): bridge-mint runs `from_json::<BridgePayload>`,
//     so we emit JSON {"recipient": <neutron bech32>, "amount": "<u128>", "nonce": <u64>}.
//   - Anything else (incl. Sepolia for the reverse-path round-trip): fall back
//     to the legacy abi.encode shape (address, uint256, uint64), which is what
//     Sepolia's own BridgeVault.onCrossChainMessage expects.
//
// `destRecipient` is the user-provided destination-chain address read off the
// Locked event. Empty-string fallback uses the source-chain user address as a
// last-ditch placeholder so unit tests + bare-bones triggers still produce
// valid bytes — production callers must supply a real recipient or the
// bridge-mint contract will reject (per its `is_empty()` guard).
func buildBridgePayloadForDest(
	destChainID string,
	destRecipient string,
	user common.Address,
	amount *big.Int,
	nonce uint64,
) []byte {
	if destChainID == "pion-1" {
		recipient := destRecipient
		if recipient == "" {
			// No on-chain recipient and no off-chain hint — log shape is wrong
			// but at least the bytes are valid JSON; bridge-mint will reject
			// with InvalidPayload, which is louder than a silent zero-byte drop.
			recipient = user.Hex()
		}
		// Scale 18-decimal Sepolia wei → 6-decimal Neutron uTUSDC. Without this
		// the recipient would receive amount * 10^12 tokens on Neutron (10
		// tUSDC locked → 10 trillion tUSDC minted) which we measured on the
		// first end-to-end run. Truncates sub-1µtUSDC dust silently — fine
		// for testnet demo amounts.
		neutronAmount := new(big.Int).Quo(amount, big.NewInt(1_000_000_000_000))
		return []byte(fmt.Sprintf(
			`{"recipient":%q,"amount":"%s","nonce":%d}`,
			recipient, neutronAmount.String(), nonce,
		))
	}
	return buildLockPayload(user, amount, nonce)
}

// Compile-time assertion: Plugin implements chain.Plugin.
var _ chain.Plugin = (*Plugin)(nil)

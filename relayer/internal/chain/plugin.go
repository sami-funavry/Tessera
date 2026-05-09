// Package chain defines the plugin interface every chain adapter must implement.
// R-80: every chain support is added by implementing Plugin; no core changes required.
package chain

import (
	"context"
	"errors"
	"math/big"
	"time"
)

// ErrNotImplemented is returned by plugin methods that are stubs for a later phase.
var ErrNotImplemented = errors.New("not implemented in this phase")

// CrossChainEvent is preserved for backward compatibility with the transform stubs (P-4).
// New code should use Event instead.
type CrossChainEvent struct {
	SourceChainID string
	SourceApp     string
	DestChainID   string
	DestApp       string
	Action        [4]byte
	Payload       []byte
	Nonce         uint64
	BlockNumber   uint64
	TxHash        string
	Sender        string
	Amount        *big.Int
}

// Fingerprint is a chain's block fingerprint.
// For EVM chains this is the stateRoot (keccak256, 32 bytes).
// For Cosmos/Tendermint chains this is the AppHash (sha256, 32 bytes).
type Fingerprint struct {
	ChainID   string
	Height    uint64
	Root      []byte    // 32-byte root hash
	Timestamp time.Time
}

// Event represents a Locked or Burned cross-chain event observed on a source chain.
type Event struct {
	SourceChainID string
	SourceApp     string
	DestChainID   string
	DestApp       string
	Action        [4]byte
	Payload       []byte
	Nonce         uint64
	BlockHeight   uint64
	TxHash        string
	Sender        string
	// Amount is the source-native token amount (wei for EVM Locked, uTUSDC
	// for CosmWasm Burned). Nil-safe — callers must coalesce nil to "0"
	// before writing to a NOT NULL column. Added P-10.8d so the dashboard's
	// totalVolume stat can accumulate real amounts instead of "0" everywhere.
	Amount *big.Int
	// DestRecipient is the destination-chain address that will receive the
	// bridged tokens. ASCII for Neutron bech32 destinations, hex string with
	// 0x prefix for Sepolia destinations. Plugins read this off the source
	// event (Locked.destinationRecipient on Sepolia, Burn.destination_recipient
	// attribute on Neutron) and the submitter threads it through to the
	// Executed pipeline event so the demo log shows where the tokens actually
	// landed instead of the source-side initiator. Empty when the source
	// plugin couldn't extract it.
	DestRecipient string
}

// MessageEnvelope is the canonical cross-chain message (R-67).
// It is the unit of work that the relayer submits to the destination verifier.
type MessageEnvelope struct {
	SourceChainID string
	SourceApp     string
	DestChainID   string
	DestApp       string
	Action        [4]byte
	Payload       []byte
	Nonce         uint64
}

// Proof is a chain-native inclusion proof for a cross-chain message event.
// The encoding is chain-specific; interpretation belongs to the transform layer (P-4).
type Proof struct {
	ChainID     string
	BlockNumber uint64
	StateRoot   []byte // source-native fingerprint (stateRoot or AppHash)
	ProofBytes  []byte // RLP-encoded Patricia or Protobuf-encoded IAVL proof
	KeyPath     []byte
	Value       []byte
}

// Plugin is the interface every chain adapter must satisfy (R-80).
// Adding a new chain means implementing this interface in plugins/<chain>/.
// Core relayer logic must not change when a new chain is added.
type Plugin interface {
	// ChainID returns the canonical chain identifier (e.g. "sepolia", "pion-1").
	ChainID() string

	// LatestBlock returns the current chain-tip block number.
	LatestBlock(ctx context.Context) (uint64, error)

	// FetchBlockFingerprint retrieves the block fingerprint (stateRoot or AppHash)
	// at the given height.
	FetchBlockFingerprint(ctx context.Context, height uint64) (Fingerprint, error)

	// FetchProof retrieves a native inclusion proof for the given event at height.
	FetchProof(ctx context.Context, event Event, height uint64) (Proof, error)

	// VerifyConsensus verifies that the block at height has sufficient validator
	// consensus (2/3+ for Tendermint; RPC-trusted stub for EVM per R-54 / R-122).
	VerifyConsensus(ctx context.Context, height uint64) error

	// SubscribeEvents returns a channel of cross-chain events starting at fromBlock.
	// The channel is closed when ctx is cancelled.
	SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan Event, error)

	// TranslateProofTo converts the proof to a format understood by the
	// destination verifier. The envelope is required because the on-chain
	// verifiers embed sha256/keccak(message_id(envelope)) into the proof's
	// leaf hash — passing a stripped-down envelope (e.g. without SourceApp
	// or Nonce) would silently produce a proof whose embedded msgID does
	// not match what the contract recomputes from the stored Submission's
	// envelope, and the proof would be rejected as "invalid proof" at
	// execute_message time. The plugin reads env.DestChainID to pick the
	// hash function (Keccak vs SHA-256).
	TranslateProofTo(proof Proof, env MessageEnvelope) (Proof, error)

	// SubmitMessage submits a cross-chain message and proof to the destination
	// verifier contract. Returns the submission transaction hash and 32-byte submissionId.
	SubmitMessage(ctx context.Context, env MessageEnvelope, proof Proof) (txHash string, submissionID [32]byte, err error)

	// ExecuteMessage triggers message dispatch after the 60-second challenge window.
	// Called by the submitter goroutine automatically after the window elapses.
	ExecuteMessage(ctx context.Context, submissionID [32]byte, proof Proof) (string, error)

	// SubmitChallenge files a challenge against a submitted message.
	SubmitChallenge(ctx context.Context, submissionID [32]byte, counterProof Proof) (string, error)

	// ClaimAbsenceSlash slashes the original assignee after the 30-second handover period.
	ClaimAbsenceSlash(ctx context.Context, submissionID [32]byte) (string, error)

	// Register registers this relayer address with its public key on the destination chain.
	Register(ctx context.Context, pubKeyBytes []byte) (string, error)

	// DepositBond deposits ETH/NTRN into the Bond contract.
	// amount is in the native denomination (wei for EVM, untrn for Cosmos).
	DepositBond(ctx context.Context, amount string) (string, error)
}

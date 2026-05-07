// Package chain defines the plugin interface every chain adapter must implement.
package chain

import (
	"context"
	"math/big"
)

// CrossChainEvent represents a Locked or Burned event emitted on a source chain.
type CrossChainEvent struct {
	SourceChainID   string
	SourceApp       string
	DestChainID     string
	DestApp         string
	Action          [4]byte
	Payload         []byte
	Nonce           uint64
	BlockNumber     uint64
	TxHash          string
	Sender          string
	Amount          *big.Int
}

// Proof is a chain-native inclusion proof for a cross-chain message event.
// The encoding is chain-specific; interpretation belongs to the transform layer.
type Proof struct {
	ChainID      string
	BlockNumber  uint64
	StateRoot    []byte // source-native fingerprint (stateRoot or AppHash)
	ProofBytes   []byte // RLP-encoded Patricia or Protobuf-encoded IAVL proof
	KeyPath      []byte
	Value        []byte
}

// Plugin is the interface every chain adapter must satisfy.
// New chains plug in by implementing this interface in plugins/<chain>/.
type Plugin interface {
	// ChainID returns the canonical chain identifier (e.g. "sepolia", "pion-1").
	ChainID() string

	// SubscribeEvents blocks and sends CrossChainEvents to the returned channel
	// until ctx is cancelled.
	SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan CrossChainEvent, error)

	// FetchProof retrieves a native inclusion proof for the event at nonce.
	FetchProof(ctx context.Context, event CrossChainEvent) (Proof, error)

	// SubmitTx submits a signed transaction to the chain and returns the tx hash.
	SubmitTx(ctx context.Context, txData []byte) (string, error)

	// LatestBlock returns the current chain tip block number.
	LatestBlock(ctx context.Context) (uint64, error)
}

// Package ethereum implements the Tessera chain plugin for Sepolia/EVM chains.
package ethereum

import (
	"context"
	"math/big"

	"github.com/tessera-bridge/tessera/internal/chain"
)

// Plugin is the Sepolia/EVM chain adapter.
type Plugin struct {
	rpcURL  string
	chainID string
}

// New returns a new Ethereum plugin.
func New(rpcURL string) *Plugin {
	return &Plugin{rpcURL: rpcURL, chainID: "sepolia"}
}

func (p *Plugin) ChainID() string { return p.chainID }

func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.CrossChainEvent, error) {
	// TODO: implement in P-3 using go-ethereum ethclient
	ch := make(chan chain.CrossChainEvent)
	go func() { <-ctx.Done(); close(ch) }()
	return ch, nil
}

func (p *Plugin) FetchProof(ctx context.Context, event chain.CrossChainEvent) (chain.Proof, error) {
	// TODO: implement in P-3 using eth_getProof
	_ = big.NewInt(0)
	return chain.Proof{}, nil
}

func (p *Plugin) SubmitTx(ctx context.Context, txData []byte) (string, error) {
	// TODO: implement in P-3
	return "", nil
}

func (p *Plugin) LatestBlock(ctx context.Context) (uint64, error) {
	// TODO: implement in P-3
	return 0, nil
}

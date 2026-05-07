// Package tendermint implements the Tessera chain plugin for Neutron/Cosmos chains.
package tendermint

import (
	"context"

	"github.com/tessera-bridge/tessera/internal/chain"
)

// Plugin is the Neutron/Tendermint chain adapter.
type Plugin struct {
	rpcURL  string
	restURL string
	chainID string
}

// New returns a new Tendermint plugin.
func New(rpcURL, restURL string) *Plugin {
	return &Plugin{rpcURL: rpcURL, restURL: restURL, chainID: "pion-1"}
}

func (p *Plugin) ChainID() string { return p.chainID }

func (p *Plugin) SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan chain.CrossChainEvent, error) {
	// TODO: implement in P-3 using CometBFT RPC
	ch := make(chan chain.CrossChainEvent)
	go func() { <-ctx.Done(); close(ch) }()
	return ch, nil
}

func (p *Plugin) FetchProof(ctx context.Context, event chain.CrossChainEvent) (chain.Proof, error) {
	// TODO: implement in P-3 using ABCI query + IAVL proof
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

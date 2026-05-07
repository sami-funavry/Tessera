// Package relayer implements the Tessera relayer's concurrent goroutines (R-83):
// event listener, submission handler, challenge watcher, and absence claimer.
package relayer

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/tessera-bridge/tessera/internal/chain"
)

// Config holds the configuration for a single relayer instance.
type Config struct {
	RelayerAddr string       // this relayer's on-chain address (used for both chains)
	EthPlugin   chain.Plugin // Sepolia plugin
	TmPlugin    chain.Plugin // Neutron plugin
	FromBlock   uint64       // starting block for event subscription
}

// Runner runs all goroutines and coordinates the relayer loop.
type Runner struct {
	cfg   Config
	admin *AdminState
}

// New creates a new Runner.
func New(cfg Config) *Runner {
	return &Runner{
		cfg:   cfg,
		admin: &AdminState{},
	}
}

// Run starts the submitter, challenger, and admin goroutines and blocks until
// ctx is cancelled. Returns only after all goroutines exit.
func (r *Runner) Run(ctx context.Context) error {
	var wg sync.WaitGroup

	// Goroutine pair 1: event listener + submission handler for Sepolia→Neutron.
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := r.runSubmitter(ctx, r.cfg.EthPlugin, r.cfg.TmPlugin); err != nil && ctx.Err() == nil {
			slog.Error("submitter Sepolia→Neutron exited unexpectedly", "err", err)
		}
	}()

	// Goroutine pair 2: event listener + submission handler for Neutron→Sepolia.
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := r.runSubmitter(ctx, r.cfg.TmPlugin, r.cfg.EthPlugin); err != nil && ctx.Err() == nil {
			slog.Error("submitter Neutron→Sepolia exited unexpectedly", "err", err)
		}
	}()

	// Goroutine 5: challenge watcher (both directions).
	wg.Add(1)
	go func() {
		defer wg.Done()
		r.runChallenger(ctx)
	}()

	slog.Info("relayer runner started",
		"relayer_addr", r.cfg.RelayerAddr,
		"from_block", r.cfg.FromBlock,
		"eth_chain", r.cfg.EthPlugin.ChainID(),
		"tm_chain", r.cfg.TmPlugin.ChainID())

	wg.Wait()
	slog.Info("relayer runner stopped")
	return nil
}

// pluginForChain returns the source and destination plugins for a given chain ID.
func (r *Runner) pluginForChain(chainID string) (src chain.Plugin, dst chain.Plugin) {
	switch chainID {
	case r.cfg.EthPlugin.ChainID():
		return r.cfg.EthPlugin, r.cfg.TmPlugin
	case r.cfg.TmPlugin.ChainID():
		return r.cfg.TmPlugin, r.cfg.EthPlugin
	}
	return nil, nil
}

// errUnknownChain wraps the unknown chain error with context.
func errUnknownChain(chainID string) error {
	return fmt.Errorf("unknown chain: %s", chainID)
}

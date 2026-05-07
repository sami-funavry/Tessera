// Package relayer implements the Tessera relayer's concurrent goroutines (R-83):
// event listener, submission handler, challenge watcher, and absence claimer.
package relayer

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/supabase"
)

// Config holds the configuration for a single relayer instance.
type Config struct {
	RelayerAddr string        // this relayer's on-chain address (used for both chains)
	EthPlugin   chain.Plugin  // Sepolia plugin
	TmPlugin    chain.Plugin  // Neutron plugin
	FromBlock   uint64        // starting block for event subscription
	DB          *supabase.Client // nil = no DB writes (e.g. in unit tests)
}

// pendingSubmission tracks a message the relayer submitted, waiting for challenge window.
type pendingSubmission struct {
	SubmissionID  [32]byte
	SubmissionDBID int64
	MessageDBID   int64
	SourceChainID string
	BlockHeight   uint64
	Nonce         uint64
	Deadline      time.Time // challenge window closes (60 s)
	Env           chain.MessageEnvelope
	Proof         chain.Proof // transformed proof submitted to dest
	DestPlugin    chain.Plugin
	TxHash        string
}

// Runner runs all goroutines and coordinates the relayer loop.
type Runner struct {
	cfg     Config
	admin   *AdminState
	mu      sync.Mutex
	pending map[[32]byte]*pendingSubmission // keyed by submissionID
}

// New creates a new Runner.
func New(cfg Config) *Runner {
	return &Runner{
		cfg:     cfg,
		admin:   &AdminState{},
		pending: make(map[[32]byte]*pendingSubmission),
	}
}

// addPending registers a submission for the challenger to watch.
func (r *Runner) addPending(ps *pendingSubmission) {
	r.mu.Lock()
	r.pending[ps.SubmissionID] = ps
	r.mu.Unlock()
}

// removePending removes a submission from the watch list.
func (r *Runner) removePending(id [32]byte) {
	r.mu.Lock()
	delete(r.pending, id)
	r.mu.Unlock()
}

// pendingList returns a snapshot of all pending submissions.
func (r *Runner) pendingList() []*pendingSubmission {
	r.mu.Lock()
	defer r.mu.Unlock()
	list := make([]*pendingSubmission, 0, len(r.pending))
	for _, ps := range r.pending {
		list = append(list, ps)
	}
	return list
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

	// Goroutine: challenge watcher (both directions).
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

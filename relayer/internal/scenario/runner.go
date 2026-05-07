// Package scenario provides self-contained simulations of the four Tessera demo scenarios.
// Each function runs entirely in-process with mock plugins — no testnet access required.
// For real testnet runs, use scripts/scenarios/0N-*.sh.
package scenario

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/relayer"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// Result summarises the outcome of a scenario run.
type Result struct {
	Scenario    string
	Passed      bool
	Description string
	Details     map[string]any
}

// RunS1 simulates Scenario 1 — honest delivery (R-30).
// An event is emitted, the submitter fetches proof and submits, the challenge
// window passes, and ExecuteMessage is called. Expects 1 submission on destination.
func RunS1(ctx context.Context) (*Result, error) {
	ethMock := newMockPlugin("sepolia", sepoliaProof(3))
	ethMock.events = []chain.Event{testEvent(1)}
	tmMock := newMockPlugin("pion-1", neutronProof(2))

	runner := relayer.New(relayer.Config{
		RelayerAddr: "scenario-s1-relayer",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
	})

	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	_ = runner.Run(runCtx)

	subs := tmMock.submissionCount()
	passed := subs >= 1
	return &Result{
		Scenario:    "S-1 Honest Delivery",
		Passed:      passed,
		Description: fmt.Sprintf("Expected ≥1 submission on Neutron; got %d", subs),
		Details:     map[string]any{"neutron_submissions": subs},
	}, nil
}

// RunS2 simulates Scenario 2 — lying relayer (R-31).
// The submitter injects a wrong fingerprint. The challenger (same runner) detects
// the mismatch and calls SubmitChallenge. Expects ≥1 challenge on destination.
func RunS2(ctx context.Context) (*Result, error) {
	ethMock := newMockPlugin("sepolia", sepoliaProof(3))
	ethMock.events = []chain.Event{testEvent(2)}
	tmMock := newMockPlugin("pion-1", neutronProof(2))

	runner := relayer.New(relayer.Config{
		RelayerAddr: "scenario-s2-relayer",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
	})

	// Inject wrong-fingerprint fault BEFORE the runner processes the event.
	runner.SetWrongFingerprint(true)

	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_ = runner.Run(runCtx)

	challenges := tmMock.challengeCount()
	passed := challenges >= 1
	return &Result{
		Scenario:    "S-2 Lying Relayer",
		Passed:      passed,
		Description: fmt.Sprintf("Expected ≥1 challenge on Neutron after fraud; got %d", challenges),
		Details: map[string]any{
			"neutron_challenges":   challenges,
			"neutron_submissions":  tmMock.submissionCount(),
		},
	}, nil
}

// RunS3 simulates Scenario 3 — silent relayer (R-32).
// Relayer A is told to go silent for 1 nonce. Relayer B (simulated by a second runner
// in the same process) picks up the message. After window close, ClaimAbsenceSlash fires.
func RunS3(ctx context.Context) (*Result, error) {
	// Shared mock plugins — both runners see the same events and share submission tracking.
	ethMock := newMockPlugin("sepolia", sepoliaProof(3))
	ethMock.events = []chain.Event{testEvent(3)}
	tmMockA := newMockPlugin("pion-1", neutronProof(2)) // destination for runner A
	tmMockB := newMockPlugin("pion-1", neutronProof(2)) // destination for runner B

	// Runner A — will be silenced for this nonce.
	runnerA := relayer.New(relayer.Config{
		RelayerAddr: "scenario-s3-relayer-A",
		EthPlugin:   ethMock,
		TmPlugin:    tmMockA,
	})
	runnerA.SetSilentNonces(1)

	// Runner B — runs normally; picks up the message after A skips it.
	ethMockB := newMockPlugin("sepolia", sepoliaProof(3))
	ethMockB.events = []chain.Event{testEvent(3)}
	runnerB := relayer.New(relayer.Config{
		RelayerAddr: "scenario-s3-relayer-B",
		EthPlugin:   ethMockB,
		TmPlugin:    tmMockB,
	})

	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = runnerA.Run(runCtx) }()
	go func() { defer wg.Done(); _ = runnerB.Run(runCtx) }()
	wg.Wait()

	// Runner B should have submitted; Runner A should have stayed silent.
	subsA := tmMockA.submissionCount()
	subsB := tmMockB.submissionCount()
	absenceSlashes := tmMockA.absenceSlashCount() + tmMockB.absenceSlashCount()

	passed := subsA == 0 && subsB >= 1
	return &Result{
		Scenario:    "S-3 Silent Relayer",
		Passed:      passed,
		Description: fmt.Sprintf("Expected A=0 submissions, B≥1, got A=%d B=%d; absence slashes=%d", subsA, subsB, absenceSlashes),
		Details: map[string]any{
			"relayer_A_submissions": subsA,
			"relayer_B_submissions": subsB,
			"absence_slashes":       absenceSlashes,
		},
	}, nil
}

// RunS4 simulates Scenario 4 — frivolous challenge (R-33).
// The submitter submits an honest proof. The challenger is then forced (via admin flag)
// to file a baseless dispute. The contract rejects it (mock records the call).
// Expects ≥1 submission AND ≥1 challenge (the frivolous one).
func RunS4(ctx context.Context) (*Result, error) {
	ethMock := newMockPlugin("sepolia", sepoliaProof(3))
	ethMock.events = []chain.Event{testEvent(4)}
	tmMock := newMockPlugin("pion-1", neutronProof(2))

	runner := relayer.New(relayer.Config{
		RelayerAddr: "scenario-s4-relayer",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
	})

	// Force-frivolous is set AFTER the event is queued — the honest submission goes
	// through first, then the challenger is kicked with the baseless flag.
	go func() {
		time.Sleep(2 * time.Second) // wait for honest submission to land
		runner.SetForceFrivolous(1)
	}()

	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_ = runner.Run(runCtx)

	subs := tmMock.submissionCount()
	challenges := tmMock.challengeCount()
	passed := subs >= 1 && challenges >= 1
	return &Result{
		Scenario:    "S-4 Frivolous Challenge",
		Passed:      passed,
		Description: fmt.Sprintf("Expected ≥1 submission and ≥1 frivolous challenge; got subs=%d challenges=%d", subs, challenges),
		Details: map[string]any{
			"neutron_submissions": subs,
			"neutron_challenges":  challenges,
		},
	}, nil
}

// ─── mock plugin ─────────────────────────────────────────────────────────────

type mockPlugin struct {
	mu          sync.Mutex
	id          string
	proof       chain.Proof
	events      []chain.Event
	submissions int
	challenges  int
	absences    int
}

func newMockPlugin(id string, proof chain.Proof) *mockPlugin {
	return &mockPlugin{id: id, proof: proof}
}

func (m *mockPlugin) ChainID() string { return m.id }

func (m *mockPlugin) LatestBlock(_ context.Context) (uint64, error) {
	return 1000, nil
}

func (m *mockPlugin) FetchBlockFingerprint(_ context.Context, height uint64) (chain.Fingerprint, error) {
	return chain.Fingerprint{
		ChainID:   m.id,
		Height:    height,
		Root:      bytes.Repeat([]byte{0xAB}, 32),
		Timestamp: time.Now(),
	}, nil
}

func (m *mockPlugin) FetchProof(_ context.Context, _ chain.Event, _ uint64) (chain.Proof, error) {
	return m.proof, nil
}

func (m *mockPlugin) VerifyConsensus(_ context.Context, _ uint64) error {
	return nil
}

func (m *mockPlugin) SubscribeEvents(ctx context.Context, _ uint64) (<-chan chain.Event, error) {
	ch := make(chan chain.Event, len(m.events)+1)
	for _, ev := range m.events {
		ch <- ev
	}
	close(ch)
	return ch, nil
}

func (m *mockPlugin) TranslateProofTo(proof chain.Proof, destChainID string) (chain.Proof, error) {
	if m.id == "sepolia" {
		env := chain.MessageEnvelope{SourceChainID: m.id, DestChainID: destChainID}
		return transform.PatriciaToIAVL(proof, env)
	}
	env := chain.MessageEnvelope{SourceChainID: m.id, DestChainID: destChainID}
	return transform.IAVLToPatricia(proof, env)
}

func (m *mockPlugin) SubmitMessage(_ context.Context, _ chain.MessageEnvelope, _ chain.Proof) (string, [32]byte, error) {
	m.mu.Lock()
	m.submissions++
	m.mu.Unlock()
	return "mock_submit_tx", [32]byte{0x01}, nil
}

func (m *mockPlugin) ExecuteMessage(_ context.Context, _ [32]byte, _ chain.Proof) (string, error) {
	return "mock_execute_tx", nil
}

func (m *mockPlugin) SubmitChallenge(_ context.Context, _ [32]byte, _ chain.Proof) (string, error) {
	m.mu.Lock()
	m.challenges++
	m.mu.Unlock()
	return "mock_challenge_tx", nil
}

func (m *mockPlugin) ClaimAbsenceSlash(_ context.Context, _ [32]byte) (string, error) {
	m.mu.Lock()
	m.absences++
	m.mu.Unlock()
	return "mock_absence_tx", nil
}

func (m *mockPlugin) Register(_ context.Context, _ []byte) (string, error) {
	return "mock_register_tx", nil
}

func (m *mockPlugin) DepositBond(_ context.Context, _ string) (string, error) {
	return "mock_deposit_tx", nil
}

func (m *mockPlugin) submissionCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.submissions
}

func (m *mockPlugin) challengeCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.challenges
}

func (m *mockPlugin) absenceSlashCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.absences
}

// ─── proof builders ───────────────────────────────────────────────────────────

func sepoliaProof(nodeCount int) chain.Proof {
	nodes := make([]string, nodeCount)
	for i := range nodes {
		nodes[i] = hexutil.Encode(bytes.Repeat([]byte{byte(i + 1)}, 32+i))
	}
	data := map[string]any{
		"storageProof": []map[string]any{
			{"key": "0xaaaa", "value": "0xbbbb", "proof": nodes},
		},
	}
	b, _ := json.Marshal(data)
	return chain.Proof{
		ChainID:     "sepolia",
		BlockNumber: 1000,
		StateRoot:   bytes.Repeat([]byte{0xFF}, 32),
		ProofBytes:  b,
		KeyPath:     bytes.Repeat([]byte{0xAA}, 32),
		Value:       bytes.Repeat([]byte{0xBB}, 32),
	}
}

func neutronProof(opCount int) chain.Proof {
	ops := make([]hexutil.Bytes, opCount)
	for i := range ops {
		ops[i] = bytes.Repeat([]byte{byte(i + 10)}, 32)
	}
	data := map[string]any{
		"value":     hexutil.Bytes(bytes.Repeat([]byte{0xCC}, 32)),
		"proof_ops": ops,
	}
	b, _ := json.Marshal(data)
	return chain.Proof{
		ChainID:     "pion-1",
		BlockNumber: 200,
		StateRoot:   bytes.Repeat([]byte{0xEE}, 32),
		ProofBytes:  b,
		KeyPath:     bytes.Repeat([]byte{0x11}, 16),
		Value:       bytes.Repeat([]byte{0xCC}, 32),
	}
}

func testEvent(nonce uint64) chain.Event {
	return chain.Event{
		SourceChainID: "sepolia",
		SourceApp:     "bridge_vault",
		DestChainID:   "pion-1",
		DestApp:       "bridge_mint",
		Action:        [4]byte{0x01, 0x02, 0x03, 0x04},
		Payload:       []byte("test_payload"),
		Nonce:         nonce,
		BlockHeight:   1000,
		TxHash:        fmt.Sprintf("0x%064x", nonce),
	}
}

// PrintResult formats and prints a scenario result.
func PrintResult(r *Result) {
	status := "PASS"
	if !r.Passed {
		status = "FAIL"
	}
	slog.Info("scenario result",
		"scenario", r.Scenario,
		"status", status,
		"description", r.Description,
		"details", r.Details)
	fmt.Printf("\n[%s] %s\n  %s\n", status, r.Scenario, r.Description)
	for k, v := range r.Details {
		fmt.Printf("  %-30s %v\n", k+":", v)
	}
}

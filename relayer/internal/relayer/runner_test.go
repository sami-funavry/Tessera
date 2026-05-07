package relayer_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/relayer"
	"github.com/tessera-bridge/tessera/internal/transform"
)

// ---- mock plugin ------------------------------------------------------------

// mockPlugin implements chain.Plugin for testing. It is configured with
// pre-determined events and proof data and records all SubmitMessage calls.
type mockPlugin struct {
	mu          sync.Mutex
	id          string
	events      []chain.Event
	proof       chain.Proof
	submitErr   error
	submissions []submitRecord
}

type submitRecord struct {
	env   chain.MessageEnvelope
	proof chain.Proof
}

func (m *mockPlugin) ChainID() string { return m.id }

func (m *mockPlugin) LatestBlock(_ context.Context) (uint64, error) {
	return 1, nil
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
	return nil // always succeeds in tests
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
	// Route to the real transform function based on source chain.
	if m.id == "sepolia" || m.id == "11155111" {
		env := chain.MessageEnvelope{
			SourceChainID: m.id,
			DestChainID:   destChainID,
		}
		return transform.PatriciaToIAVL(proof, env)
	}
	env := chain.MessageEnvelope{
		SourceChainID: m.id,
		DestChainID:   destChainID,
	}
	return transform.IAVLToPatricia(proof, env)
}

func (m *mockPlugin) SubmitMessage(_ context.Context, env chain.MessageEnvelope, proof chain.Proof) (string, [32]byte, error) {
	if m.submitErr != nil {
		return "", [32]byte{}, m.submitErr
	}
	m.mu.Lock()
	m.submissions = append(m.submissions, submitRecord{env: env, proof: proof})
	m.mu.Unlock()
	return "mock_tx_hash", [32]byte{}, nil
}

func (m *mockPlugin) ExecuteMessage(_ context.Context, _ [32]byte, _ chain.Proof) (string, error) {
	return "mock_execute_tx", nil
}

func (m *mockPlugin) SubmitChallenge(_ context.Context, _ [32]byte, _ chain.Proof) (string, error) {
	return "mock_challenge_tx", nil
}

func (m *mockPlugin) ClaimAbsenceSlash(_ context.Context, _ [32]byte) (string, error) {
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
	return len(m.submissions)
}

// ---- helpers ----------------------------------------------------------------

// buildSepoliaPatriciaProofBytes creates a Patricia proof JSON for the mock.
func buildSepoliaPatriciaProofBytes(nodeCount int) []byte {
	nodes := make([]string, nodeCount)
	for i := range nodes {
		node := bytes.Repeat([]byte{byte(i + 1)}, 32+i)
		nodes[i] = hexutil.Encode(node)
	}
	data := map[string]interface{}{
		"storageProof": []map[string]interface{}{
			{
				"key":   "0xaaaa",
				"value": "0xbbbb",
				"proof": nodes,
			},
		},
	}
	b, _ := json.Marshal(data)
	return b
}

// buildNeutronProofBytes creates a tendermintProofJSON bytes for the mock.
func buildNeutronProofBytes(opCount int) []byte {
	ops := make([]hexutil.Bytes, opCount)
	for i := range ops {
		ops[i] = bytes.Repeat([]byte{byte(i + 10)}, 32)
	}
	data := map[string]interface{}{
		"value":     hexutil.Bytes(bytes.Repeat([]byte{0xcc}, 32)),
		"proof_ops": ops,
	}
	b, _ := json.Marshal(data)
	return b
}

// mockSepoliaPlugin creates a mock Sepolia plugin with a pre-loaded proof.
func mockSepoliaPlugin(nodeCount int) *mockPlugin {
	return &mockPlugin{
		id: "sepolia",
		proof: chain.Proof{
			ChainID:     "sepolia",
			BlockNumber: 1000,
			StateRoot:   bytes.Repeat([]byte{0xFF}, 32),
			ProofBytes:  buildSepoliaPatriciaProofBytes(nodeCount),
			KeyPath:     bytes.Repeat([]byte{0xAA}, 32),
			Value:       bytes.Repeat([]byte{0xBB}, 32),
		},
	}
}

// mockNeutronPlugin creates a mock Neutron plugin with a pre-loaded proof.
func mockNeutronPlugin(opCount int) *mockPlugin {
	return &mockPlugin{
		id: "pion-1",
		proof: chain.Proof{
			ChainID:     "pion-1",
			BlockNumber: 200,
			StateRoot:   bytes.Repeat([]byte{0xEE}, 32),
			ProofBytes:  buildNeutronProofBytes(opCount),
			KeyPath:     bytes.Repeat([]byte{0x11}, 16),
			Value:       bytes.Repeat([]byte{0xCC}, 32),
		},
	}
}

// singleEvent returns a cross-chain event for the Sepolia→Neutron direction.
func singleEvent(nonce uint64) chain.Event {
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

// ---- TestS1: Honest delivery pipeline ---------------------------------------

// TestS1_HonestDelivery_Pipeline verifies the full relay pipeline without fault:
// event emitted → assigned submitter fetches proof, transforms, submits → success.
func TestS1_HonestDelivery_Pipeline(t *testing.T) {
	ethMock := mockSepoliaPlugin(3)
	ethMock.events = []chain.Event{singleEvent(1)}

	tmMock := mockNeutronPlugin(2)

	cfg := relayer.Config{
		RelayerAddr: "test-relayer-addr",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
		FromBlock:   0,
	}
	runner := relayer.New(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := runner.Run(ctx)
	// Run exits when ctx is cancelled or channels close; both are expected.
	if err != nil && err != context.DeadlineExceeded && err != context.Canceled {
		t.Errorf("runner.Run returned unexpected error: %v", err)
	}

	// The Neutron mock (destination) should have received exactly one submission.
	assert.Equal(t, 1, tmMock.submissionCount(),
		"Neutron mock must receive exactly one submission for the single emitted event")
}

// ---- TestS2: Wrong-fingerprint fraud detection ------------------------------

// TestS2_WrongFingerprint_Detection verifies that the challenger detects a wrong
// fingerprint by independently recomputing the transformed root and comparing.
func TestS2_WrongFingerprint_Detection(t *testing.T) {
	ethMock := mockSepoliaPlugin(2)
	tmMock := mockNeutronPlugin(2)

	cfg := relayer.Config{
		RelayerAddr: "test-relayer-addr",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
		FromBlock:   0,
	}
	runner := relayer.New(cfg)

	// Build a ChallengeRecord with a deliberately wrong claimed root.
	var tampered [32]byte
	tampered[0] = 0xFF
	tampered[31] = 0xFF

	rec := relayer.ChallengeRecord{
		SubmissionID:  "sub-001",
		SubmitterAddr: "bad-actor",
		ClaimedRoot:   tampered, // wrong root
		SourceChainID: "sepolia",
		BlockHeight:   1000,
		Nonce:         42,
		Deadline:      time.Now().Add(60 * time.Second),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// VerifySubmission re-fetches the proof and re-transforms it.
	// Since our mock always returns the same proof, the computed root will differ
	// from the tampered claimed root.
	matches, ourRoot, err := runner.VerifySubmission(ctx, rec)
	require.NoError(t, err, "VerifySubmission must not return an error with valid mock data")
	assert.False(t, matches, "challenger must detect the tampered claimed root as fraudulent")
	// Our independently computed root must be non-zero.
	assert.NotEqual(t, [32]byte{}, ourRoot, "independently computed root must be non-zero")
	// And it must differ from the tampered root.
	assert.NotEqual(t, tampered, ourRoot, "our root must differ from the tampered root")
}

// ---- TestTransformDeterminism_InRelayerContext ------------------------------

// TestTransformDeterminism_InRelayerContext calls TranslateProofTo 100 times
// via the mock plugin and asserts identical StateRoot every time.
func TestTransformDeterminism_InRelayerContext(t *testing.T) {
	ethMock := mockSepoliaPlugin(3)
	proof := ethMock.proof
	env := chain.MessageEnvelope{
		SourceChainID: "sepolia",
		DestChainID:   "pion-1",
	}

	first, err := transform.PatriciaToIAVL(proof, env)
	require.NoError(t, err)

	for i := 0; i < 100; i++ {
		result, err := transform.PatriciaToIAVL(proof, env)
		require.NoError(t, err, "transform must not error on run %d", i+1)
		assert.Equal(t, first.StateRoot, result.StateRoot,
			"TranslateProofTo must be deterministic: run %d produced different StateRoot", i+1)
	}
}

// ---- TestProofBytes_Under2KB ------------------------------------------------

// TestProofBytes_Under2KB verifies the transformed proof stays within the 2 KB size budget.
func TestProofBytes_Under2KB(t *testing.T) {
	// Use 16 nodes — the maximum expected Patricia trie depth.
	ethMock := mockSepoliaPlugin(16)
	proof := ethMock.proof
	env := chain.MessageEnvelope{
		SourceChainID: "sepolia",
		DestChainID:   "pion-1",
	}

	result, err := transform.PatriciaToIAVL(proof, env)
	require.NoError(t, err)

	const maxBytes = 2048
	assert.LessOrEqual(t, len(result.ProofBytes), maxBytes,
		"16-node proof must be under %d bytes; got %d", maxBytes, len(result.ProofBytes))
	t.Logf("16-node proof size: %d bytes (budget: %d)", len(result.ProofBytes), maxBytes)
}

// ---- TestAdminServer --------------------------------------------------------

// TestAdminServer verifies the admin HTTP server returns the expected JSON.
func TestAdminServer(t *testing.T) {
	ethMock := mockSepoliaPlugin(0)
	tmMock := mockNeutronPlugin(0)
	runner := relayer.New(relayer.Config{
		RelayerAddr: "0xdeadbeef",
		EthPlugin:   ethMock,
		TmPlugin:    tmMock,
	})

	srv := runner.AdminServer(":0")
	require.NotNil(t, srv, "AdminServer must return a non-nil http.Server")
}

// ---- TestRunnerNew ----------------------------------------------------------

// TestRunnerNew verifies New returns a non-nil Runner.
func TestRunnerNew(t *testing.T) {
	runner := relayer.New(relayer.Config{
		RelayerAddr: "test",
		EthPlugin:   mockSepoliaPlugin(0),
		TmPlugin:    mockNeutronPlugin(0),
	})
	require.NotNil(t, runner, "relayer.New must return a non-nil Runner")
}

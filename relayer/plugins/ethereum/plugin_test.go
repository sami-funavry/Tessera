package ethereum_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/plugins/ethereum"
)

// TestEthereumPluginChainID verifies the plugin reports the correct chain identifier.
func TestEthereumPluginChainID(t *testing.T) {
	p := ethereum.New("http://localhost:8545")
	assert.Equal(t, "sepolia", p.ChainID())
}

// TestEthereumPluginStubConsensus verifies VerifyConsensus is a documented stub
// that returns nil (trusts RPC per R-54 / R-122) without requiring a network connection.
//
// This confirms the Ethereum consensus bypass contract: the EVM cannot verify
// sync committee proofs at acceptable gas cost, so the relayer trusts its RPC.
func TestEthereumPluginStubConsensus(t *testing.T) {
	// Using a non-existent local address to confirm the stub does NOT dial.
	p := ethereum.New("http://127.0.0.1:19999")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := p.VerifyConsensus(ctx, 1234567)
	assert.NoError(t, err, "VerifyConsensus stub must return nil without dialing (R-54: trusts RPC)")
}

// TestEthereumPluginStubTranslateProof verifies TranslateProofTo returns ErrNotImplemented.
// This is a P-4 stub per the spec.
func TestEthereumPluginStubTranslateProof(t *testing.T) {
	p := ethereum.New("http://127.0.0.1:19999")
	_, err := p.TranslateProofTo(chain.Proof{ChainID: "sepolia"}, "pion-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "TranslateProofTo must return ErrNotImplemented until P-4")
}

// TestEthereumPluginStubSubmitMessage verifies SubmitMessage returns ErrNotImplemented.
func TestEthereumPluginStubSubmitMessage(t *testing.T) {
	p := ethereum.New("http://127.0.0.1:19999")
	_, err := p.SubmitMessage(context.Background(), chain.MessageEnvelope{}, chain.Proof{})
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "SubmitMessage must return ErrNotImplemented until P-6")
}

// TestEthereumPluginStubSubmitChallenge verifies SubmitChallenge returns ErrNotImplemented.
func TestEthereumPluginStubSubmitChallenge(t *testing.T) {
	p := ethereum.New("http://127.0.0.1:19999")
	_, err := p.SubmitChallenge(context.Background(), "msg-id", chain.Proof{})
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "SubmitChallenge must return ErrNotImplemented until P-7")
}

// TestEthereumPluginIntegration fetches a real Sepolia block fingerprint.
// Skipped unless ETHERUM_SEPOLIA_ENDPOINT is set in the environment.
func TestEthereumPluginIntegration(t *testing.T) {
	rpcURL := os.Getenv("ETHERUM_SEPOLIA_ENDPOINT")
	if rpcURL == "" {
		t.Skip("ETHERUM_SEPOLIA_ENDPOINT not set — skipping integration test")
	}

	p := ethereum.New(rpcURL)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	latest, err := p.LatestBlock(ctx)
	require.NoError(t, err, "LatestBlock must succeed against real Sepolia RPC")
	require.Greater(t, latest, uint64(0), "latest block number must be positive")

	fp, err := p.FetchBlockFingerprint(ctx, latest)
	require.NoError(t, err, "FetchBlockFingerprint must succeed")
	assert.Equal(t, "sepolia", fp.ChainID)
	assert.Equal(t, latest, fp.Height)
	assert.Equal(t, 32, len(fp.Root), "stateRoot must be exactly 32 bytes")
	assert.False(t, fp.Timestamp.IsZero(), "block timestamp must not be zero")
	t.Logf("Sepolia block %d stateRoot: 0x%x", fp.Height, fp.Root)
	t.Logf("Sepolia block %d timestamp: %s", fp.Height, fp.Timestamp.UTC())
}

// TestEthereumPluginConsensusStubIntegration confirms VerifyConsensus returns nil
// even when called with a real RPC. The stub never inspects the chain.
func TestEthereumPluginConsensusStubIntegration(t *testing.T) {
	rpcURL := os.Getenv("ETHERUM_SEPOLIA_ENDPOINT")
	if rpcURL == "" {
		t.Skip("ETHERUM_SEPOLIA_ENDPOINT not set — skipping integration test")
	}

	p := ethereum.New(rpcURL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := p.VerifyConsensus(ctx, 1)
	assert.NoError(t, err, "VerifyConsensus stub must always return nil regardless of height")
}

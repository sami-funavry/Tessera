package ethereum_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/config"
	"github.com/tessera-bridge/tessera/plugins/ethereum"
)

// newTestPlugin returns a plugin wired with empty addresses and no signer key.
// Suitable for unit tests that do not dial the chain.
func newTestPlugin(rpcURL string) *ethereum.Plugin {
	return ethereum.New(rpcURL, config.Addresses{}, "")
}

// TestEthereumPluginChainID verifies the plugin reports the correct chain identifier.
func TestEthereumPluginChainID(t *testing.T) {
	p := newTestPlugin("http://localhost:8545")
	assert.Equal(t, "sepolia", p.ChainID())
}

// TestEthereumPluginStubConsensus verifies VerifyConsensus returns nil without dialing (R-54 / R-122).
func TestEthereumPluginStubConsensus(t *testing.T) {
	p := newTestPlugin("http://127.0.0.1:19999")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := p.VerifyConsensus(ctx, 1234567)
	assert.NoError(t, err, "VerifyConsensus stub must return nil without dialing (R-54: trusts RPC)")
}

// TestEthereumPluginTranslateProof verifies TranslateProofTo succeeds (P-4 implemented).
func TestEthereumPluginTranslateProof(t *testing.T) {
	p := newTestPlugin("http://127.0.0.1:19999")
	result, err := p.TranslateProofTo(chain.Proof{ChainID: "sepolia"}, "pion-1")
	require.NoError(t, err, "TranslateProofTo must not error after P-4 implementation")
	assert.Equal(t, "pion-1", result.ChainID, "translated proof must target pion-1")
	assert.NotEmpty(t, result.ProofBytes, "translated proof must have wire bytes")
}

// TestEthereumPluginSubmitMessageNoKey verifies SubmitMessage returns an error when no key is set.
func TestEthereumPluginSubmitMessageNoKey(t *testing.T) {
	p := newTestPlugin("http://127.0.0.1:19999")
	_, _, err := p.SubmitMessage(context.Background(), chain.MessageEnvelope{}, chain.Proof{})
	// Should fail with "RELAYER_PRIVATE_KEY not set" (no key) or a dial error, not nil.
	assert.Error(t, err, "SubmitMessage must return an error when no private key is configured")
}

// TestEthereumPluginSubmitChallengeNoKey verifies SubmitChallenge returns an error when no key is set.
func TestEthereumPluginSubmitChallengeNoKey(t *testing.T) {
	p := newTestPlugin("http://127.0.0.1:19999")
	_, err := p.SubmitChallenge(context.Background(), [32]byte{}, chain.Proof{})
	assert.Error(t, err, "SubmitChallenge must return an error when no private key is configured")
}

// TestEthereumPluginPubKeyBytesNoKey verifies PubKeyBytes returns nil when no key is set.
func TestEthereumPluginPubKeyBytesNoKey(t *testing.T) {
	p := newTestPlugin("http://127.0.0.1:19999")
	assert.Nil(t, p.PubKeyBytes(), "PubKeyBytes must return nil when no private key is configured")
}

// TestEthereumPluginIntegration fetches a real Sepolia block fingerprint.
// Skipped unless ETHEREUM_SEPOLIA_ENDPOINT is set in the environment.
func TestEthereumPluginIntegration(t *testing.T) {
	rpcURL := os.Getenv("ETHEREUM_SEPOLIA_ENDPOINT")
	if rpcURL == "" {
		t.Skip("ETHEREUM_SEPOLIA_ENDPOINT not set — skipping integration test")
	}

	p := newTestPlugin(rpcURL)
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
}

// TestEthereumPluginConsensusStubIntegration confirms VerifyConsensus returns nil even with a real RPC.
func TestEthereumPluginConsensusStubIntegration(t *testing.T) {
	rpcURL := os.Getenv("ETHEREUM_SEPOLIA_ENDPOINT")
	if rpcURL == "" {
		t.Skip("ETHEREUM_SEPOLIA_ENDPOINT not set — skipping integration test")
	}

	p := newTestPlugin(rpcURL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := p.VerifyConsensus(ctx, 1)
	assert.NoError(t, err, "VerifyConsensus stub must always return nil regardless of height")
}

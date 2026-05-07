package tendermint_test

import (
	"context"
	"crypto/rand"
	"os"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/plugins/tendermint"
)

// TestTendermintPluginChainID verifies the plugin reports the correct chain identifier.
func TestTendermintPluginChainID(t *testing.T) {
	p := tendermint.New("http://127.0.0.1:26657", "pion-1")
	assert.Equal(t, "pion-1", p.ChainID())
}

// TestTendermintPluginStubTranslateProof verifies TranslateProofTo returns ErrNotImplemented.
func TestTendermintPluginStubTranslateProof(t *testing.T) {
	p := tendermint.New("http://127.0.0.1:26657", "pion-1")
	_, err := p.TranslateProofTo(chain.Proof{ChainID: "pion-1"}, "sepolia")
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "TranslateProofTo must return ErrNotImplemented until P-4")
}

// TestTendermintPluginStubSubmitMessage verifies SubmitMessage returns ErrNotImplemented.
func TestTendermintPluginStubSubmitMessage(t *testing.T) {
	p := tendermint.New("http://127.0.0.1:26657", "pion-1")
	_, err := p.SubmitMessage(context.Background(), chain.MessageEnvelope{}, chain.Proof{})
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "SubmitMessage must return ErrNotImplemented until P-6")
}

// TestTendermintPluginStubSubmitChallenge verifies SubmitChallenge returns ErrNotImplemented.
func TestTendermintPluginStubSubmitChallenge(t *testing.T) {
	p := tendermint.New("http://127.0.0.1:26657", "pion-1")
	_, err := p.SubmitChallenge(context.Background(), "msg-id", chain.Proof{})
	assert.ErrorIs(t, err, chain.ErrNotImplemented, "SubmitChallenge must return ErrNotImplemented until P-7")
}

// TestVerifyConsensusUnit tests Ed25519 signature verification using synthetic keys.
//
// This is the unit test for the core cryptographic logic in VerifyConsensus (R-55).
// It is independent of real chain data and runs without any network access.
//
// The Ed25519 bypass rationale: the EVM cannot verify Ed25519 signatures at
// acceptable gas cost (~500k gas per verify), so Tendermint consensus is
// verified off-chain in Go. The verified AppHash is then embedded in the proof
// submitted to the Solidity verifier, which only needs to verify the Patricia walk.
func TestVerifyConsensusUnit(t *testing.T) {
	const chainID = "pion-1"
	const height = int64(42)

	// Generate a validator key pair using CometBFT's Ed25519 implementation.
	privKey := ed25519.GenPrivKey()
	pubKey := privKey.PubKey()

	// Create a validator with 100 voting power.
	val := types.NewValidator(pubKey, 100)
	valSet := types.NewValidatorSet([]*types.Validator{val})

	// Create a block ID with a 32-byte placeholder hash.
	blockHash := make([]byte, 32)
	_, err := rand.Read(blockHash)
	require.NoError(t, err)
	blockID := types.BlockID{
		Hash: blockHash,
		PartSetHeader: types.PartSetHeader{
			Total: 1,
			Hash:  blockHash,
		},
	}

	// Build a precommit vote and sign it with the validator's Ed25519 key.
	vote := &types.Vote{
		Type:             cmtproto.PrecommitType,
		Height:           height,
		Round:            0,
		BlockID:          blockID,
		Timestamp:        time.Now().UTC(),
		ValidatorAddress: val.Address,
		ValidatorIndex:   0,
	}

	// Convert to proto and compute the canonical sign bytes (per CometBFT spec).
	voteProto := vote.ToProto()
	signBytes := types.VoteSignBytes(chainID, voteProto)
	sig, err := privKey.Sign(signBytes)
	require.NoError(t, err, "Ed25519 signing must not fail")
	vote.Signature = sig

	// Build a Commit containing the signed CommitSig.
	commit := &types.Commit{
		Height:  height,
		Round:   0,
		BlockID: blockID,
		Signatures: []types.CommitSig{
			{
				BlockIDFlag:      types.BlockIDFlagCommit,
				ValidatorAddress: val.Address,
				Timestamp:        vote.Timestamp,
				Signature:        sig,
			},
		},
	}

	// Positive case: valid Ed25519 signature must pass verification.
	err = valSet.VerifyCommit(chainID, blockID, height, commit)
	assert.NoError(t, err, "valid Ed25519 signature must pass VerifyCommit")

	// Negative case: forged signature must be rejected (R-55 requirement).
	// This is the security-critical test: the challenger cannot fabricate a
	// valid commit without the private key, so fraud is always detectable.
	forgedSig := make([]byte, 64)
	_, err = rand.Read(forgedSig)
	require.NoError(t, err)

	forgedCommit := &types.Commit{
		Height:  height,
		Round:   0,
		BlockID: blockID,
		Signatures: []types.CommitSig{
			{
				BlockIDFlag:      types.BlockIDFlagCommit,
				ValidatorAddress: val.Address,
				Timestamp:        vote.Timestamp,
				Signature:        forgedSig, // random 64 bytes — not a valid signature
			},
		},
	}
	err = valSet.VerifyCommit(chainID, blockID, height, forgedCommit)
	assert.Error(t, err, "forged Ed25519 signature must be rejected by VerifyCommit")
	t.Logf("forged signature correctly rejected: %v", err)
}

// TestVerifyConsensusMultiValidator tests the strict 2/3+ threshold rule.
//
// CometBFT's quorum is strictly MORE than 2/3 of total voting power (not ≥).
// NewValidatorSet sorts validators by voting power (then address), so the commit
// slot index must align with the sorted valSet order, not the original input order.
// We build the commit using valSet.Validators[i] directly to ensure alignment.
//
// Voting power: 4 validators × 100 = 400 total. Threshold = 400*2/3 = 266.
// 3 signers = 300 > 266 → passes. 1 signer = 100 ≤ 266 → fails.
func TestVerifyConsensusMultiValidator(t *testing.T) {
	const chainID = "pion-1"
	const height = int64(100)
	const n = 4

	// Generate private keys for each validator.
	privKeys := make([]ed25519.PrivKey, n)
	for i := range privKeys {
		privKeys[i] = ed25519.GenPrivKey()
	}

	// Build validators with equal voting power and create the sorted set.
	inputVals := make([]*types.Validator, n)
	for i := range inputVals {
		inputVals[i] = types.NewValidator(privKeys[i].PubKey(), 100)
	}
	valSet := types.NewValidatorSet(inputVals)

	// Build a lookup from address → private key so we can sign with the right key
	// regardless of how NewValidatorSet reorders the validators.
	addrToKey := make(map[string]ed25519.PrivKey, n)
	for i, pk := range privKeys {
		addrToKey[string(inputVals[i].Address)] = pk
	}

	blockHash := make([]byte, 32)
	_, err := rand.Read(blockHash)
	require.NoError(t, err)
	blockID := types.BlockID{
		Hash: blockHash,
		PartSetHeader: types.PartSetHeader{Total: 1, Hash: blockHash},
	}
	ts := time.Now().UTC()

	// signCommit builds a Commit using the sorted valSet's ordering.
	// signingSet is the set of sorted indices (0..n-1) that should sign.
	signCommit := func(signingSet map[int]bool) *types.Commit {
		commitSigs := make([]types.CommitSig, n)
		for i := range commitSigs {
			if signingSet[i] {
				commitSigs[i] = types.CommitSig{
					BlockIDFlag:      types.BlockIDFlagCommit,
					ValidatorAddress: valSet.Validators[i].Address,
					Timestamp:        ts,
					Signature:        nil, // filled below
				}
			} else {
				commitSigs[i] = types.CommitSig{BlockIDFlag: types.BlockIDFlagAbsent}
			}
		}
		c := &types.Commit{Height: height, Round: 0, BlockID: blockID, Signatures: commitSigs}

		// Sign each CommitSig using the correct private key for that sorted slot.
		// commit.VoteSignBytes(chainID, i) reproduces exactly what the verifier checks.
		for i := range commitSigs {
			if !signingSet[i] {
				continue
			}
			pk, ok := addrToKey[string(valSet.Validators[i].Address)]
			require.True(t, ok, "private key must exist for validator at sorted index %d", i)
			signBytes := c.VoteSignBytes(chainID, int32(i))
			sig, e := pk.Sign(signBytes)
			require.NoError(t, e)
			c.Signatures[i].Signature = sig
		}
		return c
	}

	// All four sign (400/400 = 100%): must pass.
	allSign := map[int]bool{0: true, 1: true, 2: true, 3: true}
	err = valSet.VerifyCommit(chainID, blockID, height, signCommit(allSign))
	assert.NoError(t, err, "4/4 signing must pass")

	// Three of four sign (300/400 = 75% > 2/3): must pass.
	threeSign := map[int]bool{0: true, 1: true, 2: true}
	err = valSet.VerifyCommit(chainID, blockID, height, signCommit(threeSign))
	assert.NoError(t, err, "3/4 signing (75%% > strict 2/3) must satisfy the quorum")

	// Only one of four (100/400 = 25%): must fail.
	oneSign := map[int]bool{0: true}
	err = valSet.VerifyCommit(chainID, blockID, height, signCommit(oneSign))
	assert.Error(t, err, "1/4 signing (25%%) must NOT satisfy the strict 2/3+ quorum")
	t.Logf("insufficient quorum correctly rejected: %v", err)
}

// TestVerifyConsensusIntegration hits the real Neutron testnet to verify a block.
// Skipped unless NEUTRON_RPC_URL is set in the environment.
func TestVerifyConsensusIntegration(t *testing.T) {
	rpcURL := os.Getenv("NEUTRON_RPC_URL")
	if rpcURL == "" {
		t.Skip("NEUTRON_RPC_URL not set — skipping integration test")
	}

	p := tendermint.New(rpcURL, "pion-1")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	latest, err := p.LatestBlock(ctx)
	require.NoError(t, err, "LatestBlock must succeed against real Neutron RPC")
	require.Greater(t, latest, uint64(0))
	t.Logf("Neutron pion-1 latest block: %d", latest)

	// Verify consensus on a finalized block (use latest-1 to ensure it is committed).
	target := latest - 1
	err = p.VerifyConsensus(ctx, target)
	assert.NoError(t, err, "VerifyConsensus must pass for a finalized Neutron block")
	t.Logf("Neutron block %d Ed25519 consensus verified", target)
}

// TestFetchBlockFingerprintIntegration fetches a real Neutron block AppHash.
// Skipped unless NEUTRON_RPC_URL is set in the environment.
func TestFetchBlockFingerprintIntegration(t *testing.T) {
	rpcURL := os.Getenv("NEUTRON_RPC_URL")
	if rpcURL == "" {
		t.Skip("NEUTRON_RPC_URL not set — skipping integration test")
	}

	p := tendermint.New(rpcURL, "pion-1")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	latest, err := p.LatestBlock(ctx)
	require.NoError(t, err)

	fp, err := p.FetchBlockFingerprint(ctx, latest)
	require.NoError(t, err, "FetchBlockFingerprint must succeed")
	assert.Equal(t, "pion-1", fp.ChainID)
	assert.Equal(t, latest, fp.Height)
	assert.NotEmpty(t, fp.Root, "AppHash must not be empty")
	assert.False(t, fp.Timestamp.IsZero(), "block timestamp must not be zero")
	t.Logf("Neutron block %d AppHash: 0x%x", fp.Height, fp.Root)
	t.Logf("Neutron block %d timestamp: %s", fp.Height, fp.Timestamp.UTC())
}

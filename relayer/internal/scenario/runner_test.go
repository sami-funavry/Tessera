package scenario_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tessera-bridge/tessera/internal/scenario"
)

func TestS1_HonestDelivery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	result, err := scenario.RunS1(ctx)
	require.NoError(t, err)
	assert.True(t, result.Passed, "S-1 must pass: %s", result.Description)
	subs, _ := result.Details["neutron_submissions"].(int)
	assert.GreaterOrEqual(t, subs, 1, "S-1: Neutron must receive at least one submission")
}

func TestS2_LyingRelayer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := scenario.RunS2(ctx)
	require.NoError(t, err)
	assert.True(t, result.Passed, "S-2 must pass: %s", result.Description)
	challenges, _ := result.Details["neutron_challenges"].(int)
	assert.GreaterOrEqual(t, challenges, 1, "S-2: challenger must file at least one dispute")
}

func TestS3_SilentRelayer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := scenario.RunS3(ctx)
	require.NoError(t, err)
	assert.True(t, result.Passed, "S-3 must pass: %s", result.Description)
	subsA, _ := result.Details["relayer_A_submissions"].(int)
	subsB, _ := result.Details["relayer_B_submissions"].(int)
	assert.Equal(t, 0, subsA, "S-3: silent relayer A must not submit")
	assert.GreaterOrEqual(t, subsB, 1, "S-3: relayer B must take over and submit")
}

func TestS4_FrivolousChallenge(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := scenario.RunS4(ctx)
	require.NoError(t, err)
	assert.True(t, result.Passed, "S-4 must pass: %s", result.Description)
	subs, _ := result.Details["neutron_submissions"].(int)
	challenges, _ := result.Details["neutron_challenges"].(int)
	assert.GreaterOrEqual(t, subs, 1, "S-4: honest submission must land")
	assert.GreaterOrEqual(t, challenges, 1, "S-4: frivolous challenge must be filed")
}

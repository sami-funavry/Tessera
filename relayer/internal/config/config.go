// Package config loads Tessera configuration from environment variables.
package config

import (
	"fmt"
	"os"
)

// Config holds all runtime configuration for the Tessera relayer.
type Config struct {
	SepoliaRPCURL     string
	SepoliaChainID    int64
	NeutronRPCURL     string
	NeutronGRPCURL    string
	NeutronRESTURL    string
	NeutronChainID    string
	SupabaseURL       string
	SupabaseServiceKey string
	EtherscanAPIKey   string
	EtherscanAPIURL   string
}

// Load reads configuration from environment variables and returns an error
// listing every missing variable (fail-fast, no silent defaults).
func Load() (*Config, error) {
	var missing []string

	get := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	cfg := &Config{
		SepoliaRPCURL:      get("ETHERUM_SEPOLIA_ENDPOINT"),
		NeutronRPCURL:      get("NEUTRON_RPC_URL"),
		NeutronGRPCURL:     get("NEUTRON_GRPC_URL"),
		NeutronRESTURL:     get("NEUTRON_REST_URL"),
		NeutronChainID:     get("NEUTRON_CHAIN_ID"),
		SupabaseURL:        get("SUPABASE_PROJECT_URL"),
		SupabaseServiceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
		EtherscanAPIKey:    get("ETHERSCAN_API_KEY"),
		EtherscanAPIURL:    get("ETHERSCAN_API_URL"),
	}
	cfg.SepoliaChainID = 11155111

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env vars: %v", missing)
	}
	return cfg, nil
}

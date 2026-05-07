// Package config loads Tessera configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Addresses holds deployed contract addresses for both chains.
type Addresses struct {
	// Sepolia (EVM)
	SepoliaTUSDC          string
	SepoliaBond           string
	SepoliaRelayerRegistry string
	SepoliaVerifier       string
	SepoliaBridgeVault    string
	SepoliaBridgeMint     string
	// Neutron (CosmWasm)
	NeutronTUSDC          string
	NeutronBond           string
	NeutronRelayerRegistry string
	NeutronVerifier       string
	NeutronBridgeVault    string
	NeutronBridgeMint     string
}

// Config holds all runtime configuration for the Tessera relayer.
type Config struct {
	SepoliaRPCURL      string
	SepoliaChainID     int64
	NeutronRPCURL      string
	NeutronGRPCURL     string
	NeutronRESTURL     string
	NeutronChainID     string
	SupabaseURL        string
	SupabaseServiceKey string
	EtherscanAPIKey    string
	EtherscanAPIURL    string
	// RelayerPrivateKey is this instance's hex-encoded secp256k1 private key (no 0x prefix).
	// Used for both EVM (Sepolia) and Cosmos (Neutron) signing.
	RelayerPrivateKey string
	Addrs             Addresses
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

	// getOpt reads an env var but does not fail if absent (optional at load time;
	// required at runtime for operations that actually need the address).
	getOpt := func(key string) string { return os.Getenv(key) }

	cfg := &Config{
		SepoliaRPCURL:      get("ETHEREUM_SEPOLIA_ENDPOINT"),
		NeutronRPCURL:      get("NEUTRON_RPC_URL"),
		NeutronGRPCURL:     get("NEUTRON_GRPC_URL"),
		NeutronRESTURL:     get("NEUTRON_REST_URL"),
		NeutronChainID:     get("NEUTRON_CHAIN_ID"),
		SupabaseURL:        get("SUPABASE_PROJECT_URL"),
		SupabaseServiceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
		EtherscanAPIKey:    get("ETHERSCAN_API_KEY"),
		EtherscanAPIURL:    get("ETHERSCAN_API_URL"),
		RelayerPrivateKey:  strings.TrimPrefix(get("RELAYER_PRIVATE_KEY"), "0x"),
		Addrs: Addresses{
			SepoliaTUSDC:           getOpt("SEPOLIA_TUSDC"),
			SepoliaBond:            getOpt("SEPOLIA_BOND"),
			SepoliaRelayerRegistry: getOpt("SEPOLIA_REGISTRY"),
			SepoliaVerifier:        getOpt("SEPOLIA_VERIFIER"),
			SepoliaBridgeVault:     getOpt("SEPOLIA_VAULT"),
			SepoliaBridgeMint:      getOpt("SEPOLIA_MINT"),
			NeutronTUSDC:           getOpt("NEUTRON_TUSDC"),
			NeutronBond:            getOpt("NEUTRON_BOND"),
			NeutronRelayerRegistry: getOpt("NEUTRON_REGISTRY"),
			NeutronVerifier:        getOpt("NEUTRON_VERIFIER"),
			NeutronBridgeVault:     getOpt("NEUTRON_VAULT"),
			NeutronBridgeMint:      getOpt("NEUTRON_MINT"),
		},
	}
	cfg.SepoliaChainID = 11155111

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env vars: %v", missing)
	}
	return cfg, nil
}

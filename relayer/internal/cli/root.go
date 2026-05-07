package cli

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/tessera-bridge/tessera/internal/config"
	"github.com/tessera-bridge/tessera/internal/pipeline"
	chainpkg "github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/plugins/ethereum"
	"github.com/tessera-bridge/tessera/plugins/tendermint"
)

func NewRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "tessera",
		Short: "Tessera cross-chain relayer and tooling",
		PersistentPreRun: func(_ *cobra.Command, _ []string) {
			slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
				Level: slog.LevelInfo,
			})))
		},
	}

	root.AddCommand(
		newRelayerCmd(),
		newIndexerCmd(),
		newBondCmd(),
		newFetchCmd(),
		newScenarioCmd(),
	)
	return root
}

func newRelayerCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "relayer",
		Short: "Run the relayer daemon (submitter + challenger)",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("relayer starting", "component", "relayer")
			// TODO: implement main relay loop in P-6
			return nil
		},
	}
}

func newIndexerCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "indexer",
		Short: "Run the chain event indexer",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("indexer starting", "component", "indexer")
			// TODO: implement block indexer in P-6
			return nil
		},
	}
}

func newBondCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "bond",
		Short: "Manage relayer bond (deposit/withdraw/status)",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("bond command", "component", "bond")
			// TODO: implement bond management in P-6
			return nil
		},
	}
}

// newFetchCmd returns the fetch subcommand.
// It fetches a block fingerprint from Sepolia or Neutron and prints it as JSON.
func newFetchCmd() *cobra.Command {
	var chainName string
	var blockHeight uint64

	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Fetch and display a block fingerprint from a chain",
		Long: `Fetch a block fingerprint (stateRoot for Sepolia, AppHash for Neutron) at a given
height and print it as JSON. If --block is 0 (the default), the latest block is used.

Supported chains: sepolia, ethereum, neutron, pion-1`,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			var plugin chainpkg.Plugin
			switch chainName {
			case "sepolia", "ethereum":
				plugin = ethereum.New(cfg.SepoliaRPCURL)
			case "neutron", "pion-1":
				plugin = tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID)
			default:
				return fmt.Errorf("unknown chain %q; use 'sepolia' or 'neutron'", chainName)
			}

			ctx := cmd.Context()

			if blockHeight == 0 {
				blockHeight, err = plugin.LatestBlock(ctx)
				if err != nil {
					return fmt.Errorf("fetch latest block: %w", err)
				}
			}

			if err := plugin.VerifyConsensus(ctx, blockHeight); err != nil {
				return fmt.Errorf("consensus verification failed: %w", err)
			}

			fp, err := plugin.FetchBlockFingerprint(ctx, blockHeight)
			if err != nil {
				return fmt.Errorf("fetch fingerprint: %w", err)
			}

			out, err := json.MarshalIndent(map[string]any{
				"chain":     fp.ChainID,
				"height":    fp.Height,
				"root":      fmt.Sprintf("0x%x", fp.Root),
				"timestamp": fp.Timestamp.UTC().Format(time.RFC3339),
			}, "", "  ")
			if err != nil {
				return fmt.Errorf("marshal output: %w", err)
			}
			fmt.Println(string(out))
			return nil
		},
	}

	cmd.Flags().StringVar(&chainName, "chain", "", "Chain to query: sepolia or neutron (required)")
	cmd.Flags().Uint64Var(&blockHeight, "block", 0, "Block height (0 = latest)")
	_ = cmd.MarkFlagRequired("chain")
	return cmd
}

// newScenarioCmd returns the test-scenario subcommand.
// In P-3, the "mock" scenario runs both pipeline directions end-to-end.
// Real scenarios 1-4 are implemented in P-7.
func newScenarioCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "test-scenario [mock|1|2|3|4]",
		Short: "Run a demo scenario (mock: pipeline dry-run; 1-4: real scenarios in P-7)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if args[0] == "mock" {
				cfg, err := config.Load()
				if err != nil {
					return fmt.Errorf("load config: %w", err)
				}
				runner := &pipeline.Runner{
					EthPlugin: ethereum.New(cfg.SepoliaRPCURL),
					TmPlugin:  tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID),
				}
				if err := runner.RunMockSepoliaToNeutron(cmd.Context()); err != nil {
					return fmt.Errorf("Sepolia→Neutron mock: %w", err)
				}
				return runner.RunMockNeutronToSepolia(cmd.Context())
			}
			slog.Info("test scenario 1-4 implemented in P-7", "id", args[0])
			return nil
		},
	}
}

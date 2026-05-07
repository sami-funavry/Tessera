package cli

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/spf13/cobra"
	chainpkg "github.com/tessera-bridge/tessera/internal/chain"
	"github.com/tessera-bridge/tessera/internal/config"
	"github.com/tessera-bridge/tessera/internal/pipeline"
	"github.com/tessera-bridge/tessera/internal/relayer"
	"github.com/tessera-bridge/tessera/internal/transform"
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
	var adminAddr string
	var fromBlock uint64

	cmd := &cobra.Command{
		Use:   "relayer",
		Short: "Run the relayer daemon (submitter + challenger)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			ethPlugin := ethereum.New(cfg.SepoliaRPCURL)
			tmPlugin := tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID)

			runner := relayer.New(relayer.Config{
				RelayerAddr: os.Getenv("RELAYER_ADDRESS"),
				EthPlugin:   ethPlugin,
				TmPlugin:    tmPlugin,
				FromBlock:   fromBlock,
			})

			// Start admin HTTP server if --admin flag is set.
			if adminAddr != "" {
				srv := runner.AdminServer(adminAddr)
				go func() {
					slog.Info("admin server listening", "addr", adminAddr)
					if err := srv.ListenAndServe(); err != nil {
						slog.Warn("admin server stopped", "err", err)
					}
				}()
			}

			slog.Info("relayer starting",
				"component", "relayer",
				"eth_chain", ethPlugin.ChainID(),
				"tm_chain", tmPlugin.ChainID(),
				"from_block", fromBlock)
			return runner.Run(cmd.Context())
		},
	}

	cmd.Flags().StringVar(&adminAddr, "admin", "", "Admin HTTP server address (e.g. :8080); disabled if empty")
	cmd.Flags().Uint64Var(&fromBlock, "from-block", 0, "Starting block for event subscription (0 = chain tip)")
	return cmd
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
// When --transform is set, it also fetches a proof and prints the transformed root.
func newFetchCmd() *cobra.Command {
	var chainName string
	var blockHeight uint64
	var doTransform bool

	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Fetch and display a block fingerprint from a chain",
		Long: `Fetch a block fingerprint (stateRoot for Sepolia, AppHash for Neutron) at a given
height and print it as JSON. If --block is 0 (the default), the latest block is used.

When --transform is set, also fetches a proof for a placeholder event at that height
and prints the TesseraProof transformed root and wire size.

Supported chains: sepolia, ethereum, neutron, pion-1`,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			var plugin chainpkg.Plugin
			var destChainID string
			switch chainName {
			case "sepolia", "ethereum":
				plugin = ethereum.New(cfg.SepoliaRPCURL)
				destChainID = "pion-1"
			case "neutron", "pion-1":
				plugin = tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID)
				destChainID = "sepolia"
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

			result := map[string]any{
				"chain":     fp.ChainID,
				"height":    fp.Height,
				"root":      fmt.Sprintf("0x%x", fp.Root),
				"timestamp": fp.Timestamp.UTC().Format(time.RFC3339),
			}

			if doTransform {
				// Fetch a proof for a placeholder event at this height.
				placeholderEvent := chainpkg.Event{
					SourceChainID: plugin.ChainID(),
					DestChainID:   destChainID,
					BlockHeight:   blockHeight,
				}
				proof, fetchErr := plugin.FetchProof(ctx, placeholderEvent, blockHeight)
				if fetchErr != nil {
					slog.Warn("fetch: FetchProof failed (placeholder address in P-3/P-4)",
						"err", fetchErr, "height", blockHeight)
					proof = chainpkg.Proof{ChainID: plugin.ChainID(), BlockNumber: blockHeight}
				}

				translated, xlateErr := plugin.TranslateProofTo(proof, destChainID)
				if xlateErr != nil {
					return fmt.Errorf("TranslateProofTo: %w", xlateErr)
				}

				result["transformed_root"] = transform.FingerprintHex(translated)
				result["proof_wire_bytes"] = len(translated.ProofBytes)
				result["dest_chain"] = translated.ChainID
			}

			out, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				return fmt.Errorf("marshal output: %w", err)
			}
			fmt.Println(string(out))
			return nil
		},
	}

	cmd.Flags().StringVar(&chainName, "chain", "", "Chain to query: sepolia or neutron (required)")
	cmd.Flags().Uint64Var(&blockHeight, "block", 0, "Block height (0 = latest)")
	cmd.Flags().BoolVar(&doTransform, "transform", false, "Also fetch a proof and print the transformed root")
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

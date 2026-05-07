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
	"github.com/tessera-bridge/tessera/internal/supabase"
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

			ethPlugin := ethereum.New(cfg.SepoliaRPCURL, cfg.Addrs, cfg.RelayerPrivateKey)
			tmPlugin := tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID, cfg.NeutronRESTURL, cfg.Addrs, cfg.RelayerPrivateKey)

			db := supabase.New(cfg.SupabaseURL, cfg.SupabaseServiceKey)
			if pingErr := db.Ping(cmd.Context()); pingErr != nil {
				slog.Warn("supabase not reachable — DB writes disabled", "err", pingErr)
				db = nil
			}

			// Derive relayer address from private key if not explicitly set.
			relayerAddr := os.Getenv("RELAYER_ADDRESS")
			if relayerAddr == "" {
				relayerAddr = cfg.RelayerPrivateKey[:8] + "..." // safe placeholder for logs
			}

			runner := relayer.New(relayer.Config{
				RelayerAddr: relayerAddr,
				EthPlugin:   ethPlugin,
				TmPlugin:    tmPlugin,
				FromBlock:   fromBlock,
				DB:          db,
			})

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

	cmd.Flags().StringVar(&adminAddr, "admin", "", "Admin HTTP server address (e.g. :8080)")
	cmd.Flags().Uint64Var(&fromBlock, "from-block", 0, "Starting block for event subscription (0 = chain tip)")
	return cmd
}

func newIndexerCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "indexer",
		Short: "Run the chain event indexer",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("indexer starting", "component", "indexer")
			return nil
		},
	}
}

// newBondCmd returns the bond management command with register + deposit subcommands.
func newBondCmd() *cobra.Command {
	bond := &cobra.Command{
		Use:   "bond",
		Short: "Manage relayer bond (register / deposit / status)",
	}
	bond.AddCommand(newBondRegisterCmd(), newBondDepositCmd(), newBondStatusCmd())
	return bond
}

// newBondRegisterCmd registers this relayer's public key on both chains.
func newBondRegisterCmd() *cobra.Command {
	var chainName string
	return &cobra.Command{
		Use:   "register",
		Short: "Register this relayer's public key on-chain (sepolia | neutron | both)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			if cfg.RelayerPrivateKey == "" {
				return fmt.Errorf("RELAYER_PRIVATE_KEY must be set")
			}

			ctx := cmd.Context()

			runRegister := func(plugin chainpkg.Plugin, name string) error {
				// Derive pubkey from the plugin's address helper.
				// Both plugins share the same secp256k1 key; EthPlugin exposes it.
				ethP, ok := plugin.(interface{ PubKeyBytes() []byte })
				if !ok {
					return fmt.Errorf("%s plugin does not expose PubKeyBytes", name)
				}
				pubKey := ethP.PubKeyBytes()
				txHash, err := plugin.Register(ctx, pubKey)
				if err != nil {
					return fmt.Errorf("register on %s: %w", name, err)
				}
				slog.Info("relayer registered", "chain", name, "tx_hash", txHash)
				return nil
			}

			ethPlugin := ethereum.New(cfg.SepoliaRPCURL, cfg.Addrs, cfg.RelayerPrivateKey)
			tmPlugin := tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID, cfg.NeutronRESTURL, cfg.Addrs, cfg.RelayerPrivateKey)

			switch chainName {
			case "sepolia", "ethereum":
				return runRegister(ethPlugin, "sepolia")
			case "neutron", "pion-1":
				return runRegister(tmPlugin, "neutron")
			default:
				if err := runRegister(ethPlugin, "sepolia"); err != nil {
					return err
				}
				return runRegister(tmPlugin, "neutron")
			}
		},
	}
}

// newBondDepositCmd posts ETH/NTRN into the Bond contract on the specified chain.
func newBondDepositCmd() *cobra.Command {
	var chainName string
	var amount string
	cmd := &cobra.Command{
		Use:   "deposit",
		Short: "Deposit bond on-chain (amount in wei for sepolia, uNTRN for neutron)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			if amount == "" {
				return fmt.Errorf("--amount is required")
			}

			ctx := cmd.Context()

			ethPlugin := ethereum.New(cfg.SepoliaRPCURL, cfg.Addrs, cfg.RelayerPrivateKey)
			tmPlugin := tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID, cfg.NeutronRESTURL, cfg.Addrs, cfg.RelayerPrivateKey)

			switch chainName {
			case "sepolia", "ethereum":
				txHash, err := ethPlugin.DepositBond(ctx, amount)
				if err != nil {
					return fmt.Errorf("deposit bond on sepolia: %w", err)
				}
				slog.Info("bond deposited on sepolia", "tx_hash", txHash, "amount_wei", amount)
			case "neutron", "pion-1":
				txHash, err := tmPlugin.DepositBond(ctx, amount)
				if err != nil {
					return fmt.Errorf("deposit bond on neutron: %w", err)
				}
				slog.Info("bond deposited on neutron", "tx_hash", txHash, "amount_untrn", amount)
			default:
				return fmt.Errorf("--chain must be 'sepolia' or 'neutron'")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&chainName, "chain", "", "Chain: sepolia or neutron (required)")
	cmd.Flags().StringVar(&amount, "amount", "", "Amount to deposit (wei for ETH, uNTRN for Cosmos)")
	_ = cmd.MarkFlagRequired("chain")
	_ = cmd.MarkFlagRequired("amount")
	return cmd
}

// newBondStatusCmd queries on-chain bond balances.
func newBondStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Print on-chain bond balance for this relayer address",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("bond status check — use block explorer for now", "component", "bond")
			return nil
		},
	}
}

// newFetchCmd returns the fetch subcommand.
func newFetchCmd() *cobra.Command {
	var chainName string
	var blockHeight uint64
	var doTransform bool

	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Fetch and display a block fingerprint from a chain",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			var plugin chainpkg.Plugin
			var destChainID string
			switch chainName {
			case "sepolia", "ethereum":
				plugin = ethereum.New(cfg.SepoliaRPCURL, cfg.Addrs, "")
				destChainID = "pion-1"
			case "neutron", "pion-1":
				plugin = tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID, cfg.NeutronRESTURL, cfg.Addrs, "")
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
					EthPlugin: ethereum.New(cfg.SepoliaRPCURL, cfg.Addrs, ""),
					TmPlugin:  tendermint.New(cfg.NeutronRPCURL, cfg.NeutronChainID, cfg.NeutronRESTURL, cfg.Addrs, ""),
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


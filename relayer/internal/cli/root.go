package cli

import (
	"log/slog"
	"os"

	"github.com/spf13/cobra"
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
			// TODO: implement in P-3
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
			// TODO: implement in P-3
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
			// TODO: implement in P-6
			return nil
		},
	}
}

func newFetchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "fetch",
		Short: "Fetch and transform a proof for a given nonce",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("fetch command", "component", "fetch")
			// TODO: implement in P-4
			return nil
		},
	}
}

func newScenarioCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "test-scenario [1|2|3|4]",
		Short: "Run a demo scenario end-to-end",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("test scenario", "component", "scenario", "id", args[0])
			// TODO: implement in P-7
			return nil
		},
	}
}

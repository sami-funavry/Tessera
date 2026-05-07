---
name: tessera-relayer
description: Conventions for writing Tessera's Go relayer service. Covers the chain plugin interface, proof transformation logic, state persistence with Supabase, structured logging, error handling, and the concurrent goroutine architecture. The relayer is the only thing that knows about chain-specific cryptography and encoding. Load for any prompt that creates or edits files under relayer/.
---

# Tessera Relayer Skill

Apply this skill when writing or modifying Go code under `relayer/`. The locked behavior of the service is in `SPEC.md` §1.8 (R-80 to R-89). This skill covers *how* to implement it well.

## Invariants (do not violate)

1. **Single role, single binary.** There is no separate "challenger" binary or "challenger" mode. Every running relayer instance is simultaneously a submitter (when assigned per nonce rotation) and a watcher of every other relayer's submissions. The challenge logic is part of the same loop.

2. **Plugin interface is the contract.** Every chain support is added by implementing the `ChainPlugin` interface in `core/plugin.go`. Adding a new chain MUST NOT require changes to `core/relayer.go`, `core/transform.go`, or any contract. If a code change to those files is needed to support a new chain, the plugin interface is wrong — fix the interface, don't bypass it.

3. **Transformations are pure and deterministic.** Functions in `core/transform.go` take the source proof and return the transformed proof and root, with no I/O, no side effects, no time dependence, no randomness. Given the same input, every run produces byte-identical output. This is what makes challenger replication possible.

4. **No off-chain authentication.** The relayer authenticates to contracts via native chain signatures only. No JWT, no API keys for contract calls, no shared secrets. The signing keypair is the identity.

5. **Bond and slash data is read from chain, never assumed.** Every reference to a relayer's bond, registration status, or slash history must come from a chain query (cached briefly is fine, fabricated is not).

## Match complexity to scope

The relayer must be production-grade in correctness, observability, and recovery. It must NOT be production-grade in dimensions that don't serve the current scope.

- **No state machine library.** The relayer's lifecycle is small enough that channels, mutexes, and explicit state structs are sufficient. Don't pull in `looplab/fsm` or similar.
- **No service mesh, no message queue.** Goroutines + Supabase + chain RPC are the entire data plane. No NATS, no Kafka, no Redis pub/sub.
- **No metrics framework yet.** Structured logs are sufficient for the hackathon. If Prometheus integration becomes a real requirement, that goes in SPEC.md first.
- **No abstract plugin loading.** Both plugins are imported as packages in `cmd/tessera/main.go`. Don't build a dynamic plugin registry, dlopen-style loading, or plugin discovery from disk. Adding a new plugin in future is a code change in one file.
- **No retry framework beyond what's needed.** A simple bounded exponential backoff for RPC calls is enough. Don't pull in `cenkalti/backoff` and configure it elaborately when 20 lines of inline code suffice.
- **No premature config keys.** The YAML schema has only the fields actually consumed by the code. Don't add `enable_feature_x: false` for features that aren't in scope.

The bar: every dependency in `go.mod` is justified by code that uses it. Every line in the YAML schema maps to a field the relayer reads. Anything that doesn't is removed.

## Designed for extensibility

The relayer is the central reusable component of the framework. Adding a new source chain (a new EVM, a new Tendermint chain, eventually a different VM family like Solana) should be a *small, isolated change* — one new package, no edits to core files.

- **The `ChainPlugin` interface is the boundary.** It is intentionally minimal (10 methods). Resist the temptation to add convenience methods that aren't used by the core loop — every method is implementation cost for every plugin.
- **New chain → new package.** Adding Polygon (an EVM chain) means: copy `plugins/ethereum/` to `plugins/polygon/`, adjust the chain config, register the plugin in `cmd/tessera/main.go`. No core changes. The Ethereum plugin should generalize cleanly to any EVM chain via configuration, so this might just be a configuration entry, not a new package.
- **New VM family → new plugin package.** Adding Solana means: write `plugins/solana/` implementing `ChainPlugin` with Solana-specific RPC, signature scheme, and proof format. The transformation code in `core/transform.go` may need extension to support a new pair (e.g., Solana ↔ Sepolia, Solana ↔ Neutron) — that's expected and is the boundary where new VM families do require core work.
- **Configuration is data.** Chain IDs, RPC endpoints, contract addresses, bond amounts — all in the YAML config, not in code. Adding a new chain to a deployed instance is a config edit.
- **Indexer reuses the same plugins.** The indexer service uses each plugin's `SubscribeEvents` method to watch the chain. New chains automatically gain indexer support when their plugin is registered.

The bar: when a second EVM chain (Polygon) gets added in future work, the only file changes should be (a) the YAML config and (b) the plugin registration in `main.go`. No edits to `core/`, no edits to existing plugin code.

## Default conventions (deviate with documented reason)

### Project layout

```
relayer/
├── go.mod
├── cmd/tessera/main.go              # CLI entry point
├── core/
│   ├── plugin.go                    # ChainPlugin interface + shared types
│   ├── transform.go                 # deterministic proof transformation
│   ├── relayer.go                   # main relayer loop
│   ├── challenger.go                # watcher and dispute logic
│   └── indexer.go                   # event indexer for the dashboard
├── plugins/
│   ├── ethereum/
│   └── tendermint/
├── storage/
│   └── supabase.go                  # Supabase wrapper
├── config/
└── testdata/                        # proof fixtures, scenario inputs
```

### Module structure

- `go.mod` at `relayer/go.mod`. Module path follows the repo's GitHub URL convention.
- One package per directory. Package name matches directory name (lowercase, no underscores).
- Subcommands via `cobra`. Configuration via `viper`.
- Each subcommand handler is its own file under `cmd/tessera/`.

### CLI structure

- `tessera relayer` — main running mode
- `tessera indexer` — event indexer
- `tessera bond deposit|withdraw|topup` — bond management
- `tessera fetch` — debugging tool that fetches and decodes a proof manually
- `tessera test-scenario <name>` — runs one of the four demo scenarios

### Naming

- Exported types: `PascalCase`. Internal types: `camelCase`.
- Files: `kebab-case.go` (`chain_plugin.go` is acceptable; pick one style and stay consistent within a package).
- Test files: `*_test.go`, table-driven tests preferred for transformation logic.
- Errors: sentinel errors at package level (`var ErrNotRegistered = errors.New(...)`) where callers need to distinguish cases. Wrapped errors elsewhere.

### Concurrency model

The main relayer loop runs four concurrent goroutines:
- **Source watcher per chain** (one per registered chain): subscribes to bridge events, pushes onto an internal channel.
- **Submission handler:** reads events; for events where this relayer is the assigned submitter (per `R-22`), runs the fetch → transform → submit pipeline.
- **Challenge watcher:** reads other relayers' submissions; independently re-fetches and re-transforms; on mismatch files dispute.
- **Bond manager:** periodically polls own bond status; alerts operator if approaching operating threshold.

All goroutines share a `context.Context` for cancellation. State synchronization via channels and small mutexes; never shared mutable state without explicit locking.

### Error handling

- Return errors. Never panic in normal control flow. The `main()` function and goroutine `recover()` blocks are the only places panic-handling lives.
- Wrap errors with context: `fmt.Errorf("transforming proof for nonce %d: %w", nonce, err)`. Preserve the chain with `%w`.
- Distinguish recoverable (RPC timeout, retry with backoff) from fatal (corrupt local state, abort loudly).
- Use sentinel errors where callers branch on error type: `errors.Is(err, ErrNotRegistered)`.

### Logging

- Use `log/slog` from the standard library. JSON handler in production, text handler in development.
- Required structured fields per log line:
  - `level`, `time`, `component` (e.g., `"relayer.submit"`, `"plugin.ethereum"`)
  - `chain` (when applicable: `"sepolia"`, `"neutron"`)
  - `message_id` (when applicable: the cross-chain message ID)
  - `tx_hash` (when applicable)
  - `nonce` (when applicable)
- Levels: `Debug` (verbose dev), `Info` (normal operation milestones), `Warn` (recoverable issues), `Error` (failures requiring attention).
- Logs go to stdout; the hosting environment captures.

### Configuration

- Single YAML file per relayer instance. Schema documented in SPEC.md §1.8 R-85.
- Secrets (Supabase service-role key, RPC tokens, wallet keypair path) referenced via environment variables in the YAML, never inline.
- Validate full config on startup; fail loudly on missing required fields.
- Per-chain config blocks are uniform; the plugin reads its own block.

### State persistence

- All operational state in Supabase tables (`R-84`).
- Restart recovery: read `last_seen_block` per chain from `events` table on startup; resume watching from that block + 1.
- Local SQLite is acceptable for ephemeral per-instance data (in-memory caches, debug logs) but never for state that affects correctness.
- Never depend on own writes being immediately readable in the same transaction. Supabase has eventual consistency.

### Testing

- Unit tests with the standard `testing` package.
- Table-driven tests for `core/transform.go`. Every fixture in `testdata/` has a corresponding test case asserting deterministic output.
- Mock the chain plugins for relayer-loop tests (use `gomock` or hand-written mocks; pick one style per package).
- Use real proof fixtures for plugin tests, captured from real testnet transactions and committed to `testdata/`.
- `go test ./...` must pass before any commit.
- Race detector: `go test -race ./...` runs in CI.

## The chain plugin interface

The interface is the framework's primary extension point. Treat changes to it with the seriousness of a public API change.

```go
type ChainPlugin interface {
    ChainID() string
    ChainType() ChainType  // EVM | Tendermint | other

    FetchBlockFingerprint(ctx context.Context, height uint64) (Fingerprint, error)
    FetchProof(ctx context.Context, txHash []byte, eventIdx uint, kind ProofKind) (RawProof, error)
    VerifyConsensus(ctx context.Context, blockHeader []byte, validatorSet []byte) error

    TranslateProofTo(rawProof RawProof, fingerprint Fingerprint, targetChainType ChainType) (CanonicalProof, Fingerprint, error)

    SubmitMessage(ctx context.Context, envelope MessageEnvelope, proof CanonicalProof, fingerprint Fingerprint, bondRef BondRef) (TxHash, error)
    SubmitChallenge(ctx context.Context, submissionID []byte, correctFingerprint Fingerprint, evidenceProof CanonicalProof) (TxHash, error)

    SubscribeEvents(ctx context.Context, contractAddrs []string, fromBlock uint64) (<-chan Event, error)
    GetBondStatus(ctx context.Context, relayer string) (BondStatus, error)
    GetRelayerRegistry(ctx context.Context) ([]Relayer, error)
}
```

When implementing a new plugin: implement every method. None are optional. If a chain genuinely cannot support a method, the plugin returns a typed error (`ErrUnsupported`) and the core handles the absence gracefully.

When changing the interface (which should be rare): update the interface in `core/plugin.go`, update all existing plugins to match, update tests, document the change in PROMPT_LOG.md with reasoning. Adding a method that breaks compatibility with hypothetical future plugins is more expensive than it looks.

## Pitfalls

- **Endianness.** Hash inputs are byte arrays. Big-endian vs little-endian on integer encoding silently produces wrong roots. The transformation tests catch this only if fixtures are real.

- **Canonical encoding.** RLP and Protobuf both have multiple ways to encode the same logical value. Use the canonical-encoding mode of the library (`alloy-rlp` for Ethereum is canonical by default; verify Protobuf encoding doesn't include unset optional fields).

- **CometBFT version.** Tendermint signature verification depends on the exact CometBFT version Neutron runs. Pin the version in `go.mod`. Mismatched versions silently fail signature checks.

- **eth_getProof returns RLP-encoded nodes.** Don't use them directly. Decode first.

- **RPC failover.** Each plugin uses primary RPC with automatic failover to a fallback list. After 3 consecutive failures across all configured RPCs, the plugin enters degraded mode (logs critical, pauses new submissions; existing in-flight messages still settle if possible).

- **Wallet keys.** Stored encrypted on disk with operator passphrase, or in a secrets manager. Never plaintext in repo, in shell history, or in environment variables logged at startup.

## When something doesn't fit a default

If a default here doesn't fit a specific situation, deviate with a documented reason — code comment, commit body, or PROMPT_LOG.md note. The friction is intentional.

## When in doubt

- Read SPEC.md §1.8 (off-chain service requirements) and the current phase section in §2.
- For transformation specifics: SPEC.md §1.6 (R-50, R-51, R-52).
- Ask the user before guessing.
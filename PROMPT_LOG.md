# PROMPT_LOG.md

> Maintained automatically per the rule in CLAUDE.md and the `tessera-prompt-log` skill. Each non-trivial prompt produces one entry following the format documented in the skill.

> The operator curates the 5-best/3-worst selection from this log at Phase 10 (`docs/prompt-log-highlights.md`). This file is the raw audit trail; the curated highlights are the hackathon deliverable.

---

### [P-pre] project discovery and execution plan — 2026-05-07

**Prompt:** Use a subagent to go through the repo (skills, .claude, CLAUDE.md, SPEC.md) to build a mental map of the project. Summarize in 100 words, give 1-liner phases, and produce a tweakable execution plan. No coding yet.

**Actions:** Launched 3 parallel Explore agents: one read SPEC.md in full (129 requirements, 13 phases, all contract interfaces), one catalogued all 13 skills and their governance rules, one mapped the current file tree (greenfield — no code dirs exist). Synthesized findings into a plan file at `/home/abdulsami/.claude/plans/use-a-subagent-to-typed-allen.md`. Created this PROMPT_LOG.md. No code written.

**Outcome:** worked — full mental map established; execution plan written and presented.

**Files:** `PROMPT_LOG.md`, `/home/abdulsami/.claude/plans/use-a-subagent-to-typed-allen.md`

**Tokens:** ~8,000

**Notes:** SPEC.md is 103KB and extremely precise (129 numbered requirements). The proof transformation layer (Patricia↔IAVL) is the most novel and risk-heavy technical piece — deserves fixture tests before any real testnet work. PROMPT_LOG.md did not exist at session start; created here as first artifact. Phase 0 begins on explicit user go-ahead.

---

### [P-0] environment setup — 2026-05-07

**Prompt:** Start Phase 0. Verify all external dependencies (Sepolia, Neutron, Etherscan, Supabase, Celatone), install missing tooling, scaffold production-grade project structure across all layers, initialize sub-projects, create CI and smoke test. Stop only when everything is configured and reachable.

**Actions:**
- Verified external endpoints: Sepolia RPC (chainId=0xaa36a7 ✓), Neutron RPC+REST (pion-1 ✓), Celatone (HTTP 200 ✓), Supabase (HTTP 200 ✓), Etherscan V2 (fixed URL from deprecated V1 `?v=2` to `/v2/api?chainid=11155111` ✓).
- Installed missing tools: pnpm@10.33.4, Foundry (forge/cast/anvil 1.6.0), wasm-pack 0.14.0, wasm32-unknown-unknown Rust target.
- Scaffolded full directory tree: `contracts-evm/`, `contracts-cosmwasm/`, `relayer/`, `frontend/`, `scripts/`, `docs/`, `supabase/migrations/`, `.github/workflows/`.
- Initialized: Foundry project with custom `foundry.toml` (optimizer, fuzz, fmt), Rust workspace with 6 contracts + shared `tessera-types` package, Go module `github.com/tessera-bridge/tessera` with cobra CLI skeleton (all 5 subcommands), Next.js 15 App Router with TypeScript strict + Tailwind.
- Created `ChainPlugin` interface in Go, `PatriciaToIAVL`/`IAVLToPatricia` stubs, Supabase client, config loader, Ethereum + Tendermint plugin stubs.
- Applied Supabase schema: 6 tables (`messages`, `submissions`, `disputes`, `bonds`, `events`, `benchmark_runs`) with RLS + public-read policies.
- Created `scripts/smoke-test.sh` (14 checks, 0 failures), `.github/workflows/ci.yml` (4-layer CI), `Makefile` (root + per-layer), `versions.txt`.
- Added `NEXT_PUBLIC_*` vars and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env`; added `@supabase/supabase-js` to frontend.

**Outcome:** worked — smoke test 14/14 PASS; forge build OK; cargo check OK; go build+vet OK; pnpm tsc OK.

**Files:** `contracts-evm/foundry.toml`, `contracts-evm/src/*.sol`, `contracts-cosmwasm/Cargo.toml`, `contracts-cosmwasm/.cargo/config.toml`, `contracts-cosmwasm/contracts/*/src/*.rs`, `contracts-cosmwasm/packages/tessera-types/`, `relayer/go.mod`, `relayer/cmd/tessera/main.go`, `relayer/internal/cli/root.go`, `relayer/internal/chain/plugin.go`, `relayer/internal/transform/*.go`, `relayer/internal/supabase/client.go`, `relayer/internal/config/config.go`, `relayer/plugins/ethereum/plugin.go`, `relayer/plugins/tendermint/plugin.go`, `frontend/app/*/page.tsx`, `frontend/components/*.tsx`, `frontend/lib/*.ts`, `supabase/migrations/001_initial_schema.sql`, `.github/workflows/ci.yml`, `Makefile`, `scripts/smoke-test.sh`, `versions.txt`, `.env`, `.gitignore`

**Tokens:** ~22,000

**Notes:** Etherscan V1 URL was broken (returned "deprecated" error) — fixed to V2 path before any other code relies on it. CosmWasm `error.rs` stubs needed explicit `ContractError` type to satisfy `pub use` in `lib.rs`. Supabase MCP requires a personal access token (not service-role key) — applied schema via node-postgres directly. Realtime publication (`ALTER PUBLICATION supabase_realtime ADD TABLE`) requires enabling via Supabase dashboard for `messages`, `submissions`, `disputes`, `events` tables before P-8 frontend work.

---

### [P-1] Solidity contracts + Foundry tests — 2026-05-07

**Prompt:** Move to phase 1. Implement all 6 Solidity contracts and tests per SPEC.md. No deployment. Stop when forge test -vvv passes 100%. Show diff, wait for commit approval.

**Actions:**
- Installed OpenZeppelin v5 via `forge install`.
- Implemented all 6 contracts: `TUSDC.sol` (ERC20 + 24h claim rate-limit), `Bond.sol` (ETH custody, 3-tier thresholds, 1h withdrawal cooldown, onlyVerifier slash), `RelayerRegistry.sol` (ordered active list, swap-and-pop, state machine Active/Benched/CoolingDown/Deregistered), `BridgeVault.sol` (lock/release, IApp), `BridgeMint.sol` (mint/burn, IApp), `Verifier.sol` (submitMessage, challenge, executeMessage, claimAbsenceSlash, virtual _verifyProof stub).
- Added interfaces: `IBond.sol`, `IRelayerRegistry.sol`, `IApp.sol`, and `libraries/MessageEnvelope.sol` (canonical envelope struct + messageId helper).
- Changed Bond and Registry from immutable verifier to one-time `setVerifier()` setter — eliminates circular-dependency nonce-prediction hack, which broke under `forge coverage --ir-minimum`; matches production deploy pattern.
- Wrote 77 tests across 7 test files: `TUSDC.t.sol` (14), `Bond.t.sol` (19 incl. fuzz), `RelayerRegistry.t.sol` (15), `BridgeVault.t.sol` (6), `BridgeMint.t.sol` (7), `Verifier.t.sol` (7), `BridgeScenarios.t.sol` (9 integration).
- Added `TestableVerifier.sol` helper that overrides `_verifyProof` with a whitelist map — enables test control of proof validity without real Patricia trie computation.
- All 4 demo scenarios tested and passing (S-1 honest, S-2 lying relayer, S-3 silent/handover, S-4 frivolous challenger).
- Bug fixes during test run: TUSDC first-claim reverted at low timestamp (fixed: skip cooldown when `lastClaim==0`); wrong expected error in absence-slash test; Bond test missing `deal()` for ETH.

**Outcome:** worked — 77/77 tests pass; coverage ≥80% for all 6 source files (Total: 91.06% lines, Verifier: exactly 80.00%).

**Files:** `contracts-evm/src/TUSDC.sol`, `contracts-evm/src/Bond.sol`, `contracts-evm/src/RelayerRegistry.sol`, `contracts-evm/src/BridgeVault.sol`, `contracts-evm/src/BridgeMint.sol`, `contracts-evm/src/Verifier.sol`, `contracts-evm/src/interfaces/IBond.sol`, `contracts-evm/src/interfaces/IRelayerRegistry.sol`, `contracts-evm/src/interfaces/IApp.sol`, `contracts-evm/src/libraries/MessageEnvelope.sol`, `contracts-evm/test/unit/*.t.sol`, `contracts-evm/test/integration/BridgeScenarios.t.sol`, `contracts-evm/test/helpers/TestableVerifier.sol`, `.gas-snapshot`

**Tokens:** ~35,000

**Notes:** The `_verifyProof` stub (non-empty proof = valid) is intentional for P-1. Real Patricia trie verification wired in P-4. The Bond/Registry one-time-setter pattern is the correct production deploy pattern — not a test-only hack. Virtual function coverage gap: the base `_verifyProof` body is counted as uncovered since it's always overridden by TestableVerifier; the 20% gap in Verifier is almost entirely this function.

---

### [P-2] CosmWasm contracts + cw-multi-test scenarios — 2026-05-07

**Prompt:** Implement all 6 CosmWasm contracts mirror to Solidity P-1, write cw-multi-test suite covering S-1 through S-4 demo scenarios, cargo test + clippy both clean, show diff before commit.

**Actions:**
- Implemented all 6 CosmWasm contracts from empty stubs: `tusdc` (standalone CW20 with 24h claim rate-limit, SetBridgeMint, BridgeMintTo/BridgeBurnFrom), `bond` (native uNTRN custody, 100/50/25 NTRN thresholds, withdrawal cooldown, one-time SetVerifier), `relayer-registry` (Active/Benched/CoolingDown/Deregistered state machine, swap-and-pop active list, cross-contract bond queries, one-time SetVerifier), `bridge-mint` (IApp OnCrossChainMessage → tusdc.BridgeMintTo; Burn), `bridge-vault` (OnCrossChainMessage → tusdc.Transfer; Lock), `verifier` (submitMessage, challenge, executeMessage, claimAbsenceSlash; `_verify_proof` stub: non-empty = valid).
- Extended `tessera-types` with `IAppExecuteMsg`, `BridgePayload`, `message_id()`, `submission_id()` helpers.
- Updated `verifier/Cargo.toml` dev-dependencies to pull in all 5 other contracts for cw-multi-test integration tests.
- Wrote 28 tests: 8 bond, 5 tusdc, 4 registry, 2 bridge-mint, 1 bridge-vault, 8 verifier integration (S-1 honest, S-2 lying, S-3 silent, S-4 frivolous + 4 edge cases).
- Key bug fixes: `SubmissionStatus` had duplicate `PartialEq` derive from `#[cw_serde]`; CosmWasm 2.x `addr_validate` requires real bech32 — fixed all unit tests and integration tests to use `MockApi::default().addr_make("name")`; `BridgePayload.recipient` in integration test payloads must be valid bech32 or dispatch chain fails at tusdc.addr_validate.
- `cargo clippy -- -D warnings` passes with zero warnings.

**Outcome:** worked — 28/28 tests pass; `cargo clippy -- -D warnings` clean.

**Files:** `contracts-cosmwasm/packages/tessera-types/src/{lib,envelope}.rs`, `contracts-cosmwasm/contracts/{bond,tusdc,relayer-registry,bridge-mint,bridge-vault,verifier}/src/{contract,msg,state,error,lib,tests/mod}.rs`, `contracts-cosmwasm/contracts/verifier/src/tests/scenarios.rs`, `contracts-cosmwasm/contracts/verifier/Cargo.toml`

**Tokens:** ~55,000

**Notes:** CosmWasm 2.x `MockApi::addr_validate` enforces real bech32 — bare strings like "admin" fail at contract entry points. Pattern fix: use `MockApi::default().addr_make("name")` everywhere in tests. The `_verify_proof` stub (non-empty bytes = valid) mirrors P-1 Solidity and will be replaced with real IAVL verification in P-4. Tessera-types `submission_id` uses string formatting (not keccak256) which is sufficient for P-2 tests; may need cryptographic hashing for on-chain uniqueness guarantees in P-4+.

---

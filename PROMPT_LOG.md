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

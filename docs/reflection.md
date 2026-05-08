# Reflection

> Hackathon: ChainGPT Internal AI Hackathon (May 7–9, 2026). Project: Tessera — bonded-relayer cross-chain framework with a tUSDC bridge between Sepolia and Neutron.

This is the honest, one-page debrief on what shipped, what didn't, and what I'd change next time.

---

## What worked

**Sub-agents for read-heavy exploration.** Whenever a prompt needed "find every file:line that touches X across four languages," I spawned three parallel Explore agents instead of grepping serially in the main context. Three concrete payoffs: the [P-9.5] UI ↔ on-chain reconciliation pass found exact root causes for 11 separate bugs in a single round-trip; the [P-9 bridge bugfixes] pass mapped four user-reported failures to the precise files in `frontend/lib/keplr.ts`, `frontend/lib/relay-helper.ts`, and `relayer/plugins/tendermint/plugin.go` before any code changed; the [P-pre] discovery pass built a full mental map of a 103KB SPEC and 13 skills in one shot. Cheaper in tokens than serial grepping and kept the main thread free for synthesis.

**Plan mode + numbered requirement IDs.** SPEC.md has 129 numbered requirements (R-1 through R-129) and stable phase IDs (P-0 through P-11). Every plan file referenced exact requirement IDs, which made "is this in scope?" a 5-second lookup instead of a 5-minute argument. The reorder of phases in [P-8 reorder] (inserting Documentation before Frontend) was a 3,000-token operation precisely because every reference was indirected through an ID.

**Custom skills as anti-hallucination guardrails.** The `tessera-context` skill loads on every prompt and enumerates the locked invariants — Sepolia↔Neutron only, two relayers, 50%/25% slashing, 60s window, generic dispatcher. The `tessera-prompt-log` skill auto-appends to PROMPT_LOG.md so the audit trail wrote itself. Together they caught at least three drift attempts (mixing source-root vs. transformed-root, fabricated "60% gas saved" claims, an attempt to add a third relayer).

---

## What didn't

**Dual `@cosmjs/stargate` versions bit twice.** The dep tree carried 0.38 transitive and 0.39 direct, so the `GasPrice` class had two identities and `instanceof` checks failed at runtime. First diagnosed and worked around in [P-9 token_info fix] with a dynamic import + `as unknown as` cast; bit *again* on the server side in [P-9.5] (manual fee object); bit a *third* time on the user-facing Neutron→Sepolia bridge in [P-9 bridge bugfixes]. The durable cure (explicit `StdFee` everywhere via `neutronFee()` in `frontend/lib/keplr.ts`) only landed on the third occurrence. Should have been done the first time.

**Bond thresholds rewritten mid-build.** Original SPEC values were 0.5 ETH / 100 NTRN. Sepolia faucets yield ~0.05 ETH/day; Neutron pion-1 faucets yield ~2 NTRN/day. The numbers were unreachable. Caught at [P-5 prep] — late enough that contract constants, tests, deploy scripts, SPEC.md, the `tessera-context` skill, and the cost log all needed coordinated rewrites. Should have been calibrated against real faucet output at P-0.

**CosmWasm bulk-memory wasm trap.** Local `cargo build --release` emits `memory.copy` / `memory.fill` instructions that Neutron's wasmd v0.61 rejects. Burned a half-day on this in [P-5] and the [P-5/P-6 neutron-v4-deploy] pass before the Docker `cosmwasm/workspace-optimizer:0.16.1` + cosmwasm-std pin to 2.1.4 became the reliable path. The signal was there in CosmWasm release notes; I wasn't reading them.

---

## What I'd do differently

**Lock dep versions at P-0, not P-9.** A 30-minute `pnpm why @cosmjs/stargate` audit on day one would have surfaced the dual-version conflict before any code was written against it. Same applies to `cosmwasm-std` — pin to a wasmd-compatible version up front, not after the third deploy attempt.

**Calibrate testnet economics against measured faucet output before writing contracts.** `for i in {1..3}; do faucet-request; done` over a day, then set bond thresholds from that data. Five minutes of measurement saves a day of retrofit.

**Adopt a chain-deploy template (Docker optimizer + version pins) on day one.** The CosmWasm build pipeline is non-trivial and the failure modes are silent (wasm validates locally, rejects on chain). A `Makefile` target with `RUSTFLAGS` + `wasm-opt` + Docker invocation would have been one P-0 task; instead it leaked across [P-5], [P-5/P-6], and [P-9 token_info]. Treat "the chain accepts our wasm" as a P-0 smoke test, same as RPC reachability.

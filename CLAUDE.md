# CLAUDE.md

> Context for Claude Code working on Tessera. This file is loaded into every conversation. Read it once per session; refer to SPEC.md for depth.

---

## What Tessera is

A trust-minimized cross-chain framework. First reference application: a bidirectional **tUSDC** bridge between **Sepolia** (Ethereum testnet) and **Neutron** (Cosmos testnet, CosmWasm).

Tessera solves three problems explicitly:
1. Replaces relayer trust with cryptographic proof verification + bonded economic enforcement.
2. Avoids ZK prover infrastructure (cost, latency, GPU dependency).
3. Bypasses Ed25519 signature verification on EVM, which doesn't fit on-chain at acceptable gas.

Architecture is plugin-based: new chains plug in as Go modules; new VMs plug in as one-time contract ports.

---

## Documents that govern this project

Read in this order when starting a session:

1. **SPEC.md** at repo root — full specification (requirements + build plan + UI spec). Authoritative on *what* and *how*.
2. **`.claude/skills/`** — six skills that auto-load based on the prompt's content:
   - `tessera-context` — locked invariants, anti-hallucination rules. Loads on every Tessera prompt.
   - `tessera-contracts` — Solidity + CosmWasm conventions. Loads when working under `contracts-evm/` or `contracts-cosmwasm/`.
   - `tessera-relayer` — Go service conventions, plugin pattern. Loads when working under `relayer/`.
   - `tessera-frontend` — Next.js conventions, design tokens, shared components. Loads when working under `frontend/`.
   - `tessera-review` — three-lens audit (security, production-readiness, UX). Invoke explicitly for review passes.
   - `tessera-prompt-log` — appends to PROMPT_LOG.md per non-trivial prompt. Always loaded.
3. **PROMPT_LOG.md** at repo root — auto-maintained per-prompt history. Read recent entries when picking up work mid-build.

When SPEC.md and a skill conflict, SPEC.md wins. When SPEC.md and reality conflict, **stop and ask the user** — do not silently reconcile.

---

## Anti-hallucination rules — non-negotiable

These apply to every output. They are the most important content in this file.

1. **No invented identifiers.** Do not fabricate contract addresses, transaction hashes, RPC URLs, validator addresses, or block numbers. Use placeholders (`<DEPLOYED_VERIFIER>`) until real values exist.

2. **No invented APIs.** When using a library, verify the method exists in the docs before calling it. If unsure, write a small test program first.

3. **No invented numerical claims.** "This saves 60% gas" or "this is 3x faster" requires a measured benchmark. Use ranges or qualitative comparisons until Phase 10 measurements exist.

4. **No mixed concepts.** The most common Tessera-specific failure mode:
   - **source root** ≠ **transformed root** (different 32-byte values)
   - **submitter** and **challenger** are roles per-message, not fixed identities — every running relayer is both
   - **bond** is one per relayer per chain, not separate "challenger deposit"

5. **When confused, stop and ask.** Do not guess. Do not "fix" ambiguity by choosing one interpretation silently.

6. **Run code with approval.** Filesystem, network, deployed contracts, wallets — propose, wait for approval, then run.

7. **Read every diff before committing.** If the diff includes changes you did not intend, stop and revert.

8. **No silent dropping of conventions.** If a default convention from a skill doesn't fit, deviate with a documented reason (code comment, commit body, or PROMPT_LOG.md note). Don't deviate silently.

---

## Operational rules

**Plan mode for any task estimated > 30 minutes.** Catch wrong direction in 2 minutes, not 2 hours. Use Claude Code's plan mode (Shift-Tab) before starting non-trivial work.

**Default to Sonnet.** Opus only on explicit escalation when Sonnet is genuinely insufficient. Track per-model spend in cost log.

**Per-prompt logging.** Every non-trivial prompt produces an entry in PROMPT_LOG.md per the `tessera-prompt-log` skill. Trivial prompts (typos, formatting, single-word clarifications) are exempt.

**Conventional commits.** `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`. Subject line under 72 characters. Reference phase or requirement IDs in the body where applicable: `feat: implement Verifier.submitMessage (P-1, R-61)`.

**Tests before declaring done.** No "this should work" without running it. `forge test`, `cargo test`, `go test ./...` per layer. Failing tests block merge.

**Read every diff before committing.** Already in anti-hallucination rules; restating because it gets violated otherwise.

---

## What gets built, in order

Phases live in SPEC.md §2. One-line summary:

- **P-0** — Environment setup. RPC endpoints, faucets, Supabase, hosting verified.
- **P-1** — Solidity contracts written and tested **locally** with Foundry. No deployment yet.
- **P-2** — CosmWasm contracts written and tested **locally** with `cw-multi-test`. No deployment yet.
- **P-3** — Go relayer skeleton + chain plugins. No on-chain calls yet.
- **P-4** — Translation layer both directions, deterministic, fixture-tested.
- **P-5** — Deploy contracts to Sepolia + Neutron testnets, verify on Etherscan + Celatone.
- **P-6** — Relayer registration, bond posting, end-to-end honest path on real testnets.
- **P-7** — Challenger logic + 4 demo scenarios passing as integration tests.
- **P-8** — Documentation midway checkpoint: README update, Notion overview page, in-repo MDX doc stubs.
- **P-9** — Frontend mapped to real data per v2 mockup.
- **P-10** — Audit pass (security, production-readiness, UX). **Gating** — must reach 99% with operator sign-off.
- **P-11** — Polish, demo recording, final docs.

State the current phase at the start of any new working session. Skills load based on file paths, but the phase is what determines which requirements are in scope.

---

## Locked invariants — short reference

The full list is in `tessera-context`. The five that get violated most often:

- **Sepolia ↔ Neutron only** for the demo. Not Evmos. Not other chains. Future work, not in scope.
- **Two relayers, single role.** Both run identical code. Per-message rotation determines who submits.
- **50% / 25%** slashing — wrong submission and frivolous challenge respectively. Exact, not approximate.
- **60-second challenge window**, **30-second handover period** on testnet. Configurable in code, set to these values for the demo.
- **Generic dispatcher pattern (Option A).** Verifier dispatches to `destinationApp` from message envelope. App contracts enforce `onlyVerifier`. New apps plug in by implementing `IApp`.

---

## What does NOT happen during the build

These are out-of-scope and must not be added without updating SPEC.md first:

- Multi-relayer scaling beyond 2.
- Race-condition handling for concurrent submissions.
- Sync committee verification for Sepolia (RPC trust is the documented limitation).
- ZK proof generation.
- Mainnet deployment.
- Real USDC integration (custom tUSDC only).
- Additional chains beyond Sepolia + Neutron.
- Additional apps beyond the tUSDC bridge.

If a request would add any of these, **stop and confirm with the user** before implementing.

---

## Naming and style — concise

Per-layer conventions are in the skills. Project-wide:

- **Files:** `kebab-case` for Go and TS utilities; `PascalCase.sol` and `PascalCase.tsx` for contracts and components.
- **Go:** stdlib `slog` for logging, error returns not panics, `fmt.Errorf("...: %w", err)` to wrap.
- **Solidity:** custom errors over revert strings, NatSpec on external/public functions, internal functions prefixed `_`.
- **CosmWasm:** `thiserror`-typed errors, standard CosmWasm file layout per contract.
- **TypeScript:** `'use client'` only when interactivity required, `kebab-case.ts` utilities, `PascalCase.tsx` components.

When a skill specifies more detail, the skill wins.

---

## Repository layout

```
tessera/
├── SPEC.md                          # full specification
├── CLAUDE.md                        # this file
├── PROMPT_LOG.md                    # auto-maintained per-prompt
├── .claude/skills/                  # six skills
├── .gitignore                       # info/ goes here
├── info/                            # local-only (mockup, drafts) — gitignored
├── contracts-evm/                   # Solidity (P-1)
├── contracts-cosmwasm/              # Rust + CosmWasm (P-2)
├── relayer/                         # Go service (P-3 to P-7)
├── frontend/                        # Next.js (P-9)
├── scripts/                         # build, deploy, smoke, scenarios
└── docs/                            # additional docs (audit findings, etc.)
```

---

## Hackathon discipline

- **Soft cap:** $75/day. **Hard cap:** $100/day. Track in cost log.
- **Required artifacts in Form 2:** GitHub repo, live URL, Notion docs, SPEC.md, CLAUDE.md, PROMPT_LOG.md, prompt log highlights (5 best + 3 worst), cost log, 1-page reflection, demo video.
- **Missing CLAUDE.md or PROMPT_LOG.md** = -25pp on rubric. Both must be live.
- **Synthetic data only.** No real PII, no production keys, no real USDC.
- **No paid third-party services** without pre-approval.
- **Claude Code only.** No other AI coding tools (-10pp penalty).

---

## When something is genuinely unclear

Stop. Ask the user. Provide:

1. What you're trying to do.
2. The two or more interpretations you're choosing between.
3. Your best guess at which is correct, and why.

Do not silently pick. Do not "fix" the ambiguity by writing code that handles all interpretations. The user prefers a 30-second clarification over a 2-hour rewrite.

---

## End of CLAUDE.md

If something seems missing from this file: it's probably in a skill, in SPEC.md, or it's a sign that this file should be updated. When updating CLAUDE.md, keep it dense — every line earns its place.
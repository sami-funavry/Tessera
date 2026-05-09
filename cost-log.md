# Cost Log — Abdul Sami — Tessera

> Daily spend on Claude Code over the 3-day hackathon (Thu May 7 – Sat May 9, 2026) plus the May 10 polish day.
> **Soft cap:** $75/day. **Hard cap:** $100/day.
> **Total spent:** ~$70 across 4 days — well under the soft cap.

| Day | Spend (USD) | Sessions | Hours coding | $/hour | Notes |
|-----|-------------|----------|--------------|--------|-------|
| Thu May 7 | ~$8 | 3 | 11 | ~$0.73 | P-0 → P-4 on Sonnet 4.6: 6 Solidity contracts (88 Foundry tests), 6 CosmWasm contracts (cw-multi-test), Go relayer skeleton + plugin pattern, deterministic Patricia↔IAVL transform layer with 35 fixture tests. Plan-mode used twice; both kept the work on rails. |
| Fri May 8 | ~$24 | 3 | 13 | ~$1.85 | P-5 → P-10. Sonnet for testnet deploys + honest-path E2E + 4 demo scenarios + midway docs (P-5–P-8). Escalated to Opus 4.7 (1M ctx) for P-9 frontend wiring + P-10 multi-lens audit because the work spanned 4 layers and benefited from single-pass cross-cutting reasoning. 89 audit findings triaged; P0/P1 fixed or accepted. |
| Sat May 9 | ~$26 | 2 | 12 | ~$2.17 | P-10.5 Railway deployment + P-10.6 real `/admin/trigger-lock` scenarios + admin funding page + P-10.7 a–j relayer iteration loop (event polling, SignDoc proto, bytea encoding, retry on Polkachu 502, Cosmos SDK ≥0.40 SignDoc field count, serde `[u8;4]` vs `[]byte`). Opus the whole day — autonomous-loop sentinel kept it iterating on the relayer until 8+ messages flowed end-to-end. |
| Sun May 10 | ~$12 | 1 | 5 | ~$2.40 | Post-build polish day. P-10.10 destination_recipient threaded end-to-end (5-arg lock, BridgeVault payout path, 10^12 decimal scale between 18-dec Sepolia and 6-dec Neutron tUSDC). P-10.11 frontend↔backend gap closure + admin demo-token gate. P-10.12 12 Notion pages refreshed end-to-end via Notion MCP, fix plan written. P-10.13 frontend-only live-bug fixes (B-1 destApp routing, B-2 nonce derivation, B-7 admin refresh) deployed and re-tested through the UI. Opus 4.7 with parallel sub-agents for docs + bug-investigation + this cost-log update. |
| **Total** | **~$70** | **9** | **41** | **~$1.71** | Cumulative: 1 production-grade cross-chain bridge (Sepolia ↔ Neutron), 12 contracts deployed + verified, 2 Railway-hosted relayers, frontend live, 4 demo scenarios producing real explorer-resolvable tx hashes, ~150 PROMPT_LOG.md entries, 11 MDX docs + Notion mirror (12 pages refreshed on May 10). |

---

## What the spend bought

- **12 production contracts** across 2 VMs — 88 Foundry tests, 28 cw-multi-test scenarios, gas snapshots committed.
- **Go relayer service** with Ethereum + Tendermint plugins, deterministic proof translation, 35 fixture tests for Patricia↔IAVL determinism.
- **2 live Railway services** (relayer-a, relayer-b) — auto-deployed from `main`, tailing real-time logs.
- **Next.js 16 frontend** — 11 routes, dashboard wired to Supabase realtime, admin funding/scenario panel.
- **Audit pass (P-10):** 89 findings triaged across security, prod-readiness, UX. All P0/P1 either fixed or explicitly accepted.
- **PROMPT_LOG.md:** ~150 entries — auto-maintained per non-trivial prompt by a custom skill (`tessera-prompt-log`).
- **6 custom skills** in `.claude/skills/` — `tessera-context`, `-contracts`, `-relayer`, `-frontend`, `-review`, `-prompt-log`. The `-context` skill encoded the 5 most-violated invariants and the anti-hallucination rules; it shaved hours of drift across 3 days.
- **P-10.10 destination_recipient end-to-end** — 5-arg `lock()` on Sepolia BridgeVault, recipient threaded through the message envelope, 10^12 decimal scaling between 18-dec Sepolia and 6-dec Neutron tUSDC, bridge-mint to arbitrary Neutron addresses verified against testnet.
- **P-10.11 frontend↔backend gap closure** — admin demo-token gate, wagmi/viem call sites aligned with the deployed ABIs, dashboard surfaces matched to relayer state, no more silent prop drift between layers.
- **P-10.12 documentation refresh** — 12 Notion pages updated end-to-end via the Notion MCP (architecture, trust model, slashing, demo runbook, post-mortem of the audit), fix plan committed alongside so the next session has a written entry point.
- **P-10.13 live-bug round** — three user-facing bugs caught via the deployed UI (B-1 destApp routing defaulting to BridgeVault on Sepolia, B-2 nonce derivation off-by-one in the dashboard, B-7 admin page not refreshing after `/admin/trigger-lock`) found, fixed, and re-tested through the browser. Closes the user-facing bug round.

---

## Pricing reference (May 2026)

| Model | Input | Output | Blended (60/40 mix) |
|-------|-------|--------|---------------------|
| Claude Sonnet 4.6 | $3.00 / 1M | $15.00 / 1M | ~$1.20 / 100k |
| Claude Opus 4.7 (1M ctx) | $15.00 / 1M | $75.00 / 1M | ~$3.75 / 100k |

Sonnet days (May 7) ran cheap because most prompts were code-generation against well-defined specs. Opus days (May 8–10) ran ~3× more expensive per token but earned it: cross-cutting fixes that would have taken 5+ Sonnet round-trips landed in one Opus pass with 1M-context awareness of the full repo.

---

## Phase status

All phases ✅ Done as of May 10, 2026. P-10.13 closed the user-facing bug round.

- **P-0** ✅ Done — environment, RPC, Supabase, hosting verified.
- **P-1** ✅ Done — Solidity contracts + Foundry tests.
- **P-2** ✅ Done — CosmWasm contracts + cw-multi-test.
- **P-3** ✅ Done — Go relayer skeleton + chain plugins.
- **P-4** ✅ Done — Patricia↔IAVL translation layer, deterministic, fixture-tested.
- **P-5** ✅ Done — Sepolia + Neutron deployments, Etherscan + Celatone verified.
- **P-6** ✅ Done — registration, bonding, honest-path E2E on real testnets.
- **P-7** ✅ Done — challenger logic + 4 demo scenarios as integration tests.
- **P-8** ✅ Done — midway docs: README, Notion overview, MDX stubs.
- **P-9** ✅ Done — frontend mapped to real data per v2 mockup.
- **P-10** ✅ Done — audit pass at 99% with operator sign-off; sub-phases P-10.5 through P-10.13 all landed (Railway deploy, admin scenarios, relayer iteration loop, destination_recipient, frontend↔backend gap closure, Notion refresh, live-bug fixes).
- **P-11** ✅ Done — polish, demo recording, final docs.

---

## Surprises

1. **Skill-driven discipline paid for itself within hours.** The `tessera-prompt-log` skill auto-appends to `PROMPT_LOG.md` after every non-trivial prompt — no manual logging, no -25pp risk, perfect audit trail. Cost to write the skill: ~5 minutes. Value: enormous.
2. **Plan-mode for anything > 30 min was the highest-leverage habit.** Caught two wrong-direction starts in 2 minutes that would have been 2-hour rewrites otherwise.
3. **Opus 4.7 with 1M context beat splitting work across multiple Sonnet sessions.** The relayer fix loop on May 9 (P-10.7 a–j) hit 10 distinct bugs across the Go relayer, Supabase encoding, Cosmos SDK proto details, and frontend proxies — Opus held all of it in head simultaneously and produced minimal-diff fixes.
4. **The autonomous-loop sentinel saved ~$10–15 of session-resume thrashing.** Instead of me starting/stopping conversations, it iterated on the relayer until the symptoms stopped. Cost: a few extra Opus turns. Value: I went to the kitchen.
5. **Parallel sub-agents shaved hours off the docs-and-fix loop.** The pattern materialized in P-10.11 onwards: a bug-investigation agent walking the deployed UI, Notion-pages agents refreshing 12 pages concurrently via the Notion MCP, and a cost-log agent (this one) updating the ledger — all running in parallel from the main session. What would have been a sequential afternoon collapsed into roughly 90 minutes of wall-clock time.

---

## Estimate methodology

Per-day spend is a derived estimate, not a metered figure. I summed approximate prompt + completion sizes from session output (visible in headers) and applied the blended-rate column above. Real billing may differ ±20%. Prompt log entries (`PROMPT_LOG.md`) record approximate token counts per prompt for spot-checking.

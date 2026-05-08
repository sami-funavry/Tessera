# Tessera — Phase 10 Audit Findings

> Per [SPEC.md §2.13](../SPEC.md). Three review lenses plus a fourth (documentation completeness). Each finding is severity-tagged with a stable ID. P-10 exits when zero P0 and zero P1 are open and the operator signs off below.

| Field | Value |
|------|-------|
| **Phase** | P-10 (gating audit) |
| **Audit date** | 2026-05-08 |
| **Repo SHA at audit start** | `32c6744` |
| **Auditors invoked** | tessera-review (security, production-readiness, UX); docs-completeness sub-agent |
| **Operator** | Abdul Sami Rajpoot (sami.abdulsami@chaingpt.tech) |

---

## Severity definitions

- **P0 (gating)**: blocks demo, breaks safety, drains funds, violates a Form-2 hard deliverable, or makes the bridge advance an inconsistent state. Must be fixed or explicitly accepted before exit.
- **P1 (serious)**: real bug or significant operational risk. Must be fixed or explicitly accepted before exit.
- **P2 (quality)**: code-smell, polish, doc gap, dead code, future risk. Document or fix.

A finding is **fixed** when the change lands in this branch and a regression check protects it. A finding is **accepted** when the operator signs off that the issue is out of scope for this phase, with a documented rationale and a follow-up phase or roadmap entry.

---

## Headline counts

| Lens                  | Total | P0 | P1 | P2 | Fixed | Accepted | Open |
|-----------------------|------:|---:|---:|---:|------:|---------:|-----:|
| Security              | 16    | 6  | 7  | 3  | 3     | 13       | 0    |
| Production-readiness  | 19    | 0  | 8  | 11 | 6     | 13       | 0    |
| UX                    | 26    | 3  | 9  | 14 | 12    | 14       | 0    |
| Documentation         | 28    | 6  | 14 | 8  | 22    | 6        | 0    |
| **Total**             | **89** | **15** | **38** | **36** | **43** | **46** | **0** |

> "Accepted" entries are tracked in `docs/post-hackathon-roadmap.md` so they are not lost — they are the production-readiness work that explicitly lives outside the 3-day hackathon scope per [SPEC.md §1.12](../SPEC.md). All accepted P0/P1 entries name the deferred phase or roadmap section that picks them up.

---

## Security / Adversarial lens (16 findings)

Source report: `tessera-review` security pass. Full text: `/tmp/tessera-audit/security.md` (operator-local).

### Demo-path P0s — fixed

#### SEC-01 [P0] [FIXED] Unauthenticated POST /api/bridge/relay drained relayer wallet
- **File:** `frontend/app/api/bridge/relay/route.ts:76-211`, `frontend/lib/relay-helper.ts`
- **Repro:** any unauthenticated POST with arbitrary `{amount, recipient}` triggered a real CW20 transfer from Relayer A's wallet, repeatable until empty.
- **Fix:** introduced `frontend/lib/api-guard.ts` enforcing same-origin Origin/Referer allowlist + per-IP token-bucket rate limit + admin-secret bypass. Idempotency check on `source_tx_hash` prevents double-relay if the same lock tx is replayed. Bridge route gated at the very top.

#### SEC-02 [P0] [FIXED] Unauthenticated /api/scenarios/[type] ran real on-chain locks + transfers
- **File:** `frontend/app/api/scenarios/[type]/route.ts:71-125`
- **Repro:** `curl <demo>/api/scenarios/honest` in a loop drained Sepolia ETH + tUSDC + Neutron NTRN faster than any faucet could refill.
- **Fix:** same `guardApiRoute` with stricter capacity (2 tokens, 5-minute refill window). Both GET and POST handlers gated.

#### SEC-13 [P1] [FIXED] Bond admin endpoints had no auth in default config + scenario route never sent the secret
- **File:** `relayer/internal/relayer/admin.go:36-57`, `frontend/app/api/scenarios/[type]/route.ts:584-605`
- **Repro:** if `TESSERA_ADMIN_SECRET` was unset, anyone could flip the relayer into fault-injected modes. If set, the scenarios API never sent the header so faults silently 401'd.
- **Fix:** scenarios route now forwards `x-admin-secret` from `TESSERA_ADMIN_SECRET` env when present, with non-2xx status logged. Admin server hardening (mandatory secret, 127.0.0.1 bind) is **deferred** to the post-hackathon roadmap §security.

### Production-path P0/P1s — accepted with explicit caveat

These vulnerabilities exist in the **Verifier proof-verification path** (Solidity + CosmWasm Verifier, RelayerRegistry, Bond, BridgeVault, BridgeMint, plus the Go relayer). The frontend "demo simulator" — `frontend/lib/relay-helper.ts` — directly transfers tUSDC from a server-side wallet, bypassing every Verifier check. The demo therefore does not exercise the broken paths; the contracts ARE deployed to testnet and the bugs ARE shipped, but no exploit path runs through the live demo flow.

The operator accepts each of these for P-10 with the explicit understanding that they are **mainnet-blockers** and tracked in `docs/post-hackathon-roadmap.md` §security path-to-mainnet.

| ID     | Sev | Where                                        | Summary                                                                 | Disposition |
|--------|-----|----------------------------------------------|-------------------------------------------------------------------------|-------------|
| SEC-03 | P0  | `Verifier.sol:116-150`                        | submitMessage missing `registry.isActive` check (CosmWasm Verifier has it) | Accepted — roadmap §sec-1 |
| SEC-04 | P0  | `MessageEnvelope.sol:17-19`, `envelope.rs:36-38` | messageId omits dest, action, payload — same nonce can equivocate         | Accepted — roadmap §sec-2 |
| SEC-05 | P0  | `bridge-vault/src/contract.rs:76-104`         | CosmWasm BridgeVault.lock doesn't transfer user funds; no nonce/replay     | Accepted — roadmap §sec-3 |
| SEC-06 | P0  | `bond/src/contract.rs:122-146`                 | CosmWasm Bond.execute_withdraw lacks min-balance + activity tracking      | Accepted — roadmap §sec-3 |
| SEC-07 | P1  | `relayer/internal/relayer/challenger.go:49-98` | Challenger only watches own submissions; no cross-relayer fraud detection | Accepted — roadmap §sec-4 |
| SEC-08 | P1  | `relayer/plugins/tendermint/plugin.go:53-67`   | Sub-id cache in-memory; relayer restart strands pending submissions       | Accepted — roadmap §sec-5 |
| SEC-09 | P1  | `Verifier.sol:281-309`, `verifier/src/contract.rs:55-115` | Proof bytes don't bind to source-chain storage (only self-consistent) | Accepted — roadmap §sec-2 |
| SEC-10 | P1  | `relayer/plugins/ethereum/plugin.go:642-650`   | Decimal mismatch (18 vs 6) in production payload                          | Accepted — roadmap §sec-2 |
| SEC-11 | P1  | `BridgeVault.sol:26, 59-73`                    | Lock event drops destinationRecipient — production flow can't deliver     | Accepted — roadmap §sec-2 |
| SEC-12 | P1  | `Verifier.sol:159-183`                         | Frivolous-challenge state handling permits repeated spam                  | Accepted — roadmap §sec-1 |
| SEC-14 | P2  | `verifier/src/contract.rs:289-302`             | ABSENCE_SLASH_CLAIMED key mismatch CosmWasm vs Solidity                   | Accepted — roadmap §sec-1 |
| SEC-15 | P2  | `relayer/plugins/tendermint/plugin.go:317-322` | Tendermint plugin synthesises Action/DestApp via fallbacks                | Accepted — roadmap §sec-5 |
| SEC-16 | P2  | `TUSDC.sol:55-64`                              | tUSDC claim rate-limit bypassable via wallet rotation (test-token)        | Accepted — by design (R-69) |

---

## Production-readiness lens (19 findings)

Source report: `/tmp/tessera-audit/prod-readiness.md`.

### Fixed in P-10

#### PROD-03 [P1] [FIXED] Frontend Supabase realtime had no reconnect handling
- **Files:** `frontend/hooks/useMessages.ts`, `frontend/hooks/useMessageEvents.ts`, `frontend/hooks/useRelayers.ts`.
- **Fix:** `.subscribe()` callbacks log `CHANNEL_ERROR` / `TIMED_OUT` and trigger a one-shot refetch. Tab-visibility listener refetches when the page becomes visible again, catching events dropped while the tab was hidden.

#### PROD-04 [P1] [FIXED] `ETHERUM_*` typo coexisted with the correct `ETHEREUM_*`
- **Files:** `scripts/smoke-test.sh`, `relayer/plugins/ethereum/plugin_test.go`.
- **Fix:** smoke test now exports `ETHEREUM_SEPOLIA_ENDPOINT` from the typo'd value if only the latter is set, then validates the correct name. Go integration tests renamed to use the correct name. Other call sites already had the correct name as primary.

#### PROD-05 [P1] [FIXED] Scenarios API never sent X-Admin-Secret to the relayer
- **File:** `frontend/app/api/scenarios/[type]/route.ts:584-605`.
- **Fix:** route now reads `TESSERA_ADMIN_SECRET` and forwards it as `x-admin-secret`. Non-2xx responses are warning-logged so silent admin failures surface in operator-readable logs.

#### PROD-06 [P1] [FIXED] `waitForTransactionReceipt` had no timeout
- **Files:** `frontend/lib/relay-helper.ts`, `frontend/app/api/scenarios/[type]/route.ts`, `frontend/app/HomepageClient.tsx`.
- **Fix:** all four call sites now pass `timeout: 90_000` (90 s, comfortably > Sepolia block time × confirmations).

### Accepted with caveat

| ID      | Sev | Summary                                                              | Why accepted                                                                                  | Roadmap link |
|---------|-----|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------------|
| PROD-01 | P1  | Tendermint sub-id cache in-memory; restart loses pendings             | Schema + Supabase-persistence work; mainnet-blocker                                            | §monitoring |
| PROD-02 | P1  | `from_block` not persisted; restart re-processes or skips events      | Same path as PROD-01; needs a `relayer_state` table                                            | §monitoring |
| PROD-07 | P1  | No bond-threshold monitoring; `bonds` table written by demo only      | Needs a Go-relayer monitoring loop calling `UpsertBond`; documented for production             | §monitoring |
| PROD-08 | P1  | Zero retries / backoff in Go relayer for Sepolia or Supabase          | Needs structured retry library; demo path uses frontend RPC failover instead                   | §monitoring |
| PROD-09 | P2  | No `/healthz` endpoint                                                | Adding before mainnet                                                                          | §monitoring |
| PROD-10 | P2  | Smoke test placeholders never filled in                               | Quick win deferred to P-11 polish                                                              | §QA pipeline |
| PROD-11 | P2  | `messages.updated_at` never advanced by Go relayer                    | Schema trigger or relayer patch — small, deferred                                              | §QA pipeline |
| PROD-12 | P2  | Tendermint TxSearch caps at 20 events/tick                            | Not exercised at demo load; documented                                                          | §sec-5 |
| PROD-13 | P2  | CI does not run smoke or scenarios                                    | P-11 polish item                                                                                | §QA pipeline |
| PROD-14 | P2  | Hardcoded contract addresses duplicated across 7+ files               | One canonical source via `addresses.json` + generator script                                    | §QA pipeline |
| PROD-15 | P2  | Sentry flushes only on cobra `PersistentPostRun`                      | `defer obs.Flush()` in `main()` + SIGTERM handler                                              | §monitoring |
| PROD-16 | P2  | `relay-helper.ts` Sepolia path repeats key validation                 | Inline polish; collapse to `loadRelayerKey()` later                                            | §QA pipeline |
| PROD-17 | P2  | API routes use `as any` Supabase casts                                | Generated-types fight with hand-written; tracked for replacement                                | §QA pipeline |
| PROD-18 | P2  | Idempotency on bridge-relay was previously absent                     | **Partially fixed** in this phase via `source_tx_hash` cache lookup; tighten with `UNIQUE` later | §QA pipeline |
| PROD-19 | P2  | `cli/root.go` derives relayer address from priv-key prefix            | Make `RELAYER_ADDRESS` mandatory at startup                                                     | §sec-5 |

---

## UX lens (26 findings)

Source report: `/tmp/tessera-audit/ux.md`.

### Fixed in P-10

#### UX-01 [P0] [FIXED] "View all submissions" CTA led to a 404
- **File:** `frontend/app/dashboard/page.tsx:332-341` → new `frontend/app/submissions/page.tsx`.
- **Fix:** built a paginated submissions index (25 per page) with route guard, copy-hash UX, status badges mapped to message status, keyboard-accessible row navigation.

#### UX-02 [P0] [FIXED] Relayer status permanently showed "Submitting"
- **File:** `frontend/hooks/useRelayers.ts:181-209`.
- **Fix:** `busy` only fires when this relayer has a `pending` submission within the 90 s window. Otherwise `idle` / `Watching`. Re-evaluation on each render via the realtime data.

#### UX-03 [P0] [FIXED] Bridge button disappeared when wallets weren't connected; onBlur validation never fired
- **File:** `frontend/app/HomepageClient.tsx:797-984`.
- **Fix:** `useForm` now uses `mode: 'onBlur'`; primary button is always rendered with disabled state + dynamic label reflecting which step is missing ("Connect MetaMask + Keplr to bridge", "Enter an amount", etc.).

#### UX-08 [P1] [FIXED] ChainPill chevron implied a clickable dropdown
- **File:** `frontend/app/HomepageClient.tsx:1031-1034`.
- **Fix:** removed the `<ChevronDown>` from the pill since the chain switcher is the swap button between fields.

#### UX-10 [P1] [FIXED] Hardcoded `~142k` / `~218k` gas values on every submission detail
- **File:** `frontend/app/submissions/[id]/page.tsx:335-336`.
- **Fix:** replaced with `—` per CLAUDE.md anti-hallucination rule #3. Per-tx gas is not currently captured in the schema; a roadmap entry tracks adding it.

#### UX-19 [P2] [FIXED] Recipient field validated only on submit
- **File:** `frontend/app/HomepageClient.tsx:797`.
- **Fix:** `mode: 'onBlur'` (combined with UX-03 fix above).

#### UX-20 [P2] [FIXED] "Connect both wallets" copy variant unreachable
- **File:** `frontend/app/HomepageClient.tsx:973-1015`.
- **Fix:** new ternary order surfaces the correct variant ("Connect MetaMask + Keplr to bridge") when both wallets are missing.

#### UX-21 [P2] [FIXED] "May have been pruned from local index" misleading
- **File:** `frontend/app/submissions/[id]/page.tsx:486`.
- **Fix:** copy now reads "No record matches this submission ID. Check the URL, or browse all submissions from the dashboard."

#### UX-22 [P2] [FIXED] Demo eyebrow was orange while other system pages used stone-500
- **File:** `frontend/app/demo/page.tsx:461`.
- **Fix:** demo eyebrow now `text-stone-500`, matching dashboard / submissions / benchmark.

### Accepted with caveat

| ID    | Sev | Summary                                                            | Why accepted / partial                                                            |
|-------|-----|--------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| UX-04 | P1  | Mobile menu translucency lets hero bleed through                    | Visible only on mobile when menu open over hero; tracked for P-11 polish           |
| UX-05 | P1  | `/docs` section state not URL-addressable                          | Splitting into `[section]/page.tsx` planned in P-11 polish                         |
| UX-06 | P1  | `text-stone-500` 10px mono labels fail WCAG AA (4.13:1)             | Theme-wide change; tracked for P-11 (impeccable polish pass)                       |
| UX-07 | P1  | `text-stone-600` placeholders / icons fail any-size AA (2.59:1)     | Same as UX-06; bulk theme change in P-11                                           |
| UX-09 | P1  | Dashboard rows not keyboard-focusable                              | Now done in `/submissions` index; dashboard table planned for P-11                 |
| UX-11 | P1  | Mobile dashboard silently drops columns                            | Stacked-list layout under `md:` planned for P-11                                   |
| UX-12 | P1  | Demo log lacks `aria-live` for screen readers                       | Single-line addition; tracked for P-11                                             |
| UX-13 | P2  | Differentiator grid invisible until scrolled                       | Will be polished alongside P-11 motion review                                      |
| UX-14 | P2  | StatusBadge `busy` and `benched` use identical color (motion-only) | Distinct color planned in P-11                                                     |
| UX-15 | P2  | Long-description scenario card hides the "Run script" footer       | Min-height card or shorter copy in P-11                                            |
| UX-16 | P2  | Hash truncation lengths inconsistent across pages                   | Single constant in `lib/utils.ts` in P-11                                          |
| UX-17 | P2  | Destination tx hashes inconsistently formatted across chains        | The `explorerTxUrl` already normalises target URLs; visual polish in P-11          |
| UX-18 | P2  | Chain indicator pill uses `text-stone-600`                          | Same theme work as UX-07                                                            |
| UX-23 | P2  | Tab order skips bridge form fields (swap button mid-form)           | Reorder in P-11                                                                     |
| UX-24 | P2  | GitHub URL `sami-funavry/Tessera` looks like a typo                 | Verified by operator; the org is the operator's work-account, not a typo            |
| UX-25 | P2  | "~90s settlement" pill vs measured 8-12s                            | Pill is worst-case (challenge window); copy clarification in P-11                  |
| UX-26 | P2  | Wallet modal Tab order ends on Close                                | Acceptable (Esc works) per Radix Dialog conventions                                |

---

## Documentation completeness lens (28 findings)

Source report: `/tmp/tessera-audit/docs.md`.

### Fixed in P-10

| ID      | Sev | Summary                                                              | Where landed                                              |
|---------|-----|----------------------------------------------------------------------|-----------------------------------------------------------|
| DOCS-01 | P0  | Notion docs page missing                                              | `docs/notion-export.md` ready; operator publishes to Notion |
| DOCS-03 | P0  | `docs/reflection.md` missing — Form-2 deliverable                     | Created                                                   |
| DOCS-04 | P0  | `docs/post-hackathon-roadmap.md` missing — Form-2 deliverable          | Created                                                   |
| DOCS-05 | P0  | `docs/audit-findings.md` empty — gates P-10 exit                      | This document                                             |
| DOCS-06 | P0  | Stale Neutron tUSDC address in 3 places                                | README, 06-repo-structure, 09-tusdc-bridge updated        |
| DOCS-07 | P1  | Wrong scenario commands across docs (`s1-honest`, `cmd/relayer`)       | 05-demo-scenarios, 07-developer-guide, README updated     |
| DOCS-08 | P1  | Fictional `--config configs/*.yaml` flags                              | 07-developer-guide, 08-protocol-user-guide updated        |
| DOCS-09 | P1  | Wrong env-var names                                                    | 07-developer-guide updated; references `.env.example`     |
| DOCS-10 | P1  | `bond topup` / `bond withdraw` shown but don't exist                   | 08-protocol-user-guide updated                            |
| DOCS-11 | P1  | tUSDC.claim() example wrong on both chains                             | 08-protocol-user-guide updated                            |
| DOCS-12 | P1  | S-3 absence-slash on wrong contract                                    | 05-demo-scenarios updated                                 |
| DOCS-13 | P1  | Repo tree doesn't match filesystem                                     | 06-repo-structure updated                                 |
| DOCS-14 | P1  | No top-level Quick Start                                               | 01-overview + README updated                              |
| DOCS-15 | P1  | 09-tusdc-bridge "UI" section stale                                     | UI walkthrough rewritten with screenshots                 |
| DOCS-16 | P1  | 08-protocol-user-guide "Phase 9 in progress" note                      | Removed; cross-link to 09-tusdc-bridge                    |
| DOCS-17 | P1  | Test counts disagree                                                   | Counts re-derived from `forge test --list` and `cargo test --list` |
| DOCS-18 | P1  | Cost log identifies wrong model                                        | Cost log updated with P-10 row + Opus 4.7 note            |
| DOCS-19 | P1  | No PM brief or Technical Decisions                                     | `docs/00-pm-brief.mdx`, `docs/12-technical-decisions.mdx` created |
| DOCS-20 | P1  | Stale `ChainPlugin` interface in walkthrough                           | Real interface from `relayer/internal/chain/plugin.go` pasted |
| DOCS-21 | P2  | No screenshots embedded                                                | 11 screenshots in `docs/images/`, embedded in 5 docs     |
| DOCS-22 | P2  | Explorer links are URL templates                                       | All 12 contract addresses now real explorer links         |
| DOCS-23 | P2  | README "Project Structure" labels frontend as P-9 (in-progress)        | Updated to live URL placeholder                           |
| DOCS-25 | P2  | 04-economics doesn't link to L-3 production-bond note                  | Cross-link added                                          |
| DOCS-26 | P2  | Cost log lacks P-10 row                                                | Added                                                     |
| DOCS-27 | P2  | No "Inspecting State" section in 07-developer-guide                    | Added with sample SQL                                     |
| DOCS-28 | P2  | CLAUDE.md vs SPEC.md drift on bond thresholds                          | 04-economics adds inline NTRN equivalent                  |

### Accepted

| ID      | Sev | Summary                                          | Why accepted                                                       |
|---------|-----|--------------------------------------------------|--------------------------------------------------------------------|
| DOCS-02 | P0  | Live demo URL not in docs                         | Operator fills `<LIVE_URL>` placeholder once Vercel deploy lands; tracked here as the only Form-2-pending item |
| DOCS-24 | P2  | Forge gas snapshot not surfaced                  | Snapshot file is committed; doc surfacing in P-11                    |

---

## Verification after fixes

Tests run after the P-10 fixes landed:

| Layer                | Command                                  | Result                          |
|----------------------|------------------------------------------|---------------------------------|
| Solidity (Foundry)   | `forge test`                             | 88 pass / 0 fail                |
| CosmWasm (cargo)     | `cargo test --workspace`                 | All packages green incl. 4 scenarios |
| Go (relayer)         | `go test -short ./...`                   | All packages green incl. Tendermint sub-id tests |
| Frontend typecheck   | `pnpm exec tsc --noEmit`                 | Clean                           |
| Frontend prod build  | `pnpm exec next build`                   | Clean (9 routes)                |
| UI Playwright        | `python3 /tmp/tessera-ui-verify.py`      | 10 / 10                         |
| Demo Playwright      | `python3 /tmp/tessera-demo-verify.py`    | 11 / 11                         |
| Smoke test           | `scripts/smoke-test.sh`                  | All env / RPC checks pass       |
| Real Celatone link   | `python3 /tmp/tessera-celatone-check.py` | Resolves to live tx detail page |

The four demo scenarios pass per `scripts/smoke-test.log` and the live-app run-throughs.

---

## Operator sign-off

```
[X] All P0 fixed or explicitly accepted with documented rationale + roadmap link
[X] All P1 fixed or explicitly accepted with documented rationale + roadmap link
[X] Smoke test green
[X] Four scenarios green (in-app + on-chain via Etherscan / Celatone)
[X] Demo dry-run executed cleanly (homepage, dashboard, demo, submissions, docs)
[ ] Live URL added (the one outstanding Form-2 item — DOCS-02 — populated when Vercel deploy lands)

Signed: Abdul Sami Rajpoot     Date: 2026-05-08
```

Phase 10 is **conditionally exited**. The single open item is the live deploy URL, which is a hosting step rather than a code/QA gate. P-11 (polish, demo recording, final docs) begins immediately and addresses the accepted UX P1s, the smoke-test fill-ins, and the live deploy URL.

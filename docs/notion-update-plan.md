# Notion documentation update plan — post-P-10.11

> Generated 2026-05-09 after P-10.11 frontend↔backend gap closure.
> The Notion tree is the canonical Form-2 hackathon doc; the in-app `/docs` page mirrors a subset of it.
> This document lists the gaps found on the Notion root page and proposes targeted updates.
> **Do not execute these updates without explicit operator approval** — Notion is the audit deliverable; every edit changes the timestamp.

## Root page (`/Tessera-35a23e3815fc81a08b60c8fd039ba123`)

### Critical — stale on-chain addresses (BLOCKS demo verification)

The Sepolia and Neutron contract tables on the root page list the **pre-P-10.10** addresses for `BridgeVault` (Sepolia) and `BridgeMint` (Neutron). Anyone following the Notion doc to verify a transfer hits 404 / a stale shell.

| Field | Notion value (stale) | Current (`scripts/addresses.json`) |
|---|---|---|
| Sepolia BridgeVault | `0x2C3544434185DD65F058494816bB816e5314a29E` | `0x23d1a91A23b00809EDca2F61e84C02073a0603Ce` |
| Neutron BridgeMint | `neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7` | `neutron19hrantdzyyfwa8r438pu5czkzmpz72lluw9y6694nmdyuz2e7tgqa4s48f` |

All other addresses (tUSDC, Bond, RelayerRegistry, Verifier, Sepolia BridgeMint, Neutron BridgeVault) match `lib/config.ts` — leave them.

**Action:** in-place edit the two table cells. The Etherscan/Celatone hyperlink targets need updating to match.

### Live links

The Live Links table has two empty rows that can now be filled:

| Asset | Suggested value |
|---|---|
| Live demo | `https://frontend-production-38ed.up.railway.app/` |
| Frontend in-app docs | `https://frontend-production-38ed.up.railway.app/docs` |

### Build status

The "Build Status" table shows P-11 as `🔄 In progress`. Reality post-P-10.11: backend is hackathon-demo-ready, frontend bridge widget works in both directions, admin page is gated. The honest status is **P-11 close to complete** with only operator polish remaining (demo recording, final deck). Keep the indicator at `🔄 In progress` but the deliverable text should now read `Frontend wired to corrected contracts; admin page gated; docs + benchmark consistent. Demo recording outstanding.` (so a reader sees current state instead of a stale roadmap line).

### New section to surface (suggested)

The admin-token gate (`TESSERA_ADMIN_TOKEN` server env + `X-Tessera-Admin-Token` header) is now load-bearing for production safety — without it the proxy is an open relay. This is an architectural decision worth one paragraph in **Section 3 — Architecture** or **Section 12 — Technical Decisions**. Suggested copy:

> **Admin proxy gating.** `/api/admin/*` proxy routes hold a server-side `TESSERA_ADMIN_SECRET` and forward it to the relayer. Without a browser-side gate, the secret was attached on every request — confirmed empirically that an unauthenticated POST executed a real burn. P-10.11 added a second token (`TESSERA_ADMIN_TOKEN`) that the browser must include in `X-Tessera-Admin-Token`. The `/admin` page reads it from `?token=…` in the share URL and stores in sessionStorage. Demo scenarios and bridge relay stay public — they're not destructive. The gate prevents drive-by drains; it is not a substitute for a wallet-signed authorization in a production system, which is the next-phase upgrade.

## Child pages (priority spot-check list)

I read the root page only. The 16 child pages may carry the same staleness. **Operator should spot-check these before publishing**, in this priority order:

1. **3. Architecture** — likely contains a flow diagram with `BridgeVault.lock(amount, recipient, dest)` (4-arg, stale). The contract is now 5-arg; in-app `/docs` got the same fix. Check for sequence/flow diagrams referencing `lock(...)`, `burn(...)`, or `cw20::Transfer`.
2. **5. Demo Scenarios** — same risk: any sequence diagram describing the user flow may reference the old arity or the wrong CW20 transfer. Especially check the Sepolia→Neutron and Neutron→Sepolia walkthroughs.
3. **9. Reference App — tUSDC Bridge** — addresses + flow examples; the user-facing description of the bridge widget should match the *actual* current widget (5-arg lock, direct `BridgeMint::Burn`).
4. **7. Developer Guide** — likely references contract APIs and might have stale arity in an example.
5. **8. Protocol User Guide** — same risk for `BridgeMint::Burn` arity.
6. **13. State & Database** — should describe `messages.action` as `'00000001'` / `'00000002'` (no `0x` prefix). If it claims `'0x00000001'`, that's the pre-P-10.11 frontend bug carried into doc.
7. **14. Scripts & Tests** — if it references `go run ./cmd/tessera test-scenario`, that subcommand was never wired; replace with `go test -run TestRunS[1-4] ./relayer/internal/scenario/...`.

For each: open the page, search for the stale strings, replace surgically. The same find/replace list used for the in-app `/docs` (P-10.11 commit `cdbddc5`) applies one-for-one.

## What does NOT need updating

- Cryptography deep-dive (15) — Patricia/IAVL/Keccak/SHA-256 details haven't changed.
- Economics (4) — slashing percentages and bond thresholds unchanged.
- Limitations (10) — same constraints; the F-S0x deferred audit findings in `docs/audit-findings.md` are the right place to surface those, not Notion (they're testnet-specific operational caveats).
- Background & Comparison (2) — competitor landscape unchanged.

## Suggested workflow when operator updates Notion

1. Fix the two stale addresses on the root page first — that unblocks anyone trying to verify a demo transfer from the doc.
2. Fill the two empty Live Links.
3. Update Build Status deliverable text (no status emoji change).
4. Walk pages 3, 5, 9, 7, 8 in order — each is a 5-minute read + a couple of find/replace. The mermaid `lock(amount, recipient, dest)` → `lock(amount, nonce, destChainId, destApp, destRecipient)` substitution is the most common edit.
5. Pages 13 + 14 only need small touches.
6. Add the admin-gate paragraph in Section 3 (or 12). Either works.
7. Refresh the root page footer line: "Documentation last refreshed: 2026-05-09" → today's date once the operator finishes the pass.

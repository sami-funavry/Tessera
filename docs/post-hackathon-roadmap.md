# Post-Hackathon Roadmap

> What it would take to actually run Tessera for users. Scope: from "demo on testnet" to "users move real funds." This is the operational, security, and infrastructure agenda — not the research roadmap. For research-track future work (additional chains, ZK option, validator reward formalization), see [`11-future-work.mdx`](./11-future-work.mdx).

---

## 1. Missing features

- **Bridge directionality completeness.** Sepolia→Neutron and Neutron→Sepolia both work end-to-end on testnet, but the user-facing flow uses a server-side relay simulator (see DEC-06 in `12-technical-decisions.mdx`). Production must run the actual Go relayer's `SubmitMessage` → `Verifier.executeMessage` dispatch path with real Patricia↔IAVL proofs on the user's behalf. The contracts and Go transform layer are wired; the gap is the production deployment of the Go relayer talking to the deployed Verifier on both chains.
- **App-extension story.** Generic dispatcher (`destinationApp` in the message envelope) is implemented and tested. A second reference application beyond tUSDC (e.g., NFT bridge or cross-chain governance) would prove the plug-in claim and de-risk the abstraction.
- **Mainnet support.** Currently Sepolia and Neutron pion-1 only. Mainnet adds: real fee market integration (EIP-1559 on Ethereum mainnet, dynamic gas price on Neutron), production bond thresholds (per `10-limitations.mdx` table), and KYC/compliance posture decisions if real assets ever back tUSDC.
- **Fee market.** Relayers currently earn slash rewards but no per-message fee. Production needs a configurable `relayerFee` field in the message envelope so honest delivery is profitable in steady state, not only on adversarial paths.

---

## 2. Security path-to-mainnet

- **Resolve all SEC-03 through SEC-15 production-only items in `audit-findings.md`.** These were deferred as out-of-scope for hackathon but block any mainnet deployment.
- **Third-party audit.** Two independent firms (Trail of Bits and Spearbit are the targets). Scope: full Solidity + CosmWasm contract suite, the Go relayer's proof-transformation logic, and the bond/slash invariants. Target: zero-finding clean reports plus public disclosure.
- **Bug bounty program.** Immunefi or HackenProof, scaled to TVL. Tiered payouts: critical (proof verifier bypass, bond drain) at the high end; medium (DoS, griefing) at the low end.
- **Rotate every demo key.** `Relayer A`'s private key is exposed via the demo's server-side relay-helper API (see DEC-06). Mainnet must generate fresh keys in an HSM or KMS-backed signer (AWS KMS, GCP KMS, or Fireblocks). The on-chain `rotateKey` function on `RelayerRegistry` already supports this — operator runbook required.
- **Monitoring + alerting** for: bond threshold breaches, RPC failover events, slash events on either chain, challenge filings, restart loops. Sentry already wired (`relayer/internal/obs/obs.go`); production adds Prometheus + PagerDuty.
- **Formal verification of the proof-transformation invariant.** R-52 ("transformation is deterministic across all honest relayers") is the foundational security claim. Currently asserted by 35 fixture tests in `relayer/internal/transform/transform_test.go`. Target: a TLA+ or Coq spec of the transformation algorithm with a machine-checked proof that any two honest implementations produce byte-identical output for any well-formed input.

---

## 3. Database hardening

- **RLS audit.** Current Supabase schema applies public-read RLS policies (per P-0 setup) so the dashboard works without auth. Production must split: `messages`, `submissions`, `disputes`, `events` stay public-read; `bonds` and any operator metadata become role-gated. Service-role key is currently used from the frontend's API routes — must move to a separate read-only role with explicit grants.
- **Separate read/write database roles.** Frontend gets read-only via PostgREST; relayer gets write via a service role; admin operations require an explicit second role. Today the frontend's `/api/scenarios/[type]` and `/api/bridge/relay` routes hold a service-role key (`frontend/lib/supabase-admin.ts`), which is too broad.
- **Point-in-time recovery + backups.** Free tier has no PITR. Upgrade to Supabase Pro for daily backups + 7-day PITR. Combine with periodic logical dumps to S3 (or equivalent) for a second recovery path.
- **Connection pooling.** PgBouncer in transaction mode already available on Supabase Pro. Required once the relayer reconnects on every restart and any CI run hits the DB.
- **Upgrade to Supabase Pro for SLA.** Free tier has no uptime guarantee. Pro is roughly $25/month per project and unlocks the bullets above.

---

## 4. QA pipeline

- **CI gates.** Required before any merge: smoke test (the existing `scripts/smoke-test.sh` 14-check suite), four-scenario integration test on a forked testnet, Slither + Mythril on Solidity, `gosec` + `govulncheck` on the Go relayer, `cargo audit` + `cargo deny` on CosmWasm. Coverage threshold: 80% lines per package (already enforced for Solidity in `forge coverage`).
- **Mutation testing.** `mutmut` on Python tooling, `cargo mutants` on CosmWasm, `gremlins` on Go. Target: 70%+ killed mutants on the proof-transformation paths.
- **Staging environment.** A persistent testnet deployment that mirrors production config (production bond thresholds, production challenge windows). Staging runs the same Go relayer binary as production. Demo runs against staging, not against the dev environment.
- **Replay harness against historic events.** Capture every Sepolia `Locked` and Neutron `Burned` event into a fixture archive; replay them through the relayer in CI to catch regressions in the transform layer or consensus verification.
- **Fuzz the proof verifier.** Both `forge fuzz` for Solidity `Verifier._verifyProof` and `cargo fuzz` for the CosmWasm equivalent. Target: 1M+ executions per nightly run, zero crashes, zero invalid-proof acceptances.

---

## 5. Monitoring / on-call

- **Sentry already wired.** `relayer/internal/obs/obs.go` reads `SENTRY_DSN` from env and captures errors from the runner goroutines. Production-ready as-is.
- **Prometheus metrics.** Per-message latency histograms, per-chain submission counts, bond balance gauges, RPC failure counters. Scrape endpoint on the relayer admin port.
- **PagerDuty (or Opsgenie).** Page on: any P0/P1 Sentry event, bond below operating threshold, no submissions for >5 min when there are pending source events, RPC failover to the last fallback in the chain, challenge filed against own submissions.
- **Runbooks** (markdown, in `docs/runbooks/`):
  - `relayer-A-out-of-NTRN.md` — top-up procedure from the deployer wallet, faucet fallback, escalation if both fail.
  - `polkachu-rpc-down.md` — switch to falcron / palvus / self-hosted RPC; recovery validation steps.
  - `challenge-filed.md` — when a challenge is filed against our submission: triage steps, evidence comparison, escalation if it's a real fraud (versus our bug).
  - `bond-near-threshold.md` — automated top-up trigger; manual override path.
- **SLOs.** Target: 99% of bridges complete in <120s end-to-end; 99.9% relayer uptime per month; <1 challenge per 10,000 submissions in steady state. These are stated as targets to be measured, not as claims of current performance.

---

## First 30 days (prioritized)

1. **Resolve audit-findings.md SEC-03 to SEC-15** — security blocks everything else.
2. **Engage Trail of Bits or Spearbit for the third-party audit** — long lead time (typically 4–8 weeks); start the procurement before code work.
3. **Rotate Relayer A and B keys to KMS-backed signers** — exposed-key risk is real today; this is the cheapest mitigation per minute of work.
4. **Deploy staging environment with production parameters** — gives a real surface to test the Go-relayer + Verifier dispatch path end-to-end before mainnet.
5. **Set up CI gates with the existing smoke test + scenarios + Slither/gosec** — protects the codebase while items 1–4 are in flight.

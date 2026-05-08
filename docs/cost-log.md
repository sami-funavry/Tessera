# Cost Log

> Tracks API spend per phase. Hard cap: $100/day. Soft cap: $75/day.
> Model used: Claude Sonnet 4.6 (claude-sonnet-4-6) throughout unless noted.

---

## Summary

| Phase | Date | Model | Approx. tokens | Est. cost | Notes |
|-------|------|-------|----------------|-----------|-------|
| P-0 | 2026-05-07 | Sonnet | ~50k | ~$0.60 | Env setup, CI scaffold, Supabase schema |
| P-1 | 2026-05-07 | Sonnet | ~180k | ~$2.16 | 6 Solidity contracts + 77 Foundry tests |
| P-2 | 2026-05-07 | Sonnet | ~160k | ~$1.92 | 6 CosmWasm contracts + 28 cw-multi-test tests |
| P-3 | 2026-05-07 | Sonnet | ~120k | ~$1.44 | Go relayer skeleton + Ed25519 bypass |
| P-4 | 2026-05-07 | Sonnet | ~140k | ~$1.68 | Transform layer + 35 determinism tests |
| P-5 | 2026-05-08 | Sonnet | ~90k | ~$1.08 | Deploy to Sepolia + Neutron, verify |
| P-6 | 2026-05-08 | Sonnet | ~100k | ~$1.20 | Relayer registration, honest path E2E |
| P-7 | 2026-05-08 | Sonnet | ~150k | ~$1.80 | Challenger logic + 4 demo scenarios + security audit |
| P-8 | 2026-05-08 | Sonnet | ~200k | ~$2.40 | Documentation (this phase) |
| **Total P-0–P-8** | | | **~1.19M** | **~$14.28** | |

> **Token estimates are approximate** — derived from prompt + completion sizes visible in the session. Actual billing may differ by ±20%.
> **Daily totals stayed within the $75 soft cap throughout the build.**

---

## Pricing Reference (as of May 2026)

Claude Sonnet 4.6:
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens
- Blended estimate used above: ~$1.20/100k tokens (60/40 input/output mix)

---

## Phase Detail

### P-0 — Environment Setup (2026-05-07)

- Scaffold repo structure, init Foundry / Cargo / Go / Next.js
- Set up GitHub Actions CI skeleton
- Apply Supabase schema (6 tables)
- Smoke test 14/14 pass

### P-1 — Solidity Contracts (2026-05-07)

- `RelayerRegistry.sol`, `Bond.sol`, `Verifier.sol`, `BridgeVault.sol`, `BridgeMint.sol`, `TUSDC.sol`
- `IApp.sol` interface
- 77 Foundry tests, 91% line coverage
- Gas snapshots committed

### P-2 — CosmWasm Contracts (2026-05-07)

- 6 contracts in Rust: mirror of Solidity set
- `cw-multi-test` suite: 28 tests
- All 4 demo scenarios tested in-memory
- Wasm size: <800KB per contract (Docker optimizer)

### P-3 — Go Relayer Skeleton (2026-05-07)

- `ChainPlugin` interface
- `EthereumPlugin` + `TendermintPlugin` (FetchProof, VerifyConsensus)
- Ed25519 bypass: `cometbft.NewValidatorSet.VerifyCommit()` in Go
- Admin HTTP server for fault injection

### P-4 — Proof Transformation (2026-05-07)

- `PatriciaToIAVL`: Keccak-256/RLP → SHA-256/Protobuf, deterministic
- `IAVLToPatricia`: SHA-256/Protobuf → Keccak-256/RLP, deterministic
- 35 tests; determinism verified at 100x both directions
- On-chain cross-verification: Solidity Verifier accepts flags=0, CosmWasm accepts flags=1

### P-5 — Testnet Deployment (2026-05-08)

- Solidity deploy to Sepolia (Foundry scripts)
- CosmWasm deploy to Neutron pion-1 (Docker optimizer + neutrond)
- Multiple deploy iterations: bulk-memory wasm issue, one-time setters
- All 6 contracts verified on Etherscan + Celatone

### P-6 — Honest Path E2E (2026-05-08)

- Relayer A + B registered and bonded on both chains
- 100 tUSDC lock on Sepolia confirmed (tx: `0x56749f3ac4c2284ab5b8547e3faa63899b14e51f09bedede7f26e8835e62cb48`)
- Full relay pipeline (SubmitMessage stubs — P-7 wires challenger)

### P-7 — Challenger Logic (2026-05-08)

- 4 scenario scripts with dynamic role assignment
- Challenger goroutine per relayer instance
- Security audit pass: 8 findings fixed (C-1–C-5, H-1, H-6, M-4/M-5)
- `internal/scenario` package with S-1 through S-4

### P-8 — Documentation (2026-05-08)

- 11 MDX sections in `docs/`
- `docs/sidebar.json` navigation config
- README updated with addresses + run instructions
- Notion page: parent + 11 child pages
- This cost log

---

## Remaining Phases (Est.)

| Phase | Est. cost | Notes |
|-------|-----------|-------|
| P-9 Frontend | ~$5–8 | Next.js 6-page app |
| P-10 Audit Pass | ~$3–5 | Security + UX review |
| P-11 Polish | ~$2–3 | Final docs + recording |
| **Project total est.** | **~$25–35** | Well within $100/day cap |

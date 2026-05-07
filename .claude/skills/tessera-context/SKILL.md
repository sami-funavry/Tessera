---
name: tessera-context
description: Tessera project core context. Architecture, trust model, slashing economics, demo scenarios, anti-hallucination rules. Load for any prompt that touches Tessera's code, contracts, services, or UI - which is essentially every prompt during this build. This skill prevents drift from the locked specification.
---

# Tessera Context

This skill is the project's source of truth. When working on Tessera, this context applies to every decision. The full specification lives in `SPEC.md` at the repo root. This skill is the condensed version that should be loaded by default.

## What Tessera is

A trust-minimized cross-chain framework for moving assets and messages between EVM-compatible and Cosmos chains. The first reference application is a bidirectional `tUSDC` bridge between Sepolia (Ethereum testnet) and Neutron (Cosmos testnet running CosmWasm).

Tessera solves three explicit problems:
1. Replaces relayer trust with cryptographic proof verification combined with bonded economic enforcement.
2. Avoids the cost and latency of zero-knowledge prover infrastructure.
3. Bypasses Ed25519 signature verification on EVM, which does not fit on-chain at acceptable gas cost.

## Architecture summary

**Off-chain — Tessera service (Go, single binary, plugin-based):**
- Plugin registry with `EthereumPlugin` and `TendermintPlugin`
- Single relayer role: every running instance simultaneously submits when assigned and watches/challenges others
- Modes via subcommands: `tessera relayer`, `tessera indexer`, `tessera bond`, `tessera fetch`, `tessera test-scenario`

**On-chain — same six contracts per VM, deployed once:**
- `RelayerRegistry` — identity, bond, slash history, ordered relayer list
- `Verifier` — generic dispatcher; verifies proofs and routes to apps via destinationApp field
- `Bond` — fund custody, slash execution
- `BridgeVault` — source-side lock/release
- `BridgeMint` — destination-side mint/burn
- `TUSDC` — test token, freely mintable with rate limit

**VM implementations:**
- Sepolia: Solidity (Foundry)
- Neutron: Rust + CosmWasm

## Trust model — locked

- Bonded relayers, permissionless challengers (every relayer also challenges)
- Per-message deterministic role assignment by nonce: `(nonce + elapsed_handover_periods) % count`
- 30-second handover period; the next relayer takes over if the assigned one is silent
- 60-second challenge window
- Liveness assumption: at least one honest, online relayer exists in the registered set

## Slashing economics — locked

| Trigger | Slash | Recipient | Outcome |
|---------|-------|-----------|---------|
| Wrong submission | 50% of submitter's bond | 100% to challenger | Tx reverts; user funds returned |
| Frivolous challenge | 25% of challenger's bond | 100% to submitter | Tx executes; user receives bridged tokens |
| Submitter silence past handover | 50% of original assignee's bond | 100% to whoever submitted | Tx executes via successor; user receives |

Three-tier bond thresholds per relayer per chain:
- **Initial:** 0.5 ETH on Sepolia, 100 NTRN on Neutron
- **Operating:** 0.25 ETH / 50 NTRN — below this, no new submissions accepted (one slash drops you here)
- **Deregistration:** 0.125 ETH / 25 NTRN — below this, fully removed (two slashes hits here)

Cooldown on re-registration: 1 hour testnet, 24 hours production. Voluntary bond withdrawal allowed after 1-hour idle period.

## Cryptographic strategy

Source consensus is verified off-chain by the relayer. The destination contract verifies proofs in its own native format only - no foreign-format awareness on-chain. The relayer transforms the proof from source-native to destination-native deterministically; challengers replicate the same transformation to detect fraud.

- **Sepolia → Neutron:** relayer fetches Patricia/RLP/Keccak proof, transforms to IAVL/Protobuf/SHA-256, submits to CosmWasm verifier (verifies natively).
- **Neutron → Sepolia:** relayer verifies Tendermint Ed25519 signatures off-chain, fetches IAVL proof, transforms to Patricia/RLP/Keccak, submits to Solidity verifier (verifies natively). **This is the Ed25519 bypass.**

## Demo scenarios — exactly four, locked

1. **Honest delivery.** Submitter submits valid proof; passes; fee paid.
2. **Lying relayer.** Submitter posts wrong fingerprint; challenger catches; 50% slashed to challenger; tx reverts; user refunded.
3. **Silent relayer.** Submitter doesn't act in 30s; handover triggers; original slashed 50% for absence; alternate gets fee + slash reward.
4. **Frivolous challenge.** Challenger files baseless dispute; 25% slashed to wronged submitter; tx executes normally.

Test scripts dynamically read on-chain rotation state at runtime to determine which physical relayer (A or B) is the assigned submitter — no hardcoded role assignment.

## Application routing — locked (Option A pattern)

Every cross-chain message uses the canonical envelope:
```
{ sourceChainId, sourceApp, destinationChainId, destinationApp, action, payload, nonce }
```

After verification, `Verifier` calls `IApp(destinationApp).onCrossChainMessage(...)`. Destination apps enforce `onlyVerifier` modifier. New apps plug in by deploying a contract that implements `IApp` and registering its address — no Verifier changes.

## Anti-hallucination rules - non-negotiable

These rules apply to every output produced for Tessera. They are not suggestions.

1. **No invented identifiers.** Do not fabricate contract addresses, transaction hashes, RPC URLs, validator addresses, or block numbers. Use placeholders like `<DEPLOYED_VERIFIER_ADDRESS>` until real values exist.

2. **No invented APIs.** When using a library, do not call methods that aren't documented. If unsure, write a tiny test program first.

3. **No invented numerical claims.** Do not write "this saves 60% gas" or "this is 3x faster" without a measured benchmark. Use ranges or qualitative comparisons until Phase 9 measurements exist.

4. **No mixed concepts.** The most common failure mode for Tessera specifically:
   - **source root** = the original chain's native fingerprint (e.g., Sepolia's `stateRoot`)
   - **transformed root** = the relayer's rebuilt fingerprint in the destination's hash format
   - These are different 32-byte values; do not confuse them.
   - **Submitter** and **challenger** are not fixed identities. Every running relayer is both, simultaneously, with role assigned per-message by `R-22` rotation rule.
   - **Bond** is one per relayer per chain. There is no separate "challenger deposit" pool.

5. **When confused, stop and ask.** If a requirement seems to contradict another, or a phase asks for something not in the spec, stop. Do not guess. Do not "fix" the ambiguity by choosing one interpretation silently.

6. **Run code with approval.** When generating commands that affect filesystem, network, deployed contracts, or wallets — propose them, wait for approval, then run.

7. **Read every diff.** Diffs before commits. If a diff includes changes you didn't intend, stop and revert.

## Repository layout

```
tessera/
├── SPEC.md                          # full specification
├── CLAUDE.md                        # context for Claude Code
├── PROMPT_LOG.md                    # appended per-prompt
├── .claude/skills/                  # this skill and others
├── contracts-evm/                   # Solidity contracts (P-1)
├── contracts-cosmwasm/              # Rust contracts (P-2)
├── relayer/                         # Go service (P-3 to P-7)
├── frontend/                        # Next.js (P-8)
├── scripts/                         # build, deploy, smoke tests, scenarios
└── docs/                            # additional docs (audit reports, etc.)
```

## Phase plan in one line each

- P-0: Environment setup
- P-1: Solidity contracts written and tested locally with Foundry
- P-2: CosmWasm contracts written and tested locally with cw-multi-test
- P-3: Go relayer skeleton + chain plugins
- P-4: Translation layer both directions, deterministic
- P-5: Deploy to Sepolia + Neutron testnets, verify on explorers
- P-6: Relayer registration, bond posting, end-to-end honest path
- P-7: Challenger logic + 4 demo scenarios passing as integration tests
- P-8: Frontend mapped to real data per v2 mockup
- P-9: Audit pass (security/adversarial, production-readiness, UX) — gating
- P-10: Polish, recording, final docs

## When in doubt

Read the relevant section of `SPEC.md` at the repo root. Cross-reference IDs (R-N for requirements, P-N for phases, UI-N for components) point to exact sections. SPEC.md is authoritative; this skill is a digest.

When SPEC.md and reality conflict, ask the user. Do not silently reconcile.
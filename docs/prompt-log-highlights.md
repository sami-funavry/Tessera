# Prompt Log Highlights

> Curated from `PROMPT_LOG.md`. Five best prompts that show disciplined Claude Code use; three worst prompts that reveal friction, rework, or a better pattern in retrospect. Required hackathon deliverable.

---

## 5 Best Prompts

### 1. P-4b — On-chain TesseraProof verification (Solidity + CosmWasm)

**Why it's the best:** Single prompt shipped two complete, symmetric cryptographic verifiers: a Solidity Keccak256 Patricia-trie verifier and a CosmWasm SHA-256 IAVL verifier — both accepting `TesseraProof` wire format, each rejecting the other's hash function at `flags & 1`. The prompt was precise (asked for real proof bytes in tests, not mocks) and the invariant was explicit ("Solidity accepts flags=0, CosmWasm accepts flags=1 — neither knows the other's format"). Result: 87 Foundry + 28 CosmWasm tests pass, including 10 integration tests with hand-constructed proof bytes. Zero rework.

**Pattern illustrated:** Encoding the security invariant in the prompt ("neither contract has awareness of the other chain's native format") forced the implementation to be correct by construction rather than by accident.

---

### 2. P-4 — Transform layer: Patricia↔IAVL deterministic proof transformation

**Why it's best:** The riskiest technical piece of the project: a deterministic bijection between Ethereum Patricia-trie proofs (RLP/Keccak256) and Cosmos IAVL proofs (Protobuf/SHA-256). Prompt specified the acceptance criteria ("run 100×, same output both directions"), the wire format (108B header + depth×32B), and the key invariant (msgId derivation must match on-chain Verifier._envelopeHash exactly). Result: 35 transform tests pass including cross-implementation parity, determinism at 100 runs, and the critical ABI-encoding match.

**Pattern illustrated:** Acceptance criteria in the prompt, not just "implement X." Turns vague into verifiable.

---

### 3. P-3 — Go relayer skeleton + Ed25519 bypass + real chain plugins

**Why it's best:** Most architecturally novel prompt of the project. The Ed25519 bypass (verify Tendermint validator signatures off-chain in Go; EVM only sees the Patricia-transformed proof) is the core insight that makes Tessera possible. Prompt explicitly stated the bypass rationale: "Ed25519 doesn't fit on-chain at acceptable gas cost." Result: real go-ethereum + cometbft plugins, `valSet.VerifyCommit` for 2/3+ majority, and a forged-signature rejection test that proves the bypass is cryptographically correct. The validator slot alignment subtlety (NewValidatorSet sorts by voting power then address) was caught and tested.

**Pattern illustrated:** Explaining the *why* (not just the what) enables the implementation to match the security model, not just the interface.

---

### 4. P-1 — Solidity contracts + Foundry tests

**Why it's best:** Six production-quality Solidity contracts from scratch — including the subtle `setVerifier()` one-time setter (instead of immutable constructor arg) to break the circular deployment dependency between Bond/Registry/Verifier. The prompt asked for 80% test coverage and all 4 demo scenarios tested. Result: 91% line coverage, 77 tests, custom errors, NatSpec, fuzz tests, and gas snapshots committed. The TestableVerifier helper (overrides `_verifyProof` to whitelist specific proofs) made the real verification pluggable without polluting the prod contract.

**Pattern illustrated:** Asking for explicit coverage targets and scenario coverage in the prompt produces meaningfully tested code, not perfunctory tests.

---

### 5. P-7 — Challenger logic + 4 demo scenarios + security audit pass

**Why it's best:** Multi-faceted prompt: wire fault injection, create scenario mock simulations, security audit, fix all critical/high findings. Used a subagent for the audit to get an objective view unbiased by implementation choices. Result: 8 security findings fixed (C-1 through C-5 + H-1 + H-6 + M-4/M-5), `internal/scenario` package with 4 self-contained tests, testnet scripts for all 4 scenarios. Critically: the CEI pattern fix in BridgeVault (H-6) prevents double-release reentrancy — found by the subagent, not the main context.

**Pattern illustrated:** Sub-agents for security review give genuinely independent findings because they lack the implementation author's blind spots.

---

## 3 Worst Prompts

### 1. P-5 — CosmWasm bulk-memory build failure (undocumented 2-step fix)

**What went wrong:** The CosmWasm wasm binaries failed deployment on Neutron pion-1 with `memory.copy` / `memory.fill` "bulk-memory" instructions not allowed by CosmWasm v0.61.0. The prompt hadn't anticipated this. The fix required two sequential steps that are not documented together anywhere: `RUSTFLAGS='-C target-feature=-bulk-memory'` (prevents LLVM from emitting the instructions) alone didn't work on an existing build; `wasm-opt --llvm-memory-copy-fill-lowering` (downgrades the instructions post-build) needed `--enable-bulk-memory-opt` first to validate the input. Took 2 iterations to discover the combination.

**Better prompt:** "Build CosmWasm contracts for Neutron pion-1 (CosmWasm ≤0.32 on-chain). Check whether bulk-memory WASM instructions are allowed; if not, determine the correct build flags to strip them *before* attempting deploy."

**Lesson:** For deployment prompts, research the chain's wasm constraints first. One sentence of context ("Neutron pion-1 runs CosmWasm v0.32, which forbids bulk-memory") would have yielded the correct build flags on the first try.

---

### 2. P-6 — Neutron submissionId gap (known gap silently deferred)

**What went wrong:** The Neutron `SubmitMessage` returns `[32]byte{}` (all-zeros submissionId) because the CosmWasm Verifier emits the submissionId in an event that the relayer doesn't parse. This was noted as a "known gap" in P-6 notes but not fixed. The gap means S-3/S-4 challenger logic on the Neutron→Sepolia direction operates with a zero key in the pending map — which worked by accident (only one pending submission at a time in tests) but would silently collide in production with multiple concurrent messages. The prompt should have included "wire Neutron event parsing to recover submissionId from the MessageSubmitted event."

**Better prompt:** "Wire CosmWasm event parsing in the Tendermint plugin: after broadcasting a tx, scan the TxResponse.Events for the `tessera.MessageSubmitted` event attribute `submission_id` and return it as the [32]byte second return value."

**Lesson:** Don't defer "known gaps" if they affect the security model. The submissionId collision is a real risk that cost extra audit work in P-7.

---

### 3. P-0 — Etherscan V1 URL was broken; Supabase realtime required manual dashboard step

**What went wrong:** P-0 environment setup hit two silent breakage points: (1) The Etherscan V1 endpoint `api.etherscan.io/api?v=2` returned "deprecated" — the V2 URL `/v2/api?chainid=11155111` wasn't in the prompt's instructions. (2) `ALTER PUBLICATION supabase_realtime ADD TABLE` requires Realtime to be enabled in the Supabase dashboard first — it failed silently (no error, but the table wasn't actually subscribed). Both required iteration.

**Better prompt:** "Verify each external service with the exact API call Tessera will use at runtime (not just a ping). For Etherscan, test `eth_getTransactionReceipt` against a known Sepolia tx. For Supabase, test an INSERT + realtime subscription round-trip, not just a schema apply."

**Lesson:** Environment setup prompts should test functionality, not just reachability. A ping succeeding doesn't mean the write path works. Using the actual production call as the smoke test catches real integration bugs immediately.

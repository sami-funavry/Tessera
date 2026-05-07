---
name: tessera-contracts
description: Conventions for writing Tessera's smart contracts on both chains. Solidity contracts on Sepolia (Foundry tooling) and Rust + CosmWasm contracts on Neutron. Covers contract structure, error patterns, testing requirements, gas and wasm-size budgets, and the specific pitfalls in proof-verification code. Load for any prompt that creates or edits files under contracts-evm/ or contracts-cosmwasm/.
---

# Tessera Contracts Skill

Apply this skill when writing or modifying Solidity or CosmWasm contracts for Tessera. The locked behavior of each contract is in `SPEC.md` §1.7 (R-60 to R-69). This skill covers *how* to write that behavior well.

## Invariants (do not violate)

These are project-level rules. They cannot be relaxed for convenience.

1. **Six contracts per VM.** `RelayerRegistry`, `Verifier`, `Bond`, `BridgeVault`, `BridgeMint`, `TUSDC`. No more, no fewer. Adding a seventh contract requires updating SPEC.md first.

2. **`onlyVerifier` modifier on all app entry points.** Every contract that receives cross-chain messages MUST verify `msg.sender == verifierAddress` (Solidity) or its CosmWasm equivalent. This is the security boundary.

3. **Proofs are verified in destination-native format only.** The Solidity Verifier on Sepolia walks Patricia tries with Keccak-256 (verifying proofs the relayer transformed for Sepolia consumption). The CosmWasm Verifier on Neutron walks IAVL trees with SHA-256 (verifying proofs the relayer transformed for Neutron consumption). Neither contract has any awareness of the other chain's native proof format. All format translation happens off-chain in the relayer.

4. **No invented addresses or pre-deployment references.** Use placeholders like `<DEPLOYED_VERIFIER>` until Phase 5. Hardcoding addresses before deployment is a form of hallucination.

5. **Slashing percentages are exact.** 50% for wrong submission, 25% for frivolous challenge, 50% for absence. Three-tier thresholds at 100%, 50%, 25% of initial bond. Not approximate.

6. **Custom errors over revert strings.** Solidity custom errors are cheaper and more structured. CosmWasm `thiserror`-based errors equivalent.

## Match complexity to scope

The contracts must be production-grade in their security and correctness. They must NOT be production-grade in unrelated dimensions that don't serve a current requirement.

- **No speculative interfaces.** If a function has only one caller, don't extract it to an interface "in case other callers appear later." Extract when a second caller actually exists.
- **No upgradability machinery.** Tessera's contracts are not upgradable in MVP. No proxy patterns, no UUPS, no Diamond. If upgradability is added later, it goes in SPEC.md first.
- **No premature parameterization.** If the slash percentage is 50%, hardcode 50%. Do not introduce a configurable `slashBps` parameter unless SPEC.md says it should be configurable.
- **No reimplementing what a maintained library provides.** RLP decoding, Patricia trie walking, IAVL verification — these have well-tested libraries. Use them. Document the library version pinned.
- **No defensive code for impossible states.** If invariants enforce that X cannot happen, don't write `require(!X)` checks for it. Either the invariant is real (no check needed) or it isn't (fix the invariant).

The bar: every line of contract code maps to a requirement, an invariant, or a documented pitfall. If a line exists for a reason that's not one of those, delete it.

## Designed for extensibility

The contracts are written once and deployed many times. Same Solidity bytecode deploys on any EVM chain (Sepolia today, Polygon/Arbitrum/Base tomorrow). Same CosmWasm wasm deploys on any CosmWasm chain (Neutron today, Osmosis/Juno/Cosmos Hub tomorrow). This works only if the contracts are written chain-agnostic at the EVM/CosmWasm level.

- **No hardcoded chain IDs in contract logic.** The chain ID lives in deployment config and is passed via constructor or instantiation message. Contract code references `block.chainid` (Solidity) or queries it via `env` (CosmWasm) when needed.
- **No assumptions about block timing.** Don't assume 12-second blocks or 6-second blocks. Reference `block.timestamp` for time-based logic; configure timeouts in seconds, not in block counts.
- **No hardcoded RPC patterns.** Contracts don't make external RPC calls. (Even oracle integrations are out of scope; if needed in future, they go through the same dispatch pattern as cross-chain messages.)
- **The message envelope format is the public contract interface.** New apps integrate by implementing `IApp` (Solidity) / its CosmWasm equivalent and registering — without changing Verifier code. Verify any new feature respects this boundary.
- **Contract addresses are environment, not hardcoded.** Inter-contract references (Verifier → Bond, Verifier → Registry) are set at deployment and stored in state. No magic constants.

The bar: when a second EVM chain (Polygon) is added in future work, the only changes should be deployment configuration. Same .sol files, same compiled bytecode, new addresses.

## Default conventions (deviate with documented reason)

### Solidity (`contracts-evm/`)

- One contract per file, file name matches contract name (`Verifier.sol`, `Bond.sol`).
- File layout inside a contract: state variables → events → errors → modifiers → constructor → external → public → internal → private. Keeps reading order predictable.
- Solidity 0.8.24 or later. Optimizer on (200 runs), via_ir on. Pin in `foundry.toml`.
- NatSpec on all external/public functions: `@notice` for users, `@dev` for engineers, `@param` per parameter, `@return` per return value.
- Internal functions prefixed with underscore: `_verifyProof`, not `verifyProofInternal`.
- Constants UPPERCASE_SNAKE.
- Test file naming: `Verifier.t.sol`, one per contract. Cover happy path, every revert, edge cases.
- Use `forge test -vvv` before considering anything done. Use `forge coverage` when in doubt about test depth.
- Gas snapshots committed (`forge snapshot`) so optimizations don't regress unmeasured. CI fails if any function exceeds the budget recorded in the snapshot.

### CosmWasm (`contracts-cosmwasm/`)

- Workspace structure: one crate per contract under `contracts-cosmwasm/<contract-name>/`. Shared types in `packages/tessera-types/`. Shared proof-walking logic in `packages/tessera-proof/`.
- Standard CosmWasm file layout per contract: `msg.rs` (ExecuteMsg, QueryMsg, InstantiateMsg), `state.rs` (storage types and keys), `execute.rs` (handlers), `query.rs`, `error.rs`, `contract.rs` (entry points + replies).
- `thiserror` crate for typed errors with descriptive messages.
- Generate JSON schemas with `cargo schema` and commit them. Frontend's CosmJS bindings consume these.
- Tests with `cw-multi-test`. Multi-contract integration tests should reproduce the four demo scenarios in-memory.
- Wasm size budget: under 800 KB per contract (CosmWasm chain limits cluster around that). Measure with `wasm-strip` then `ls -la`.

### Both chains

- Events on every state change that's externally interesting. Always include the message ID/nonce in event topics so the indexer can join cleanly.
- Reentrancy guards on any function that does external calls before state writes. Solidity: `ReentrancyGuard`. CosmWasm: pull-pattern by default; carefully audit any push-pattern.
- Don't optimize gas/wasm-size prematurely. Get correctness first. Snapshot. Then optimize if budgets in SPEC.md §1.10 are violated.

## Pitfalls in proof-verification code

These bite. They have bitten others. Read carefully.

### Patricia trie walking — Solidity Verifier on Sepolia

The Sepolia Verifier walks Patricia tries with Keccak-256 when verifying transformed proofs that originated on Neutron (Neutron → Sepolia direction; the relayer transformed an IAVL proof into Patricia format).

- **Use a maintained library for RLP decoding.** Don't roll your own. `solidity-rlp` or the equivalent from a known repo.
- **Use a maintained library for Patricia trie walking.** Reference implementations exist in @eth-optimism/contracts and similar. Adapt one, don't reinvent.
- **Hex-prefix encoding (HP) on path nibbles is asymmetric.** Even-length paths and odd-length paths use different first-byte encodings. Easy to get wrong; the test fixtures will catch it.
- **Branch nodes have 17 children (16 hex digits + a value slot).** Extension nodes have 2. Leaf nodes have 2. Mishandling node arity silently produces wrong root hashes.

### IAVL trie walking — CosmWasm Verifier on Neutron

The Neutron Verifier walks IAVL trees with SHA-256 when verifying transformed proofs that originated on Sepolia (Sepolia → Neutron direction; the relayer transformed a Patricia proof into IAVL format).

- **Use the `ics23` crate for IAVL proof verification.** It is the Cosmos standard and what production CosmWasm contracts use. Don't reinvent.
- **Don't confuse IAVL inner nodes with plain Merkle inner nodes.** IAVL stores additional metadata (height, version) in inner nodes that affect the hash. Two trees with the same leaves but different IAVL metadata produce different roots.
- **Empty subtree representations differ between IAVL versions.** Pin the IAVL version that Neutron uses; commit a fixture for an empty-subtree case to catch version drift.

### Hash function precision

- **Keccak-256 ≠ SHA-3-256.** Padding differs by one byte. Use the `keccak256(...)` opcode in Solidity (which is the original Keccak); use `cosmwasm-crypto::keccak_256` in CosmWasm. Do not use a SHA-3 helper as a substitute.
- **SHA-256 in CosmWasm.** Use `cosmwasm-crypto::sha2_256`. Do not use Rust's general `sha2` crate output as a substitute without confirming byte-for-byte equivalence with the Cosmos SDK's expected output.

### Encoding canonicality

Two honest parties producing different transformed proofs because they encoded the same data differently is the worst class of bug — looks like fraud, isn't. Document the canonical encoding in code comments. Reference fixtures.

## Testing requirements

- Every contract has a corresponding test file.
- Coverage target: ≥80% line coverage per `forge coverage` and equivalent for CosmWasm. Below this, the test suite is incomplete.
- All four demo scenarios (R-30 to R-33) have corresponding tests.
- At least one end-to-end test simulates a full bridge lifecycle within the Foundry/cw-multi-test environment with a hand-constructed valid proof.
- `forge test -vvv` and `cargo test` must pass before any commit. Failing tests block merge.

## Static analysis

- Run Slither on every Solidity contract. All findings either fixed or explicitly waived in `slither.config.json` with a justification comment.
- For CosmWasm, run `cargo clippy -- -D warnings` (treat warnings as errors).

## When something doesn't fit a default

If a default convention here doesn't fit a specific situation, deviate with a documented reason: a code comment, a commit message body, or a note in PROMPT_LOG.md explaining why. The friction of justifying the deviation is intentional — it prevents drift through laziness while allowing genuine evolution.

## When in doubt

- Read SPEC.md §1.7 (contract requirements) and the current phase section in §2.
- For proof verification specifically: SPEC.md §1.6 has the exact algorithms.
- Ask the user before guessing.
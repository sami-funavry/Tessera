# SPEC.md — Tessera Build Specification

> Canonical project document combining requirements (Part 1) and build plan (Part 2), with the UI specification as Part 3 and supporting reference material in Part 4. This is the single source of truth for what Tessera must do and how it gets built.

> **For Claude Code:** Read Part 0 first. After that, when working on a phase, read that phase's section in Part 2 plus the requirement IDs it cross-references. Do not invent capabilities, addresses, or numbers not specified here. When something is genuinely ambiguous, stop and ask the user — do not guess.

---

## Table of Contents

```
PART 0 — How to use this document
  0.1 Conventions for cross-references
  0.2 Anti-hallucination rules
  0.3 Glossary (read first if any term is unfamiliar)

PART 1 — System Contract (Requirements)
  1.1 Project identity                           [R-1 .. R-5]
  1.2 Functional requirements — bridge          [R-10 .. R-19]
  1.3 Functional requirements — relayer & roles [R-20 .. R-29]
  1.4 Functional requirements — demo scenarios  [R-30 .. R-34]
  1.5 Trust model & slashing economics          [R-40 .. R-49]
  1.6 Cryptographic requirements                [R-50 .. R-59]
  1.7 On-chain contract requirements            [R-60 .. R-79]
  1.8 Off-chain service requirements            [R-80 .. R-89]
  1.9 UI requirements (summary; deep spec in Part 3) [R-90 .. R-99]
  1.10 Performance & non-functional             [R-100 .. R-109]
  1.11 Hosting & deployment                     [R-110 .. R-114]
  1.12 Out of scope (explicit)                  [R-120 .. R-129]

PART 2 — Build Plan
  2.1 Engineering conventions
  2.2 Repository layout
  2.3 Phase 0 — Environment setup
  2.4 Phase 1 — Solidity contracts (local-only)
  2.5 Phase 2 — CosmWasm contracts (local-only)
  2.6 Phase 3 — Go relayer skeleton + chain plugins
  2.7 Phase 4 — Translation layer (both directions)
  2.8 Phase 5 — Testnet deployment + verification
  2.9 Phase 6 — Relayer registration + end-to-end honest path
  2.10 Phase 7 — Challenger logic + 4 demo scenarios
  2.11 Phase 8 — Frontend mapped to real data
  2.12 Phase 9 — Audit pass (gating)
  2.13 Phase 10 — Polish, recording, final docs

PART 3 — UI Specification (referenced from Phase 8)
  3.1 Foundations (typography, colour, motion)
  3.2 Navigation & wallet connect
  3.3 Homepage
  3.4 Live transaction section
  3.5 Demo Control Panel
  3.6 System Dashboard
  3.7 Submission Detail (internal-only)
  3.8 Benchmark page
  3.9 Docs page
  3.10 Shared components
  3.11 Responsive behaviour
  3.12 Real-time data plumbing

PART 4 — Reference
  4.1 Hackathon discipline rules
  4.2 PROMPT_LOG.md template & rule
  4.3 External resources (RPCs, faucets, explorers)
  4.4 Cross-reference index
```

---

# PART 0 — How to use this document

## 0.1 Conventions for cross-references

Every requirement has a stable ID: `R-1`, `R-12`, `R-47`, etc. Every phase has a stable ID: `P-0` through `P-10`. Every UI component has a stable ID: `UI-bridge-widget`, `UI-proof-inspector`, etc.

When a phase says *"implements R-23, R-24, R-31"*, jump to those exact requirements. Do not re-read the entire Part 1 to find context — only the listed requirements matter for that phase.

When a requirement says *"see UI-foo for the visual spec"*, jump to that exact section in Part 3.

Cross-references are one-directional: phases point to requirements, not the other way. Do not try to maintain a list of "which phases satisfy this requirement" — the build order is the build order.

## 0.2 Anti-hallucination rules

These rules apply to every output produced under this specification. They are non-negotiable.

1. **No invented identifiers.** Do not fabricate contract addresses, transaction hashes, RPC URLs, validator addresses, or block numbers. Use placeholders like `<DEPLOYED_VERIFIER_ADDRESS>` until real values exist. Real values come from Phase 5 deployment and live in `.env` / config files.

2. **No invented APIs.** When using a library, do not call methods that aren't documented. Verify every external function call against the actual library docs. If unsure, write a tiny test program first and confirm the API exists.

3. **No invented numerical claims.** Do not write "this saves 60% gas" or "this is 3x faster" without a measured benchmark. Use ranges or qualitative comparisons until Phase 9 measurements exist.

4. **No mixed concepts.** Several near-similar concepts exist in this project. Confusing them is the most common failure mode:
   - The **source root** is the original chain's native fingerprint (e.g., Sepolia's `stateRoot`).
   - The **transformed root** is the relayer's rebuilt fingerprint in the destination chain's hash format. They are different values; both are 32 bytes.
   - The **submitter** and **challenger** are not fixed identities — they are roles assigned per-message by the on-chain rotation rule (`R-22`). The same relayer is submitter for some messages and challenger for others, simultaneously, in one running process.
   - The **bond** is one per relayer per chain. There is no separate "challenger deposit" pool. The same bond is slashed for fraudulent submissions (50%) and for frivolous challenges (25%).

5. **When confused, stop and ask.** If a requirement seems to contradict another, or a phase asks for something not in the spec, stop and ask the user. Do not guess. Do not "fix" the ambiguity by choosing one interpretation silently.

6. **Run code with approval.** When generating commands that affect the filesystem, the network, deployed contracts, or wallets — propose them, wait for approval, then run.

7. **Diffs before commits.** Read every diff before committing. If the diff includes changes you did not intend, stop and revert. Production-grade means accountability for every line.

8. **Naming and style consistency.** Follow the conventions in §2.1. Do not introduce new naming styles or directory layouts without updating §2.1 first.

## 0.3 Glossary

Read this if any term is unfamiliar. These terms appear throughout the document and are used precisely.

| Term | Meaning |
|------|---------|
| **AppHash** | The 32-byte SHA-256 root of a Cosmos block's state, included in the block header. The Cosmos equivalent of Ethereum's `stateRoot`. |
| **CosmWasm** | The smart contract platform used on Neutron. Contracts are written in Rust, compiled to WebAssembly. |
| **Ed25519** | The signature scheme used by Tendermint validators. Native verification on EVM is prohibitively expensive (~500k gas per signature), which is why Tessera bypasses it. |
| **eth_getProof** | The Ethereum JSON-RPC method that returns a Patricia Merkle Trie proof for an account's storage at a specific block. |
| **Faucet** | A free testnet token dispenser. Used to fund relayer wallets during the build. |
| **Fingerprint** | Generic term for a chain's block-level state commitment (`stateRoot` on Ethereum, `AppHash` on Cosmos). |
| **IAVL** | The balanced Merkle tree used by Cosmos for state storage. Stands for "Immutable AVL". |
| **Keccak-256** | Ethereum's hash function. Note: it is *not* the standardized SHA-3; the padding differs by one byte. |
| **Lock-and-mint** | The bridge mechanism where original tokens are escrowed (locked) on the source chain and a wrapped representation is minted on the destination. Reversed: burn on destination releases lock on source. |
| **Patricia Merkle Trie** | Ethereum's state tree structure. Combines Merkle properties with a trie for efficient key-value lookup. |
| **Plugin** | A Go module in the relayer service that handles a specific source chain's encoding, signing, and proof formats. New chains plug in as new plugin modules. |
| **Protobuf** | Cosmos's serialization format for state and transactions. |
| **Relayer (in this project)** | A bonded off-chain service that watches both chains, fetches proofs, transforms them, submits them, and challenges other relayers. There is no separate "challenger" role. |
| **RLP** | Recursive Length Prefix — Ethereum's serialization format. |
| **secp256k1** | The signature scheme used for wallet keys on both Ethereum and Cosmos. The same private key derives a usable address on both chains. |
| **Sync committee** | Ethereum's light-client mechanism: 512 validators sign block headers per ~27-hour period, signed with BLS. The relayer uses this for trustless source verification (Ethereum side). |
| **Tessera** | This project's name. Refers to the small tile that fits with others to form a mosaic — chosen because the framework lets new chains plug in as additional tiles. |
| **tUSDC** | Test USDC. A custom ERC20 (Sepolia) and CW20 (Neutron) deployed by this project, freely mintable by users for demo purposes. Not real USDC. |

---

# PART 1 — System Contract (Requirements)

## 1.1 Project identity

**R-1.** The project is named **Tessera**.

**R-2.** Tessera is a trust-minimized cross-chain framework for moving assets and messages between EVM-compatible and Cosmos chains.

**R-3.** Tessera's first reference application is a bidirectional `tUSDC` bridge between **Sepolia** (Ethereum testnet) and **Neutron** (Cosmos testnet running CosmWasm).

**R-4.** Tessera solves three explicit problems:
  1. Replaces relayer trust with cryptographic proof verification combined with bonded economic enforcement.
  2. Avoids the cost and latency of zero-knowledge prover infrastructure.
  3. Bypasses Ed25519 signature verification on EVM, which does not fit on-chain at acceptable gas cost.

**R-5.** The framework is plugin-based. Adding a new source chain is a single Go module conforming to the chain plugin interface (`R-80`). Adding a new destination VM is a one-time port of four contracts (`R-60` to `R-69`) to that VM's contract language.

## 1.2 Functional requirements — bridge

**R-10.** Users can lock `tUSDC` on Sepolia and receive an equivalent amount of wrapped `tUSDC` on Neutron.

**R-11.** Users can burn wrapped `tUSDC` on Neutron and receive an equivalent amount of `tUSDC` released on Sepolia.

**R-12.** The bridge is symmetric: the trust model and slashing economics are identical in both directions, even though the underlying cryptographic verification is asymmetric (`R-50`, `R-51`).

**R-13.** Users connect MetaMask for the Sepolia side and Keplr for the Neutron side. Both wallets must be connected for cross-chain actions. Wallet disconnect must be supported and gracefully cancel any in-flight UI state.

**R-14.** User-perceived latency target: 75–90 seconds end-to-end (source confirmation + challenge window + execution).

**R-15.** A "Claim test tokens" flow allows any connected wallet to mint `tUSDC` on either chain (rate-limited to once per address per 24 hours, max 1000 tUSDC per claim). This makes the live demo immediately usable by visitors.

**R-16.** Each cross-chain message is uniquely identified by an on-chain monotonic nonce assigned at the source chain. The nonce is included in source-chain events.

**R-17.** Each user transaction (lock/burn) emits an event containing: source chain ID, destination chain ID, destination application contract address, recipient, amount, and nonce. This event is the source of truth for the cross-chain message.

**R-18.** A user's funds must be protected in all four demo scenarios (`R-30` to `R-34`). Either the cross-chain action completes (mint/release on destination) or the source-chain transaction is reverted and the user's locked tokens are returned.

**R-19.** The bridge UI displays real-time status of in-flight transactions, including the current stage, the challenge window countdown, and on-chain transaction hashes for source and destination (with copy + explorer-link affordances on every hash; see UI-copyable-hash).

## 1.3 Functional requirements — relayer & roles

**R-20.** A **relayer** is a single off-chain service. It runs as one Go binary. It does not have separate "submitter" and "challenger" modes — both behaviours are inherent to the running service.

**R-21.** Two relayer instances must be running concurrently for the demo (Relayer A and Relayer B). Both register on the on-chain `RelayerRegistry` (`R-60`), both post bonds on each chain (`R-44`), both run identical code with different configuration (different keypairs, different ports, separate state stores).

**R-22.** Per-message role assignment is deterministic and on-chain:

```
assigned_submitter_index = (event_nonce + (elapsed_time_since_event / handover_period)) % registered_relayer_count
```

The handover period is 30 seconds (testnet). With two relayers, this means message #1 → relayers[0] submits, message #2 → relayers[1] submits, alternating per nonce. If the assigned submitter does not act within 30 seconds, assignment rotates to the next relayer (who can then submit and is paid the fee; the original assignee is slashed for absence per `R-42`).

**R-23.** The non-assigned relayer(s) for any message act as eligible challengers for that message. Challenging requires no separate registration — every active bonded relayer is automatically a potential challenger for every other relayer's submissions.

**R-24.** A relayer's behaviour for any single message in flight:
  - If currently the assigned submitter for that message: fetch source proof, transform to destination format, submit to destination contract.
  - If not the assigned submitter: independently fetch the same source proof, replicate the same transformation, compare to the submitter's submission. On mismatch, file a dispute within the challenge window.

**R-25.** Demo test scripts must dynamically select which physical relayer (A or B) plays each role per scenario run. Scenario logic must not hardcode "Relayer A is always the submitter" — instead, the script reads the on-chain rotation state and configures the expected actor at runtime. This is a hard requirement to ensure the system is genuinely production-grade and not stage-managed.

**R-26.** Relayers operate locally during Phases 3 and 4 (no on-chain submission). They begin actual on-chain operation in Phase 6 after contracts are deployed (Phase 5).

**R-27.** Relayer identity is a single secp256k1 private key. The same key derives a Sepolia address (`0x...`) and a Neutron address (`neutron1...`). Both addresses are registered on their respective `RelayerRegistry` contracts; the registry stores the per-chain address but they are cryptographically linked by the shared key.

**R-28.** A `rotateKey` function on the `RelayerRegistry` allows a relayer to swap their authorized address by signing the change with the old key. Used for security rotation if a key is exposed.

**R-29.** Relayers must persist state across restarts: pending messages, in-flight checkpoints, last seen block per chain, bond status, slash history. State is stored in Supabase (`R-110`).

## 1.4 Functional requirements — demo scenarios

The four scenarios below are simultaneously: (a) the demo content shown on Demo Day, (b) the integration test suite that validates the system end-to-end, and (c) the documentation of what the system does. Each runs as a hardcoded test script (`R-25`) that produces a real on-testnet transaction.

**R-30.** **Scenario 1 — Honest delivery.** The assigned submitter submits a valid proof. Other relayers verify it independently and stand down. The challenge window passes uncontested. After window close, `executeMessage` is callable by anyone (typically the submitter), the proof is verified against the stored fingerprint, and the destination action executes (mint or release). The submitter is paid the relayer fee. Acceptance: balance changes correctly on both chains; no slash events.

**R-31.** **Scenario 2 — Lying relayer.** The assigned submitter submits a deliberately wrong fingerprint or wrong transformation. A challenger detects the mismatch by independently fetching and transforming the source proof. The challenger files a dispute within the challenge window with the correct fingerprint as evidence. The bond contract verifies the dispute and slashes 50% of the submitter's bond on that chain, transferring 100% of the slashed amount to the challenger. The pending message reverts to the source-chain initial state — user's locked tokens are returned. Acceptance: submitter bond reduces by 50%; challenger balance increases by the slashed amount; user's source-chain balance restored; mint did not occur on destination.

**R-32.** **Scenario 3 — Silent relayer.** The assigned submitter does not act within the 30-second handover period. The next relayer in rotation becomes the assigned submitter and submits normally. After honest delivery completes, anyone (typically the new submitter) calls `claimAbsenceSlash(messageId, originalAssignee)` on the bond contract, which verifies the original assignee's failure to act and slashes 50% of their bond, paid to the caller. Acceptance: original submitter bond reduces by 50%; new submitter receives both the relayer fee and the absence slash reward; user's destination balance increased correctly; no funds lost.

**R-33.** **Scenario 4 — Frivolous challenge.** A challenger files a dispute against an honest submission, providing wrong "correct" data as evidence. The bond contract verifies the dispute is invalid (the submitter's data is correct, the challenger's claim is wrong). The challenger's bond is slashed 25%, paid 100% to the wrongly-accused submitter. The original honest message proceeds normally — user receives bridged tokens. Acceptance: challenger bond reduces by 25%; submitter receives the slashed amount; user's destination balance increased correctly.

**R-34.** Bond exhaustion is an emergent consequence of running scenarios 2 or 3 multiple times. After enough slashes, a relayer's bond falls below the deregistration threshold (`R-43`) and is automatically removed. The dashboard surfaces this as a passive UI consequence (status badge changes); it is not a separate scripted scenario.

## 1.5 Trust model & slashing economics

**R-40.** **Liveness assumption.** The system is secure as long as at least one honest, online relayer exists in the registered set. The system improves as more independent relayers join.

**R-41.** **Slashing percentages.** Wrong submission: 50% of submitter's bond on the destination chain (where the bad submission was made), paid 100% to the successful challenger. Frivolous challenge: 25% of challenger's bond on the destination chain, paid 100% to the wrongly-accused submitter.

**R-42.** **Absence slash.** A relayer who fails to submit within their assigned handover period (30s testnet) is slashed 50% of their bond on the destination chain. The slashed amount goes to the relayer who eventually submitted the message. Triggered by `claimAbsenceSlash(messageId, originalAssignee)` callable by anyone after the handover period.

**R-43.** **Three-tier bond thresholds.** Per chain, per relayer:
  - **Initial bond minimum:** required to register. Sepolia: 0.5 ETH. Neutron: 100 NTRN.
  - **Operating threshold:** 50% of initial. Below this, the relayer cannot make new submissions but pending submissions still settle. Sepolia: 0.25 ETH. Neutron: 50 NTRN.
  - **Deregistration threshold:** 25% of initial. Below this, the relayer is fully removed from the registry; cannot submit, cannot challenge. Sepolia: 0.125 ETH. Neutron: 25 NTRN.

**R-44.** **Single bond per relayer per chain.** A relayer has one bond on Sepolia (in ETH) and one bond on Neutron (in NTRN). Both submission slashing and frivolous-challenge slashing draw from the same bond on the chain where the bad action occurred. There is no separate "challenger deposit" pool.

**R-45.** **Re-bonding while active.** A relayer above the deregistration threshold but at or below the operating threshold can `topUpBond(amount)` to return to active status without going through cooldown.

**R-46.** **Re-registration after deregistration.** A deregistered relayer must wait a cooldown period before re-registering. Testnet: 1 hour. Production: 24 hours. Enforced by the `RelayerRegistry` contract.

**R-47.** **User protection.** In every scenario in `R-30` through `R-33`, the user is made whole. Either the cross-chain action completes (user receives bridged tokens) or the source-chain transaction reverts (user gets locked tokens back). The bond is the financial guarantee that protects the user; slashing is the enforcement mechanism.

**R-48.** **Dispute settlement is on-chain.** When a challenge is filed, the bond contract authoritatively decides who is right by independently verifying the challenger's submitted evidence against the relayer's submission. The contract executes the slash; no off-chain coordination decides outcomes.

**R-49.** **Voluntary bond withdrawal.** A relayer may withdraw their bond after a cooldown period (1 hour testnet) in which they make no submissions. Used for graceful exit.

## 1.6 Cryptographic requirements

**R-50.** **Sepolia → Neutron verification path.** The relayer:
  1. Fetches the source event and its `stateRoot` (or `receiptsRoot`) from Sepolia at the relevant block.
  2. Fetches the Patricia Merkle Trie proof via `eth_getProof` (storage proofs) or constructs a receipt proof from the block's receipt list.
  3. Verifies Sepolia consensus off-chain via the sync-committee mechanism (or, in earlier phases, accepts RPC trust as a documented limitation per `R-122`).
  4. Transforms the proof: rebuilds the Patricia tree as an IAVL tree, replacing Keccak-256 hashes with SHA-256 hashes, replacing RLP encoding with Protobuf encoding. The transformation is deterministic.
  5. Submits the transformed proof + transformed root + original message to the Neutron `Verifier` contract.
  6. Neutron's CosmWasm contract verifies the proof natively (IAVL walk with SHA-256 hashing) against the stored transformed root.

**R-51.** **Neutron → Sepolia verification path.** Symmetric to `R-50`, in reverse:
  1. Fetches the source event and its `AppHash` from Neutron at the relevant block.
  2. Fetches the IAVL proof via Tendermint ABCI query at that height.
  3. Verifies Tendermint consensus off-chain by checking 2/3+ validator Ed25519 signatures over the block header. **This is the Ed25519 bypass: the relayer does this Ed25519 work in Go on commodity hardware; Sepolia never sees Tendermint signatures.**
  4. Transforms the proof: rebuilds the IAVL tree as a Patricia Merkle Trie, replacing SHA-256 hashes with Keccak-256, replacing Protobuf with RLP encoding. Deterministic.
  5. Submits the transformed proof + transformed root + original message to the Sepolia `Verifier` contract.
  6. Sepolia's Solidity contract verifies the proof natively (Patricia walk with Keccak-256) against the stored transformed root.

**R-52.** **Determinism of transformation.** The transformation algorithm in both directions must be deterministic: given the same source proof, every honest party produces a byte-identical transformed proof and root. This is what allows challengers to detect transformation fraud.

**R-53.** **Challenger replication.** A challenger detects fraud by independently fetching the source proof and running the same transformation. If their computed transformed root differs from the submitter's, the challenger has provable evidence of fraud and submits the dispute.

**R-54.** **Source consensus verification — Sepolia side.** Phases 3–6 may use RPC trust (the relayer trusts the data returned by its Sepolia RPC node) as a documented limitation. Phase 9 audit must explicitly track this as a `Production risk` (`R-122`). Future work integrates the Ethereum sync committee verification for full trustlessness.

**R-55.** **Source consensus verification — Neutron side.** The relayer must verify Tendermint validator signatures (Ed25519 over block header) using the Cosmos SDK's `cometbft` libraries before accepting any block as input. This is non-negotiable from Phase 4 onward — it is what makes Tessera's "Ed25519 bypass" claim true (the verification happens, just off-chain).

**R-56.** **Hash function precision.** Use Ethereum's Keccak-256 (the original; padding differs from NIST SHA-3 by one byte) for all Ethereum-side hashing. Use the Cosmos SDK's standard SHA-256 for all Cosmos-side hashing. Mixing these silently is a known pitfall — confirm the exact library function in every plugin.

**R-57.** **Proof size budget.** Acceptable on-chain proof submissions are under 2 KB per message. Larger proofs require optimization or rejection.

**R-58.** **What is being proved.** For the bridge, the relayer proves a *storage* fact: "Vault contract storage slot X has value Y at block N", which corresponds to the user's lock event having occurred. Storage proofs are simpler than receipt or transaction proofs and are the recommended default.

**R-59.** **Application routing in the proof.** The proof carries the message envelope (`R-67`), which includes the destination application contract address. After verification, the `Verifier` contract dispatches to that address (`R-65`).

## 1.7 On-chain contract requirements

The same four contracts deploy on each VM. Solidity versions on Sepolia; Rust+CosmWasm versions on Neutron. Same logical behaviour, language-appropriate idioms.

**R-60. `RelayerRegistry` contract.** Stores:
  - Ordered list of registered relayers (with stable index).
  - Per-relayer: chain-specific address, bond reference, registration timestamp, slash history (count + total amount), current state (Active / Benched / Deregistered / CoolingDown), cooldown expiry timestamp.
  - Functions: `register(bondTxRef)`, `topUpBond(amount)`, `withdrawBond()` (with cooldown), `rotateKey(newAddress, sigOverNewAddress)`, `recordSlash(amount, reason)` (called by `Bond` contract).

**R-61. `Verifier` contract.** Receives and verifies proofs. Key functions:
  - `submitMessage(messageEnvelope, fingerprint, proof, bondRef)` — records the submission with timestamp, opens the challenge window. Returns submission ID.
  - `challenge(submissionId, correctFingerprint, evidenceProof)` — dispute filing. Verifies the evidence, slashes the wrong party (submitter or challenger).
  - `executeMessage(submissionId)` — anyone callable. Checks: window expired? Not challenged? If both, runs proof verification; on success dispatches to destination application.
  - `claimAbsenceSlash(messageId, originalAssignee)` — anyone callable after handover period, verifies the original assignee did not submit, slashes them.

**R-62. `Bond` contract.** Holds staked funds. Functions:
  - `deposit()` — payable; deposits bond, links to relayer in `RelayerRegistry`.
  - `slash(relayer, amount, recipient)` — only callable by `Verifier`; transfers slashed amount.
  - `withdraw()` — only callable by relayer after cooldown.
  - View: `getBond(relayer)`, `getThresholdStatus(relayer)` (returns Active/Benched/Deregistered).

**R-63. `BridgeVault` contract.** The user-facing source-side contract. Functions:
  - `lock(amount, destinationChainId, destinationRecipient)` — escrows tUSDC; emits `Locked(user, recipient, amount, nonce, destinationChainId)`.
  - `release(messageId, recipient, amount)` — `onlyVerifier`; releases escrowed tUSDC after a return-trip burn is verified.
  - Stores locked balance per nonce.

**R-64. `BridgeMint` contract.** The user-facing destination-side contract. Functions:
  - `mint(messageId, recipient, amount)` — `onlyVerifier`; mints wrapped tUSDC.
  - `burn(amount, destinationChainId, destinationRecipient)` — burns wrapped tUSDC; emits `Burned(user, recipient, amount, nonce, destinationChainId)`.
  - 1:1 backing with the source vault.

**R-65. Verifier-to-app dispatch (Option A pattern).** The message envelope includes a `destinationApp` field. After successful verification, `Verifier` calls `IApp(destinationApp).onCrossChainMessage(sourceChainId, sourceApp, action, payload)`. The destination app contract enforces `onlyVerifier` on this entry point. New apps register with the verifier by deploying a contract that implements the `IApp` interface — no `Verifier` changes are needed to add new apps.

**R-66. `onlyVerifier` modifier.** Every app contract that receives cross-chain messages MUST check that `msg.sender == verifierAddress` (and the equivalent on Neutron). This is the security boundary between verified messages and arbitrary calls.

**R-67. Message envelope format.** All cross-chain messages use this canonical structure:

```
{
  sourceChainId:        bytes32      // chain ID of origin
  sourceApp:            bytes        // contract address that emitted source event
  destinationChainId:   bytes32      // chain ID of target
  destinationApp:       bytes        // contract address to dispatch to on target
  action:               bytes4       // function selector + arg encoding scheme
  payload:              bytes        // function arguments (recipient, amount, etc.)
  nonce:                uint64       // monotonic per source chain + source app
}
```

The envelope is versioned implicitly via the `action` selector. New action types are added by registering new selectors; existing handlers continue to work.

**R-68. Authentication of relayer calls to Verifier.** The relayer signs every transaction natively (ECDSA on Sepolia, secp256k1 on Neutron). The `Verifier` contract reads `msg.sender`, looks it up in `RelayerRegistry`, and rejects the call if:
  - the address is not registered, or
  - the relayer is in `Benched` or `Deregistered` state, or
  - this relayer is not the currently assigned submitter for this message's nonce (per `R-22`).

No JWT, no session tokens, no off-chain auth. Native chain signatures are stronger.

**R-69. Test token contracts (`tUSDC`).** Deploy a custom ERC20 on Sepolia and a custom CW20-equivalent on Neutron. Both:
  - Standard transferable token (18 decimals on Sepolia, 6 on Neutron — match each chain's USDC convention).
  - Public `claim(address, amount)` function gated by a per-address rate limit (max 1000 tUSDC per address per 24 hours).
  - Owned by the deployer; admin can mint additional supply if needed for demo.

**R-70 to R-79.** Reserved for additional contract requirements that emerge during Phase 1/2.

## 1.8 Off-chain service requirements

**R-80. Plugin interface (Go).** Every chain plugin implements:

```go
type ChainPlugin interface {
    ChainID() string
    ChainType() ChainType  // EVM | Tendermint | other

    // Read side
    FetchBlockFingerprint(ctx, height uint64) (Fingerprint, error)
    FetchProof(ctx, txHash []byte, eventIdx uint, proofKind ProofKind) (RawProof, error)
    VerifyConsensus(ctx, blockHeader []byte, validatorSet []byte) error

    // Translation side
    TranslateProofTo(rawProof RawProof, fingerprint Fingerprint, targetChainType ChainType) (CanonicalProof, Fingerprint, error)

    // Write side
    SubmitMessage(ctx, envelope MessageEnvelope, proof CanonicalProof, fingerprint Fingerprint, bondRef BondRef) (TxHash, error)
    SubmitChallenge(ctx, submissionId []byte, correctFingerprint Fingerprint, evidenceProof CanonicalProof) (TxHash, error)

    // Read-back
    SubscribeEvents(ctx, contractAddrs []string, fromBlock uint64) (<-chan Event, error)
    GetBondStatus(ctx, relayer string) (BondStatus, error)
    GetRelayerRegistry(ctx) ([]Relayer, error)
}
```

**R-81. Plugin implementations required for the hackathon.** Two plugins:
  - `EthereumPlugin` — handles Sepolia and any other EVM chain via configuration. Uses `go-ethereum` libraries.
  - `TendermintPlugin` — handles Neutron and any other Tendermint chain via configuration. Uses `cometbft` libraries.

**R-82. Single binary, multiple modes.** The Tessera service is one Go binary. Subcommands: `tessera relayer` (the main running mode), `tessera indexer` (populates Supabase from chain events for the dashboard), `tessera bond deposit/withdraw/topup`, `tessera fetch` (debugging tool — fetch + decode a proof manually), `tessera test-scenario <name>` (runs one of the four demo scenarios).

**R-83. Relayer behaviour loop.** The `tessera relayer` runs four concurrent goroutines:
  - **Source watcher × 2:** one per chain. Subscribes to bridge events.
  - **Submission handler:** for each event where this relayer is the assigned submitter (per `R-22`), executes the fetch → transform → submit pipeline.
  - **Challenge watcher:** for each *other* relayer's submission seen on either chain, independently re-fetches and re-transforms; on mismatch files dispute.
  - **Bond manager:** monitors own bond status, alerts operator if approaching operating threshold.

**R-84. State persistence.** All relayer state lives in Supabase (`R-110`):
  - `messages` table: lifecycle of every cross-chain message (created, submitted, finalized, challenged, executed, slashed).
  - `submissions` table: every relayer submission with status.
  - `disputes` table: every challenge filed.
  - `bonds` table: bond balances and threshold status, periodically synced from chain.
  - `events` table: raw chain events for the dashboard's event log.
  - `benchmark_runs` table: per `R-100` benchmark recording.

**R-85. Configuration format.** Single YAML file per relayer instance:

```yaml
relayer:
  identity:
    keypair_path: <path>           # encrypted file; never committed

chains:
  - name: sepolia
    plugin: ethereum
    rpc:
      primary: <PRIMARY_RPC>
      fallback: <FALLBACK_RPC>
    chain_id: 11155111
    contracts:
      verifier: <DEPLOYED_VERIFIER>
      bond: <DEPLOYED_BOND>
      registry: <DEPLOYED_REGISTRY>
      bridge_vault: <DEPLOYED_VAULT>
      bridge_mint: <DEPLOYED_MINT>
      tusdc: <DEPLOYED_TUSDC>
    bond_amount_initial: "500000000000000000"  # 0.5 ETH in wei

  - name: neutron
    plugin: tendermint
    rpc:
      primary: <PRIMARY_RPC>
      fallback: <FALLBACK_RPC>
    chain_id: pion-1
    contracts:
      verifier: <DEPLOYED_VERIFIER>
      # ... etc
    bond_amount_initial: "100000000"  # 100 NTRN

routes:
  - { from: sepolia, to: neutron, fee_bps: 10 }
  - { from: neutron, to: sepolia, fee_bps: 10 }

storage:
  supabase_url: <SUPABASE_URL>
  supabase_key: <SUPABASE_KEY>      # service-role key; from .env

operations:
  challenge_window_seconds: 60
  handover_period_seconds: 30
  source_confirmation_blocks_sepolia: 6
  source_confirmation_blocks_neutron: 2
```

**R-86. Indexer service.** Subscribes to bridge events on both chains via the same plugins. Writes to the same Supabase tables as the relayer. The dashboard frontend reads from Supabase via PostgREST API. The indexer is the single writer of dashboard data; relayers don't write dashboard data directly.

**R-87. Logging.** Structured logging from the start (use `slog` or `zap`). Every log line includes: timestamp, level, component, chain (if applicable), message ID (if applicable), tx hash (if applicable). Logs are written to stdout (for the hosting environment to capture) and to a rotating file in production.

**R-88. Error handling.** Errors are returned, not panicked. Wrap with `fmt.Errorf("...: %w", err)` to preserve the chain. Distinguish recoverable errors (RPC timeout, retry) from fatal errors (corrupt state, abort).

**R-89. Faucet exhaustion handling.** If a relayer's gas balance drops below a configured floor, log a critical warning and pause new submissions until topped up. Do not crash. This protects the demo from silent failures.

## 1.9 UI requirements (summary)

Full visual specification lives in Part 3. This section lists requirements; Part 3 specifies *how*.

**R-90.** All UI is built per the v2 mockup (`info/mockup/tessera-mockup-v2.jsx`, gitignored). The mockup is the source of truth for visual design.

**R-91.** Six top-level routes: `/` (Bridge — homepage), `/demo` (Demo Control Panel), `/dashboard` (System Dashboard), `/benchmark` (Benchmark page), `/docs` (Docs page). The Submission Detail view (`/submissions/[id]`) is internal-only — accessible only by clicking a row in the Dashboard.

**R-92.** Real-time updates are required on all numeric and status displays: bridge widget fees, system status strip, relayer cards, submission states, challenge window countdowns. Driven by Supabase realtime subscriptions or polling (every 5s minimum).

**R-93.** Every transaction hash, fingerprint, or address displayed in the UI must use the `CopyableHash` pattern: shows truncated value, has copy button, has explorer link button (Etherscan for Sepolia, Mintscan for Neutron testnet).

**R-94.** Wallet connect/disconnect UX: the top-right wallet button shows "Connect Wallet" (orange CTA) when no wallet is connected, and a connected pill with disconnect dropdown when connected. Both MetaMask (Sepolia) and Keplr (Neutron) must be connected for cross-chain actions.

**R-95.** Live transaction visualization (`UI-curvy-roadmap`) appears below the bridge widget on the homepage when a transaction is in flight. The curvy SVG path fills progressively (orange → emerald gradient) as each stage completes in real time.

**R-96.** Proof Inspector (`UI-proof-inspector`) is collapsed by default, expandable. Each stage row inside is independently expandable to reveal real cryptographic content (hashes, sizes, formats) with copy/explorer affordances.

**R-97.** The four demo scenarios must be triggerable from the Demo Control Panel via four scenario buttons. Each runs the corresponding hardcoded test script. The live event log streams real events as they occur. Relayer cards (Relayer A / Relayer B) display dynamic status badges reflecting current per-message role (`R-24`): Active · Submitting / Watching / Disputing, plus Benched / Deregistered / Cooling Down.

**R-98.** Responsive across mobile (320–640px), tablet (640–1024px), desktop (1024px+). Mobile uses hamburger nav. Tables overflow horizontally rather than wrapping.

**R-99.** The Docs page has a left sidebar (collapsible to dropdown on mobile) navigating between sections (Overview, What is Tessera, How it works, Trust model, Cryptography, Architecture, Demo scenarios, Run a relayer, Add a chain, Limitations & risks, Roadmap). Sections render as MDX. Animated transitions between sections (fade-up, ~400ms).

## 1.10 Performance & non-functional

**R-100.** **Benchmarks.** The system records per-run measurements to `benchmark_runs`: user-perceived latency (source-tx-confirmed → destination-tx-confirmed), source-side gas, destination-side gas, sub-step timings (proof fetch, transformation, submission, finalization). Used to populate the Benchmark page Tessera row with live data; falls back to seeded reference values when the table is empty.

**R-101.** **Latency targets.** User-perceived latency: 75–90 seconds end-to-end. Within that: source confirmation 12–60s (configurable depth), challenge window 60s, finalization + execution <5s. Total dominated by confirmation depth + challenge window.

**R-102.** **Gas budget.** Destination gas under 250k per message verification + execution. This includes proof verification (~120k), state writes (~50k), and application-level dispatch (~30–80k). Source gas (lock/burn): under 150k.

**R-103.** **Proof size budget.** Per `R-57`: under 2 KB on the wire. Patricia and IAVL proofs of typical depth fit comfortably.

**R-104.** **Throughput.** Single relayer can handle ≥1 message per 30 seconds in steady state. With 2 relayers running, system can handle ≥1 message per 15 seconds. Higher throughput requires multi-relayer scaling (out of scope, `R-122`).

**R-105.** **Persistence.** All operational state survives relayer restart. Restart recovery: relayer reads last-seen-block from Supabase and resumes watching from there. No state lives only in memory.

**R-106.** **Failure modes — RPC outages.** Each chain's plugin uses primary RPC with automatic failover to a fallback list. After 3 consecutive failures across all configured RPCs, the plugin enters degraded mode (logs critical, pauses new submissions).

**R-107.** **Failure modes — chain reorgs.** If a source-chain block is reorged after a relayer has fetched a proof but before submission, the proof becomes invalid. The relayer detects this by re-checking the block header before submission and aborts the submission if the header changed. Logged as a recoverable error.

**R-108.** **Wallet disconnect mid-flow.** If the user disconnects their wallet during a pending bridge transaction, the UI shows the in-flight tx as "monitoring" rather than "interactive" — the on-chain state continues, but the user must reconnect to see status updates or initiate new transactions.

**R-109.** **Determinism in tests.** All proof-transformation logic must have unit tests with fixed input fixtures and exact expected outputs. Tests fail loudly if outputs drift. This catches accidental changes to canonical encoding.

## 1.11 Hosting & deployment

**R-110.** **State storage: Supabase.** Supabase is the persistent state store. Free tier; Postgres-compatible. Schema: see `R-84`. Migrations managed by Supabase CLI.

**R-111.** **Frontend hosting: Vercel.** Free tier. Automatic deployments from main branch.

**R-112.** **Go service hosting.** Free tier with no card-required policy preferred. Primary candidate: Render free background workers. Alternates: Koyeb (one service per account, multiple accounts acceptable), Northflank, Oracle Cloud Free Tier, self-hosted via Cloudflare Tunnel from a local machine. Final selection deferred to early Phase 0; the Go services must be deployable to whichever is chosen without code changes.

**R-113.** **Contract deployment.** Sepolia testnet via Foundry scripts. Neutron testnet via `wasmd` CLI. Both contracts verified on their respective explorers (Etherscan for Sepolia, Neutron explorer / Mintscan for Neutron).

**R-114.** **No paid third-party services.** Per hackathon rules. Public RPCs, free-tier hosting, faucets, open-source libraries only.

## 1.12 Out of scope (explicit)

The following are **not** built for this hackathon. They are explicitly excluded so they cannot be silently added during the build.

**R-120.** Multi-relayer scaling beyond 2. The architecture supports it; the demo runs with exactly 2.

**R-121.** Race-condition handling for multi-relayer submission. With deterministic per-message rotation (`R-22`), this doesn't arise within the 2-relayer setup. Future work.

**R-122.** Sync committee verification for Sepolia source consensus. Phases 3–6 use RPC trust as a documented limitation. Future work integrates the beacon chain light client.

**R-123.** ZK proof generation. Tessera deliberately avoids this approach; not building it as a fallback.

**R-124.** Mainnet deployment. Testnet only.

**R-125.** Real USDC integration. Custom `tUSDC` per `R-69` only. No Circle API, no canonical bridges.

**R-126.** Additional source chains beyond Sepolia. Architecture supports plugins; only the Ethereum plugin ships.

**R-127.** Additional destination VMs beyond CosmWasm/Neutron. Architecture supports it; only the CosmWasm verifier ships.

**R-128.** Additional applications beyond the tUSDC bridge. NFT bridge, governance, generic message passing — future work.

**R-129.** Express relayers, value-aware challenge windows, periodic checkpointing mode, stake-weighted assignment. Future work.

---

# PART 2 — Build Plan

## 2.1 Engineering conventions

Apply consistently across the codebase. Junior-developer note: when in doubt, match the existing code in the repo. If the repo is empty (Phase 0), the conventions below are the starting point.

### 2.1.1 Repository layout

```
tessera/
├── README.md
├── SPEC.md                          # this document
├── CLAUDE.md                        # context for Claude Code
├── PROMPT_LOG.md                    # appended per-prompt
├── .gitignore                       # info/ goes here
├── info/                            # local-only working files (mockup, drafts)
│
├── contracts-evm/                   # Solidity contracts (Phase 1)
│   ├── foundry.toml
│   ├── src/
│   │   ├── RelayerRegistry.sol
│   │   ├── Verifier.sol
│   │   ├── Bond.sol
│   │   ├── BridgeVault.sol
│   │   ├── BridgeMint.sol
│   │   ├── TUSDC.sol
│   │   └── interfaces/
│   ├── test/
│   ├── script/                      # deployment scripts
│   └── lib/                         # forge dependencies
│
├── contracts-cosmwasm/              # Rust contracts (Phase 2)
│   ├── Cargo.toml
│   ├── relayer-registry/
│   ├── verifier/
│   ├── bond/
│   ├── bridge-vault/
│   ├── bridge-mint/
│   ├── tusdc/
│   └── packages/                    # shared types
│
├── relayer/                         # Go service (Phases 3–7)
│   ├── go.mod
│   ├── cmd/tessera/
│   │   └── main.go
│   ├── core/
│   │   ├── plugin.go                # ChainPlugin interface
│   │   ├── transform.go             # proof transformation
│   │   ├── relayer.go               # main relayer loop
│   │   ├── challenger.go            # challenge logic
│   │   └── indexer.go               # event indexer
│   ├── plugins/
│   │   ├── ethereum/
│   │   └── tendermint/
│   ├── storage/
│   │   └── supabase.go
│   ├── config/
│   └── testdata/
│
├── frontend/                        # Next.js (Phase 8)
│   ├── package.json
│   ├── app/
│   │   ├── page.tsx                 # /
│   │   ├── demo/
│   │   ├── dashboard/
│   │   ├── submissions/[id]/
│   │   ├── benchmark/
│   │   └── docs/
│   ├── components/
│   ├── lib/
│   │   ├── chain.ts                 # wagmi/viem + CosmJS setup
│   │   └── supabase.ts
│   └── public/
│
├── scripts/                         # build, deploy, smoke tests
│   ├── deploy-evm.sh
│   ├── deploy-cosmwasm.sh
│   ├── smoke-test.sh
│   └── scenarios/
│       ├── 01-honest.sh
│       ├── 02-lying.sh
│       ├── 03-silent.sh
│       └── 04-frivolous.sh
│
└── docs/                            # additional docs (audit reports, etc.)
```

### 2.1.2 Naming

- **Files:** `kebab-case.ts`, `kebab-case.go`, `kebab-case.sol` (one contract per file, file name matches contract name in PascalCase for Solidity: `RelayerRegistry.sol`).
- **Go packages:** lowercase, no underscores, single word where possible (`plugins/ethereum`, `core`).
- **Go types:** `PascalCase`. Go interfaces end in `-er` where natural (`ChainPlugin`, not `ChainPluginer` — this is a noun, not a verb-derived name; allowed).
- **Go constants:** `PascalCase` if exported, `camelCase` if package-private.
- **TypeScript types/components:** `PascalCase`. Hooks: `useThing`. Files: `kebab-case.tsx` for components, `camelCase.ts` for utilities.
- **Solidity:** contracts `PascalCase`, functions `camelCase`, events `PascalCase`, errors `PascalCase`. State variables: prefix internal/private with `_`.
- **Database tables:** `snake_case`, plural (`messages`, `submissions`, `disputes`).

### 2.1.3 Errors and panics

- **Go:** return errors; never panic in normal control flow. Wrap with `fmt.Errorf("doing X: %w", err)`. Use sentinel errors (`var ErrNotFound = errors.New(...)`) where callers need to distinguish cases.
- **Solidity:** use custom errors (`error InvalidProof()`) over `require` strings; cheaper gas, more structured.
- **CosmWasm:** typed errors via the `thiserror` crate.
- **TypeScript:** throw `Error` subclasses; use the `Result` pattern only where a non-throwing API is expressly needed.

### 2.1.4 Logging

- **Go:** `log/slog` with JSON handler in production, text handler in dev. Required fields per log line: `level`, `component`, `chain` (if applicable), `message_id` (if applicable), `tx_hash` (if applicable).
- **Frontend:** browser console for dev only; never log secrets. No production logging service.

### 2.1.5 Commits

- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`. Subject under 72 characters. Body wrapped at 72.
- **One logical change per commit.** Don't bundle a feature with unrelated cleanup.
- **Reference phase or requirement IDs in commit bodies** when applicable: `feat: implement Verifier.submitMessage (P-1, R-61)`.

### 2.1.6 Testing

- **Solidity:** Foundry. Every contract has a corresponding `*.t.sol` file. Cover happy path + every revert condition + edge cases. Run with `forge test -vvv` before considering anything done.
- **CosmWasm:** `cargo test` with `cw-multi-test`. Same coverage standard.
- **Go:** standard `testing` package. Table-driven tests for transformation logic. Mocked plugins for relayer-loop tests.
- **Integration:** the four demo scenarios in `scripts/scenarios/` double as the integration test suite. Each is a shell script that runs against deployed testnet contracts.
- **End-to-end smoke test:** runs against a deployed environment, makes one full bridge round-trip, asserts balances and slash counts.

### 2.1.7 Configuration and secrets

- **Never commit secrets.** `.env` is gitignored.
- **Per-environment config:** `config.dev.yaml`, `config.testnet.yaml`. Secret values reference environment variables; YAML stores only references.
- **Wallet keys:** stored encrypted on disk (operator-supplied passphrase) or in a secrets manager. Never plaintext in repo or in shell history.

## 2.2 Repository layout

See §2.1.1 above.

---

## 2.3 Phase 0 — Environment setup

**Phase ID:** P-0
**Goal:** Local dev environment is fully functional. CI for tests in place. CLAUDE.md drafted. PROMPT_LOG.md initialized. Smoke test stub running. RPC endpoints, faucets, Supabase project, hosting platform — all chosen and verified.
**Implements:** R-110, R-111, R-112, R-114; sets foundation for everything that follows.
**Depends on:** Nothing.

### 2.3.1 Tasks

1. **Repository init.** Create private repo `hackathon-2026-05-<your-name>` per hackathon rule. Add Ilan and Adnan as collaborators. Push initial commit with this `SPEC.md`, an empty `CLAUDE.md` placeholder, and a basic `.gitignore` (ignores `info/`, `.env`, `node_modules/`, `target/`, `out/`, `cache/`, `.DS_Store`).

2. **CLAUDE.md draft.** Write CLAUDE.md per the template in §4.2 of this document. Roughly 300 lines. Includes: project overview, anti-hallucination rules, conventions reference, prompt log discipline, current phase pointer.

3. **PROMPT_LOG.md initialization.** Create with the template at the top (per §4.2). First entry is the bootstrapping prompt that produced this SPEC.md.

4. **Toolchain installation.** Verify and document versions:
   - Foundry (latest stable): `forge --version`
   - Rust + cargo + cw-multi-test: `cargo --version`, target `wasm32-unknown-unknown`
   - Go (1.22+): `go version`
   - Node.js (20+) + pnpm: `node --version`, `pnpm --version`
   - `wasmd` CLI for Neutron deployment

5. **Supabase project setup.** Create free-tier project. Note URL and service-role key (in `.env`, never committed). Create initial schema migration (empty tables matching `R-84`). Verify connection from a tiny Go test program.

6. **Sepolia setup.** Acquire Alchemy or other Sepolia RPC (user-provided). Add to `.env`. Verify with a simple `eth_chainId` call. Acquire Sepolia ETH from faucet for one operator wallet (used for deploying contracts in Phase 5).

7. **Neutron setup.** Identify Neutron testnet (`pion-1`) public RPC endpoints. Add primary + fallback to `.env`. Verify with a simple ABCI query. Acquire NTRN from Neutron testnet faucet.

8. **Hosting platform decision.** Sign up for Render (or chosen alternative). Deploy a tiny "hello world" Go service. Confirm: it stays running, environment variables load, logs are accessible. **Do not skip this.** Validating the hosting target on day 1 prevents discovering on day 3 that the chosen platform doesn't fit.

9. **Smoke test stub.** Create `scripts/smoke-test.sh`. Initially, it just echoes "smoke test placeholder — phase TBD". As phases complete, append real checks. The smoke test runs every 30 minutes during build days (operator's responsibility) — it tells you which phase regressed if something breaks.

10. **CI setup (lightweight).** GitHub Actions workflow that runs `forge test`, `cargo test`, `go test ./...` on push. No deployment from CI. Failure blocks merge to main.

### 2.3.2 Success criteria

- [ ] Repo exists, collaborators added, initial commit pushed.
- [ ] CLAUDE.md present, ≥250 lines, includes anti-hallucination rules.
- [ ] PROMPT_LOG.md present with at least one entry.
- [ ] All tools installed and version-printed in a `versions.txt` committed at root.
- [ ] Supabase project created, schema migration applied, test connection passes.
- [ ] Sepolia RPC + faucet ETH both verified (`eth_blockNumber` succeeds, deployer wallet has ≥0.5 ETH).
- [ ] Neutron RPC + faucet NTRN both verified (ABCI query succeeds, deployer wallet has ≥200 NTRN).
- [ ] "Hello world" Go service deployed and reachable on chosen hosting.
- [ ] CI runs and passes (with no real tests yet).
- [ ] Smoke test stub committed.

### 2.3.3 What does NOT happen in this phase

- No contract code yet.
- No relayer code yet.
- No frontend code yet (mockup is reference, not production code).

---

## 2.4 Phase 1 — Solidity contracts (local-only)

**Phase ID:** P-1
**Goal:** All five Solidity contracts (`RelayerRegistry`, `Verifier`, `Bond`, `BridgeVault`, `BridgeMint`) plus `TUSDC` written and exhaustively tested with Foundry. No deployment to testnet yet. The `forge test` suite passes 100%.
**Implements:** R-60, R-61, R-62, R-63, R-64, R-65, R-66, R-67, R-68, R-69; partial R-41, R-42, R-43, R-44, R-45, R-46, R-47.
**Depends on:** P-0.

### 2.4.1 Tasks

1. **Foundry project init.** `forge init contracts-evm`. Configure `foundry.toml`: solc 0.8.24+, optimizer on with 200 runs, via_ir on, gas-snapshot enabled.

2. **Interfaces first.** Create `src/interfaces/`:
   - `IApp.sol` — the destination application contract interface (`R-65`). Single function: `onCrossChainMessage(bytes32 sourceChainId, bytes sourceApp, bytes4 action, bytes payload)`.
   - `IBond.sol`, `IRegistry.sol`, `IVerifier.sol`.

3. **`TUSDC.sol`.** ERC20 with `claim(amount)` rate-limited per-address (`R-69`). Test: rate limit enforced, transfers work, no broken edge cases.

4. **`RelayerRegistry.sol`.** Per `R-60`. Stores ordered list of relayers, manages state transitions (Active → Benched → Deregistered → CoolingDown → Active again on re-registration). `register`, `topUpBond`, `withdrawBond`, `rotateKey`, `recordSlash`. Tests: full state-transition coverage, key rotation with valid and invalid signatures, threshold computation correctness.

5. **`Bond.sol`.** Per `R-62`. Holds ETH on Sepolia. Tests: deposit, slash with various amounts and recipients, withdraw with cooldown enforcement, edge cases (slash amount > balance, double-slash, withdraw before cooldown).

6. **`Verifier.sol`.** Per `R-61`. Most complex contract.
   - `submitMessage`: stores submission with timestamp, opens window. Checks `RelayerRegistry` for: relayer is registered, in Active state, is the assigned submitter for this nonce per `R-22` rotation rule.
   - `challenge`: re-runs verification logic on challenger's evidence; on confirmed mismatch, calls `Bond.slash` to slash 50% to challenger.
   - `executeMessage`: lazy finalization (`R-61`). Anyone callable. Checks: window expired, not challenged. Runs proof verification (`R-50`) then dispatches to `destinationApp` per `R-65`.
   - `claimAbsenceSlash`: per `R-32`, `R-42`. Anyone callable after handover period.
   - **Proof verification (Patricia trie walk with Keccak-256).** This is the cryptographic core. Implement walking the proof, hashing nodes, comparing to stored root. Test against fixture proofs (fetch real `eth_getProof` output, save fixtures, assert verification correctness).

7. **`BridgeVault.sol`** (`R-63`) and **`BridgeMint.sol`** (`R-64`). Both implement `IApp`. `onlyVerifier` modifier on the `IApp` entry point per `R-66`. Tests: lock/release flow, mint/burn flow, `onlyVerifier` rejection of unauthorized callers, accounting correctness.

8. **End-to-end Foundry test.** Simulate a full Sepolia → Neutron lock → mint scenario *within Foundry* using mocked Neutron-side. The test deploys all contracts, has a user lock 100 tUSDC, manually constructs a valid proof bundle (Foundry can construct this via cheatcodes), submits to Verifier, advances time past challenge window, calls executeMessage, asserts vault state. Then reverse: simulate the Neutron-originated burn arriving on Sepolia, vault releases, asserts user balance restored.

9. **Gas snapshots.** `forge snapshot` to record current gas costs per function. Track over time so optimizations don't regress unmeasured.

### 2.4.2 Success criteria

- [ ] All six contracts compile cleanly with no warnings.
- [ ] `forge test -vvv` passes 100% with ≥80% line coverage.
- [ ] Gas snapshots committed.
- [ ] Slither (static analyzer) runs cleanly or all findings explicitly waived in `slither.config.json`.
- [ ] At least one end-to-end test simulates the full bridge lifecycle in Foundry.
- [ ] All four scenarios (`R-30` to `R-33`) have corresponding Foundry tests that pass.

### 2.4.3 What does NOT happen in this phase

- No deployment to Sepolia testnet (that's Phase 5).
- No interaction with real Neutron contracts (those don't exist yet — Phase 2).
- No Go code calling these contracts (that's Phase 3).

### 2.4.4 Pitfalls to avoid

- **Don't optimize gas prematurely.** Get correctness first, then snapshot, then optimize if budget violated (`R-102`).
- **Don't write your own RLP decoder.** Use `solidity-rlp` or equivalent maintained library.
- **Don't write your own Patricia trie walk.** Reference implementations exist (e.g., from `@eth-optimism/contracts` or `solidity-stringutils`). Adapt one; don't reinvent.
- **Test with real proofs.** Save fixtures from `eth_getProof` against known Sepolia state. Synthetic proofs hide encoding bugs.

---

## 2.5 Phase 2 — CosmWasm contracts (local-only)

**Phase ID:** P-2
**Goal:** CosmWasm equivalents of the six Solidity contracts written in Rust, exhaustively tested with `cw-multi-test`. The `cargo test` suite passes 100%.
**Implements:** R-60, R-61, R-62, R-63, R-64, R-65, R-66, R-67, R-68, R-69 (CosmWasm side); partial R-41 to R-47.
**Depends on:** P-1 (the Solidity contracts establish the canonical behaviour; CosmWasm mirrors it).

### 2.5.1 Tasks

1. **Workspace init.** `cargo new --lib contracts-cosmwasm`. Workspace with one crate per contract plus a shared `packages/` crate for types and proof-walking logic.

2. **Shared types crate (`packages/tessera-types/`).** Mirrors the message envelope (`R-67`), bond status enums, relayer state enums.

3. **`packages/tessera-proof/`.** The Patricia Merkle Trie walking logic (verifies proofs *transformed from Sepolia* in IAVL form per `R-50`) — this is the proof verification core for the CosmWasm Verifier. Use `alloy-rlp`, `cosmwasm-crypto::keccak_256`, hand-rolled Patricia walk. Test against fixtures.

4. **Contract crates.** One per: `relayer-registry`, `verifier`, `bond`, `bridge-vault`, `bridge-mint`, `tusdc`. Each follows standard CosmWasm structure: `msg.rs` (ExecuteMsg, QueryMsg, InstantiateMsg), `state.rs` (storage), `execute.rs` (handlers), `query.rs`, `error.rs`, `contract.rs` (entry points).

5. **Test with `cw-multi-test`.** Multi-contract integration tests in a simulated chain: deploy all contracts, run the full bridge lifecycle scenarios (`R-30` to `R-33`) entirely in-memory.

6. **Schema generation.** `cargo schema` for each contract — generates JSON schemas for ExecuteMsg/QueryMsg used by the frontend's CosmJS bindings later.

### 2.5.2 Success criteria

- [ ] All six contracts compile to `wasm32-unknown-unknown` with no warnings.
- [ ] `cargo test` passes 100% with full multi-contract integration coverage.
- [ ] Each contract's wasm size is under 800 KB (CosmWasm hard cap is around that; smaller is better for gas).
- [ ] All four scenarios (`R-30` to `R-33`) have corresponding `cw-multi-test` integration tests that pass.
- [ ] Schemas generated and committed.

### 2.5.3 What does NOT happen

- No deployment to Neutron testnet yet (Phase 5).
- No Go code calling these contracts yet (Phase 3 builds the plugin; integration in Phase 6).

### 2.5.4 Pitfalls

- **Don't reinvent IAVL.** Use the `ics23` crate for IAVL proof verification (this is what's used when verifying Cosmos *native* proofs — different from the Patricia walk used for verifying transformed Sepolia proofs).
- **Address bech32 encoding.** Neutron uses `neutron1...` prefix. Use `cosmwasm-std::Addr` and don't fight the encoding.
- **Gas in CosmWasm is computed differently.** Don't try to map Solidity gas budgets directly; benchmark CosmWasm separately.

---

## 2.6 Phase 3 — Go relayer skeleton + chain plugins

**Phase ID:** P-3
**Goal:** The Tessera Go service is initialized as a single binary with the plugin interface (`R-80`), and both `EthereumPlugin` and `TendermintPlugin` are implemented to the point where they can fetch raw proofs and decode them locally. No on-chain submission. No cross-chain transformation yet.
**Implements:** R-80, R-81, R-82, R-83 (skeleton only — not the full loop), R-84 (initial schemas), R-85, R-86 (skeleton), R-87, R-88.
**Depends on:** P-0 (env), P-1 and P-2 (contract ABIs/schemas exist for plugin to know what to call against).

### 2.6.1 Tasks

1. **Module init.** `go mod init github.com/<you>/tessera/relayer`. Add `cobra` for CLI, `viper` for config, `slog` for logging, `pgx` for Postgres (Supabase).

2. **CLI structure with cobra.** `tessera relayer`, `tessera indexer`, `tessera bond`, `tessera fetch`. Each subcommand stub, returns a "not implemented" message.

3. **Config loader.** Parse the YAML schema in `R-85`. Use viper. Validate required fields on startup.

4. **`core/plugin.go`.** Define `ChainPlugin` interface per `R-80` exactly. Plus shared types: `MessageEnvelope`, `Fingerprint`, `RawProof`, `CanonicalProof`, `BondStatus`, `Event`, `Relayer`.

5. **`plugins/ethereum/`.** Implement `ChainPlugin`:
   - Use `go-ethereum/ethclient` for RPC.
   - `FetchBlockFingerprint`: call `eth_getBlockByNumber`, extract `stateRoot`.
   - `FetchProof`: call `eth_getProof`, decode result.
   - `VerifyConsensus`: stubbed to "trust RPC" with a logged warning per `R-54` (sync committee integration is `R-122`, future work). Document this clearly in the function header.
   - `SubscribeEvents`: subscribe via WebSocket; fall back to polling if WS unavailable.
   - `GetBondStatus`, `GetRelayerRegistry`: read from deployed contracts (placeholder — actual contract addresses come in Phase 5).
   - `TranslateProofTo`: stubbed; full implementation in Phase 4.
   - `SubmitMessage`, `SubmitChallenge`: stubbed; full implementation in Phase 6.

6. **`plugins/tendermint/`.** Implement `ChainPlugin`:
   - Use `cometbft/rpc/client` for RPC.
   - `FetchBlockFingerprint`: query block at height, extract `AppHash`.
   - `FetchProof`: ABCI query with `prove=true`, decode IAVL proof.
   - `VerifyConsensus`: full Ed25519 verification per `R-55`. Use `cometbft/types` light client primitives. Validate 2/3+ signatures over block header. **This is the Ed25519 bypass; this code is the load-bearing part of Tessera's claim.** Heavy unit testing required.
   - Other functions stubbed analogously.
   - `TranslateProofTo`: stubbed.

7. **Storage layer.** `storage/supabase.go`. Implement insert/select for `messages`, `submissions`, `events`, `bonds`, `benchmark_runs`. Wrap with Go interfaces so plugins can use a mock during tests.

8. **`tessera fetch` debugging command.** Given `--chain sepolia --block N --tx T`, fetches and prints the proof bundle for that transaction. Prints: block fingerprint, proof bytes (hex), parsed proof structure. Used for manual verification of plugin correctness.

9. **Unit tests.** Per plugin: tests for fingerprint extraction, proof decoding (using saved fixtures from real chains), consensus verification. Mock the chain RPC; use real proof fixtures.

### 2.6.2 Success criteria

- [ ] `go build ./...` succeeds.
- [ ] `go test ./...` passes with both plugins exercised against fixture data.
- [ ] `tessera fetch --chain sepolia --block <real-block> --tx <real-tx>` outputs a parsed proof.
- [ ] `tessera fetch --chain neutron --block <real-block> --tx <real-tx>` outputs a parsed proof.
- [ ] Tendermint Ed25519 signature verification has tests with at least one negative case (forged signature is rejected).
- [ ] Logging is structured; every line includes component, chain, message_id where applicable.

### 2.6.3 What does NOT happen

- No transformation between formats yet (Phase 4).
- No on-chain submission (Phase 6).
- No frontend yet (Phase 8).

### 2.6.4 Pitfalls

- **`eth_getProof` returns RLP-encoded nodes that need decoding before they're useful.** Don't try to use them as-is.
- **CometBFT's API has changed across versions.** Pin a specific version compatible with Neutron's chain. Document the version.
- **The plugin interface is a public contract; changing it later is expensive.** Get it right in this phase.

---

## 2.7 Phase 4 — Translation layer (both directions)

**Phase ID:** P-4
**Goal:** The deterministic proof transformation per `R-50` and `R-51` is implemented, with byte-identical output across runs. Tested against fixture data.
**Implements:** R-50, R-51, R-52, R-53, R-56, R-58, R-109.
**Depends on:** P-3.

### 2.7.1 Tasks

1. **`core/transform.go`.** Two functions:
   - `TransformPatriciaToIAVL(patriciaProof, sepoliaStateRoot) (iavlProof, transformedRoot)`
   - `TransformIAVLToPatricia(iavlProof, neutronAppHash) (patriciaProof, transformedRoot)`
   Both deterministic, both pure functions (no I/O), both extensively tested.

2. **Algorithm specifics.** Document and implement carefully:
   - **Patricia → IAVL.** Walk the Patricia proof. For each node: re-encode (Protobuf), re-hash (SHA-256 instead of Keccak-256), preserve sibling positions. Build new tree bottom-up. The leaf value is unchanged (it commits to the same logical claim). The transformed root is the SHA-256 of the rebuilt structure.
   - **IAVL → Patricia.** Same in reverse. Walk IAVL proof, re-encode (RLP), re-hash (Keccak-256), preserve positions, rebuild tree, take Keccak-256 of root.

3. **Test fixtures.** Save real proofs from real testnet transactions (multiple — different storage slots, different tree depths, edge cases like empty subtrees). For each, hand-compute (or compute with a reference implementation) the expected transformed proof and root. Commit these as test fixtures.

4. **Determinism tests.** Run the same transformation 100 times on the same input; assert byte-identical output every time.

5. **Cross-implementation parity.** Both relayer and challenger code paths use the *same* transformation function. Verify in tests that both call sites produce identical results.

6. **Plugin integration.** Update `plugins/ethereum/TranslateProofTo` and `plugins/tendermint/TranslateProofTo` to call the new transformation functions.

7. **`tessera fetch --transform` flag.** Extends the fetch command to also produce the transformed proof, outputting the transformed root and a byte count. Used for manual end-to-end verification.

### 2.7.2 Success criteria

- [ ] Both transformation functions implemented and pure.
- [ ] Test suite includes ≥10 fixture-based test cases per direction with hand-verified expected outputs.
- [ ] Determinism tests pass (100x identical output).
- [ ] `tessera fetch --transform` produces a transformed proof for a real Sepolia transaction.
- [ ] `tessera fetch --transform` produces a transformed proof for a real Neutron transaction.
- [ ] When the transformed proof is fed (via Foundry test for Sepolia, `cw-multi-test` for Neutron) into the destination Verifier contract from Phase 1/2, verification succeeds.

### 2.7.3 What does NOT happen

- No live submission to deployed contracts yet (those don't exist on testnet until Phase 5).
- No frontend changes.

### 2.7.4 Pitfalls

- **Endianness.** Hash inputs are byte arrays; getting endianness wrong silently produces a different root.
- **Canonical encoding.** RLP and Protobuf both have multiple ways to encode the same logical value. Pick canonical encoding and document it. Otherwise, two honest parties produce different transformed roots and the system mistakes them for fraud.
- **Empty subtree handling.** Both Patricia and IAVL have specific representations for empty children. Easy to get wrong.

---

## 2.8 Phase 5 — Testnet deployment + verification

**Phase ID:** P-5
**Goal:** All Solidity contracts deployed to Sepolia and verified on Etherscan. All CosmWasm contracts deployed to Neutron testnet and verified on the Neutron explorer. Contract addresses captured in config files.
**Implements:** R-113.
**Depends on:** P-1, P-2, P-3, P-4 all passing locally.

### 2.8.1 Tasks

1. **Deploy Sepolia contracts.** Foundry script: deploys `TUSDC`, `RelayerRegistry`, `Bond`, `Verifier`, `BridgeVault`, `BridgeMint` in dependency order. Outputs addresses to `deployments/sepolia.json`.

2. **Verify on Etherscan.** Use Etherscan API key (user-provided). `forge verify-contract` for each. Confirm each address shows verified source.

3. **Deploy Neutron contracts.** `wasmd tx wasm store` then `instantiate` for each. Outputs addresses to `deployments/neutron.json`.

4. **Verify on Neutron explorer.** Find a free verification API for the Neutron testnet explorer (or upload schemas + compiled wasm if explorer supports source verification).

5. **Wire deployments into config.** Update `config.testnet.yaml` with all six addresses per chain.

6. **Smoke test deployment.** Run a small read-only call against each deployed contract from the Go service to verify connectivity end-to-end. Update `scripts/smoke-test.sh` to include these checks.

7. **Initial test token mint.** Mint a supply of tUSDC on each chain to the deployer wallet for use in subsequent phases.

### 2.8.2 Success criteria

- [ ] All 12 contract addresses captured in `deployments/*.json`.
- [ ] All Sepolia contracts show "verified" on Etherscan.
- [ ] All Neutron contracts show "verified" on the Neutron explorer (or equivalent confirmation).
- [ ] `tessera fetch` reads from each contract successfully (`getRelayerRegistry`, `getBondStatus` succeed).
- [ ] Smoke test script exits 0.

### 2.8.3 Pitfalls

- **Don't redeploy contracts unnecessarily.** Each redeployment burns gas and changes addresses everywhere. Deploy once per phase carefully.
- **Bytecode mismatch on verification.** If solc settings differ between local compilation and deployment, Etherscan rejects verification. Pin solc version in `foundry.toml`.

---

## 2.9 Phase 6 — Relayer registration + end-to-end honest path

**Phase ID:** P-6
**Goal:** Two relayer instances are running (locally or on chosen hosting), both registered on both chain registries, both bonded. A user-initiated lock on Sepolia results in a successful mint on Neutron. The reverse direction also works. Only the honest path (`R-30`); other scenarios are Phase 7.
**Implements:** R-21, R-22, R-26, R-27, R-29, R-44, R-83 (full), R-86, R-89, R-105.
**Depends on:** P-5.

### 2.9.1 Tasks

1. **Generate two operator keypairs.** Use `cast wallet new` (Foundry) or any standard generator. Two keys, each derives one Sepolia address and one Neutron address. Fund all four addresses from faucets to gas-floor levels (~0.1 ETH, ~20 NTRN per address for gas).

2. **`tessera bond deposit` implementation.** Deposits the configured initial bond into `Bond` contract on each chain. Per relayer.

3. **`tessera relayer register` implementation.** Registers in `RelayerRegistry`, linking to deposited bond. Per relayer.

4. **Run two relayer instances.** Each with its own config file (different keypair, different storage state, optionally different hosting account). Both subscribe to events on both chains.

5. **Implement the honest submission flow.** When a Sepolia `Locked` event is observed, the assigned relayer (per `R-22`) fetches proof, transforms it, submits to Neutron `Verifier`. Tracks state in Supabase. Calls `executeMessage` after window closes. Logs every step with structured fields.

6. **Implement the watcher/challenger logic** (but not yet the dispute filing — that's Phase 7). Each relayer independently re-fetches proofs for *other* relayers' submissions and verifies them. On match: log "verified, standing down." This proves the watching loop works without yet exercising the slashing path.

7. **End-to-end test.** Manually trigger one bridge transfer in each direction. Verify on explorers. Verify Supabase records the full lifecycle. Verify the Dashboard data is queryable (frontend doesn't exist yet but Supabase queries do).

### 2.9.2 Success criteria

- [ ] Two relayers registered in `RelayerRegistry` on both chains.
- [ ] Both relayers have bonds at the initial threshold on both chains.
- [ ] One full Sepolia → Neutron bridge transfer succeeds end-to-end with on-explorer evidence.
- [ ] One full Neutron → Sepolia bridge transfer succeeds end-to-end with on-explorer evidence.
- [ ] Supabase contains the full message lifecycle records for both transfers.
- [ ] User-perceived latency measured between 75–120s; if outside this band, investigate (`R-101`).
- [ ] Smoke test extended with bridge-transfer assertion.

### 2.9.3 Pitfalls

- **Nonce management on Sepolia.** If both relayers send transactions concurrently from the same wallet, nonce collisions occur. Each relayer's wallet is its own; this only matters within one relayer's own transactions.
- **Eventual consistency on Supabase.** A successful insert may take a few hundred ms to be readable. The frontend handles this; the relayer logic should not depend on its own writes being immediately readable in the same transaction.

---

## 2.10 Phase 7 — Challenger logic + 4 demo scenarios

**Phase ID:** P-7
**Goal:** All four demo scenarios (`R-30` to `R-33`) implemented and passing as integration tests against deployed testnet contracts. Each is a hardcoded test script in `scripts/scenarios/`.
**Implements:** R-23, R-24, R-25, R-30, R-31, R-32, R-33, R-34, R-41, R-42, R-43, R-46, R-48, R-53.
**Depends on:** P-6.

### 2.10.1 Tasks

1. **Implement dispute filing.** When a relayer's challenger goroutine detects a transformation mismatch, it constructs the dispute evidence (the original source proof) and calls `Verifier.challenge`. Tracked in Supabase `disputes` table.

2. **Implement absence claim.** When a handover period passes without the assigned submitter acting, any other relayer can call `Verifier.claimAbsenceSlash` (or `Bond.slash` directly via the appropriate function).

3. **Implement frivolous-challenge defense.** The dispute resolution logic in the contract: when a challenge is filed, the contract verifies whether the challenger's evidence is correct. If yes, slash submitter. If no (challenger lied), slash challenger. This should be in Phase 1's Verifier; this phase exercises it from the relayer side.

4. **Scenario script: `01-honest.sh`.** Triggers a normal bridge transfer; expects clean settlement. Asserts: balances correct, no slashes, fee paid to assigned submitter.

5. **Scenario script: `02-lying.sh`.** Configures the assigned submitter (read at runtime per `R-25`) to inject a wrong fingerprint via an admin endpoint. Triggers transfer. Expects: challenger detects, files dispute, submitter bond reduced 50%, challenger receives slashed amount, message reverts, user balance restored.

6. **Scenario script: `03-silent.sh`.** Configures the assigned submitter to drop the message (admin endpoint pauses submission for one nonce). Triggers transfer. Expects: handover after 30s, alternate relayer submits, message executes, original submitter slashed 50% for absence, alternate submitter receives both fee and slash reward.

7. **Scenario script: `04-frivolous.sh`.** Configures the watching relayer to file a baseless challenge against a valid submission (admin endpoint forces a wrong-evidence dispute). Expects: dispute resolution rejects challenge, challenger bond slashed 25%, original submitter receives slashed amount, message executes normally, user receives bridged tokens.

8. **Admin endpoints on relayer.** Small HTTP API on each relayer (gated, only enabled when `--admin` flag is set) for triggering scenarios:
   - `POST /admin/inject-fault?type=wrong_fingerprint&duration=1`
   - `POST /admin/go_silent?nonces=1`
   - `POST /admin/file_invalid_challenge?against_submission_id=N`

   These are demo plumbing; they don't affect the relayer's normal operation.

9. **Dynamic role detection in scripts** (`R-25`). Each script reads on-chain state at start time to determine which physical relayer (A or B) is currently the assigned submitter for the next message, then targets admin commands at the correct relayer. No hardcoded "Relayer A is the submitter."

10. **Integration test harness.** A single command (`make integration-test` or `scripts/test-all-scenarios.sh`) runs all four scenarios sequentially, captures results, asserts state correctness against on-chain truth and Supabase records.

### 2.10.2 Success criteria

- [ ] All four scenario scripts run individually and pass.
- [ ] All four scenarios run consecutively (`test-all-scenarios.sh`) and pass.
- [ ] After running scenario 2 twice, the offending relayer's bond drops below the operating threshold and they're benched (visible in registry status).
- [ ] After running scenario 2 three times, the offending relayer is deregistered and a cooldown timer starts.
- [ ] On-chain explorers show the slash transactions clearly attributable to each scenario.
- [ ] Supabase `disputes` table records every dispute and its outcome.

### 2.10.3 Pitfalls

- **Bond exhaustion mid-test.** If you run scenario 2 too many times, the relayer becomes deregistered and subsequent tests can't use them. Reset between test runs or refund bonds.
- **Time-based logic.** Challenge windows and handover periods rely on chain timestamps. Don't rely on local clock; the chain's `block.timestamp` is the source of truth.
- **Race conditions in admin endpoints.** Don't allow two admin commands targeting the same nonce simultaneously.

---

## 2.11 Phase 8 — Frontend mapped to real data

**Phase ID:** P-8
**Goal:** The Next.js frontend (modeled on the v2 mockup, `info/mockup/tessera-mockup-v2.jsx`) is built with real data sources (Supabase via PostgREST/realtime; on-chain reads via wagmi/viem and CosmJS). All six pages are functional. All real-time updates work. Wallet connect/disconnect work. The four scenarios are observable from the frontend in real time.
**Implements:** R-13, R-15, R-19, R-90 through R-99, plus all UI sub-requirements in Part 3.
**Depends on:** P-7 (real data exists). Visual reference: v2 mockup.

### 2.11.1 Tasks

1. **Next.js init.** `pnpm create next-app frontend` (App Router, TypeScript, Tailwind). Add `shadcn/ui`, `wagmi`, `viem`, `@cosmjs/stargate`, `@cosmjs/cosmwasm-stargate`, `@keplr-wallet/cosmos`, `@supabase/supabase-js`.

2. **Foundation layer.** Implement the design tokens from Part 3 §3.1 (typography, colour, motion). Set up the chain config for wagmi (Sepolia) and CosmJS (Neutron). Set up Supabase client with realtime subscriptions.

3. **Wallet connection.** MetaMask + Keplr both via the WalletButton component (Part 3 §3.2). Connect / disconnect / switch / show balances on both chains.

4. **Homepage.** Per Part 3 §3.3. Centered hero, side-by-side bridge widget on desktop, stacked on mobile. Live system status strip with real numbers from Supabase. 2×3 differentiator grid. No "how it compares" teaser (moved to benchmark page only per locked spec).

5. **Bridge widget.** Per Part 3 §3.3.2. Chain selectors, amount input, real balance reads from chain via wagmi/CosmJS, real-time fee estimation, real-time gas estimation, real recipient validation. Bridge button triggers the actual lock transaction.

6. **Live transaction section** (`UI-curvy-roadmap`, `UI-proof-inspector`). Per Part 3 §3.4. Appears below bridge when a transaction is in flight. Real-time progress driven by Supabase subscriptions on the `messages` table. Curvy SVG path fills as stages complete. Proof Inspector entries pull real cryptographic data from the indexer.

7. **Demo Control Panel.** Per Part 3 §3.5. Two relayer cards with real bond balances (read from chain), dynamic status badges driven by current activity (read from Supabase), four scenario buttons (each triggers the corresponding script via a backend endpoint), live event log streaming from Supabase.

8. **System Dashboard.** Per Part 3 §3.6. Top metrics from aggregated Supabase queries. Active relayers table. Recent submissions table (5 most recent with "View all" button — per locked spec). Every hash uses `CopyableHash`.

9. **Submission Detail.** Per Part 3 §3.7. Internal-only route (`/submissions/[id]`). Renders full metadata + Cryptographic Roadmap section. Every hash copyable + explorer-linkable.

10. **Benchmark page.** Per Part 3 §3.8. Comparison table with Tessera row served live from `benchmark_runs` (or seeded reference fallback when empty). Other rows from seeded JSON. Limitations / Risks / Future Work in the bold treatment per locked spec.

11. **Docs page.** Per Part 3 §3.9. Sidebar with all sections. MDX-rendered content. Each section's icon and animations per spec.

12. **Test token claim.** A small Claim button or banner when connected wallet has zero tUSDC. Calls the public `claim` function on `TUSDC` contracts.

13. **Responsive testing.** Verify all pages at mobile (375px), tablet (768px), desktop (1280px) breakpoints. Tables scroll, sidebar collapses, hero stacks.

14. **End-to-end frontend test.** Connect wallets, claim tokens, bridge 100 tUSDC, watch the lifecycle progress in the UI live, see balance update on destination chain, navigate to dashboard, click the recent submission, see the detail page render correctly with copyable hashes.

### 2.11.2 Success criteria

- [ ] Frontend deployed to Vercel and reachable from public internet.
- [ ] All six pages render without errors at all three responsive breakpoints.
- [ ] Wallet connect/disconnect works for both MetaMask and Keplr.
- [ ] User can claim tUSDC, lock 100 tUSDC, watch the lifecycle, see the mint complete on Neutron, all from the UI.
- [ ] Demo Control Panel can trigger all four scenarios with visible live updates.
- [ ] Every displayed hash copies correctly and links to the right explorer.
- [ ] Realtime subscriptions update without manual refresh.

### 2.11.3 Pitfalls

- **Hydration errors.** Next.js App Router + wallet libraries can cause hydration mismatches. Use `'use client'` boundaries carefully.
- **Keplr CosmWasm calls require enabling experimental chain.** Document the chain-config registration in the wallet connect flow.
- **Supabase realtime row-level security.** Default RLS may block reads. Configure policies carefully so the frontend can read public dashboard data without leaking secrets.

---

## 2.12 Phase 9 — Audit pass (gating)

**Phase ID:** P-9
**Goal:** A multi-perspective review surfaces gaps. All findings are triaged, P0/P1 fixed, P2 either fixed or explicitly accepted. This phase is gating: documentation (Phase 10) does not start until this phase reaches 99% pass with operator sign-off.
**Implements:** Validates all prior requirements; produces audit report.
**Depends on:** P-8.

### 2.12.1 Tasks

1. **Adversarial / security review.** Review the contract suite, the bond/slash logic, and the dispute resolution paths from an attacker's perspective. Consider: reentrancy, integer overflow, malformed proof inputs, race conditions in challenge windows, replay attacks on rotated keys, denial-of-service via bond depletion, sybil registration, edge cases in handover.

2. **Production-readiness review.** Review from an operational perspective: missing logs, unhandled error paths, RPC failure modes, faucet exhaustion handling, restart recovery, secret management, monitoring gaps.

3. **User experience review.** Review the frontend: confusing states (e.g., transaction in progress with disconnected wallet), missing error messages, broken affordances, unclear scenario semantics, mobile-specific layout issues.

4. **For each finding:** assign severity (P0 = blocks demo / breaks safety; P1 = serious bug; P2 = quality issue). Log in `docs/audit-findings.md`. P0 and P1 must be fixed in this phase before exit.

5. **Re-run the four scenario scripts after fixes.** Confirm no regressions.

6. **Re-run the smoke test.** Should pass.

### 2.12.2 Success criteria

- [ ] `docs/audit-findings.md` exists with all findings logged.
- [ ] Zero P0 findings open.
- [ ] Zero P1 findings open.
- [ ] All four scenarios pass after fixes.
- [ ] Operator (you) signs off in the audit findings doc.

### 2.12.3 Pitfalls

- **Don't skip P2 findings unconditionally.** Some are quick wins; fixing them is faster than documenting why they're acceptable.
- **The temptation to "just ship" after the audit reveals real bugs.** The audit is the protection against shipping a broken bridge. Take the findings seriously.

---

## 2.13 Phase 10 — Polish, recording, final docs

**Phase ID:** P-10
**Goal:** Hackathon submission ready. Demo recorded. All required artifacts in place per `R-114` and §4.1.
**Implements:** All documentation requirements.
**Depends on:** P-9.

### 2.13.1 Tasks

1. **Notion documentation.** Single comprehensive page covering: PM brief, architecture overview, technical decisions, post-hackathon roadmap. Mirrors the in-app docs at depth + adds research-paper-level commentary.

2. **In-app docs MDX.** Render the in-app `/docs` content from MDX files in `frontend/content/docs/`. Each section per Part 3 §3.9.

3. **README.md.** Top-level repo readme: project description, how to run, how to test, links to live demo, link to Notion docs, contributors.

4. **Cost log.** Tally daily spend per hackathon rule. Format: `docs/cost-log.md`.

5. **Prompt log curation.** From `PROMPT_LOG.md`, select 5 best + 3 worst prompts per hackathon submission rule. Annotate why each is in its category. Save as `docs/prompt-log-highlights.md`.

6. **1-page reflection.** What worked, what didn't, what you'd do differently. `docs/reflection.md`.

7. **Demo recording.** 5–10 minute video walking through all four scenarios + the live system. Upload to a stable URL.

8. **Form 2 submission.** All artifacts checked in, GitHub repo accessible, live URL working, Notion page shareable.

9. **Final smoke test.** End-to-end fresh user flow: open the deployed site, connect wallets, claim tokens, bridge, observe, all works.

### 2.13.2 Success criteria

- [ ] Notion documentation comprehensive and shareable.
- [ ] In-app docs render correctly at all breakpoints.
- [ ] README.md complete.
- [ ] Cost log shows total spend; under hackathon hard cap.
- [ ] PROMPT_LOG.md highlights selected.
- [ ] Reflection written.
- [ ] Demo video recorded and accessible.
- [ ] Form 2 submitted with all required fields.
- [ ] Smoke test passes against the deployed system.

---

# PART 3 — UI Specification

This part specifies the visual and interaction details. Source of truth: v2 mockup at `info/mockup/tessera-mockup-v2.jsx`. When this spec and the mockup disagree, the spec is authoritative — but flag the disagreement so the spec can be updated.

## 3.1 Foundations

**3.1.1 Typography.**
- Display (headlines, hero, page titles): **Instrument Serif** (Google Fonts).
- UI body (paragraphs, buttons, form labels): system sans (`font-sans` Tailwind default).
- Monospace (hashes, addresses, hex data, log timestamps, code): system mono (`font-mono` Tailwind default).

**3.1.2 Colour.**
- Background base: `stone-950` (#0c0a09).
- Card surfaces: `stone-900/60`.
- Subtle borders: `stone-800`.
- Primary text: `stone-100`.
- Muted text: `stone-400`.
- Very muted: `stone-500`.
- **Accent: `orange-400` (#fb923c).** Used sparingly — for the brand mark, primary CTAs, active states, key highlights. Never as a default fill colour.
- Functional: `emerald-400` (success), `amber-400` (warning), `red-400` (error/danger).

**3.1.3 Motion.**
- Default transition: 150ms ease.
- Path animations (curvy roadmap fill): 800ms cubic-bezier(0.4, 0, 0.2, 1).
- Page transitions: 400ms fade-up.
- Pulse rings: 2s infinite.
- Card tilt on hover: subtle perspective + rotateX/Y, 400ms ease.
- All animations CSS-only where possible; no heavy animation libraries.

## 3.2 Navigation & wallet connect

**3.2.1 Top nav.** Sticky, semi-transparent backdrop blur over `stone-950/80`. Height 56px desktop. Contains: brand mark (Tessera logo + name), nav links, network indicator (small mono text "SEPOLIA · NEUTRON"), wallet button.

**3.2.2 Brand mark.** Four-square mosaic tile pattern (2×2 grid, 2 cells filled, 2 muted) in `orange-400`, with "Tessera" in Instrument Serif beside it.

**3.2.3 Nav links.** "Bridge" (home), "Demo", "Dashboard", "Benchmark", "Docs". Active link: `stone-100` text on `stone-800/60` background. Inactive: `stone-400`. Hover: `stone-200`.

**3.2.4 Wallet button (`UI-wallet-button`).** Two states:
  - **Disconnected.** Orange CTA: "Connect Wallet" with wallet icon. Click → connect dialog (MetaMask + Keplr options).
  - **Connected.** Pill showing first/last 4 of address with green dot and chevron. Click → dropdown with: connected wallets list (MetaMask · Sepolia / Keplr · Neutron, each with copyable address), "Switch wallet" action, "Disconnect" action (red text).

**3.2.5 Mobile nav.** Hamburger menu on screens < 768px. Drops down a vertical list of nav links. Wallet button visible always.

## 3.3 Homepage

**3.3.1 Hero.** Centered, full-width layout. From top:
  - Decorative line + uppercase mono label: "Trust-minimized cross-chain"
  - Display headline (~80px on desktop, ~48px mobile): "Bridge between two worlds **without a middleman.**" — second line italicized in `orange-400`.
  - Body paragraph (~18px): the project description.
  - Animated entrance: each element fades up with 100ms staggered delay.

**3.3.2 Bridge widget (`UI-bridge-widget`).** Centered below hero, with decorative pills on either side at desktop width. Width: 24rem (384px) on desktop; full-width with margin on mobile.
  - Header: "BRIDGE" mono label + slippage indicator.
  - From panel: chain selector (Sepolia / Neutron), balance display, amount input (large display-serif font), token symbol.
  - Swap-direction button (small square, between panels).
  - To panel: same structure mirrored. Recipient address auto-fills user's destination wallet.
  - Live stats grid (2×2): estimated time, challenge window, relayer fee, network gas. All values served from indexer/chain reads, real-time.
  - Primary CTA: "Bridge {amount} tUSDC". Disabled when wallets not connected, balance insufficient, or in-flight transaction exists.

**3.3.3 Side pills.** Three on each side of the bridge widget, only on desktop (`lg:flex`). Each: small icon + short label ("No trusted committee", "Permissionless", etc.). Subtle borders, decorative.

**3.3.4 Differentiators grid.** Below hero. 2 columns × 3 rows on desktop, 1 column on mobile.
  - Each card: icon tile (orange tinted), uppercase mono tag (e.g., "TRUST MODEL"), display-serif headline, body paragraph.
  - Card has subtle 3D tilt on hover (perspective transform).
  - Six cards, content per `R-95` and the v2 mockup.

**3.3.5 Live system status.** Below differentiators. Single row card with:
  - Pulsing online indicator + "Online" label.
  - Stat groups: Transfers (all-time), Active relayers, Challenges (week), Successful frauds (highlighted green if 0).
  - Right-aligned: "last sync: just now" timestamp, real-time updated.

## 3.4 Live transaction section

Appears below the bridge widget on the homepage *only when a transaction is in flight*. Disappears after completion (with a "Replay" affordance for demo).

**3.4.1 Header.** Pulsing orange dot + "In flight · #N" + amount/route summary.

**3.4.2 Curvy roadmap (`UI-curvy-roadmap`).** SVG path with 6 stations (Locked, Proof, Transformed, Submitted, Window, Minted) along an S-curve. Station positions slightly offset vertically for visual rhythm.
  - Background path: `stone-800`, 2px stroke.
  - Progress path: gradient (orange-400 → emerald-400), 2.5px stroke, with subtle glow filter, animated stroke-dashoffset transition.
  - Stations: 7px circle; uncompleted = `stone-900` fill with `stone-700` border; current = `orange-400` filled with pulsing ring; completed = `orange-400` filled with white checkmark inside.
  - Labels above or below each station based on station's vertical position (alternating).

**3.4.3 Proof Inspector (`UI-proof-inspector`).** Below roadmap. Collapsed by default behind a single button: "Proof Inspector — Tap any step for cryptographic detail."
  - Expanded: reveals a list of stage rows. Each row clickable to expand independently.
  - Header bar: streaming indicator + "Streaming · live" + sub-label.
  - Each row shows: stage icon (check/circle/clock), stage label, brief detail text, expand chevron.
  - Expanded row: a code-block-styled detail card showing actual cryptographic content per stage (transaction hashes with copy + explorer; proof root with copy; size in bytes; hash function name; format names; transformation source/target).
  - Each hash uses the `CopyableHash` component (`UI-copyable-hash`).

## 3.5 Demo Control Panel

**3.5.1 Page header.** Mono label "Demo Control" + display headline + paragraph.

**3.5.2 Relayer cards.** Two cards side-by-side on desktop, stacked on mobile.
  - Per card: relayer ID circle (large display-serif letter), name, copyable Sepolia address, status badge (dynamic per `R-24`).
  - Bond cells: Sepolia and Neutron, each showing gas balance + bond balance with a horizontal progress bar (green if healthy, amber if approaching threshold).
  - Stats grid: Earned, Slashed, Submitted (count), Success (rate).
  - Card has subtle 3D tilt on hover.

**3.5.3 Scenario buttons.** 4-column grid on desktop, 2 on tablet, 1 on mobile.
  - Per button: scenario icon (color-coded), display-serif name, body paragraph description, "Run script" affordance with play icon.
  - Hover: border highlight in scenario's color, background tinted.
  - Click: triggers the scenario script via backend API.

**3.5.4 Live event log.** Terminal-style at the bottom.
  - Header: terminal icon + mono command-style title + streaming indicator.
  - Body: scrolling list of events. Each: timestamp + tag pill (color-coded by event type) + actor + message.
  - Streams in real-time via Supabase subscription.

## 3.6 System Dashboard

**3.6.1 Top metrics.** 4-column grid: Total volume bridged, Active relayers, Avg. bridge time, Successful frauds.

**3.6.2 Active relayers table.** Full-width data table. Columns: Relayer, Status, Sepolia bond, Neutron bond, Submissions, Success rate, Earned (24h). Hover row highlights subtly.

**3.6.3 Recent submissions table.** Header row with "Recent submissions" label (left) and "View all submissions →" button (right). Table shows 5 most recent. Columns: #, Route, Amount, Relayer, State (color-coded), Source tx (`CopyableHash`), Destination tx (`CopyableHash`), Time, expand chevron. Click row → navigates to `/submissions/[id]`.

**3.6.4 "View all" behaviour.** Click → routes to `/submissions` (paginated full list). Out of scope for MVP if time-constrained; for demo, clicking can show "All submissions" page that's just the same table without the 5-row limit. Document if scoped down.

## 3.7 Submission Detail (internal-only)

**3.7.1 Access.** Route is `/submissions/[id]`. Only reachable by clicking a row in Dashboard's recent submissions table. Not in main nav.

**3.7.2 Header.** Back-to-dashboard button, status pill, page title in display serif: "Submission detail."

**3.7.3 Metadata grid.** 4-column on desktop, 2 on tablet, 1 on mobile. Each cell: uppercase mono label + value. Hash values use `CopyableHash` with explorer links.

**3.7.4 Cryptographic Roadmap (`UI-cryptographic-roadmap`).** Card containing:
  - 5-node horizontal pipeline (Source → Plugin → Transform → Plugin → Destination), each clickable.
  - Below pipeline: side-by-side proof structure visualizations (Sepolia native: Patricia trie outline; Neutron native: IAVL outline). Each shows tree depth, node types, root hash with copy, size, hash function.
  - Below visualizations: callout in orange tint stating "Both proofs commit to the same logical claim: <storage claim>."

## 3.8 Benchmark page

**3.8.1 Header + disclaimer.** Page title + paragraph + amber-tinted methodology callout block.

**3.8.2 Comparison table.** 4 rows × 7 columns. Tessera row tinted orange and badged "Live" (when `benchmark_runs` has data) or "Reference" (when empty fallback). Other rows from seeded JSON.

**3.8.3 Limitations / Risks / Future work — bold treatment.** Below comparison table. Three sections, each:
  - Large display-serif number ("01", "02", "03") + colored icon.
  - Display-serif title ("Current limitations", "Production risks", "Future work").
  - 2-column grid of item cards. Each card: tinted by section color, mono number, item text.

## 3.9 Docs page

**3.9.1 Layout.** Sidebar (240px) + content area on desktop. Sidebar collapses to dropdown on mobile.

**3.9.2 Sidebar.** Sections: Overview, What is Tessera, How it works, Trust model, Cryptography, Architecture, Demo scenarios, Run a relayer, Add a chain, Limitations & risks, Roadmap. Each item: icon + label. Active item: orange tinted background.

**3.9.3 Content area.** Renders MDX. Each section gets a fade-up animation on transition. Display-serif headlines, sans body.

**3.9.4 Demo scenarios section** specifically explains each of the four test scripts and what each one proves (per the v2 mockup's existing content).

## 3.10 Shared components

**3.10.1 `UI-copyable-hash`.** Inline component for any displayed hash/address.
  - Truncated display ("0xabc12...d4f1").
  - Inline copy icon (changes to checkmark on click for 1.5s).
  - Inline external-link icon when applicable (links to Etherscan for Sepolia hashes, Mintscan for Neutron).
  - Click stops propagation to prevent triggering parent row's onClick.

**3.10.2 `UI-status-badge`.** Pill component for relayer status. Colors per state:
  - `busy` (submitting): amber-tinted.
  - `idle` (watching): emerald-tinted.
  - `benched`: amber-tinted with warning context.
  - `deregistered`: red-tinted.
  - `cooling`: stone-tinted.

**3.10.3 `UI-section-label`.** Uppercase mono label with horizontal line, used as section headers throughout.

## 3.11 Responsive behaviour

- **Mobile (320–640px):** Single-column layouts, hamburger nav, dropdown sidebar (docs), tables overflow with horizontal scroll, hero text scales down (5xl on mobile vs 8xl on desktop), bridge widget full-width.
- **Tablet (640–1024px):** Two-column where applicable, larger touch targets, side pills (homepage) hidden.
- **Desktop (1024px+):** Full layouts as specified.

Test breakpoints explicitly: 375px (iPhone SE), 768px (iPad), 1280px (laptop), 1920px (large desktop).

## 3.12 Real-time data plumbing

- **Bridge widget fees.** Polled every 10s from a small backend endpoint that aggregates current gas prices.
- **System status strip.** Subscribed to Supabase `messages` and `bonds` tables; recomputed on changes.
- **Live tx section.** Subscribed to the specific message's row in `messages` table; UI re-renders as state changes.
- **Demo Control Panel relayer cards.** Subscribed to `bonds` and the relayers' recent activity; updates on every change.
- **Live event log.** Subscribed to `events` table; new rows append to the top with fade-up animation.
- **Submission Detail.** Loaded once on mount; not subscribed (submission is finalized).

---

# PART 4 — Reference

## 4.1 Hackathon discipline rules

Per the hackathon guidelines, applies throughout:
- **CLAUDE.md required** before second prompt. Missing CLAUDE.md = -25pp.
- **Default to Sonnet.** Opus only on escalation. Track per-model spend in cost log.
- **Plan mode for tasks > 30 min.** Catch wrong direction in 2 min, not 2 hours.
- **Read every diff** before approving.
- **Cost discipline.** Soft cap $75/day, hard cap $100/day.
- **Claude Code only.** No other AI coding tools (-10pp penalty).
- **No paid third-party services** without pre-approval.
- **New private repo** named `hackathon-2026-05-<your-name>`.
- **Synthetic data only.** No production data, no PII.
- **No production secrets.** Use `sk-test-fake-...` for any keys.
- **Required artifacts in Form 2:** GitHub repo, live URL, Notion docs (PM brief + architecture + technical decisions + roadmap), `SPEC.md` and `CLAUDE.md` committed, prompt log (5 best + 3 worst), cost log, 1-page reflection.

## 4.2 PROMPT_LOG.md template & rule

**Rule (also in CLAUDE.md):** After every non-trivial prompt that produces code, contract changes, or architectural decisions, Claude appends an entry to `PROMPT_LOG.md` before considering the response complete. Trivial prompts (typos, simple clarifications, formatting-only) are exempt.

**Template at top of file:**
```markdown
# PROMPT_LOG.md

> Maintained automatically by Claude Code per the rule in CLAUDE.md. Each non-trivial prompt produces one entry following the format below.

## Entry template

### [Phase N] — short title — YYYY-MM-DD HH:MM

**Prompt summary:** (1–2 lines, what was asked)
**Claude's actions:** (1–2 lines, key decisions and changes made)
**Outcome:** (worked / partial / failed, brief why)
**Tokens approx:** (for cost log)
**Files touched:** (paths)
**Notes:** (what was sharp, what was confusing, what to remember)

---
```

## 4.3 External resources

Filled in during Phase 0:
- **Sepolia RPC:** (Alchemy or chosen — user-provided)
- **Sepolia faucet:** (Alchemy faucet, Google Cloud faucet, etc.)
- **Sepolia explorer:** https://sepolia.etherscan.io
- **Neutron testnet RPC:** (pion-1 public RPC — user-discovered)
- **Neutron testnet faucet:** (pion-1 faucet)
- **Neutron testnet explorer:** (Mintscan testnet or Neutron's native explorer)
- **Etherscan API key:** (for verification — user-provided)
- **Supabase URL + service-role key:** (in `.env`)

## 4.4 Cross-reference index

For navigation; scannable per Part 0.1.

**Requirements by group:**
- R-1 to R-5: Project identity (§1.1)
- R-10 to R-19: Bridge functional (§1.2)
- R-20 to R-29: Relayer & roles (§1.3)
- R-30 to R-34: Demo scenarios (§1.4)
- R-40 to R-49: Trust & slashing (§1.5)
- R-50 to R-59: Cryptography (§1.6)
- R-60 to R-79: Contracts (§1.7)
- R-80 to R-89: Off-chain service (§1.8)
- R-90 to R-99: UI summary (§1.9; deep spec Part 3)
- R-100 to R-109: Performance (§1.10)
- R-110 to R-114: Hosting (§1.11)
- R-120 to R-129: Out of scope (§1.12)

**Phases:**
- P-0: Environment setup (§2.3)
- P-1: Solidity contracts local (§2.4)
- P-2: CosmWasm contracts local (§2.5)
- P-3: Go relayer skeleton (§2.6)
- P-4: Translation layer (§2.7)
- P-5: Testnet deployment (§2.8)
- P-6: Registration + honest path (§2.9)
- P-7: Challenger + scenarios (§2.10)
- P-8: Frontend on real data (§2.11)
- P-9: Audit pass (§2.12)
- P-10: Polish + docs (§2.13)

**UI components:**
- UI-wallet-button (§3.2.4)
- UI-bridge-widget (§3.3.2)
- UI-curvy-roadmap (§3.4.2)
- UI-proof-inspector (§3.4.3)
- UI-cryptographic-roadmap (§3.7.4)
- UI-copyable-hash (§3.10.1)
- UI-status-badge (§3.10.2)
- UI-section-label (§3.10.3)

---

**End of SPEC.md.**

> Claude Code: when in doubt, re-read Part 0.2 (anti-hallucination rules). When something is genuinely ambiguous, ask the user. When working on a phase, read only that phase plus the requirements it cross-references.

---
Additional Rules
Frontend integrates PostHog for event tracking (page views, bridge initiations, scenario triggers, wallet connects). Backend services integrate Sentry for error capture." Bake into Phase 8 + Phase 10 polish.
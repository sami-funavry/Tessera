---
name: tessera-review
description: Multi-perspective review skill for Tessera. Three sharp review lenses: security/adversarial (looks for exploits, economic attacks, malformed inputs, race conditions); production-readiness (looks for ops gaps, missing logs, error handling, RPC failure modes, restart recovery); and UX (looks for confusing states, missing affordances, accessibility issues, mobile problems). Use when running audit passes (Phase 9) or any focused code review. Outputs structured findings with severity grades.
---

# Tessera Review Skill

Apply this skill when running a review pass on any part of Tessera — a contract, a relayer module, a frontend page, or the whole system. The output is structured findings, not free-form commentary.

The phase-9 audit is the primary use, but this skill applies to any review (PR review, mid-phase sanity check, pre-deployment dry run).

## The three lenses

Three perspectives that catch different bugs. Use all three on any non-trivial review. Don't collapse them — they each find things the others miss.

### Lens 1 — Security / adversarial

Read the code as an attacker. The question is *"what would I exploit if I wanted to drain funds, halt the system, or grief honest users?"*

Specific things to look for:

**Smart contract attacks:**
- **Reentrancy.** Any external call before state writes is a reentrancy vector. Look for `call`, `delegatecall`, `transfer` to user-controlled addresses before storage updates. Solidity: confirm `ReentrancyGuard` or check-effects-interactions pattern.
- **Integer overflow / underflow.** Solidity ≥ 0.8 has built-in checks; verify it's not bypassed with `unchecked` blocks. CosmWasm Rust uses `checked_*` arithmetic; `unwrap` on those is a panic vector.
- **Access control bypass.** Every privileged function must check the caller. `onlyVerifier`, `onlyOwner`, registry membership checks. Search for missing modifiers.
- **Replay attacks.** Signed messages without nonces or expiry. Key rotation that doesn't invalidate old key usage.
- **Front-running.** Submissions that depend on transaction ordering can be sandwiched. For the bridge specifically: can a challenger be front-run by another submission that pre-empts the bond claim?
- **Griefing via low-cost attacks.** Frivolous-challenge spam (already mitigated by 25% slash, but verify the slash math). Bond griefing via repeated registration/deregistration cycles.
- **Sybil.** Multiple identities controlled by one party. Tessera's bond requirement mitigates this — verify the bond is a real economic floor.

**Cryptographic attacks:**
- **Forged proofs.** Can a malicious relayer construct a proof that verifies but commits to a different value? Check that the leaf encoding is canonical and the path encoding rejects ambiguity.
- **Hash collisions.** Tessera uses Keccak-256 and SHA-256, both collision-resistant. But verify no part of the system depends on truncated hashes for security.
- **Malformed inputs.** Send the verifier a proof with invalid encoding. Does it revert cleanly, or does it consume gas indefinitely / produce a false-positive verification?
- **Edge cases in proof depth.** Empty trees, single-node trees, maximally deep trees. Verify each handles correctly.

**Economic attacks:**
- **Bond depletion via repeated frivolous challenges.** Calculate: how many slash cycles before a relayer is bankrupt? Is the slashing economics actually punishing or just slap-on-wrist?
- **Slashing math correctness.** 50% of submitter to challenger. Verify the actual transferred amount in the contract matches the stated 50%. Off-by-one (49% or 51%) is a real bug, not a rounding curiosity.
- **Cooldown bypass.** Can a slashed relayer re-register sooner than the cooldown by deploying a fresh contract?

**Off-chain attacks:**
- **RPC poisoning.** If a relayer's RPC is compromised, what's the blast radius? Document the trust assumption. Is it noted in SPEC.md §1.12 (out of scope) as a known limitation?
- **Key exposure.** How are wallet keys stored? Are they ever logged, ever in environment variables that could leak via crash dumps, ever committed to git history?
- **Time-based attacks.** Relayer relies on local clock for handover timing — but the contract uses block timestamp. Verify clock skew between relayer and chain is handled.

### Lens 2 — Production-readiness

Read the code as an operator. The question is *"if this runs unattended for 48 hours and something goes wrong, will I be able to figure out what happened and recover?"*

Specific things to look for:

**Observability:**
- Every error logged with enough context to reproduce — message ID, transaction hash, chain, block.
- Structured logs, not free-form. Filter by component, by chain, by message ID.
- Critical errors (RPC failure, chain reorg, bond depletion) trigger distinct log levels operators can alert on.
- Metrics on submissions, challenges, slashes per time window — even if not exported to Prometheus, at least visible in Supabase queries.

**Error paths:**
- Every external call has a documented retry policy or explicit failure path. No silent swallows.
- RPC failures: primary fails over to fallback, fallback fails over to degraded mode. Degraded mode is observable.
- Database errors: distinguish transient (retry) from fatal (alert).
- Chain reorgs: detected via header re-fetch before submission. Aborts cleanly.

**Restart recovery:**
- The relayer can be killed at any moment and restarted from any point without state corruption. State lives in Supabase, not memory.
- On startup, replay events from the last seen block per chain. No gaps.
- In-flight messages either complete or are detectable as orphaned (with a recovery action).

**Resource management:**
- Database connections pooled, not leaked. Confirm `defer rows.Close()` on every query.
- HTTP/RPC clients reuse connections rather than creating per-request.
- Goroutines spawned with bounded lifetimes; don't leak on cancellation.

**Configuration and secrets:**
- All knobs in config, not hardcoded. Challenge window, handover period, bond amounts, RPC endpoints.
- Secrets via environment variables, never in YAML/code. Documented in `.env.example`.
- No secrets in logs at any level (including DEBUG).

**Operational runbooks:**
- README has "how to run a relayer," "how to add a chain," "how to investigate a slashed relayer."
- Smoke test runs on a known-good environment and exits 0.

### Lens 3 — UX

Read the UI as a confused first-time user. The question is *"can a judge who's never used a bridge before complete a transfer without getting stuck?"*

Specific things to look for:

**Confusing states:**
- Wallet connected on one chain but not the other — what does the UI do? Is the user told they need both?
- Transaction in progress + page refresh — does the user see the in-flight state or lose it?
- Insufficient balance — does the Bridge button explain *why* it's disabled?
- Pending tx + wallet disconnect — does the UI show a stuck-but-recoverable state?

**Missing affordances:**
- Hashes that aren't `CopyableHash` — every displayed hash should have copy + explorer link.
- Long values with no copy button. Long addresses with truncation but no full-value access.
- "Loading..." with no estimate or way to cancel.
- Errors that say "something went wrong" without saying what or what to do.

**Accessibility:**
- Color is not the only signal for status. Status badges should have icon + text + color.
- Focus states preserved on keyboard navigation.
- Screen reader labels on icon-only buttons.
- Reduced motion respected on animations.

**Mobile:**
- Touch targets ≥ 44px.
- Tables overflow gracefully (horizontal scroll, not wrap-and-break).
- Wallet connect on mobile MetaMask works (in-app browser, not deep link).
- Sidebar collapses to dropdown.

**Information clarity:**
- The fee and time estimate are visible *before* the user clicks Bridge.
- The challenge window is explained, not just shown as a countdown timer.
- The four demo scenarios are labeled clearly and the user understands what each demonstrates.

## Severity grading

Every finding gets a severity. Use these levels strictly.

**P0 — blocks demo or breaks safety.**
- Funds at risk in normal operation.
- A demo scenario fails consistently.
- Wallet integration is broken on a major platform.
- Critical RPC dependency has no fallback.

P0 findings BLOCK Phase 9 exit. Fix or escalate.

**P1 — serious bug, likely visible.**
- A demo scenario works but is fragile (intermittent failure).
- An error path is silently swallowed.
- A UX flow has a confusing state that judges will notice.
- A security finding that requires non-default attacker capability but is feasible.

P1 findings SHOULD be fixed before Phase 9 exit. Document any deferred to Phase 10.

**P2 — quality issue.**
- Code style, missing comments, opportunities for refactoring.
- Edge cases that would matter in production but not in a 3-day demo.
- Minor inconsistencies between mockup and implementation.

P2 findings can be deferred to post-hackathon work. Log in `docs/audit-findings.md` with a clear "deferred — reason" note.

## Audit findings format

Every finding goes in `docs/audit-findings.md` with this structure:

```markdown
## F-001 — [Severity] [Lens] Short title

**Component:** path/to/file.ext
**Lens:** Security | Production-readiness | UX
**Severity:** P0 | P1 | P2

**Description:**
What the issue is, in plain language.

**Reproduction (if applicable):**
Steps or conditions under which the issue manifests.

**Recommendation:**
Specific fix or mitigation.

**Status:** Open | In progress | Fixed | Deferred (with reason)
**Resolution commit (if Fixed):** abc1234
```

Every fix references the finding ID in its commit message: `fix: address F-007 - missing onlyVerifier on BridgeMint.release (P-9, P0)`.

## How to use this skill

When invoked for a review:

1. **State the scope.** "Reviewing the Solidity Verifier contract" or "Reviewing the demo control panel UI." Don't review the whole system at once.

2. **Apply all three lenses.** Even if a component seems clearly only one type of concern (e.g., the UI seems "only UX"), the security and production-readiness lenses still apply (the UI handles user funds; it has error paths).

3. **Output structured findings, not narrative.** Don't write paragraphs. Write findings in the format above.

4. **Severity grade every finding.** Don't leave severity unspecified.

5. **Don't soften.** P0 findings are P0 even if the user is tired or close to demo day. Severity reflects impact, not convenience.

6. **Surface what's *missing* as well as what's wrong.** Missing logs, missing tests, missing error paths are findings.

## When in doubt

- Read SPEC.md §1 (requirements) to know what the system *should* do; review against that, not against general best practices.
- For security specifically, the slashing economics in SPEC.md §1.5 (R-40 to R-49) are the load-bearing trust model — review them paranoidly.
- Ask the user before downgrading a severity.
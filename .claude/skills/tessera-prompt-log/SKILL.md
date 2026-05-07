---
name: tessera-prompt-log
description: Maintains PROMPT_LOG.md for Tessera. After every non-trivial prompt that produces code, contracts, services, UI changes, or architectural decisions, append a structured entry to PROMPT_LOG.md before the response is complete. The full prompt history goes to git for hackathon audit; the operator selects the 5 best and 3 worst at the end. Always loaded.
---

# Tessera Prompt Log Skill

Apply this skill on every prompt during the Tessera build. The hackathon requires a prompt log as a deliverable; missing it costs -25 percentage points on the rubric. The operator curates the final 5-best/3-worst selection at the end, but the full per-prompt history is captured here automatically as work happens.

## What gets logged

**Log it (non-trivial):**
- Prompts that produce code, contracts, scripts, configurations.
- Prompts that make architectural decisions (even if no code changes).
- Prompts that change SPEC.md, CLAUDE.md, or any skill file.
- Prompts that modify the deployment plan.
- Prompts that surface a bug or design flaw.
- Prompts that close a phase or milestone.

**Don't log it (trivial):**
- Single-word clarifications ("yes," "go ahead," "next").
- Typo corrections.
- Formatting-only changes (whitespace, line wrapping).
- Acknowledgment-only responses.
- Conversational pleasantries.

When in doubt, log it. The cost of a stray entry is a few lines; the cost of missing real work is the audit rubric penalty.

## Entry format

Every entry follows this exact template, appended to the bottom of `PROMPT_LOG.md`:

```markdown
### [P-N] short-title — YYYY-MM-DD HH:MM

**Prompt:** One or two lines describing what the user asked for. Paraphrase if the prompt is long; quote verbatim if the wording matters.

**Actions:** One or two lines describing what was done in response. Key files touched, key decisions made.

**Outcome:** worked | partial | failed — with one-line reason.

**Files:** `path/to/file1`, `path/to/file2`

**Tokens:** ~N (approximate, for cost log correlation)

**Notes:** What was sharp about this prompt, what was confusing, what to remember. Optional but encouraged on tricky ones.

---
```

Where `[P-N]` is the current phase ID from SPEC.md §2 (use `[P-pre]` for anything before Phase 0 starts; `[P-post]` for anything after Phase 10).

## Initial file state

If `PROMPT_LOG.md` doesn't exist when this skill is first invoked, create it with the header:

```markdown
# PROMPT_LOG.md

> Maintained automatically per the rule in CLAUDE.md and the `tessera-prompt-log` skill. Each non-trivial prompt produces one entry following the format documented in the skill.

> The operator curates the 5-best/3-worst selection from this log at Phase 10 (`docs/prompt-log-highlights.md`). This file is the raw audit trail; the curated highlights are the hackathon deliverable.

---
```

Then begin appending entries below.

## When to append

Append the entry as the *last action* of the response, after all the work is done. Not before — if something fails mid-prompt, the entry should reflect the actual outcome, not the intended one.

The append is a small step, but it matters. Skipping it for one prompt makes skipping the next easier. Hold the discipline.

## Concrete example

A user prompt and its corresponding log entry:

**User said:** *"Add a `claimAbsenceSlash` function to the Bond contract that anyone can call after the handover period if the assigned submitter didn't act."*

**Resulting entry:**

```markdown
### [P-1] add claimAbsenceSlash to Bond contract — 2026-05-07 14:23

**Prompt:** Add `claimAbsenceSlash` to Bond contract — anyone-callable, slashes original assignee 50%, pays caller, after handover period.

**Actions:** Added `claimAbsenceSlash(messageId, originalAssignee)` to `contracts-evm/src/Bond.sol`. Verifies the original assignee was assigned for that nonce, that the handover period has passed, and that someone else has since submitted. Pays caller 100% of slash. Added Foundry tests covering happy path, replay rejection, and pre-handover rejection.

**Outcome:** worked — all tests pass.

**Files:** `contracts-evm/src/Bond.sol`, `contracts-evm/test/Bond.t.sol`

**Tokens:** ~3,400

**Notes:** The "anyone callable" pattern matches the existing `executeMessage`. Reuses the rotation rule from RelayerRegistry. No new attack surface — the slash math is identical to the wrong-submission case (50%), just triggered by a different condition.

---
```

## Anti-patterns to avoid

- **Don't bundle multiple prompts into one entry.** Each prompt = one entry, even if related.
- **Don't write entries that just say "wrote some code."** Specificity is the point. The entry should let a future reader (the operator at curation time, or an auditor) understand what happened without re-reading the conversation.
- **Don't skip entries because the prompt felt small.** If it produced a code change or a decision, log it. The operator filters at the end.
- **Don't editorialize.** Stick to facts. "What was sharp about this prompt" in the Notes field is the place for editorial commentary, not the action description.

## When in doubt

If unsure whether a prompt counts as non-trivial, log it. Filtering down at curation is easier than reconstructing history.

## When this skill conflicts with other work

If appending the entry would cause a problem (a long-running command in flight, a test suite running), append it after the other work completes. Never let logging block real progress, but never let real progress skip logging either.
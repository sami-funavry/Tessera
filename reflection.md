# Reflection — Abdul Sami

## Before the hackathon, my honest take on Claude Code was:

A glorified autocomplete with extra steps. I'd seen co-workers wrestle with it for 20 minutes to land a 5-minute change, and assumed the tool would slow me down on anything genuinely novel — like a cross-VM bridge with custom proof translation.

## Now, my take is:

If I brief it like a junior staff engineer (spec, invariants, anti-hallucination rules, plan-mode gates) it operates like one — and ships in days what would take me solo weeks. If I brief it sloppily, it produces sloppy code at the speed of light. The discipline I bring to the prompt is the ceiling of the output.

## The 3 patterns I'll bring to my real work

1. **Skill-driven invariants.** I wrote `tessera-context` on day one with the 5 most-violated rules (source root ≠ transformed root, submitter and challenger are roles not identities, etc.) and the 7 anti-hallucination rules. It auto-loaded on every prompt and cut drift to near-zero. **Lesson:** for any real project, write a 1-page invariant skill before writing the first line of code.
2. **Plan-mode for anything > 30 min.** Twice it caught wrong-direction starts in 2 minutes that would have been 2-hour rewrites. The friction of writing a plan is the point — it forces me to think before Claude does. I'll default-on plan-mode for any ticket touching > 3 files.
3. **Auto-maintained prompt log.** The `tessera-prompt-log` skill appended an entry after every non-trivial prompt with no manual cost. By day 3 I had a perfect audit trail — for the rubric, for retros, for self-review of which prompt patterns actually worked. **Cost: 5 minutes to write the skill. Value: ~150 entries I'd never have written by hand.**

## The 2 patterns I'll NOT bring (and why)

1. **Letting Opus run as default.** Sonnet 4.6 was sufficient for ~80% of the work and ran ~3× cheaper. I'll default to Sonnet and escalate to Opus explicitly only when (a) cross-cutting fixes span 3+ layers or (b) the 1M-context window genuinely matters. On real-work budgets this is the difference between $40/day and $120/day.
2. **The autonomous-loop sentinel as a habit.** It saved me time on May 9 because the relayer iteration was genuinely closed-loop (clear error → fix → redeploy → check log → repeat). For most real-work tickets the loop isn't that clean — letting it iterate without me reviewing each diff produces drift. **Hackathon-only pattern; not for production codebases.**

## What I'd want to change in our team's workflow

Make a 1-page invariant skill mandatory for every new project — the "5 things I'll get wrong if I'm not careful" list. We already maintain spec docs; a skill is a spec the model actually reads. Second: standardize prompt-log auto-skills across projects so we have comparable artifacts for retros. Third: move the team-wide CLAUDE.md anti-hallucination rules into a personal global file (`~/.claude/CLAUDE.md`) so they apply across every project, not just the ones with discipline. The cost of one fabricated contract address in production is higher than the cost of every other engineering mistake combined.

## My answer to: "would I want to keep using this on real tickets?"

[x] Yes, default to it
[ ] Yes, for some kinds of work
[ ] No, prefer manual

**Why:** Tessera is the most ambitious thing I've built solo in 3 days — a cross-VM bridge with custom Patricia↔IAVL translation, bonded relayers, slashing logic, Railway-hosted services, and a real UI. Hand-coding it would have taken 3+ weeks. Claude Code under disciplined briefing did it in 36 hours of coding time at ~$58. The tool is real; the discipline I bring decides whether the output is too. I'm keeping it as the default and treating any ticket I'd estimate at > 1 day as a Claude Code task by default.

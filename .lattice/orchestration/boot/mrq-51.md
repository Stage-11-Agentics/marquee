FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-51-audit-isolation" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-51** (A-9 — reviewer event and track isolation audit). Actor: `agent:auditor-mrq-51`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-51-audit-isolation`, branch `mrq-51-audit-isolation`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMC5F2CPPY98EWAAQK68B.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit** — push, not just commit. **Opening the PR is the final step and is not optional.**

## You are an AUDITOR. You did not write this code.

Reviewer isolation is defended by **four** merged layers, and your job is to find where they disagree — not to re-read the tests that already pass:

1. MRQ-3: per-event reviewer scoping down to a **database CHECK** rejecting org-wide reviewer memberships.
2. MRQ-18: `src/lib/reviewer-scope.ts` tightened with `committee.event_id = submission.event_id` — closing a cross-conference hole via round assignments.
3. MRQ-33: pre-write guard `reviewerCanBeAssignedToSubmission` (event membership + reviewer role + track scope).
4. MRQ-35: category routing, which assigns **without a human in the loop** and is the most likely bypass.

**A sibling audit just found exactly the class of defect you are hunting**: MRQ-47 discovered cookie and bearer credential paths disagreeing on effective authority, where an inconsistent cross-org membership row made the cookie path broader. **Look for the same shape here** — two code paths that should compute identical authority but don't, especially where one was written before a later tightening landed.

Enumerate every reviewer-reachable surface from the route manifest rather than from memory: queue, record, file, export, evaluation-write, comparison-write, and the two-round funnel MRQ-28 added. For each, prove an out-of-event and an out-of-track reviewer is refused **and that no row is written** — counts before and after — with a positive control so the assertions cannot pass vacuously.

**Assume a green test over a dead feature until proven otherwise**; that shape has appeared four times on this run.

## What to produce

**Findings with `file:line` and a concrete failure input.** Where you find nothing, name exactly which surfaces and which isolation dimensions you scanned. **Add a machine guard** so a future ticket cannot silently reintroduce a bypass — `tests/node/comms.AC-250.test.mjs` (AST inventory) and MRQ-47's `tests/node/auth-boundary.test.mjs` (enumerated session writers) are the models. Prefer `tests/node`.

**Do not fix product code you are auditing** unless the fix is trivially safe and you say so; findings route to their owning tickets. Flag ambiguity to me.

## Standing rules

Suite ~10–20s against 30s; whole gate 45s. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-51.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-51`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

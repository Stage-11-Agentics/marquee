# MRQ-180: CNT-08: a bulk reminder for two speakers confirms one, and never says which

Rubric item **CNT-08** — `content-management`, weight **2**, `partial` in round 4 and round 9 (1.0 recoverable). Scenario: **CNT-S3**. Also a **major** defect this round.

Round 4 could not judge the send at all (the agent ran out of turns). Round 9 reached it, and found something worse than "unverified".

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> A bulk reminder action is available from the dashboard for incomplete/outstanding tasks (with or without a template picker) and the UI confirms the send (toast, dialog, or sent count). Actual delivery is verified manually

## Why it fell short — the judge's own reasoning (confidence high)

> The bulk reminder path exists and was exercised on the filtered outstanding set: with both speakers ticked, "Send reminder (2)" opened a COMPOSE drawer headed "Reminder for 2 speakers · Demo-safe outbox · no email will be delivered" with RECIPIENTS 2 (Priya Raman · Marcus Okafor), a template picker, subject/body with merge fields and a working "Preview merge" [...] Pressing "Queue reminder (2)" returned an in-drawer confirmation line. **The gap is in that confirmation: it reads "1 queued · 0 already in outbox" for a send the same drawer describes as going to 2 speakers, and the UI gives no indication which recipient was skipped or why.** So the action and a send confirmation exist, but the confirmation contradicts the selection.

And the defect entry: *"Only one of the two selected speakers was queued and the UI never says which one was skipped or why, so an organizer reasonably believes both were reminded."*

## What to build

First establish which of the two this is, because the fix differs:

- **The drop is real** — one recipient was genuinely not queued (no address, an existing suppression, a dedupe against an earlier outbox row, a per-recipient failure). Then the queueing is correct and the *reporting* is the defect.
- **The count is wrong** — both were queued and the confirmation miscounts. Then the count is the defect.

Either way the product must end up here:

1. **The confirmation reconciles to the selection.** If 2 were selected, the confirmation accounts for 2: queued, skipped, and already-in-outbox must sum to the number the button promised.
2. **A skipped recipient is named, with its reason**, at the moment of the send — not in a log the organizer would have to know to open. "Marcus Okafor — no email address on file" is the shape.
3. **The organizer can act on it.** A skip the organizer cannot see is a speaker who never gets chased, which is the one thing PHILOSOPHY.md says the system exists to do.

## Acceptance

- Queueing a reminder for N selected speakers produces a confirmation whose parts sum to N.
- A recipient that cannot be queued is listed by name with a reason.
- Regression test covers the mixed case: one queueable recipient and one not.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree and two agents stashing at once swap each other's work.
- **No migration without the operator.** If you conclude one is needed, stop and say so on the ticket.
- **Do not deploy.** An eval round is running and a `.deploy-freeze` marker sits at the primary checkout. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — reserve space for anything that swaps.
- Ship a regression test that fails on `main` and passes on your branch.
- Gate serialized. macOS has no `flock(1)`; wrap it: `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

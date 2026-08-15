# MRQ-178: CNT-07: the chase grid pushes its newest task columns off the screen

Rubric item **CNT-07** — `content-management`, weight **3**, `partial` in both rounds — **1.5 recoverable, the joint-largest single item left in my queue.** Scenarios: **CNT-S1**, **CNT-S3**.

**Round 4's cause is fixed; this is the next layer.** Round 4 failed because the grid hard-wired its columns to the conference's six original task types, so a task authored later got no column at all. MRQ-164 fixed that and it shows — the page now reports **9 task columns**. The new gap is that the columns it gained are off-screen.

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> The dashboard shows all speaker-task pairs as incomplete in S1, and in S3 accurately reflects the S2 state: Priya's presentation task complete/uploaded (either label passes - clones without an explicit mark-complete action must not be penalized), her headshot task incomplete, Marcus's tasks incomplete; applying a filter visibly changes the displayed set

## Why it fell short — the judge's own reasoning

> A real deliverables dashboard exists at /onboarding [...] Filtering visibly changes the set [...] **The gap: in both the S1 and S3 captures the two newly created task columns sit off the right edge** (the page itself says "9 task columns · scroll the grid sideways to reach 'Upload Final Headshot (print quality)'"), so the dashboard was never observed reflecting the S2 upload — Priya's "Upload Session Presentation" cell is not visible in any dashboard screenshot, and the visible PRESENTATION UPLOAD column is the seeded task, still crossed.

And the matching defect:

> With 9 task columns the two newest sit off the right edge at 1280px; the only affordance is a line of text ("9 task columns · scroll the grid sideways to reach 'Upload Final Headshot (print quality)'") with no visible horizontal scrollbar, pagination or column chooser, so the per-speaker status of the newest deliverables is effectively unreachable.

## The shape of this defect

It is the loop's recurring pattern in a new costume: **a capability that is present but not where the eye lands is undiscoverable, and the judge cannot score a cell it cannot see.** The page even knows the problem — it prints a sentence asking the reader to scroll sideways — which is the product apologising instead of fixing. A sentence is not an affordance.

Note that the newest columns are the ones an organizer most needs: a task authored today is the one whose chase state is live. Sorting the newest to the far right puts the most urgent column furthest from the eye.

## What to build

Any of these is acceptable if it makes the newest task's per-speaker cells reachable and visible at 1280px without the reader being told to scroll:

1. **A column chooser** — the organizer picks which task columns are shown; the newest are on by default. This is the strongest answer because it also scales past 9.
2. **Real horizontal scroll with a visible scrollbar and sticky speaker column**, so the grid is obviously scrollable and the reader never loses the row identity.
3. **Ordering that puts recently created tasks first**, so the live chase is what the viewport opens on.

Whatever you choose:

- The **TASK TYPE filter already works** and narrows to "2 shown" — lean on it rather than duplicating it.
- The speaker (row header) column stays fixed while task columns move.
- No layout jump when columns are toggled or the grid scrolls — reserve widths.
- The "9 task columns · scroll the grid sideways" sentence goes away, or becomes true and actionable rather than an instruction to compensate for the UI.

## Acceptance

At 1280px, with 9 task columns configured, an organizer can see the per-speaker status cell of the most recently created task without being told to scroll — and a regression test proves the newest task's column is reachable in the rendered output.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree and two agents stashing at once swap each other's work.
- **No migration without the operator.** If you conclude one is needed, stop and say so on the ticket.
- **Do not deploy.** An eval round is running and a `.deploy-freeze` marker sits at the primary checkout. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — reserve space for anything that swaps.
- Ship a regression test that fails on `main` and passes on your branch.
- Gate serialized. macOS has no `flock(1)`; wrap it: `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## Reset 2026-08-14 by agent:codex-cli

## Reset 2026-08-14 by agent:eval-triage

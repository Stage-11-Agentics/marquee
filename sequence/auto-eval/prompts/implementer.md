# Implementer — one ticket, one PR

Ticket: `$AE_TICKET`. Read it with `lattice show $AE_TICKET`. Report to the coordinator;
it owns your completion. Raise a c11 flag only if a **migration** is required — that is
the one thing you may not do yourself.

Read `CLAUDE.md`, `DESIGN.md`, and `PHILOSOPHY.md` before you touch anything.

## Your acceptance criterion is not yours

The ticket carries a `pass_criteria` copied verbatim from the sbek rubric, and the
judge's own reasoning for why the item scored short. That is the definition of done,
written by the thing that grades us. Do not reinterpret it, do not narrow it, and do not
declare victory against a reading of it that is easier than what it says.

Re-read it when you think you are finished, and ask literally: if an agent walked the
listed scenarios and screenshotted the result, would a strict judge call this `pass`?
The bar is explicit — a form existing proves nothing; the harness wants confirmation
states, persisted data, the record visible in a list.

## Your first command, before you read another line of code

```sh
cd /Users/atin/Projects/Stage11/deployments/Marquee
git fetch github
git worktree add ../Marquee-worktrees/<branch> -b <branch> github/main
cd ../Marquee-worktrees/<branch>
```

**Check where you actually are before you trust it.** `pwd` and `git branch --show-current`.
Whatever directory you were launched into is not yours unless you just made it — an agent
that inherits a cwd and starts committing puts its work on someone else's branch and into
someone else's PR. That has already happened here once.

Never work in the primary checkout — it is the board's home and it stays on `main`. Never
work in `Marquee-worktrees/mrq-auto-eval`, which is the loop's own machinery.

- `npm test` (45s budget), `npm run pr-gate` (120s) before the PR.
- **The gate is load-sensitive.** Same branch, same night: load 14 → 78s, load 164 →
  276s. If it fails on time alone, check the machine load before believing it. A red
  suite must mean a real defect.
- Every fix ships with a regression test that fails against `github/main` and passes on your
  branch. If you cannot write that test, you have not found the defect yet.
- `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## Root-cause before you fix

The strongest work on this project tonight traced every defect to its cause before
changing a line, and proved each fix against a running seeded Worker — shipped build
erased the answer, branch preserved it. Do that. A fix you cannot explain is a fix you
cannot defend when the next round scores it differently.

## Two standing rules you will trip over

**Elements never jump.** Toggling a control must not move anything else. Reserve space
for swapped text, fix widths on segmented controls, keep row counts constant (show "—"
rather than removing a row), tabular numerals for changing numbers.

**A control that vanishes when inapplicable is a defect,** not a feature. Render it
disabled with the count alongside. This is simultaneously a discoverability fix and a
scoring fix — the judge cannot score a button that is not on the page.

## When you are done

Comment on the ticket with: the root cause in one sentence, how you verified it (the
actual command or the A/B), and the PR number. Set status and stop. Do not merge — the
merge warden owns `main`.

# MRQ-193: The import-undo receipt can report an outcome the write did not perform

Filed by #188's reviewer as a non-blocking observation during the MRQ-167 re-review. **Not a data
defect** — the reviewer was explicit that the data stays safe via the conditional update. What is
exposed is **reporting completeness**.

## The window

The import-undo path reads a skipped-vs-restored decision **before** the batch executes. Between
that read and the write, the underlying row can change. The conditional update still does the right
thing to the data — a field that no longer holds the import's value is left alone, which is the
whole point of the `after_json` snapshot — but the *receipt* the organizer is shown was computed
from the earlier read.

So the organizer can be told a row was restored when it was skipped, or skipped when it was
restored, on a narrow race. The data is correct; the account of it may not be.

## Why it is worth a ticket rather than a shrug

MRQ-167 exists because an import silently overwrote hand-entered work and the organizer was never
told. **The fix for "the product did something and did not say so" should not ship with a path
where the product says something that did not happen.** The severity is much lower — this is a
narrow race, not the default behaviour — but it is the same axis, and the receipt is the entire
user-visible surface of the undo.

## What to do

Establish the decision from the same read the write acts on, so the receipt describes what the
batch actually did rather than what was true a moment earlier. Return the per-row outcome from the
conditional update itself if the shape allows it, rather than computing it beforehand.

If closing the window properly is disproportionate — and it may be — the acceptable alternative is
to make the receipt honest about its own precision rather than silently confident: say what was
attempted and what the update reported, and do not assert an outcome the write did not confirm.
**Choose deliberately and write the choice down**; do not leave it as the accident it is now.

## Acceptance

- The undo receipt's per-row outcomes are derived from the write, not from a prior read; or the
  receipt no longer claims per-row certainty it cannot have, with the reason recorded in the code.
- A regression test exercising the concurrent case — pair it, so that a receipt reporting "nothing
  restored" cannot pass for correctness: assert an unraced undo still reports its restores.
- No change to the data behaviour, which is already correct.

## Constraints

- Cut your worktree from `github/main`; CLAUDE.md now carries the correct instruction. Verify:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- **A red gate is real.** `fail` from a findings-derived check is load-invariant; `pass-over-budget`
  is a warn; `timeout` is the only status contention can manufacture. Never dismiss failing tests as
  a baseline without naming the commit that made them pass.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- **No migration without the operator.** MRQ-167 needed one (`0016_people_import_undo_receipts.sql`)
  and it was cleared explicitly; do not assume that clearance extends to another.
- Do not deploy.

# MRQ-177: CNT-04: the speaker portal can drop a replacement upload and say nothing

Rubric item **CNT-04** — `content-management`, weight **2**, **pass in round 4, partial in round 9**. Scenarios: **CNT-S2**, **CNT-S3**. Also recorded separately as the round's only **CRITICAL** defect.

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> After the second slides.pdf upload, a version list shows two entries with timestamps, the latest is flagged as current, and the older version remains individually viewable/downloadable (a control exists) rather than being overwritten

## Why it fell short — the judge's own reasoning

> The end state satisfies the criterion: after the second upload the speaker panel shows "slides.pdf V2 OF 2 · uploaded Aug 13, 2026, 7:40 PM" with a version list beneath [...] The gap that keeps this off a pass: **the first "Upload new version" attempt silently failed.** The panel sat at "Uploading · 0% · 0 B / 608 B" with a Cancel upload button for ~15 s, no error was ever shown, and a full reload revealed "This is the only version uploaded so far" — the new version had never been written. Only an identical retry produced v2. Versioning therefore works, but the re-upload path can drop a replacement without telling the speaker.

And the critical defect entry:

> **`/portal` — speaker portal, file task deliverable panel, "Upload a new version".** Silent upload failure on the speaker deliverable replacement path. [...] A speaker can therefore believe a deliverable was replaced when it was not.

Plus the matching minor, which is the reason the failure was invisible:

> **`/portal` — speaker portal upload control.** Upload progress indicator never advances. Throughout every upload the line reads "Uploading · 0% · 0 B / 608 B" with an empty progress bar, for a 608-byte file, and only ever changes by disappearing. It conveys no progress information and makes a hung upload indistinguishable from a working one.

## Why this one is first in the queue

Versioning already works — the points are not the reason to fix this. A speaker who uploads the corrected deck, watches a progress line, and closes the tab has every reason to believe the conference has their file. It does not, and nothing ever told them. That is the same class of harm as the CSV overwrite: the product quietly discards work a human did and reports success by saying nothing.

## What to build

1. **Find the actual failure.** Root-cause it before changing anything — presigned PUT, the completion call, a race between them, an aborted request, a token that expired. An identical retry succeeded, so it is very likely a race or a stale token rather than a rejected file. A fix you cannot explain will not survive the next round.
2. **A failed upload says so.** Terminal failure state on the panel, in the speaker's language, with a retry affordance. Never a silent return to the pre-upload state.
3. **A stuck upload times out** rather than sitting at 0% indefinitely, and the timeout is also a stated failure, not a disappearance.
4. **The progress indicator reports real progress** or does not pretend to. If byte-level progress is not available on this path, show an indeterminate working state — an empty bar reading "0% · 0 B / 608 B" for the entire life of a 608-byte upload is a lie that made this bug invisible.
5. **The panel's post-upload state is read from the server**, so a claimed success that did not persist cannot render as a success.

## Acceptance

- A failed or aborted new-version upload leaves a visible, stated failure and no false success.
- A regression test exercises the replacement path's failure branch and proves the panel does not report success when nothing was written.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree and two agents stashing at once swap each other's work.
- **No migration without the operator.** If you conclude one is needed, stop and say so on the ticket.
- **Do not deploy.** An eval round is running and a `.deploy-freeze` marker sits at the primary checkout. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — reserve space for anything that swaps.
- Ship a regression test that fails on `main` and passes on your branch.
- Gate serialized. macOS has no `flock(1)`; wrap it: `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

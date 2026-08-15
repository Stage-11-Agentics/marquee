# Code Review: MRQ-171

> Note on scope: the diff supplied in this prompt corresponds to an earlier
> commit on `mrq-171-reviewer-home`. The branch has since gained a follow-up
> commit (`b2ca5f10`, "preserve portal profile export contract" / the
> `role-home.ts` client-typecheck fix). I pulled `github/mrq-171-reviewer-home`
> and reviewed the actual current HEAD (PR #199) so this review reflects what
> would actually ship. The finding below was verified against that HEAD, not
> just the stale diff text.

## 1. Verdict

**FAIL (implementation-level)**

## 2. Summary

The route split itself (`/reviewer` → home, `/reviewer/queue` → working
surface) is well executed: real `<a href>` navigation instead of
`history.back()`, shell/route-table/sign-in/docs touchpoints updated
consistently, the profile editor is genuinely reused with no second endpoint,
and the shared `ThemeSwitch` extraction is clean. The bug is in a feature the
implementation *added* beyond the ticket's scope: a "revise a saved review"
capability (`revising` state, "Update review", "Revise this review") that is
non-functional on both of its two paths — a real dead end reachable from the
page every reviewer is expected to use most, which the project's own written
rule ("a dead end anywhere is a defect, whoever finds it") makes disqualifying
on its own. A secondary issue in the empty-queue/no-scope messaging on home
should be fixed in the same pass.

## 3. Issues

```
**[CRITICAL] src/ui/review/ReviewerPage.tsx:668 — "Revise this review" is dead on both of its two reachable paths**
```
The ticket didn't ask for a "revise a saved review" feature (the plan's
"Keeps" list only names the existing scorecard, conflict, shortcuts, modal,
and comparison mode). The implementation added one anyway — `revising` state
(line 259), `openRevision` (line 351), "Update review" / "Back to queue"
(line 647) — and it doesn't work:

- **From home** (the only place a reviewer can browse completed reviews,
  since the queue's own completed list was removed per the plan): clicking a
  row opens the read-only detail modal via `openDetailFor`, and inside it
  "Revise this review" runs `if (isHome) window.location.assign("/reviewer/queue")`
  with no query param, hash, or any other way to say *which* submission to
  revise. The queue page has no code that reads `location.search` on load
  (verified: no `URLSearchParams`/`location.search` reference anywhere in the
  file). The reviewer lands on a plain queue and the item they wanted to edit
  is gone — it's excluded from `queue`/`data` because it already has an
  evaluation (`assignedSubmissionIds`'s `NOT EXISTS (SELECT ... FROM
  evaluations ...)` filter in `src/routes/review.routes.ts`). There is no way
  back to it short of navigating home and clicking the same broken button
  again.
- **From the queue page directly** (`isHome === false`): the `else
  openRevision(item)` branch can only run if `detail.review` is populated,
  which only happens when `openDetailFor` is called for a submission that
  already has a saved evaluation. On the queue page, `openDetailFor` is only
  ever called for `current.id` (an active, unreviewed queue item) or a
  comparison candidate (also always unreviewed) — never for a completed item,
  because the completed list was deliberately removed from the queue page in
  this same diff ("Sheds: ... the Completed list — both now live on home").
  So `detail.review` is always `null` there, the "Revise this review" section
  never renders, and `openRevision`'s non-home branch is unreachable dead
  code.

Net effect: the entire revise capability — `revising`, `leaveRevision`,
"Update review", the `revising`-aware header text — is unreachable in one
direction and a dead end in the other. This directly violates the project's
own stated rule (`CLAUDE.md`: "The 11-step walkthrough loop ... must complete
with zero dead ends. A dead end anywhere in it is a defect, whoever finds
it.") and is a materially different behavior from what the PR description
claims was validated (the browser-evidence checklist covers save → exit →
appears under Your reviews, but not reopen → revise).

**Fix:** Either (a) wire it up for real — have the home "Revise this review"
navigate to `/reviewer/queue?revise=<submissionId>` and have `ReviewerPage`
read that param on mount, fetch the submission's existing review, and call
`openRevision` with it before first paint — or (b) if revision isn't in scope
for this ticket, cut it: drop `revising`/`openRevision`/`leaveRevision`/the
"Update review" branch and the "Revise this review" button entirely, and keep
the detail modal purely read-only (matching what `main` had, and what the
plan actually asked for — "the same detail modal", not a new edit surface).
(b) is the smaller, lower-risk fix given the ticket didn't request this
feature.

```
**[MAJOR] src/ui/review/ReviewerPage.tsx:571 — an empty queue always reads as "finished," even for a reviewer who was never given a track scope**
```
AC7 requires the home to distinguish "nobody assigned them work" from
"nobody gave them a track" for a reviewer facing an empty queue. The
responsibility block (rendering `scopes`) does say "No track scope is
assigned" when empty — but the assignment block's CTA slot doesn't consult
`scopes` at all:
```
{counts.waiting > 0 ? <a ...>Start reviewing →</a> : <div class="reviewer-home-clear">
  <span class="completed-mark" aria-hidden="true">✓</span><strong>Queue clear</strong>
  <span>Everything assigned to you is reviewed.</span>
</div>}
```
A reviewer with zero track scope and zero completed reviews sees a
celebratory checkmark claiming "Everything assigned to you is reviewed" —
which is false; nothing was ever assigned. This is exactly the ambiguity the
AC calls out as a defect ("a reviewer with an empty queue deserves to know
whether nobody assigned them work or nobody gave them a track"), and the two
blocks on the same page now actively disagree with each other in that case.

**Fix:** Branch the assignment-foot state on `scopes.length === 0` as well —
e.g. a third state ("No track scope assigned yet — nothing to review") distinct
from both "Start reviewing" and "Queue clear."

```
**[MAJOR] src/routes/review.routes.ts:370-395 — reviewerReviewedCount hand-rolls the track/assignment authorization predicate instead of reusing the canonical one**
```
`src/lib/reviewer-scope.ts` already exports the single authorization path for
this exact predicate (`authorizeReviewerQueueScope`, built from
`REVIEWER_TRACK_SCOPE_SQL` + `REVIEWER_ASSIGNMENT_SCOPE_SQL`), with an
explicit comment calling it out as "the single reviewer resource-authorization
path (AC-246)" precisely to prevent divergent copies. `reviewerReviewedCount`
reimplements the track-scope half of that predicate as inline SQL (the
`EXISTS (SELECT 1 FROM submission_tracks carried JOIN reviewer_track_scopes
scope ...)` block), rather than calling the shared helper or importing the
shared SQL fragment. The values happen to agree today, but this is a second,
independently-maintained copy of a security-sensitive predicate: if the
canonical scope rule ever changes (e.g. an exclusion is added, or the
committee-pool exception mentioned in the file's own comments is revisited),
this progress count will silently drift from what the reviewer is actually
authorized to see, and nothing will catch it.

**Fix:** Export `REVIEWER_TRACK_SCOPE_SQL`/`REVIEWER_ASSIGNMENT_SCOPE_SQL` (or
a small `reviewerAuthorizedSubmissionIds` helper) from `reviewer-scope.ts` and
have `reviewerReviewedCount` build on that instead of re-deriving the join.

```
**[MINOR] tests/integration/signin.MRQ-133.test.ts:99, tests/unit/signin-destination.MRQ-133.test.ts:26 — stale comments now describe the wrong destination**
```
Comments like "a reviewer goes to the queue" / "the reviewer queue is the only
surface that answers it" are now inaccurate — `/reviewer` is home, not the
queue. The assertions themselves (`redirect_to: "/reviewer"`) still pass
since the path string is unchanged, so this is cosmetic, but it's exactly the
kind of drift the ticket's "known touchpoints — check every one" list was
meant to catch, and it will mislead the next reader.

**Fix:** Update the comments to say "home" where they currently say "queue."

## 4. Positive Observations

- The core route/shell mechanics are done correctly and thoroughly: real
  anchor-tag navigation for Exit queue and the brand link (satisfying AC4
  cleanly via a full reload rather than fighting `history`), both
  `/reviewer` and `/reviewer/queue` correctly special-cased in `AppShell`,
  `route-table.ts`/`isAdminRoute`/`check-routes.mjs`/`docs/ROUTES.md`/
  `SITEMAP.md` all updated in lockstep, and `scripts/checks/speed.ts`
  deliberately repointed to `/reviewer/queue` per the plan's own reasoning.
- Profile reuse is exactly as instructed: no second endpoint, `ProfileForm`
  exported and reused as-is from `PortalPage.tsx`, and `requireProfileSession`
  cleanly extends the existing speaker-only gate to `speaker`/`reviewer`
  without weakening it (confirmed `requireUnscopedSpeakerSession` only checks
  "not a co-speaker session," so the role restriction genuinely comes from the
  new membership query).
- `reviewerQueuePayload`/`comparisonQueuePayload` fetch `completed`, profile,
  committees, and the reviewed count in one `Promise.all`, avoiding
  sequential round-trips.
- The honest `completed_truncated` caption is preserved verbatim, and
  `counts.reviewed` is computed independently of the (paginated) `completed`
  list, so the progress numbers stay correct past the 50-item completed-list
  cap.
- `ThemeSwitch` extraction is a clean, uncontroversial dedup — same markup,
  same behavior, now shared between `Topbar` and both reviewer surfaces.
- Reasonable mobile CSS coverage for the new home blocks at the existing
  375px breakpoint, consistent with the surrounding file's conventions.

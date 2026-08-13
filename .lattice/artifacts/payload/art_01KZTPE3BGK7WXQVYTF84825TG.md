# Code Review: MRQ-110 — Per-round reviewer pools, recusal, reviewer reminders

Reviewer: independent (cold context). Branch: `mrq-110-pools-recusal` @ `b7ce6db`
(worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-110-pools-recusal`).

Verification I ran myself:

- `npx tsc --noEmit` — clean.
- `npm test` — **136/136 pass, 22.7s** (budget 45s, hermetic).
- `npx vitest run tests/integration/api/evaluation.test.ts tests/unit/reviewer-surface.AC-61-158-159.test.ts tests/integration/mail.test.ts` — 46/46 pass.
- `npm run pr-gate -- --ticket MRQ-110` — **pass, 23.9s** (budget 120s), with one warning: `missing-current-ticket-manifest` for MRQ-110.

## 1. Verdict

**FAIL (implementation-level)** — narrowly, and *not* because the feature logic is wrong.

I found no correctness defect in the three outcomes: the round pool, the recusal round-trip, and the
reviewer reminder all behave as specified and are covered. Two things nevertheless have to be fixed
before this can merge, and both require touching the branch:

1. The branch is stacked on a **stale snapshot of MRQ-108**. The published parent has moved six
   commits ahead and now contains its own edits to three of the same files — including the same
   optimistic-completed-review lines this PR rewrites. The gate evidence above is therefore evidence
   about a head that will not be the head that merges.
2. The test-title normalization asserts **AC-93 coverage for the reviewer reminder**, an AC owned by
   MRQ-24 and defined as the *speaker* bulk-comms path — the exact audience shape this ticket
   forbids reviewers from joining. That writes a false claim into the merged AC trace.

Everything else below is advisory.

## 2. Summary

Reviewed the full MRQ-110 diff: `0010` migration, `evaluation.routes.ts` (round pool, summary
assignments projection, remind endpoint), `review.routes.ts` (abstention semantics),
`submission-record.routes.ts`, the mail template/merge additions, `EvaluationPage`/`ReviewerPage`/
`SubmissionRecordPage`, and the tests. The implementation quality is high: the abstention write is
genuinely idempotent in both directions (recusal → review → recusal all clear correctly), the
aggregate exclusions are applied at every consumer I could find, the reminder endpoint stays out of
`recipientsFor` and the audience role enum exactly as the ticket demanded, and the failed-write draft
preservation asked for in Cycle 3 is implemented and asserted by an ordering test. The blocking
issues are the stale stack base and one false AC claim; the rest are small truthfulness and payload
nits.

## 3. Issues

**[MAJOR] branch base — stacked on a stale MRQ-108; three files will conflict**
`git merge-base --is-ancestor github/mrq-108-review-depth HEAD` → false. This branch carries local
copies of MRQ-108 commits `22b3043…0b31ecf`, but the published parent tip is `fd7e46a`, six commits
further on. Concrete collisions:

- `tests/node/bulk-paths.AC-66-69.test.mjs:258-264` — MRQ-110 commit `bee5230` adds a
  `reviewsForSubmissions` census entry; parent commit `8215501` adds the **same slot** with different
  classification text. `EXPECTED_PLACEHOLDER_SITES` is an exact-match census, so a naive merge
  duplicates or mismatches the entry. This is parent-owned work that MRQ-110 should not be carrying.
- `src/ui/review/ReviewerPage.tsx` — parent commit `9b83885` already implemented the optimistic
  completed-review payload in `saveNext` (with `actor_id: ""`); MRQ-110 reimplements the same lines
  inside `commitReview` (with `actor_id: "current reviewer"`). Same hunk, two implementations. The
  parent also renamed `Scorecard (optional)` → `Overall score (optional)` and added
  `completed_truncated`, neither of which exists here.
- `tests/integration/api/evaluation.test.ts`, `tests/unit/reviewer-surface.AC-61-158-159.test.ts` —
  the parent titles these tests `CONTRACT · MRQ-108 · …`; MRQ-110 commit `b8fc999` retitles the same
  tests to `AC-54 ·` / `AC-98 ·` / `AC-59 ·`. Direct conflict, and the parent's convention is the
  correct one (see next issue).
- `cli/api-registry.json` `documentSha256` will need regenerating after the rebase.

**Fix:** rebase onto `github/mrq-108-review-depth` (`fd7e46a`); drop `bee5230` entirely and the
parent-test renames from `b8fc999` (take the parent's `CONTRACT · MRQ-108 ·` titles); reconcile
`commitReview` on top of the parent's `saveNext` rather than replacing it wholesale — the parent's
`actor_id: ""` is the more honest value; regenerate the registry and re-run `pr-gate` on the real
head. Keep the `stacked on MRQ-108 — merge that first; this rebases.` line in the PR body.

**[MAJOR] tests/integration/api/evaluation.test.ts:1479 — the reviewer reminder claims AC-93, which it does not cover**
`EVALUATION.md:373` defines AC-93 as "one action against a filtered set → one outbox row per
recipient from the template, and a send logged on each speaker record", and
`tests/ac-claims/MRQ-24.json` lists AC-93 under MRQ-24's `owns`. The reviewer reminder is
deliberately *not* that path — the ticket's whole point is that reviewers are not participation-
shaped. `tests/unit/reviewer-surface.AC-61-158-159.test.ts:1641` makes the same claim. The trace gate
derives coverage from test titles, so AC-93's coverage set now includes a test that exercises a
different route with a different audience model. The gate also warns
`missing-current-ticket-manifest` — MRQ-110 ships no `tests/ac-claims/` manifest, unlike MRQ-100,
MRQ-104, and MRQ-116.

**Fix:** title the three MRQ-110-owned tests `CONTRACT · MRQ-110 · …` (the prefix the trace parser
already accepts and the parent branch already uses for exactly this situation), and add
`tests/ac-claims/MRQ-110.json` with `"owns": []`, an `"exercises"` list of the ACs genuinely
deepened (AC-54, AC-58, AC-59, AC-98), and a `notes` line stating that the reviewer reminder is a
program-authorized outbox path outside AC-93's speaker audience engine.

**[MINOR] src/routes/comms.routes.ts:566,618,671,705 — the allowlist narrowing removes more than reviewer keys**
Swapping `MAIL_TEMPLATE_KEYS` → `COMMUNICATION_TEMPLATE_KEYS` excludes `REVIEWER_TEMPLATE_KEYS` (the
intent) *and* `AUTH_TEMPLATE_KEYS`. Organizers could previously persist an event-scoped override for
`magic_link_login` / `draft_resume` / `task_link`, which `findTemplate` would then use for real auth
mail; that capability is now gone, and `tests/integration/mail.test.ts:1577` locks the new 400 in.
Closing the "send an auth template to a speaker via `/comms/send`" hole is defensible, but it is a
second behavior change riding in a ticket whose plan only names the reviewer key.

**Fix:** either scope the guard to what the ticket asked for
(`MAIL_TEMPLATE_KEYS` minus `REVIEWER_TEMPLATE_KEYS`), or keep it and say plainly in the PR body that
auth templates are no longer customizable through the comms routes.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:1103 — the coverage cell contradicts itself**
When `progress` is undefined the row renders `No assignments yet` in the subtitle and
`Coverage unavailable` in the action column. Those two claims cannot both be true, and the state is
reached by two very different causes: a reviewer with genuinely zero assignments (the summary query
only returns reviewers that have assignment rows), or the per-round `?summary=1` fetch failing and
falling into the `catch` that returns `{}`. So a healthy empty pool is labelled "unavailable", and a
failed fetch is labelled "no assignments yet" — a false negative on a chair surface whose job is to
tell the operator what is outstanding.

**Fix:** distinguish the two: store `null` for a round whose fetch threw and `{}` for a successful
empty result, then render `Coverage unavailable` only for `null` and `—` / `No assignments yet` for
the empty case.

**[MINOR] src/ui/review/ReviewerPage.tsx:1290 — `Declare conflict` fires immediately, with no confirmation and no way back**
The button sits beside Save, is enabled whenever the reviewer is not mid-save, and one click writes
`abstained: 1` and removes the card from the queue. `assignedSubmissionIds` excludes any submission
with an evaluation row, so the item never returns to the queue, and Completed opens a read-only
detail drawer — from the reviewer's seat the action is irreversible even though the API would happily
overwrite it. The notice ("reopen it any time from Completed") is pre-existing copy that is not
strictly true for either path, but a misclickable one-click destructive control raises the cost.

**Fix:** confirm the recusal (a small inline confirm in the reserved feedback space keeps the layout
stable per the no-jump rule), or offer an Undo in the notice that re-posts the preserved draft.

**[MINOR] src/routes/evaluation.routes.ts:234-245,594 — `event.timezone` leaks into the round payload**
`roundForEvent` now joins `events` to carry `timezone` for the reminder day key, and
`PATCH /api/v1/events/{eventId}/rounds/{roundId}` returns `{ round: <that row> }` verbatim. A round
object now advertises a field that is not a round attribute.

**Fix:** strip it at the response boundary (`const { timezone, ...round } = …`) or fetch the event
timezone separately inside `remindRoundReviewer`.

**[NIT] src/routes/evaluation.routes.ts:315 — the chair's "N complete" number changes silently**
`COUNT(evaluation.id)` → `COUNT(DISTINCT … evaluation.id)` over a `LEFT JOIN` keyed only on
(round_id, submission_id) removes a real fan-out inflation: a submission with 3 assignments and 3
evaluations previously counted 9. The new number is correct, but the headline figure and the progress
bar on the seeded demo will drop noticeably. Worth one line in the PR body so it reads as a fix
rather than a regression when someone diffs screenshots.

**[NIT] scripts/seed/evaluations.ts:238 — no seeded recusal**
Every seeded evaluation has `abstained: 0`, so `1 recusal · needs reassignment`, the
`Recusals excluded from aggregates` note, and the `Conflict declared` record row never appear on the
live site or in the judge's walkthrough. Flipping one seeded evaluation to `abstained: 1` (with its
recommendation/score nulled) makes the whole chair-side half of this ticket visible for free.

**[NIT] src/routes/evaluation.routes.ts:931-940 — outstanding math mixes two assignment shapes**
`assigned_count` counts only rows with `reviewer_person_id = person.id`, while `reviewed_count`
counts every evaluation by that person in the round, including ones made against committee-scoped
assignments (`reviewer_person_id IS NULL`). A reviewer working a committee-scoped round can end up
with `reviewed > assigned`, clamp to `outstanding = 0`, and get a 409. It is consistent with the
`?summary=1` rows (which also filter `reviewer_person_id IS NOT NULL`), so the chair never sees a
Remind button that then fails — no visible contradiction today. Flagging it as a known boundary
rather than asking for a change.

## 4. Positive Observations

- **The abstention round-trip is genuinely correct both ways.** `writeEvaluationRoute` nulls
  recommendation, score, *and* `criteria_scores` on abstain, and the `ON CONFLICT … DO UPDATE SET
  abstained = excluded.abstained` makes recusal → review → recusal converge with no residue. The
  test asserts the exact stored tuple after each transition rather than just the happy path.
- **The aggregate exclusions are complete.** I swept every `FROM evaluations` in `src/` — the round
  progress, plan summary, per-member progress, `listRoundAssignments`, and the submission record
  coverage count all filter `abstained = 0`; `submissions.queries.ts:473`'s `AVG(score)` needs no
  filter because an abstention's score is NULL and `AVG` skips it. A recusal cannot drag an average
  anywhere I could find, which is the thing the ticket said was worse than not shipping.
- **The reminder stayed narrow.** Program-authorized route, direct event-scoped reviewer load, the
  canonical `enqueueOutbox` helper, `reviewer_reminder` deliberately kept out of `recipientsFor` and
  `reminderSelectorSchema.role`. The idempotency entity id `round:person:localDay` derived through
  the event timezone is the right call — a UTC day key would have split an organizer's evening.
- **Cycle-3's draft-preservation fix is real, and the test proves the ordering** rather than the
  presence: `commitReview.indexOf("await api") < commitReview.indexOf("setDrafts(…)")` is a nice way
  to pin "the draft becomes state only after the server accepts".
- **The seed reorder is the correct fix, not a workaround** — committees must exist before rounds now
  that `evaluation_rounds.committee_id` references them, and `WIPE_ORDER` already deletes rounds
  before committees, so reset-demo stays safe with no ordering change.
- **Migration hygiene:** nullable column, index on the FK, old rows preserved as NULL, distribution
  degrading to a 422 with a field-anchored message (`select a reviewer pool for this round`) rather
  than a silent no-op — and a test that clears the pool and asserts the 422 before restoring it.
- **The per-round committee card** now resolves each round's own pool instead of the first committee,
  which was the substantive Cycle-2 finding, and the empty-pool state routes the operator to the
  action that fixes it.

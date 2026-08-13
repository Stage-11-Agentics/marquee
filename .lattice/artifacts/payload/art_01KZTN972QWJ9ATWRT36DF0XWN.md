# Code Review: MRQ-110 — Per-round reviewer pools, recusal, reviewer reminders

Reviewed branch `mrq-110-pools-recusal` @ `bee5230` (stacked on MRQ-108 commits; `github/main` merge-base `fa14e7c`).

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the design is faithfully executed — but `npm run pr-gate -- --ticket MRQ-110` is **red** on this branch, and four of the nine failures are this ticket's own new tests. There is also one real data-loss path in the reviewer surface. Both are small, mechanical fixes; the task should return to `in_progress`, not `in_planning`.

Evidence gathered locally (load 4.79, well under the 24 threshold):

- `npx tsc --noEmit` — clean.
- `npm test` — **pass**, 19.9s of a 45s budget, hermetic.
- `npx vitest run tests/integration/api/evaluation.test.ts tests/unit/reviewer-surface.AC-61-158-159.test.ts tests/integration/mail.test.ts` — 46/46 pass.
- `npm run pr-gate -- --ticket MRQ-110` — **fail**, `"failedCheck": "merged AC trace"`.

## 2. Summary

All four plan outcomes are implemented and behave correctly at the API layer: nullable `evaluation_rounds.committee_id` with event-scoped validation, distribution falling back to the round's persisted pool, abstention as a first-class evaluation state that clears score/recommendation/criteria and completes the assignment, aggregates and denominators filtering `abstained = 0` at every consumer, and a narrow reviewer-reminder route that goes straight to `enqueueOutbox` without touching `recipientsFor` or the audience-role enum. Test coverage is genuinely good — round-trip recusal, cleared-pool distribution rejection, cross-event pool 404, reminder idempotency, and the exact `1 recusal · needs reassignment` copy are all asserted.

The blocking finding is the gate: the four new tests are titled `ABS-02 · …` / `MRQ-110 · …`, and `scripts/checks/trace-ac-core.mjs:45` accepts only `AC-<n> · ` or `CONTRACT · ` prefixes. The second finding is that `commitReview` overwrites the reviewer's draft *before* the network write, so a failed "Declare conflict" silently erases entered scores.

## 3. Issues

**[MAJOR] tests/integration/api/evaluation.test.ts:148,175,223 and tests/unit/reviewer-surface.AC-61-158-159.test.ts:69 — new test titles fail the AC-trace prefix rule; the PR gate is red**

`scripts/checks/trace-ac-core.mjs:45` matches `^((?:AC-\d+(?:\s*[,+]\s*AC-\d+)*)|CONTRACT)\s+·\s+`. The four new titles use `ABS-02 · `, `ABS-12 · `, `ABS-09 · `, and `MRQ-110 · `, none of which match, so `merged AC trace` fails and `npm run pr-gate -- --ticket MRQ-110` exits `"status": "fail"`. The plan's Verification section requires pasting *passing* gate output into the completion comment, so this blocks the ticket's own exit condition. The repo's established convention for work whose AC IDs are not yet minted is the `CONTRACT ·` prefix (`CONTRACT · MRQ-100 keeps Submitted and Withdrawn status filters populated` passes today).

**Fix:** rename to `CONTRACT · ABS-02 · a round carries its own committee pool…`, `CONTRACT · ABS-12 · …`, `CONTRACT · ABS-09 · …`, and `CONTRACT · MRQ-110 · reviewer and chair surfaces label recusals…`. Re-run `node scripts/checks/trace-ac.mjs` to confirm the four entries clear.

Note: five *further* `invalid-title-prefix` errors on this branch (`MRQ-108 · …` in `evaluation.test.ts:451,483,523`, `reviewer-queue.AC-59-65-244-246.test.ts:263`, `reviewer-surface.AC-61-158-159.test.ts:53`) come from the stacked MRQ-108 commits, not from this work. They must be fixed on MRQ-108 or the gate stays red here after rebase — worth calling out explicitly in the stacked PR body alongside the `stacked on MRQ-108 — merge that first; this rebases.` line.

---

**[MAJOR] src/ui/review/ReviewerPage.tsx:321 — a failed "Declare conflict" destroys the reviewer's in-progress scorecard**

`commitReview` calls `setDrafts((previous) => ({ ...previous, [current.id]: review }))` *before* the POST. `saveRecusal` (line 366) passes `{ ...draft, abstained: true, criteria: {}, recommendation: null, score: null }`. If the write fails — offline, 500, session expiry — the catch only calls `setError`, and the draft has already been replaced by the emptied recusal state.

**Failure scenario:** a reviewer fills in every rubric criterion, picks Approve, then clicks "Declare conflict" (deliberately or by misclick on the adjacent button). The request 500s. The error banner appears, the submission stays in the queue, and every entered score plus the recommendation is gone; "Save recommendation & next" is now disabled because `recommendation` is null. The reviewer must re-read the abstract and re-enter everything.

**Fix:** move the draft mutation into the success path — keep the payload local, and only `setDrafts(... review)` after `await api(...)` resolves. The optimistic-completion behavior the cycle-2 resolution asked for is unaffected; it already happens after the await.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:340 — Remind blanks the entire chair surface**

`remindReviewer` ends with `await load()`, and `load()` starts with `setLoading(true)`; the render guard at line ~437 swaps the whole page for the `evaluation-loading` instrument. A one-row action therefore replaces the chair's page with "Loading conference review machinery…" and rebuilds it, discarding scroll position and flashing the notice the action just set. It also refetches the plan detail plus one summary request per round to update a single row's outstanding count. (`updateRound` and `distribute` share this pattern, so it is at least consistent — but those are page-level mutations, and this one is not.)

**Fix:** either refresh only `reviewerProgress` for the affected round, or give `load()` a `{ quiet: true }` option that skips `setLoading(true)` for row-level refreshes.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:429 — a plan-scoped number is rendered inside a round-scoped row**

When a committee member has no outstanding assignments the action cell falls back to `{member.progress} complete`. `member.progress` comes from `planDetail`'s per-member `reviewCount`, which counts evaluations across `round.plan_id` — every round in the plan. The line directly above it reads `${progress.reviewed_count} / ${progress.assigned_count} reviewed`, which *is* round-scoped. With two rounds configured, the same row can read `3 / 3 reviewed` and `7 complete`, which invites the chair to read 7 as this round's number. This cuts against the "the organizer's language" / truthful-surface rules in PHILOSOPHY.md.

**Fix:** use the round-scoped `progress.reviewed_count` for the fallback (`{progress?.reviewed_count ?? 0} complete`), or relabel it explicitly as plan-wide.

---

**[MINOR] src/routes/evaluation.routes.ts:946 — reminder idempotency uses the UTC day, not the organizer's day**

`new Date().toISOString().slice(0, 10)` buckets the idempotency key by UTC date. For a US-Eastern organizer the "one reminder per day" window rolls over at 20:00 local, so two reminders sent the same working evening (19:55 and 20:05 ET) both queue, while two sent the following morning are collapsed. The event row carries a `timezone`, and `roundForEvent` is already loaded.

**Fix:** derive the day in the event's timezone, or document the UTC boundary in the response/notice copy so the behavior is at least predictable.

---

**[MINOR] src/routes/evaluation.routes.ts:305–372 — abstention filtering lives at consumers, not in a shared helper**

The plan's Outcome 3 requires composing with MRQ-109's shared aggregate helper. MRQ-109 is not an ancestor of this branch (`git log` shows only MRQ-108 + MRQ-110 commits), so `abstained = 0` is instead spelled out inline at eight call sites across `evaluation.routes.ts`, `submission-record.routes.ts`, and `review.routes.ts`. That is the correct call given the merge order, but it is a live divergence risk: when MRQ-109's results surface lands with its own aggregate path, it will not inherit the filter. (`submissions.queries.ts:473`'s `AVG(evaluation.score)` happens to be safe only because abstained rows are written with `score = NULL`.)

**Fix:** no code change now. Carry it into the PR body as a named merge-order obligation — "MRQ-109's aggregate helper must apply `abstained = 0`; `submissions.queries.ts:473` relies on NULL scores rather than an explicit filter" — and re-verify after MRQ-109 merges.

---

**[NIT] src/ui/evaluation/evaluation.css:63 — dead CSS fallback**

`var(--danger, #8f2118)` — `--danger` is defined unconditionally at `src/styles/tokens.css:44`, and every other consumer in the codebase writes plain `var(--danger)`. The literal is unreachable and drifts from the token if the palette changes.

**Fix:** `color: var(--danger);`

---

**[NIT] src/routes/evaluation.routes.ts:944 — 409 for a reviewer who has no assignments at all**

`ApiError.conflict("reviewer has no outstanding assignments")` covers both "finished everything" (a genuine conflict) and "was never assigned to this round" (arguably 422/404). The UI only renders Remind when `outstanding_count > 0`, so this is API-surface tidiness rather than a user-visible defect.

---

**[NIT] migrations/ — two migrations share the `0009_` prefix**

`0009_file_comments.sql` and `0009_criterion_kinds.sql` both exist on this branch (the latter from MRQ-108). Wrangler orders lexically so it resolves deterministically today, but a duplicate ordinal is a trap for the next migration author. `0010_evaluation_round_committees.sql` is correctly numbered and not implicated; flagging for the stack owner.

## 4. Positive Observations

- **The abstention semantics are genuinely correct, not just present.** `writeEvaluationRoute` nulls recommendation, score, *and* criteria on abstention, and the `ON CONFLICT … abstained = excluded.abstained` upsert makes the recusal↔review transition round-trippable in both directions. The test at `evaluation.test.ts:175` proves that round trip explicitly — recuse, restore a full scored review, recuse again, and assert the row is fully cleared each time. That is the hard case, and it is covered.
- **The Zod `superRefine` is the right shape.** Requiring a recommendation unless abstaining, and *rejecting* a recommendation when abstaining, closes the "recusal that quietly carries an opinion" hole at the boundary rather than in the handler — and the test asserts no row is written on either rejection.
- **The reminder path stayed narrow, exactly as the contract demanded.** `reviewer_reminder` is added to `MAIL_TEMPLATE_KEYS` but deliberately kept out of `COMMUNICATION_TEMPLATE_KEYS`, so it is unreachable from `createTemplate`/`preview`/`send` and invisible in the organizer's Communications manifest. Tightening those four comms call sites from `MAIL_TEMPLATE_KEYS` to `COMMUNICATION_TEMPLATE_KEYS` is a real hardening win — it also stops `magic_link_login` from being addressable by the comms route, and `mail.test.ts` now asserts that rejection.
- **Idempotency is done properly**, through the canonical `enqueueOutbox` unique-constraint path with `entityId = round:person:day` rather than a hand-rolled pre-check, and `enqueueMailMessage` fires only on `inserted` — so a duplicate press cannot double-queue the worker either.
- **The cycle-2 UI resolutions were honored, not paraphrased.** The committee card re-renders per round from each round's persisted `committee_id`; the recusal line reserves its height with ` ` and `min-height: 16px` so nothing jumps; the recusal count is a summary note rather than an orphan fifth tile in the two-column grid; and the action track widened to 88px with a mobile `grid-column: 2` rule so `Remind` stays inside the row. That is the "elements never jump" rule applied without being asked twice.
- **Per-round progress loading degrades independently** — one failing round's summary fetch yields `{}` and leaves the plan rendered, with a comment explaining why. Correct instinct for a secondary affordance.
- **The test seams are behavioral, not structural**, where it counts: the distribution test compares actual `round_assignments` rows against actual `committee_members` rows rather than trusting a response count, and the cleared-pool case asserts the 422. The source-level assertions in `reviewer-surface` are the codebase's existing idiom for UI copy.

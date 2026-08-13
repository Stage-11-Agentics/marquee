# Code Review: MRQ-110 — Per-round reviewer pools, recusal, reviewer reminders

Reviewer: independent (cold context). Head reviewed: `3e07877` on `mrq-110-pools-recusal`
(working tree clean; diff in the prompt matches HEAD).

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the data/API layer is correct and well tested. What fails is the
craft layer on the ticket's own headline control: the new `Declare conflict` button ships
a 30px tap target on the mobile reviewer surface — the one surface whose acceptance
criteria (AC-158/159) exist for mobile — and renders 12px taller than and misaligned with
the Save button it sits beside. Both are verified, not inferred (measurement below), and
both are two-line CSS fixes. Three smaller chair-surface truthfulness/copy nits are listed
with them.

## 2. Summary

I reviewed the migration, `evaluation.routes.ts`, `review.routes.ts`,
`submission-record.routes.ts`, the mail template/outbox path, the two Preact surfaces, the
CSS, and the tests. The backend is genuinely good work: abstention is a real column-level
state with clean upsert semantics, every aggregate and denominator I could find was
audited for it, the reminder is a narrow program-authorized outbox write that stays out of
`recipientsFor`, and the round→committee FK respects the demo wipe order. I ran the full
suite (134 tests + 46 integration/unit in the touched files, all green, 19.8s),
`check:seed`, `check:api`, and `trace:ac` — all pass. Every finding below is UI-layer.

Verification I ran myself (not taken on trust):
- `npm test` → pass, 19.8s, hermetic, under the 45s budget.
- `npx vitest run tests/integration/api/evaluation.test.ts tests/unit/reviewer-surface.AC-61-158-159.test.ts tests/integration/mail.test.ts` → 46/46 pass.
- `npm run check:seed`, `npm run check:api` (exit 0), `npm run trace:ac` (no errors, no uncovered).
- Headless Chromium measurement of the exact new CSS rules to confirm issue #2.

## 3. Issues

**[MAJOR] src/ui/review/review.css:134 — `Declare conflict` is a 30px tap target at mobile width**
The mobile block gives every other control on this surface an explicit ≥44px target —
`.decision-button` 48px, `.score-buttons button` 44px, `.clear-score` 44px,
`.review-open-row .button` 44px, `.comparison-open` 44px, `.reviewer-save` 48px — and two
of those are asserted by `tests/unit/reviewer-surface.AC-61-158-159.test.ts:48-49`. The new
`.reviewer-conflict` is added to `.review-save-actions` (which does get a mobile
`grid-template-columns: 1fr`) but never gets a mobile min-height, so it inherits
`.button { min-height: 30px }`. A reviewer working the queue on a phone — the persona
AC-158/159 exists for — gets a sub-standard target on the one destructive-ish action in
the flow, directly under a 48px Save button.
**Fix:** in the `@media` block beside `.reviewer-save`, add
`.reviewer-conflict { min-height: 48px; }` (48 to match its row partner). Consider
extending the existing style assertion in `reviewer-surface.AC-61-158-159.test.ts` to
cover it so it can't regress.

**[MINOR] src/ui/review/review.css:65-66 — the two save-row buttons render at different heights with misaligned tops**
`.review-save-actions` is a two-column grid with no `align-items`, so both children
stretch; `.reviewer-save` carries `margin-top: 12px` while `.reviewer-conflict` carries
none. The row track sizes to 42px, Save occupies 30px pushed to the bottom, and
`Declare conflict` stretches to the full 42px. Measured in headless Chromium against these
exact rules: `save { top: 12, height: 30 }`, `conflict { top: 0, height: 42 }`. Two
adjacent buttons, 12px of vertical disagreement, on the primary action row — against a
design contract that reserves a ` ` line one card over specifically to keep things
from moving.
**Fix:** move the offset to the container and neutralize it on the child, so the comparison
card's standalone `.reviewer-save` keeps its spacing:
`.review-save-actions { align-items: center; margin-top: 12px; }` and
`.review-save-actions .reviewer-save { margin-top: 0; }`.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:445-451 — the committee row prints the same phrase twice**
When a member has no progress entry, `coverageLabel` resolves to `"No assignments yet"` /
`"Coverage unavailable"` and the `action` slot resolves to the identical string, so the row
renders e.g. `Nora Vale … No assignments yet   No assignments yet`. `"Coverage unavailable"`
also has to fit the 88px `.committee-person-action` track, which it won't at that width.
**Fix:** keep the sentence in `coverageLabel` and render `—` (or nothing) in the action slot
when there is no `progress`; the action column is for actions.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:180-197 — "No assignments yet" is shown while coverage is still loading**
`load()` deliberately calls `setLoading(false)` before awaiting the per-round
`assignments?summary=1` fetches, so the first paint has `reviewerProgress[round.id]`
`undefined`. The label logic distinguishes only two states — value vs `null` — and folds
`undefined` into `"No assignments yet"`. For the seeded demo (3 reviewers with real
assignments) the chair briefly reads a false statement about their own committee before it
flips. The Cycle-4 resolution asked to distinguish successful-empty from failed; the
still-loading third state was missed.
**Fix:** treat `undefined` as loading — render a reserved-height placeholder
(`"Reading coverage…"` or ` `, matching the recusal-status pattern already used in
`renderRound`) until the entry exists.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:352 — the duplicate-reminder notice misstates the window**
Idempotency is per reviewer **per round per event-local day** (`entityId` is
`${roundId}:${personId}:${reminderDay}`), but the notice reads
`"Reviewer reminder already queued for this round"`. An organizer who reminds on Tuesday
after reminding on Monday will queue a second message despite having been told the round
was already covered.
**Fix:** `"Reviewer reminder already queued today"`.

**[MINOR] src/routes/evaluation.routes.ts:578 — a cross-event pool on round PATCH escapes the inline error seam**
`committeeForEvent` throws `notFound` (404), but `updateRound` in the UI only routes 422s
to `roundErrors[round.id]`; a 404 lands in the page-level alert, away from the select the
operator just changed — which is the exact behavior the comment above `updateRound`
(`EvaluationPage.tsx:359-363`) says the surface is trying to avoid. Low-frequency (the
select only offers this event's committees), but it's the one input on that card that can
produce it.
**Fix:** raise `ApiError.unprocessable("committee is not in this conference", "committee_id")`
when a round PATCH/POST supplies a committee outside the event, keeping bare
`committeeForEvent` 404s for direct committee routes. Note this would need the
`expect(crossEvent.status).toBe(404)` assertion at `tests/integration/api/evaluation.test.ts:1475`
updated with it.

**[NIT] src/routes/evaluation.routes.ts:857-874 — one operationId, two response shapes**
`?summary=1` makes `listRoundAssignments` return a different row shape than its default,
and a caller passing both `summary=1` and `submission_id` silently gets the default shape
with no signal. For a repo that ships a generated `cli/api-registry.json` and types its
clients off the operation, a separate `…/assignments/summary` operation would type better.
Not worth a rework on its own — flagging it in case a later ticket touches this route.

## 4. Positive Observations

- **The abstention semantics are honest all the way down.** `abstained = excluded.abstained`
  in the upsert (rather than the old hardcoded `0`) means a review→recusal→review round
  trip actually clears `recommendation`, `score`, and `criteria_scores` instead of leaving
  a half-state; the test at `evaluation.test.ts:1514` walks exactly that cycle and asserts
  the stored row, not just the response.
- **The aggregate audit is thorough and I could not find a hole.** `planDetail` round
  progress, the plan summary (including the `wide_spread` correlated subquery), the
  committee member review count, `listRoundAssignments` both shapes, and
  `submission-record.routes.ts` coverage all filter `abstained = 0`. I checked the two
  consumers *not* touched — `submissions.queries.ts:473` (`AVG(evaluation.score)`, safe
  because abstentions store `NULL`) and `review.routes.ts:172` (`NOT EXISTS`, correct: a
  recusal should leave the queue) — and both are right by construction rather than by luck.
- **The `COUNT(DISTINCT …)` correction is a real pre-existing bug fixed in passing.** The
  `LEFT JOIN evaluations` in `planDetail` joins on `(round_id, submission_id)` only, so the
  old `COUNT(evaluation.id)` multiplied by the assignment fan-out. Good catch, and the plan
  already commits to naming it in the PR body.
- **The reminder stayed narrow, exactly as the contract demanded.** A dedicated
  `REVIEWER_TEMPLATE_KEYS` outside `COMMUNICATION_TEMPLATE_KEYS`, no `reviewer` in
  `reminderSelectorSchema.role`, no `recipientsFor`, `findTemplate`'s default fallback doing
  the resolution, and `enqueueOutbox`'s existing `inserted` flag carrying idempotency
  instead of a new dedupe mechanism. The response says `queued`, never "sent" — no false
  claim, matching the demo-safe send policy.
- **The event-timezone day key is the right call and is kept internal.** Deriving
  `reminderDay` from the event's timezone means the one-per-day boundary matches the
  organizer's calendar, and `publicRound()` strips `timezone` from every round payload —
  with a test at `evaluation.test.ts:1596` that asserts the absence rather than trusting it.
- **The FK ordering was thought through.** `WIPE_ORDER` already deletes `evaluation_rounds`
  (27) before `committees` (30), and the seed's committee block was moved *above*
  `evaluation_plans` so inserts satisfy the new reference. `check:seed` passes against a
  fresh migration chain, which is the thing that would have caught it.
- **Test quality is high for a UI-heavy ticket.** The reminder test asserts the stored
  outbox row's `template_key`, `person_id`, rendered `text`, and the `entity_id` day-key
  shape; the round-pool test asserts the *actual assigned reviewer set* equals the
  committee's member set rather than just a 200; and the source-level UI test pins the
  ordering constraint that matters (`await api` before `setDrafts`), which is the Cycle-3
  fix expressed as an executable invariant rather than a comment.

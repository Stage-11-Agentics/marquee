# Code Review: MRQ-110 — Per-round reviewer pools, recusal, reviewer reminders

**Reviewed sha:** `c80f11b` (branch `mrq-110-pools-recusal`, stacked on MRQ-108).
**Note on worktree state:** while this review was in progress, `Marquee-worktrees/mrq-110-pools-recusal`
went to a detached HEAD at MRQ-108's newer tip (`e6a07e8`) with staged UI modifications — the
delegator appears to be mid-rebase. Nothing was touched. Everything below is pinned to `c80f11b`,
which is still what the branch ref points at. No PR is open yet for this head.

**Verification I ran** (at `c80f11b`, load avg 6.77, well under the 24 threshold):
`npx vitest run tests/integration/api/evaluation.test.ts tests/integration/api/reviewer-queue.AC-59-65-244-246.test.ts tests/integration/mail.test.ts tests/unit/reviewer-surface.AC-61-158-159.test.ts`
→ **4 files, 54 tests passed, 2.85s.**

---

### 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the server-side work is genuinely good. Two UI defects and a set of
test gaps against the plan's own Verification list need a pass before this ships. The rework
is bounded and mechanical — no architectural change.

### 2. Summary

Reviewed the full MRQ-110 diff: the nullable `evaluation_rounds.committee_id` migration and its
distribution/plan plumbing, the abstention path through `writeEvaluationRoute` and every aggregate
that consumes `evaluations`, and the narrow reviewer-reminder route with its reviewer-only outbox
template. The data model is the strongest part of this change: abstentions store `score = NULL`, so
every existing `AVG(score)` in the codebase (e.g. `src/routes/submissions.queries.ts:473`) is
correct without being touched, and the COUNT-based aggregates — where NULL would *not* have saved
you — were each explicitly filtered. The scope discipline the ticket asked for held: no
`recipientsFor`, no `reminderSelectorSchema.role` widening, no per-round membership rows.

The key findings are on the chair surface. At mobile width the reviewer row's action cell loses its
grid placement rule and overflows the 28px avatar track; and the Remind/coverage affordance is
hardwired to round 1 and `committees[0]`, which is precisely the assumption this PR's own headline
feature (per-round pools) removes.

### 3. Issues

```
**[MAJOR] src/ui/evaluation/evaluation.css:109 — the mobile grid rule no longer matches the reviewer action cell**
```
At ≤600px, `.committee-person` collapses to `grid-template-columns: 28px minmax(0, 1fr)` and line 109
forces the third child back under the name column with `.committee-person > .tabular { grid-column: 2; }`.
That third child used to be `<span class="tabular subtle">`. It is now
`<span class="committee-person-action">` (`EvaluationPage.tsx:455`), with the `.tabular` span nested
*inside* it — so the direct-child selector matches nothing. Auto-placement drops the action cell into
row 2, column 1: a 28px fixed track holding an element with `min-width: 88px` and a `Remind` button.
It overflows to the right of the avatar column on every phone-width render. This repo carries explicit
mobile ACs (AC-158/159), so this is a regression on a surface the project tests for.
**Fix:** update the selector to the new class, e.g.
`.committee-person > .committee-person-action { grid-column: 2; justify-content: flex-start; }`
(keeping the old `.tabular` rule is harmless but no longer does anything).

```
**[MAJOR] src/ui/evaluation/EvaluationPage.tsx:455 — Remind and reviewer coverage are hardwired to round 1 and committee[0]**
```
`const progress = firstRound ? reviewerProgress[firstRound.id]?.[member.id] : undefined` and
`remindReviewer(firstRound!, member.id)` pin the whole affordance to the first round, over
`plan.committees[0]`'s member list. This PR's other headline feature is that *each round* now carries
its own pool. So for a two-round plan where round 2 uses a different committee: those reviewers have
no Remind action, no coverage line, and the chair has no outstanding signal for them at all —
Outcome 4 ("each reviewer progress row with outstanding assignments has a narrow Remind action") is
only satisfied for round 1. The waste is visible in the code too: `load()` fetches
`assignments?summary=1` for *every* round (line 169) and `reviewerProgress` is then only ever read at
`firstRound.id` — round 2's request is issued and discarded on each load.
**Fix:** render the reviewer rows for the round being displayed (or one block per round), sourcing
members from that round's `committee_id` rather than `plan.committees[0]`, and pass that round into
`remindReviewer`. If per-round rows are out of scope for this PR, stop fetching the summary for rounds
you will not render.

```
**[MINOR] src/ui/evaluation/evaluation.css:60 — 88px min-width inside an 80px fixed grid track**
```
`.committee-person` (line 38) defines the third track as a fixed `80px`; `.committee-person-action`
sets `min-width: 88px`. A fixed track does not grow to fit an item's min-width, so the cell overflows
its track by 8px on desktop as well. The reserved width was clearly added for the "elements never
jump" rule — good instinct, wrong number.
**Fix:** widen the track (`grid-template-columns: 28px minmax(0, 1fr) 88px`) and drop the `min-width`,
so one declaration owns the reserved space. Also check the swap height: a `Button small` and a bare
`<span>` are not the same height, so rows may still shift between "Remind" and "N complete" states —
`min-height` on `.committee-person-action` closes that.

```
**[MINOR] src/ui/evaluation/EvaluationPage.tsx:449 — a fifth metric tile orphans in a two-column grid**
```
`.evaluation-metrics` is `grid-template-columns: repeat(2, minmax(0, 1fr))` (evaluation.css:32). The
strip had four tiles (two clean rows); "Recusals" makes five, leaving a lone half-width tile on row 3.
**Fix:** either promote a sixth tile, or move the recusal count out of the metric strip — it is
arguably better placed beside the per-round `1 recusal · needs reassignment` line it explains, since
the plan-level number without a round is not actionable.

```
**[MINOR] src/ui/review/ReviewerPage.tsx:348 — saveRecusal duplicates saveNext almost line for line**
```
`saveRecusal` (348–370) and `saveNext` (319–346) differ only in the forced abstention and the notice
string; the POST body, queue splice, `setCompleted`, `setCurrentId`, and error/finally handling are
identical ~20 lines. Two copies of the queue-advance logic will drift.
**Fix:** one `commitReview({ abstained }: { abstained: boolean })`, with the two buttons passing the
flag and the notice derived from it.

```
**[MINOR] src/ui/review/ReviewerPage.tsx:363 — a fresh recusal shows as "Recorded", not "Conflict"**
```
The recusal is pushed into `completed` as `{ ...saved, review: null }`, so the new
`item.review?.abstained ? "Conflict" : …` chip cannot fire until the next full load — the reviewer
declares a conflict and immediately sees the row labelled "Recorded". `saveNext` has the same shape,
so this is inherited rather than introduced, but the new chip is the whole point of the change.
**Fix:** push a minimal review object (`review: { abstained: true, recommendation: null, … }`) so the
optimistic row tells the truth.

```
**[MINOR] tests/integration/api/evaluation.test.ts — several items the plan's Verification section promised are untested**
```
The three new tests are well-targeted, but against the plan's own list:
- **Event scoping is untested.** The plan says "round committee create/read/update **and event
  scoping**"; there is no case asserting a committee from another event is rejected on
  `POST /plans` / `POST /rounds` / `PATCH /rounds`. That validation (`committeeForEvent`) is the whole
  security argument for the new column.
- **Neither `superRefine` branch is covered** — `abstained: 1` with a recommendation (422) and
  `abstained: 0` without one (422). Both are new rejection paths.
- **The recusal round-trip is untested, and it is the riskiest edit in the diff.** The upsert's
  hardcoded `abstained = 0` became `abstained = excluded.abstained` (`review.routes.ts:891`). Nothing
  asserts that converting an existing scored review into a recusal clears `score`/`criteria_scores`/
  `recommendation`, or that converting a recusal back into a real review restores them and flips
  `abstained` to 0.
- No case for distribution's new 422 when neither `body.committee_id` nor `round.committee_id` is
  set, nor for clearing a round's pool back to `NULL`.
**Fix:** add these four; each is a few lines against the existing fixtures.

```
**[MINOR] tests/unit/reviewer-surface.AC-61-158-159.test.ts:73 — assertions on source substrings**
```
`expect(reviewerPageSource).toContain("abstained: recusal.abstained ? 1 : 0")` asserts an exact
expression from the implementation. Deduping `saveRecusal` into `saveNext` (finding above) breaks this
test without changing any behaviour. The `data-reviewer-control="declare-conflict"` and copy-string
assertions in the same test are fine — those are contracts.
**Fix:** keep the control-presence and copy assertions; drop the expression-level ones, or move the
payload assertion to the integration test that already exercises the route.

```
**[MINOR] src/routes/evaluation.routes.ts:947 — a reviewer can be reminded exactly once per round, forever**
```
`entityId: `${roundId}:${personId}`` feeds `buildIdempotencyKey`, which is a plain
`sha256(templateKey:entityId:personId)` with no time component. The second press — a week later, with
work still outstanding — returns `queued: false` and sends nothing. The UI is honest about it
("Reviewer reminder already queued for this round"), the plan did say "idempotent", and this matches
the existing `sendComms` convention (`comms.routes.ts:713`), so it is defensible. But "the system does
the chase work" is a stated project principle, and a chase you can run once is not a chase.
**Fix (if the operator wants re-remindability):** bucket the entity id by day —
`${roundId}:${personId}:${new Date(now).toISOString().slice(0, 10)}` — and keep the duplicate response
for same-day presses.

```
**[MINOR] src/ui/evaluation/EvaluationPage.tsx:161 — the comment overstates what the code does**
```
"keep the primary render independent from the optional reminder affordance" — but a failure inside the
`Promise.all` still falls to the shared `catch` and raises a page-level error alert over an otherwise
healthy plan. The `setLoading(false)` before the await does get the plan painted first, which is half
the intent.
**Fix:** catch per round and leave that round's entry empty (`{}`), so a coverage failure degrades to a
missing Remind button rather than a page-level alarm — then the comment is true.

```
**[MINOR] src/routes/comms.routes.ts:566,618,671,705 — an in-scope but unannounced behaviour change**
```
Swapping `MAIL_TEMPLATE_KEYS` for `COMMUNICATION_TEMPLATE_KEYS` is necessary — otherwise
`reviewer_reminder` becomes addressable by the speaker audience engine, which the ticket forbids. But
it also newly rejects the three `AUTH_TEMPLATE_KEYS` on create/update/preview/send, which previously
passed. Risk is low (`listCommunicationTemplates` never surfaced them, and `findTemplate` still reads
any persisted row), and the new `mail.test.ts` case pins the rejection.
**Fix:** none needed in code — call it out in the PR body so a reviewer of the *stack* is not surprised
by a comms-route change in a review-depth PR.

**Not a defect, but flag it in the PR body:** the plan required composing with MRQ-109's shared
aggregate helper. MRQ-109 is not in this branch's history and no such helper exists here, so the
abstention filters are inline SQL in `evaluation.routes.ts` and `submission-record.routes.ts`. That is
the only thing that could have been done, but whichever of MRQ-109/MRQ-110 merges second must
reconcile the two rather than leaving one aggregate filtered and the other not.

**Also outstanding (workflow, not code):** no PR is open for this head, and the plan requires the body
to carry `stacked on MRQ-108 — merge that first; this rebases.`

### 4. Positive Observations

- **The abstention model is chosen well, not just implemented.** Storing `score = NULL` on an
  abstention means every pre-existing `AVG(score)` in the codebase is silently correct — including
  `submissions.queries.ts:473`, which this PR never touches. The explicit `abstained = 0` filters were
  then applied exactly where NULL would *not* have helped: the COUNT-based progress, coverage, and
  member-progress queries. That is the right division, and it is why the blast radius stayed small.
- **The whole loop agrees on what a recusal is.** Round progress, plan summary, submission-record
  coverage, the reviewer's own queue, and the completed list all report a recusal as "complete but not
  reviewed". The queue needed no change at all — its existing `NOT EXISTS (evaluations …)` already
  removed the card — and the delegator correctly left it alone instead of adding a redundant filter.
  The `reviewers[0].coverage.reviewed === 0` assertion in the ABS-12 test is the right thing to pin.
- **The reminder really is narrow.** Program-authorized, event-scoped through the `memberships.role =
  'reviewer'` join (matching `addCommitteeMember`'s own check), outstanding count derived from the same
  seam as `listRoundAssignments`, canonical `enqueueOutbox`, and `reviewer_reminder` deliberately kept
  out of `COMMUNICATION_TEMPLATE_KEYS` so the audience engine cannot address it. This is precisely the
  shape the ticket asked for, and the resolution note about not touching `reminderSelectorSchema.role`
  was honoured.
- **Migration hygiene is complete.** `0010` plus both registration points (`apply-migrations.ts` and
  `schema-verify.mjs`), the FK graph count moved 91→92, and — the nice touch — the schema-verify
  fixture inserts were rewritten from positional to named columns, so the next column addition will not
  break them again.
- **Distribution does the right thing with the new optional pool:** explicit `committee_id` wins, the
  round's persisted pool is the fallback, and a clear 422 (`"select a reviewer pool for this round"`)
  when neither exists — with no per-round membership rows invented and the track-scope validation
  untouched.
- **The "elements never jump" rule was visibly considered:** `.round-recusal-status` reserves
  `min-height: 16px` with a ` ` fallback so the recusal line does not push the round meta around,
  and the action cell reserves width. The 88-vs-80 conflict is a miss, but the intent was there.
- **Copy is honest.** `1 recusal · needs reassignment`, `Conflict recorded · reopen it any time from
  Completed`, and `Reviewer recused; no recommendation recorded.` all say what happened without
  claiming a message was sent or a review was collected.

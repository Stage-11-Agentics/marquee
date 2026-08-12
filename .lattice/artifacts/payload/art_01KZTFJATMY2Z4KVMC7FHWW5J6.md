# Code Review: MRQ-110 — Per-round reviewer pools, recusal, reviewer reminders

Reviewed at `Marquee-worktrees/mrq-110-pools-recusal` @ `22c1914` (base `f27a44c`, MRQ-108).
Checks actually run: `tsc -p tsconfig.json`, `tsc -p tsconfig.client.json`, `tsc -p tsconfig.test.json`,
`npm run check:design`, `npm run check:api`, `npm test`, `npx vitest run tests/integration/api/evaluation.test.ts`.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the API/data layer is largely right. But the client does not compile,
the headline reviewer-facing action (`Remind`) is wired as a GET and therefore cannot work,
the CLI API registry was never regenerated, and the chair-facing surfaces that the ticket
specifically called out still present a recusal as a completed review. None of that requires
a new plan — it requires rework against the plan already written.

## 2. Summary

Reviewed the migration, `evaluation.routes.ts` / `review.routes.ts` changes, the mail template
and merge-data additions, both Preact surfaces, and the three new integration tests. The
abstention data model is clean and correct — the upsert, the queue-exit semantics, the
`abstained = 0` filters on the round/plan aggregates, and the recusal counters all hold up, and
the new tests pass in 3.4s.

The key finding is that **the PR gate was not run against this head**: `npm run pr-gate` fails at
step 2 (`client types`) on a real type error in the `Remind` call, which is also a live functional
defect — the button issues a GET to a POST-only route, so the reviewer-reminder feature (ABS-09,
register row 14) does not work at all in the product. Secondary but substantive: the chair's
per-submission record and the committee member progress counter still count a recusal as a review,
which is the exact failure mode the ticket named as worse than not shipping.

## 3. Issues

**[CRITICAL] src/ui/evaluation/EvaluationPage.tsx:325 — `Remind` sends a GET; the feature never works, and the client typecheck fails**

The local helper is `api<T>(path: string, route: string, init: RequestInit = {})` (line 106), but
`remindReviewer` calls it with two arguments:

```ts
const response = await api<{ queued: boolean; outstanding: number }>(`…/remind`, {
  method: "POST",
});
```

`{ method: "POST" }` lands in the `route` parameter (used only for logging), `init` defaults to `{}`,
and `apiFetch` therefore issues a **GET** to a route registered as POST-only — Hono returns 404, so
the operator gets an error alert every time. Confirmed by compiler, not inference:

```
$ npx tsc -p tsconfig.client.json --noEmit
src/ui/evaluation/EvaluationPage.tsx(325,153): error TS2345:
  Argument of type '{ method: string; }' is not assignable to parameter of type 'string'.
```

(The root `tsconfig.json` excludes `src/ui/**`, which is why a plain `tsc --noEmit` looks clean.
`pr-gate` runs the client project as its second check, so the gate could not have passed on this head.)

**Fix:** pass the route template as the second argument:
```ts
await api<{ queued: boolean; outstanding: number }>(
  `/api/v1/events/${eventId}/rounds/${round.id}/reviewers/${personId}/remind`,
  "/api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind",
  { method: "POST" },
);
```
Then re-run `npx tsc -p tsconfig.client.json --noEmit` and click the control in the running app —
the plan's own verification asked for a reachable reviewer action, and a source-level test of the
handler would have caught this before review.

---

**[CRITICAL] cli/api-registry.json — `npm run check:api` fails; the new route is missing from the CLI registry**

```json
"status": "fail",
"findings": [
  { "code": "cli-registry-parity",
    "missing": ["POST /api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind remindRoundReviewer"] },
  { "code": "cli-registry-hash-mismatch",
    "served": "00870224…", "registry": "8e5648e5…" }
]
```

`API contract` is step 6 of `pr-gate`, so this is a second independent gate failure. Every new route
in this repo has to land in the generated registry.

**Fix:** regenerate with `node cli/generate-api-registry.mjs` (the generator beside `cli/api-registry.json`),
commit the result, and re-run `npm run check:api` until `"status": "pass"`.

---

**[MAJOR] src/routes/evaluation.routes.ts:355 and src/routes/submission-record.routes.ts:377-419 — the chair still sees a recusal counted as a review**

Outcome 3 of the plan ("Chair aggregates and denominators exclude abstained evaluations… without
silently counting a recusal as a review") is met for the plan/round aggregates in `planDetail`, but
three chair-facing reads were missed:

1. `evaluation.routes.ts:355` — committee member `progress`:
   `SELECT COUNT(*) … FROM evaluations … WHERE round.plan_id = ? AND reviewer_person_id = ?`
   has no `abstained = 0` filter. `EvaluationPage.tsx:452` renders it as `{member.progress} complete`,
   so a reviewer who recused reads as having completed a review.
2. `submission-record.routes.ts:417` — `reviewed_count` (the `coverage.reviewed` in
   `SubmissionRecordPage.tsx`'s `{reviewed}/{assigned} reviewed`) has the same omission.
3. `submission-record.routes.ts:377-386` — the per-submission evaluation projection does not select
   `abstained`, so `SubmissionRecordPage.tsx:172` renders an abstention as
   `— · No recommendation` inside "Answers and evaluation evidence", and it counts toward
   `{round.evaluations.length} scorecard results`. This is the chair's decision screen: the one
   place the recusal most needs to be labelled truthfully, and the one place it is invisible.

**Fix:** add `AND abstained = 0` to both counters; add `evaluation.abstained` to the record projection,
carry it through the `Round`/`evaluations` interfaces in `SubmissionRecordPage.tsx`, render abstentions
as an explicit "Conflict declared" row, and exclude them from the scorecard-result count. Cover each
with an assertion in `tests/integration/api/` alongside the existing ABS-12 test.
(`submissions.queries.ts:473`'s `AVG(evaluation.score)` is safe by accident — abstained rows persist
`score = NULL` and SQLite's `AVG` skips nulls — but an explicit `WHERE abstained = 0` there would make
the guarantee intentional rather than incidental.)

---

**[MAJOR] tests — no UI/source coverage for any of the three visible controls**

The plan's verification section is explicit: "Targeted UI/source tests cover visible `Declare conflict`,
`Remind`, round pool labeling, and the exact … copy." The diff adds three API tests and zero UI tests.
The critical issue above is precisely what that coverage exists to catch — the `Remind` control has
never been executed, in a test or in a browser.

**Fix:** add source/DOM assertions for `data-reviewer-control="declare-conflict"`, the `Remind` button
and its `POST` (mock `fetch` and assert the method), the `Reviewer pool` select, and the recusal
status string — following whatever pattern the existing reviewer-surface tests use.

---

**[MAJOR] src/ui/evaluation/EvaluationPage.tsx:161-174 + src/routes/evaluation.routes.ts:846-864 — unbounded per-round assignment fetch blocks first paint**

`load()` now fetches `/rounds/{id}/assignments` for **every** round and `await`s all of it *before*
`setPlan(detail)`. That route has no `LIMIT` and returns one row per (submission × reviewer) with three
correlated subqueries each. At AIE scale — say 400 submissions × 3 reviewers × 2 rounds — the evaluation
page pulls ~2,400 rows on every load, and again after every `remindReviewer`, purely to derive four
counters per reviewer. R7 says treat a slow list as a defect. It also couples plan rendering to a second
route: if the assignments call fails, the plan itself no longer renders.

**Fix:** either add a compact per-reviewer aggregate to `planDetail`'s committee member rows
(`assigned/reviewed/recusals/outstanding` — one grouped query, which is what the UI actually consumes),
or at minimum move the progress fetch after `setPlan(detail)` and wrap it so a failure degrades the
Remind affordance instead of the page.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:414 — recusal copy uses a hyphen where the plan and the house style use `·`**

Rendered: `1 recusal - needs reassignment`. The plan's verification names the exact string
`1 recusal · needs reassignment`, and every adjacent separator on this page ("complete · remaining",
"reviewers · explicit track responsibility") uses the interpunct. The ticket description used a hyphen,
so this is an inherited ambiguity rather than carelessness — but the plan is the later, authoritative
artifact.

**Fix:** use `·`, and assert the exact string in the UI test above.

---

**[MINOR] src/ui/review/ReviewerPage.tsx:135, 270, 319, 328-330 — `ReviewState.abstained` is never set to `true`**

`saveRecusal` posts `abstained: 1` directly and never touches the draft, so nothing in the component
ever writes `abstained: true`. That makes three pieces of logic dead: the `...(patch.recommendation ? { abstained: false } : {})`
guard in `updateReview`, the `&& !currentReview.abstained` clause in `saveNext`'s guard, and the two
`currentReview.abstained ? null : …` ternaries in the `saveNext` body. `saveRecusal` is otherwise an
18-line copy of `saveNext`.

**Fix:** drop `abstained` from `ReviewState` and the dead branches, or (preferable) collapse the two
handlers into one `save({ abstained })` and let the single code path carry the flag.

---

**[MINOR] src/routes/comms.routes.ts:566, 618, 671, 705 — the template-key allowlist narrowing is out of scope and untested**

Swapping `MAIL_TEMPLATE_KEYS` → `COMMUNICATION_TEMPLATE_KEYS` correctly keeps `reviewer_reminder` out
of the audience engine (good — that was the constraint). But it also *newly rejects* the three
`AUTH_TEMPLATE_KEYS` (`magic_link_login`, `draft_resume`, `task_link`) from template create/update,
preview, and send. That is defensible hardening and no test or UI writes those keys today, but it is a
behavior change nobody asked for in this ticket and nothing pins it.

**Fix:** keep it (it is the right shape), but add a one-line test asserting an auth key is rejected by
`createTemplate`, and say so in the PR body so the narrowing is a decision rather than a side effect.

---

**[MINOR] src/routes/evaluation.routes.ts:900 — reminder idempotency is permanent, not per-send**

`entityId` is `${roundId}:${personId}` and `buildIdempotencyKey` hashes `(templateKey, entityId, personId)`,
so the **second** reminder a chair ever sends to a given reviewer for a given round returns
`queued: false` — forever, no matter how much later, no matter that outstanding went 2 → 7. The UI
honestly says "already queued", so nothing lies; but the chase workflow this feature exists to serve is
a repeated nudge. This matches the existing `sendComms`/`enqueueBulkReminder` behavior, so it is
consistent rather than novel — flagging it as a product call for the operator, not a code error.

**Fix (if the operator wants repeat nudges):** fold a coarse time bucket into `entityId`
(e.g. `${roundId}:${personId}:${Math.floor(now / 86_400_000)}`), which keeps double-click safety while
allowing a nudge on a later day.

---

**[MINOR] tests/integration/api/evaluation.test.ts:1037 — the reminder test omits the rejection paths the plan named**

The plan asked that the reminder "rejects completed/nonexistent reviewers". The test covers the happy
path and idempotency only; neither the 404 (unknown/non-reviewer person) nor the 409
("reviewer has no outstanding assignments") branch is exercised, and both are hand-written logic.
Likewise the ABS-02 test asserts only `status === 200` from distribution — it never checks that the
resulting `round_assignments` rows belong to the round's persisted pool, which is the actual claim.

**Fix:** two extra `expect(status).toBe(404|409)` assertions, and one query asserting the created
assignments' `reviewer_person_id`s are exactly the round pool's members.

---

**[INHERITED — blocks this PR, but not caused by MRQ-110] tests/node/bulk-paths.AC-66-69.test.mjs:339 — D1 placeholder inventory guard fails on the base commit**

`npm test` fails here: the observed inventory now contains
`{ file: 'src/routes/review.routes.ts', owner: 'reviewsForSubmissions', binding: 'result', expression: 'chunk.map(() => "?")', classification: 'UNCLASSIFIED' }`,
which `EXPECTED_PLACEHOLDER_SITES` does not list. `reviewsForSubmissions` was introduced by the parent
(`f27a44c`, MRQ-108) — it does not exist on `github/main` — and MRQ-110 touches neither the function's
placeholder expression nor the allowlist. So the base is red, and this stack cannot gate green until
MRQ-108 classifies that site.

**Fix:** raise it on MRQ-108 (add the classified entry to `EXPECTED_PLACEHOLDER_SITES`), then rebase.
Do not patch the allowlist from this branch — the guard exists to force the audit on the ticket that
created the site.

*Separately, and not a defect:* `npm test` also reported `OVER BUDGET: 54592ms against a 45000ms objective`.
One-minute load average at the time was **198.9**. Per CLAUDE.md that is machine contention, not a suite
regression — re-time it on a quiet machine before treating it as anything else.

## 4. Positive Observations

- **The abstention data model is the strongest part of this change.** Widening `evaluationInput` with a
  `superRefine` that enforces *both* directions (no recommendation without abstention, no recommendation
  *with* abstention) is exactly right, and clearing `score`/`criteria_scores` server-side rather than
  trusting the client means a recusal cannot become a numeric result even from a hand-rolled request.
  The `abstained = excluded.abstained` upsert makes recuse → un-recuse → re-review all work without a
  second code path.
- **Queue semantics were thought through.** `queueRows`'s `NOT EXISTS (SELECT 1 FROM evaluations …)`
  already keys on row existence rather than recommendation, so an abstention leaves the queue with no
  change to that query — the implementer noticed this instead of adding a redundant filter.
- **The aggregate rewrites are careful.** `COUNT(DISTINCT CASE WHEN abstained = 0 THEN evaluation.id END)`
  preserves the LEFT-JOIN de-duplication that the original `COUNT(evaluation.id)` relied on, and the
  `wide_spread` subquery got the `other.abstained = 0` filter it needed so a recusal cannot skew the
  comparison baseline. Easy to get wrong; not gotten wrong.
- **The reminder path honors the "do not widen the audience engine" constraint literally and well** —
  separate `REVIEWER_TEMPLATE_KEYS`, separate `mergeDataForReviewerReminder` with `reviewer.*` merge
  fields, a direct person load, no `recipientsFor`, no `reminderSelectorSchema.role` change, and the
  canonical `enqueueOutbox` + `enqueueMailMessage` pair. The `COMMUNICATION_TEMPLATE_KEYS` split is a
  genuinely better boundary than the one it replaced.
- **The migration is minimal and reversible-by-omission** — nullable column, index, old rounds preserved
  as `NULL` — with `schema-verify.mjs`'s FK count and explicit-column seed inserts updated in the same
  commit, and `apply-migrations.ts` wired for the integration suite. `WIPE_ORDER` already deletes
  `evaluation_rounds` before `committees`, so the new FK needs no reset-demo change.
- **Distribution's fallback is the right shape**: `body.committee_id ?? round.committee_id`, then a 422
  naming the field when neither exists — the round's persisted pool is used without inventing per-round
  membership rows, exactly as the plan required.
- **The recusal status line reserves its own height** with ` ` and `min-height: 16px`, so the round
  card does not jump when a recusal appears. That is the house UI rule being followed without being asked.

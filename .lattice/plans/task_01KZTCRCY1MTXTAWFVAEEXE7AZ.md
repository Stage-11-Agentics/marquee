# MRQ-109: Chair results: weighted aggregates, sort, real export, progress

ABS-10 (w3 — ascending sort does not exist, fails outright today), ABS-08 (w2 — nearly free), ABS-13 (w2), ABS-04 (w1). STACKED ON the review-depth ticket (needs criteria capture). (1) One shared weighted-aggregate helper (criteria_scores x weight_pct, numeric only, per round; scalar fallback honestly labeled; exclude abstained rows); every consumer reads it. (2) score_asc in SUBMISSION_SORTS + clickable score header; the submissions list IS the results table; prominent 'View results' link from /evaluation into the pre-filtered score-sorted view; label 'Weighted score'; show reviewer count next to score. (3) NEW results export endpoint GET .../plans/{planId}/results/export?format=csv (one row per submission: title/track/format/status/per-criterion/aggregate/count/recommendations) + button. Do NOT wire the existing /rounds/{id}/export — it exports the reviewer's UNREVIEWED queue with zero scores; a button on it passes the robot and fails the human manual check. (4) Committee card progress: roll up listRoundAssignments' existing correct assigned/reviewed per reviewer (EvaluationPage.tsx:289 currently shows person-count over round-total). Full spec: section T-C. Register rows 10,11,13 + ABS-08 miss. DEPENDS ON / STACKED: see boot prompt; parent is the 'Review depth: per-round scorecards, criterion types, reviewer capture' ticket.

---

## Plan (delegator, 2026-08-12)

Base: `github/main @ 23a06b0`. Parent branch `mrq-108-review-depth` does not exist on the
remote yet, so this branch is cut from `github/main` and will be rebased `--onto` the
parent tip once it lands (COMMON.md stacked rule). Nothing below *requires* T-B to have
landed — see "Independence from T-B" — so implementation proceeds now.

### What is actually there today (verified in the worktree)

| Fact | Evidence |
|---|---|
| Aggregate is a bare unlabeled `AVG(score)` across all rounds | `src/routes/submissions.queries.ts:473` |
| `score` sort is desc-only; no ascending key exists anywhere | `src/routes/submissions.queries.ts:22-27`, `SORT_OPTIONS` `SubmissionsPage.tsx:104-109` |
| Table headers are inert `<th>{label}</th>` | `SubmissionsPage.tsx:735` |
| Column label is "Score" | `src/lib/submission-columns.ts:15` |
| The only CSV export is a client-side dump of the *list* columns (no per-criterion, no count, no recommendations) | `SubmissionsPage.tsx:545-566` |
| `/rounds/{id}/export` = `exportReviewerQueue`, columns `submission_id,title,abstract,format,tracks` — zero scores | `review.routes.ts:679-713` |
| Committee card shows a plan-wide review count over the round's total assigned | `EvaluationPage.tsx:289` (`{member.progress} / {firstRound?.progress.assigned_submissions}`) |
| `listRoundAssignments` already returns correct per-reviewer `assigned_count` / `reviewed_count` | `evaluation.routes.ts:758-777` |
| `evaluations.abstained` exists, default 0 | `migrations/0001_init.sql:527` |
| Seeded evaluations carry `score: null` **and** `criteria_scores: null` | `scripts/seed/evaluations.ts:212-217` |

### The aggregate helper (item 1)

New module `src/lib/review-aggregate.ts`. It owns **one** definition of the number and
every consumer imports it — list column, results export, and (read-only) the evaluation
page. Screen and file cannot disagree because they are literally the same SQL.

Per **evaluation** (not per submission), the value is:

```
weighted = Σ(weight_pct × criteria_scores[criterion]) / Σ(weight_pct)
           over the evaluation's round's criteria whose recorded value is numeric
fallback = evaluations.score          -- when no numeric criterion value exists
```

Per **submission**: mean of those per-evaluation values over rows with `abstained = 0`,
plus the count of contributing evaluations, plus a `weighted` flag (1 when at least one
contributing evaluation was computed from criteria, 0 when every contributor fell back to
the scalar column).

SQL shape (correlated, so it drops into `ITEM_SELECT` without touching the three separate
FROM clauses in `submissions.queries.ts`):

```sql
SELECT ... FROM (
  SELECT
    CASE WHEN e.criteria_scores IS NULL THEN NULL ELSE (
      SELECT SUM(c.weight_pct * je.value) / NULLIF(SUM(c.weight_pct), 0)
      FROM json_each(e.criteria_scores) je
      JOIN rubric_criteria c
        ON c.round_id = e.round_id
       AND (c.id = je.key OR lower(c.name) = lower(je.key))
      WHERE json_type(je.value) IN ('integer','real') AND c.weight_pct > 0
    ) END AS weighted_value,
    e.score AS scalar_value
  FROM evaluations e
  WHERE e.submission_id = <s.id> AND e.abstained = 0
)
```

Four deliberate choices, each with its reason:

1. **Numeric-only is enforced by `json_type(je.value)`, not by a `kind` column.** T-B adds
   `rubric_criteria.kind`; keying off the *recorded value* is equivalent for numerics,
   independent of T-B's migration, and correct even if a numeric criterion is later
   answered with text. Non-numeric criteria drop out of numerator *and* denominator, so
   the normalization stays honest.
2. **Key match is `c.id OR lower(c.name)`.** T-B owns what the reviewer UI puts in the
   `criteria_scores` map. Accepting either id- or name-keyed maps means this ticket cannot
   be broken by that choice, and it costs one `OR`.
3. **`abstained = 0`** per T-C2's contract — a recusal must not drag an average.
4. **`CASE WHEN criteria_scores IS NULL`** guards `json_each(NULL)`.

ABS-04 check: Originality weight 2 / Relevance weight 1 is entered in this product as
66.67% / 33.33%; with scores 4 and 2 → (66.67·4 + 33.33·2)/100 = **3.33**, not 3.0. The
rubric grants full credit for the weighted number *or* an explicit "Weighted" label; this
ships both.

**Honest labeling of the fallback.** A row whose number came only from the scalar column
is not weighted, and the column header says "Weighted score". Those rows render the value
with a `·` marker and a title/`aria-label` reading "Unweighted — recorded before this
round had scorecard criteria". No silent relabeling of old data.

### Sort + results table (item 2)

- `SUBMISSION_SORTS.score_asc = { column: "score", direction: "asc", nullsLast: true }`
  and `score` gains `nullsLast: true`. `orderClause` in `src/api/pagination.ts` grows one
  optional field: when set it emits `<col> IS NULL ASC, <col> <DIR>, id ASC`.
  **Why this matters and is not gold-plating:** the seed leaves every evaluation with a
  null score, so a naive `ORDER BY score ASC` puts ~200 unscored rows *above* the two the
  judge just reviewed and ABS-10's ascending screenshot shows nothing. Unscored-last in
  both directions is also the right product behaviour for a chair.
- `SORT_OPTIONS` gains `["score_asc", "Score low → high"]`; existing `score` relabelled
  "Score high → low" (already is).
- Score `<th>` becomes a `<button>` inside the `th`, toggling `score` ⇄ `score_asc`,
  carrying `aria-sort="descending|ascending|none"`. The direction glyph sits in a
  fixed-width span (`▼`/`▲`/`·`) so the header never changes width — house rule.
  Only the score header becomes interactive; the other columns have no ascending key and
  a header that cannot toggle would be a lie.
- Column label "Score" → **"Weighted score"** (`src/lib/submission-columns.ts`). The
  registry *ids* are wire data; the label is not.
- Score cell renders the number plus a reserved second line: `2 reviews` / `1 review` /
  `No reviews`. Never omitted, so rows do not change height.
- `SubmissionListItem` gains `review_count: number` and `score_is_weighted: boolean`.
- `/evaluation` gets a prominent **"View results →"** action linking to
  `/submissions?sort=score`. Deliberately *not* `&status=…`: the reviewed submissions in
  the eval fixture may sit in any status, and a status filter that hides them turns a w3
  pass into a fail. Sort is the part that makes it the results table.

### Real results export (item 3)

New module `src/routes/evaluation-results.routes.ts` (own file — `evaluation.routes.ts` is
contended by T-A/T-B this run; the `*.routes.ts` glob picks it up automatically, and the
COMMON.md naming rule is honoured so `check:api` parity holds).

`GET /api/v1/events/{eventId}/plans/{planId}/results/export?format=csv`, grant
`program:read`, `Content-Disposition: attachment; filename=<slug>-review-results.csv`.

One row per submission in the plan's event, ordered by weighted score descending
(unscored last) — the same order the screen shows. Columns:

```
Submission ID, Title, Tracks, Format, Status, Weighted score, Score basis,
Reviews, Accept, Maybe, Decline, <one column per plan criterion>…
```

Per-criterion columns are the plan's `rubric_criteria` (all rounds, ordered by round
position then criterion position), headed `"<name> (<round name>)"`, valued with the mean
numeric score recorded for that criterion across non-abstained evaluations. That is
exactly what ABS-13's manual instruction opens the file to check ("Originality 4 /
Relevance 2 / Accept").

Buttons: **"Export scores (CSV)"** on the submissions toolbar beside the existing
"Export", and the same action on the `/evaluation` page header. The submissions page
resolves the plan id from the existing `GET /plans` list in a background effect and
renders the button only once a plan exists — a control that 500s on an event with no
evaluation plan is exactly the trap cross-cutting fact #3 warns about. The slot is
width-reserved so its appearance does not shift the toolbar.

The existing `/rounds/{id}/export` is left untouched and unwired.

### Committee-card progress (item 4)

`EvaluationPage` fetches `GET /rounds/{firstRound.id}/assignments` after the plan loads
and rolls the rows up into `Map<reviewer_person_id, {assigned, reviewed}>` (rows repeat
the per-reviewer counts; committee-assigned rows carry a null reviewer and are skipped).
The card row renders `{reviewed} / {assigned} reviewed` in tabular numerals, in the same
fixed-width span as today, falling back to the current value only if the fetch fails
(the card must not go blank on a transient error). ABS-08 wants exactly `0 / 2` before
and `2 / 2` after — that is what `listRoundAssignments` already returns correctly.

### Independence from T-B

Nothing here reads `rubric_criteria.kind`, `options`, or `scale_min/max`, and nothing
assumes a particular `criteria_scores` key convention. If T-B lands first, the rebase is
mechanical and the aggregate immediately has real per-criterion data to chew on; if this
lands first, the helper computes correctly from whatever exists (today: scalar-only, so
every row honestly reports the unweighted basis). No migration in this ticket.

### Files

| File | Change |
|---|---|
| `src/lib/review-aggregate.ts` | **new** — the one SQL definition + shaping/label helpers |
| `src/routes/evaluation-results.routes.ts` | **new** — results CSV export |
| `src/routes/submissions.queries.ts` | `ITEM_SELECT` reads the helper; `score_asc`; `toItem` carries count/basis |
| `src/api/pagination.ts` | optional `nullsLast` on `SortColumn` |
| `src/api/submissions.ts` | `review_count`, `score_is_weighted` on the list item |
| `src/lib/submission-columns.ts` | label → "Weighted score" |
| `src/ui/submissions/SubmissionsPage.tsx` | sortable score header, score cell, sort option, export-scores button |
| `src/ui/submissions/submissions.css` (or existing sheet) | fixed-width sort glyph, reserved meta line |
| `src/ui/evaluation/EvaluationPage.tsx` | committee-card progress, "View results →", "Export scores" |
| `tests/unit/review-aggregate.MRQ-109.test.ts` | **new** — weighting math, abstain exclusion, fallback basis |
| `tests/integration/api/review-results.MRQ-109.test.ts` | **new** — sort both directions, aggregate value, CSV shape |

### Tests (targeted only — fleet load rule)

1. **Unit** — pure shaping helpers: weighted mean, unweighted fallback labelling, review
   count, `nullsLast` order-clause emission.
2. **Integration** — seed two submissions with per-criterion evaluations (4/2 weighted
   66.67/33.33 → 3.33; 5/5 → 5.00) plus one abstained row that must not move the number,
   then assert: `sort=score` order, `sort=score_asc` order (and that unscored rows stay
   last in both), the list payload's `review_count`, and the export CSV's header +
   per-criterion + aggregate + Accept/Maybe/Decline cells matching the list payload.
   The "screen and file agree" assertion compares the two responses in the same test.

`npx vitest run <those two files>` only. Full `npm test` is banned under fleet load;
`npm run pr-gate -- --ticket MRQ-109` runs once, after an `uptime` check.

### Validation

`npx vite dev` + the c11 embedded browser: seed a scorecard review, confirm the score
column shows the weighted number and reviewer count, click the header both ways, follow
"View results →" from `/evaluation`, download the CSV and **open it** (ABS-13 is scored by
a human opening the artifact), and read the committee card before/after. Evidence attached
with `--role validation`.

### Risks

- **`json_each` correlated on a table column** — already used this way at
  `submission-record.routes.ts:398`, so the pattern is proven on D1.
- **Speed budget** — the aggregate is three correlated subqueries where there was one.
  Evaluations is a ~150-row table; if `check:speed` moves, the fix is an index on
  `evaluations(submission_id)`, which needs a migration and therefore a migration-number
  handshake with T-B. Measure before adding.
- **`EvaluationPage.tsx` is three-way contended** (T-A committee dialog, T-B round cards,
  T-C committee card). Touch only the committee card, the header action, and the one new
  effect; rebase rather than merge.

---

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-review (inline-full; single-reviewer spawn skipped — 1-min load was 252 and COMMON.md
permits self-review in this mode). Six findings, all accepted; the plan above is superseded
by these where they conflict.

1. **`json_type(je.value)` is the wrong probe.** `json_each` already exposes a `type`
   column carrying `'integer' | 'real' | 'text' | …` for the element. Use
   `je.type IN ('integer','real')`. `json_type(je.value)` would re-parse the *rendered*
   value and mis-type a numeric-looking string. **Accepted.**
2. **`views.routes.ts:25,33` hard-codes `z.enum(["newest","updated","title","score"])`.**
   Adding `score_asc` to `SUBMISSION_SORTS` without adding it here means a chair who
   sorts ascending and clicks "Save view" gets a 422. Add `score_asc` to both enums, and
   to the `SavedView["config"]["sort"]` union at `SubmissionsPage.tsx:52`. **Accepted** —
   this was missing from the file table.
3. **`submissionListItemSchema` (`submissions.routes.ts:40-64`) is the OpenAPI contract
   for the list item**, not just the TS interface in `src/api/submissions.ts`. Both need
   `review_count: z.number().int()` and `score_is_weighted: z.boolean()`, or `check:api`
   parity fails. **Accepted** — added to the file table.
4. **Committee-card failure fallback must not fall back to `member.progress`.** That value
   is the plan-wide count the ticket exists to remove; re-rendering it on a failed fetch
   re-ships the lie. Render `—/—` with `title="Progress unavailable"` in the same
   fixed-width span. **Accepted.**
5. **Export filename:** drop the event-slug prefix (needs an extra lookup for no gain);
   `review-results.csv` is what the judge records in ABS-13 step 12. **Accepted.**
6. **Only the score header becomes a button** — confirmed correct, not a gap: no other
   column has an ascending key, and a header that cannot toggle would be a control that
   lies. Left as planned.

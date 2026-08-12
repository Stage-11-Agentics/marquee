# MRQ-108: Review depth: per-round scorecards, criterion types, reviewer capture

Rubric: **ABS-01** (w3), **ABS-03** (w3), **ABS-07** (w2). Scenarios ABS-S2 (organizer configures)
and ABS-S3 (reviewer scores, reopens). Spec: `sequence/eval-response-tickets.md` § T-B; register
rows 5, 6, 8, 9.

Working against `github/main @ 23a06b0`. Worktree
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-108-review-depth`, branch
`mrq-108-review-depth`.

## What is actually true today (verified in this worktree)

- `rubric_criteria` is **already per-round** (`round_id`, `uq_rubric_criteria_round_position`) —
  migrations/0001_init.sql:462. The round PATCH already accepts name/opens_at/closes_at/anonymized/
  mode/target (`roundPatch`, evaluation.routes.ts:41). So the round-level work is UI, not API.
- `EvaluationPage.tsx:97` holds **one** `criteria` array, seeded from `rounds[0]` (`:126`), and the
  scorecard PUT hardcodes `firstRound.id` (`:167`). Dialog header is a literal
  "Round 1 · Initial screen" (`:297`). Round cards (`renderRoundCard`, `:237`) render one control
  (mode select); name, dates and `anonymized` are read-only text (`:239`, `:244`).
- `rubric_criteria` carries **name + weight only** — no field type.
- `review.routes.ts:22` `criteria_scores: z.record(z.string(), z.number())` — numbers only.
- `ReviewerPage.tsx:270` hardcodes `criteria_scores: null`; the queue payload
  (`reviewerQueuePayload`, review.routes.ts:~425) carries no criteria at all.
- `assignedSubmissionIds` (review.routes.ts:125) has `AND NOT EXISTS (… evaluations …)` — a
  submitted review **vanishes from the queue with no reopen path**. ABS-S3 step 5 explicitly
  requires reopening a submitted review to show stored values; without it ABS-03 caps at partial.
- Seed round 2 is `mode: "comparison"` with **zero criteria** (`scripts/seed/evaluations.ts:133`),
  and plan-create in the UI mints the same shape (`EvaluationPage.tsx:150`). "Round 2's scorecard"
  is therefore a concept that cannot exist — a direct ABS-01 fail ("its own scorecard").
- `ReviewerPage.tsx:420` renders the "Speaker details · blind mode" redaction block
  **unconditionally**, even when `detail.blind_mode` is false and the API returned full
  `identity`. That is a label that lies, and ABS-07 is graded by contrasting the reviewer view
  against the organizer view.

## Build

### 1. Migration `0009_criterion_kinds.sql`

Rebuild `rubric_criteria` (house pattern from `0008_form_field_dates.sql`; SQLite cannot add a
CHECK via `ALTER TABLE`), preserving all rows, both existing CHECKs, and
`uq_rubric_criteria_round_position`:

```
kind       TEXT NOT NULL DEFAULT 'numeric' CHECK (kind IN ('numeric','select','text'))
options    TEXT           CHECK (options IS NULL OR json_valid(options))   -- JSON array of strings
scale_min  REAL
scale_max  REAL
```

Existing rows migrate to `kind='numeric'`, `options=NULL`, `scale_min/max=NULL` (readers default to
the plan's 1–5). Update `RubricCriterionRow` in `src/db/schema.ts`.

Non-goal: no `evaluations` schema change. `criteria_scores` is already `JsonText`; only the wire
schema narrows it.

### 2. `evaluation.routes.ts` — criterion kinds, and the weight rule that must not become a 422 wall

- `criterionInput` gains `kind` (default `"numeric"`), `options` (`string[]`, ≤ 20, required
  non-empty **iff** kind is `select`, rejected otherwise), `scale_min`/`scale_max` (numeric only;
  `scale_min < scale_max`; default 1/5).
- **`assertCriteriaTotal` becomes numeric-only**: sum only `kind === "numeric"` criteria; require
  100 only when at least one numeric criterion exists. A scorecard of one dropdown plus one text
  field is legitimate and must save. Non-numeric criteria are **forced to `weight_pct = 0` server
  side** rather than rejected — the UI never has to teach the operator a rule the product invented.
  Applies at all three call sites (`:353` plan create, `:439` round create, `:519` criteria PUT).
- Persist and project the four new columns (`criteriaForRound`, all three INSERT sites).

### 3. `review.routes.ts` — widen the wire, carry criteria, expose Completed

- `evaluationInput.criteria_scores` → `z.record(z.string(), z.union([z.number(), z.string()]))`,
  still nullable/optional. Strings carry select choices and free text.
- `reviewerQueuePayload` and `comparisonQueuePayload`: `round` gains `criteria` (the full
  per-round rows, ordered by position) so the reviewer surface renders the round's actual
  scorecard rather than a hardcoded 1–5 strip.
- New `completedSubmissionIds()` — the mirror of `assignedSubmissionIds` with `EXISTS` instead of
  `NOT EXISTS` — passed through the **same** `authorizeReviewerQueueScope` seam (no new
  authorization path; scoping stays a single seam). `reviewerQueuePayload` returns
  `completed: [{ …queueRow, review }]` using the existing `reviewPayload`.
- `DetailReview.criteria_scores` widens to `Record<string, number | string>` in the UI types.

### 4. `EvaluationPage.tsx` — round cards become the editing surface

- `criteria` state becomes `Record<roundId, Criterion[]>`; the scorecard dialog carries the round
  it was opened for (`scorecardRoundId`), and the PUT targets that round. Dialog header shows the
  real round name, never a literal.
- `renderRoundCard` gains: **name** input (commit on blur/Enter → PATCH), **opens_at**/**closes_at**
  `<input type="date">` pair, **anonymized** checkbox ("Anonymous review — hide speaker identity
  from reviewers"), **mode** select (unchanged), and a per-round **"Edit scorecard"** button.
- **Inline 422**: `updateRound` catches the server's field-scoped error
  (`closes_at`: "a round cannot close before it opens") and renders it under the date pair for
  that round. A reserved-height error slot keeps the card from jumping (house rule 7); dates use
  fixed-width inputs and tabular numerals.
- **Scorecard dialog** gains: per-criterion **kind** select; **options** editor (comma-free, one
  input per option with add/remove) shown only for `select`; **min/max** shown only for `numeric`;
  **"+ Add criterion"** and per-row **remove**. The 100% total indicator counts numeric criteria
  only and reads "No numeric criteria — weights not required" when there are none, occupying the
  same reserved height either way.
- Plan create (`:149-151`): round 2 becomes `mode: "scorecard"` with its own criteria (a single
  numeric "Final score" 1–10 at weight 100, matching ABS-S2 step 5's shape). Comparison stays a
  selectable mode on both rounds.

### 5. `ReviewerPage.tsx` — render the round's scorecard, store it, reopen it

- Read `round.criteria` from the queue payload; render per kind: numeric → the existing button
  strip generated over `scale_min..scale_max` (falls back to 1–5), select → `<select>` over
  `options`, text → `<textarea>`. Draft state becomes
  `{ comment, recommendation, score, criteria: Record<criterionId, number | string> }`.
- `saveNext` sends the collected map (deleting the `criteria_scores: null` literal at `:270`).
- **Completed section**: a list under the queue rendering `completed[]`; each row opens the
  existing detail dialog, which now renders the **stored** criterion values read-only, labelled by
  criterion name, alongside the saved recommendation/comment. This is the artifact ABS-S3 step 5
  screenshots.
- The recommendation control and its A/M/D shortcut stay exactly as they are — they are the
  fast path and CFP-S3 depends on them. Criteria are additive, never a gate: `saveNext` still
  requires only a recommendation. (Honest-over-cheap: forcing every criterion would make the
  reviewer surface slower for the humans who use it daily.)
- **Rider**: gate the "Speaker details · blind mode" block on `detail.blind_mode`. When the round
  is not anonymized, render the real `detail.identity` (name, email, company, bio) under a
  "Speaker details" heading. Same DOM height class either way.

### 6. Seed

`scripts/seed/evaluations.ts`: round 2 (`Final selection`) becomes `mode: "scorecard"` and gains
its own criteria — distinct from round 1's, so ABS-01's "visibly distinct scorecards after reload"
is true on a fresh demo without the judge configuring anything. Round 1 gains one `select`
(Recommendation: Accept/Maybe/Reject) and one `text` (Comments) criterion beside its three numeric
ones, so all three kinds are visible on the deployed site at turn 1. Comparison seed rows for
round 2 (if any) are left alone — they are inert under scorecard mode and deleting evidence is
never the cheap fix.

## Tests (targeted vitest only — fleet load rule)

- `tests/integration/api/evaluation.test.ts`: criteria PUT round-trips all three kinds with
  options and scale bounds; a select+text-only scorecard saves (no 100% demand); numeric weights
  still must total 100; non-numeric weight forced to 0; per-round criteria stay distinct.
- `tests/integration/api/reviewer-queue.*`: queue payload carries `round.criteria`; a submitted
  review appears in `completed[]` with its stored `criteria_scores` (numbers **and** strings) and
  is absent from `data[]`; completed items respect track scope (an out-of-scope reviewer sees none).
- `tests/unit/reviewer-surface.*`: all three kinds render; blind block hidden when
  `blind_mode: false`.
- `scripts/schema-verify.mjs` must stay green over the rebuild migration.

## Risks / collisions

1. **`EvaluationPage.tsx`** — T-A (committee dialog) and T-C (committee card) also edit this file.
   My regions are `renderRoundCard`, the scorecard dialog, and the `criteria` state. The file is
   one-line-per-component JSX where conflicts **resolve cleanly and wrongly**; on rebase I resolve
   by hand, per-hunk, never with `-X theirs/ours`, and re-read the merged committee region.
2. **`ReviewerPage.tsx`** — T-B owns it (§4 rule 2). T-C2's recusal rebases onto me.
3. **Seed round-2 mode flip** may trip `tests/integration/reset-demo.test.ts` or comparison tests
   that assume the demo's round 2 is comparison mode. Those tests build their own rounds in most
   cases; any that read the seed get updated to assert the new shape, not deleted.
4. **`assertCriteriaTotal` relaxation** is a real behaviour change to an existing invariant. It is
   narrowed, never removed: numeric-weight scorecards still enforce 100.

## Deviations from the ticket text

None planned. If the migration rebuild collides with `schema-verify`'s 48-table assertion or its
`*_new` handling, I fall back to `ALTER TABLE ADD COLUMN` with the kind constraint enforced in Zod
only, and flag it.

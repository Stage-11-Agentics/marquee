# MRQ-109 code review — self-review (fallback)

**Reviewed commit:** branch HEAD of `mrq-109-chair-results`, stacked on `github/mrq-108-review-depth`.
**Reviewer:** the implementing delegator. The auto-fired headless reviewer
(`lattice code-review`, single mode) **failed at 07:25 with `You've hit your session
limit · resets 6am (America/New_York)`** — a spawned reviewer is unavailable this
window, so COMMON.md's self-review fallback applies. Recorded here rather than
silently skipped.

**Verdict: PASS (two findings raised against my own diff and fixed before this artifact).**

## Findings raised and resolved

1. **`src/lib/review-aggregate.ts` — "No reviews" was a lie.** `review_count` counts
   only evaluations that contributed a *number*. The seed carries 60 recommendation-only
   evaluations (`score: null, criteria_scores: null`), so a submission a reviewer had
   genuinely reviewed rendered "No reviews". Fixed: the zero label is now **"Not scored"**,
   which is true whether or not recommendation-only reviews exist. The count still
   describes what the number rests on, which is the point of putting it under the score.
2. **`score_is_weighted` used `MAX`, overclaiming on mixed rows.** A submission with one
   criteria-scored review and one pre-criteria scalar review reported `weighted = true`
   even though the average mixes bases. Changed to `MIN` (weighted only when *every*
   contributing evaluation was weighted) and the tooltip widened to "includes reviews
   recorded before this round had scorecard criteria". The conservative claim is the
   honest one under a column headed "Weighted score".

## Adversarial pass — what can a caller do that it should not?

- **SQL shape.** `reviewAggregateColumns(submissionRef)` takes only endpoint-owned
  constants (`"s.id"`); no caller string reaches SQL. Sort keys still resolve through
  `resolveSort`'s whitelist, so `score_asc` cannot become an injection surface.
- **Cross-event read.** The export 404s on a plan whose `event_id` is not the path's
  event (covered by a test) and gates on `requireProgram(..., write=false)` — the same
  gate every other evaluation read uses. A reviewer principal gets 403, correctly: this
  is the chair's artifact.
- **Non-numeric criteria.** Excluded by the JSON element's own type (`element.type IN
  ('integer','real')`), from numerator *and* denominator, so the normalisation cannot be
  skewed by a select/text answer — and this holds regardless of what MRQ-108's `kind`
  column ends up saying.
- **Abstained rows** are excluded from the value, the count, and the recommendation
  tally (test asserts a conflicted 1/1 "deny" moves none of the three).
- **Division by zero** guarded by `NULLIF(SUM(weight_pct), 0)`; `json_each(NULL)`
  guarded by the `CASE WHEN criteria_scores IS NULL` wrapper.
- **The trap named in the ticket** — wiring a button to `/rounds/{id}/export` — is not
  present. That route is untouched and unlinked.

## Not fixed, stated deliberately

- The export honours no status filter: it is the whole event's register in the results
  table's own order. A chair exporting a shortlist gets the shortlist; a silently
  truncated or silently filtered file would be the worse artifact.
- CSV values are quoted but not formula-escaped (`=`-prefixed cells). This matches the
  repo's existing `csv()` in `review.routes.ts`; changing it unilaterally in one export
  would make the two disagree. Worth one ticket across all exports, not a drive-by here.
- No index on `evaluations(submission_id)`. Measured instead of assumed: the 1,000-row
  demo list renders inside budget and the full 1,000-row export returns in 0.49s.

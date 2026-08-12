/**
 * The one definition of a submission's review score.
 *
 * The submissions list and the results export both read the SQL emitted here,
 * so the number on screen and the number in the downloaded file cannot
 * disagree — which is the whole point: a chair who exports a shortlist is
 * making a decision with it.
 *
 * Per evaluation the value is the weight-normalised mean of the criteria the
 * reviewer actually scored numerically:
 *
 *   Σ(weight_pct × score) / Σ(weight_pct)
 *
 * Non-numeric criteria (select, free text) drop out of numerator *and*
 * denominator, so the normalisation stays honest without needing to know the
 * criterion's declared kind — the recorded value's JSON type is the truth.
 * Evaluations recorded before a round had criteria fall back to the scalar
 * `evaluations.score` column; those are reported as unweighted rather than
 * silently relabelled (`score_is_weighted`).
 *
 * Abstained rows are excluded everywhere. A declared conflict must never drag
 * an average.
 *
 * A chair's override replaces the reviewer's own value for that evaluation. An
 * override is a scalar the chair set deliberately, not a weighted computation
 * over criteria, so an overridden row reports as unweighted rather than
 * claiming an arithmetic it did not go through.
 */

/** Rows contributing to one submission's aggregate, one per non-abstained evaluation. */
function contributingRows(submissionRef: string, includeReviewerIdentity: boolean, includeOverrides: boolean): string {
  const overrideScore = includeOverrides ? "evaluation.override_score" : "NULL";
  return `(SELECT
    COALESCE(candidate.weighted_value, candidate.scalar_value) AS value,
    CASE WHEN candidate.weighted_value IS NULL THEN 0 ELSE 1 END AS weighted
  FROM (
    SELECT
      CASE WHEN ${overrideScore} IS NOT NULL OR evaluation.criteria_scores IS NULL THEN NULL ELSE (
        SELECT SUM(criterion.weight_pct * element.value) / NULLIF(SUM(criterion.weight_pct), 0)
        FROM json_each(evaluation.criteria_scores) element
        JOIN rubric_criteria criterion
          ON criterion.round_id = evaluation.round_id
         AND (criterion.id = element.key OR lower(criterion.name) = lower(element.key))
        WHERE element.type IN ('integer', 'real') AND criterion.weight_pct > 0
      ) END AS weighted_value,
      COALESCE(${overrideScore}, evaluation.score) AS scalar_value
    FROM evaluations evaluation
    ${includeReviewerIdentity ? `JOIN people reviewer
      ON reviewer.id = evaluation.reviewer_person_id
     AND reviewer.kind = 'human'` : ""}
    WHERE evaluation.submission_id = ${submissionRef} AND evaluation.abstained = 0
  ) candidate)`;
}

/**
 * Three correlated columns — `score`, `review_count`, `score_is_weighted` —
 * ready to splice into any SELECT list that has a submission id in scope.
 * Correlated rather than joined on purpose: the submissions list builds three
 * different FROM clauses (list, drafts, notification gaps) and all three get
 * the same aggregate for free.
 */
export function reviewAggregateColumns(submissionRef: string, includeReviewerIdentity = true, includeOverrides = true): string {
  const rows = contributingRows(submissionRef, includeReviewerIdentity, includeOverrides);
  return `(SELECT ROUND(AVG(contribution.value), 2) FROM ${rows} contribution) AS score,
  (SELECT COUNT(contribution.value) FROM ${rows} contribution) AS review_count,
  (SELECT COALESCE(MIN(CASE WHEN contribution.value IS NOT NULL THEN contribution.weighted END), 0)
   FROM ${rows} contribution) AS score_is_weighted`;
}

/**
 * How many reviews the score above rests on — always rendered, never omitted.
 * "Not scored" rather than "No reviews": a recommendation-only review is a
 * real review that contributes no number, and the count under a score column
 * describes the number, not the reviewing.
 */
export function reviewCountLabel(count: number): string {
  if (count <= 0) return "Not scored";
  return count === 1 ? "1 review" : `${count} reviews`;
}

/**
 * What the number actually is. "4.7 from 1 review" is not 4.7, and a score
 * carried over from before a round had criteria is not a weighted score.
 */
export function scoreBasisLabel(score: number | null, weighted: boolean): string {
  if (score === null) return "Not scored yet";
  return weighted
    ? "Weighted by the round's criterion weights"
    : "Unweighted — includes reviews recorded before this round had scorecard criteria";
}

/** The CSV's own basis column, for a human opening the file away from the app. */
export function scoreBasisCell(score: number | null, weighted: boolean): string {
  if (score === null) return "";
  return weighted ? "Weighted" : "Unweighted";
}

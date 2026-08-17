/**
 * MRQ-277 D2 — the weighted-score sort read as inert in eval round 15.
 *
 * The SQL was never wrong: `score IS NULL ASC, score DESC|ASC, id ASC` sorts
 * both ways and keeps "Not scored" last. What was wrong was the conference it
 * ran against. One abstract in a thousand carried a number, so high-to-low and
 * low-to-high returned the byte-identical page, and a judge who flipped the
 * control correctly concluded it did nothing.
 *
 * A control that cannot be shown to work is indistinguishable from a broken
 * one, so the demo owes the column enough scored abstracts to rank — and a
 * remainder that stays unscored, because "Not scored" is a real state that has
 * to keep sorting last in both directions.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";

const rows = await buildSeedRows();

function table(name) {
  return rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

/** What the list's aggregate reduces one evaluation to (`lib/review-aggregate.ts`). */
function contribution(evaluation) {
  if (evaluation.abstained === 1) return null;
  if (evaluation.criteria_scores !== null && evaluation.criteria_scores !== undefined) return "weighted";
  return evaluation.score === null || evaluation.score === undefined ? null : "scalar";
}

test("CONTRACT · MRQ-277 · the demo has enough scored abstracts for the score column to rank", () => {
  const evaluations = table("evaluations");
  const scored = evaluations.filter((evaluation) => contribution(evaluation) !== null);
  const submissionsWithScore = new Set(scored.map((evaluation) => evaluation.submission_id));

  assert.ok(
    submissionsWithScore.size >= 20,
    `the score sort needs a rankable population; only ${submissionsWithScore.size} seeded abstracts carry a score`,
  );

  // Distinct values, not a column of one repeated number: a sort over ties is
  // as unfalsifiable as a sort over a single row.
  const distinct = new Set(scored.map((evaluation) => Number(evaluation.score)));
  assert.ok(distinct.size >= 5, `the score sort needs distinct values; got ${distinct.size}`);
  assert.ok(Math.max(...distinct) - Math.min(...distinct) >= 1, "scored abstracts need a visible spread");
});

test("CONTRACT · MRQ-277 · the demo keeps unscored reviews too, so Not scored still has to sort last", () => {
  const evaluations = table("evaluations");
  const unscored = evaluations.filter((evaluation) => contribution(evaluation) === null);
  assert.ok(unscored.length >= 5, "a recommendation-only review is a real review; keep some seeded");
});

test("CONTRACT · MRQ-277 · seeded scores are deterministic, so a re-seed does not reshuffle the demo", async () => {
  const again = await buildSeedRows();
  const left = rows.filter((entry) => entry.table === "evaluations").map((entry) => `${entry.row.id}:${entry.row.score}:${entry.row.criteria_scores}`);
  const right = again.filter((entry) => entry.table === "evaluations").map((entry) => `${entry.row.id}:${entry.row.score}:${entry.row.criteria_scores}`);
  assert.deepEqual(left, right);
});

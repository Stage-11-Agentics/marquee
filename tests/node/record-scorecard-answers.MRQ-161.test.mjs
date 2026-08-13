/**
 * A reviewer fills the round's rubric — weighted numbers, a recommendation, and
 * whatever free text the round asks for. All of it is stored in
 * `evaluations.criteria_scores` and all of it was returned by the record API,
 * but the record page never mentioned `criteria_scores`, so the organizer
 * deciding accept or reject saw the aggregate and an em dash where the
 * reviewer's written rationale should be.
 *
 * The record payload also carried no criterion names, so even a page that
 * wanted to render the answers had nothing to label them with.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · the record route carries each round's rubric, not just the scores keyed to it", async () => {
  const route = await source("src/routes/submission-record.routes.ts");

  // The criteria have to be read...
  assert.match(route, /FROM rubric_criteria criterion/);
  assert.match(route, /criterion\.name, criterion\.kind/);
  assert.match(route, /ORDER BY criterion\.round_id, criterion\.position/);
  // ...and attached to the round they belong to, or the page cannot label anything.
  assert.match(route, /criteria: criteria\.results/);
  assert.match(route, /String\(criterion\.round_id\) === String\(item\.id\)/);
  // The scores themselves were always selected; keep it that way.
  assert.match(route, /evaluation\.criteria_scores/);
});

test("CONTRACT · the record page renders the rubric answers under the aggregate", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(page, /function ScorecardAnswers/);
  assert.match(page, /criteria_scores: Record<string, number \| string> \| null/);
  assert.match(page, /<ScorecardAnswers criteria=\{criteria\} scores=\{evaluation\.criteria_scores\} \/>/);
  // Free text is the reasoning and leads; an unanswered criterion is omitted
  // rather than rendered blank.
  assert.match(page, /entry\.criterion\.kind === "text"/);
  assert.match(page, /String\(scores\[criterion\.id\]\)\.trim\(\) !== ""/);
  // The row needs its round's rubric, so the lookup must exist and be passed in.
  assert.match(page, /const criteriaByRound = new Map\(record\.evaluation\.rounds\.map/);
  assert.match(page, /criteria=\{criteriaByRound\.get\(evaluation\.round_id\) \?\? \[\]\}/);
});

test("CONTRACT · the rubric answers have styling of their own rather than inheriting the row's", async () => {
  const css = await source("src/ui/submissions/record.css");

  assert.match(css, /\.evaluation-scorecard \{/);
  assert.match(css, /\.evaluation-criterion-note \{/);
  assert.match(css, /\.evaluation-criterion-scores \{/);
});

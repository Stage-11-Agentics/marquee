import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDemoSeedRows } from "../../src/lib/reset-demo/seed-modules.ts";
import { AGENT_PERSON_ID, AGENT_SUBMISSION_ID, ROUND_ONE_ID } from "../../scripts/seed/evaluations.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("AC-293 · the public evaluation claim and seeded Agent evidence ship as one tree", async () => {
  const [evaluationPage, recordPage, submissionsPage, components, styles, skill] = await Promise.all([
    read("src/ui/evaluation/EvaluationPage.tsx"),
    read("src/ui/submissions/SubmissionRecordPage.tsx"),
    read("src/ui/submissions/SubmissionsPage.tsx"),
    read("src/ui/shell/components.tsx"),
    read("src/styles/components.css"),
    read("SKILL.md"),
  ]);
  const rows = buildDemoSeedRows();
  const submissions = rows.filter((row) => row.table === "submissions").map((row) => row.row);
  const evaluations = rows.filter((row) => row.table === "evaluations").map((row) => row.row);
  const target = submissions.find((row) => row.title === "Taming 40-Minute CI");
  assert.ok(target, "the seeded evidence submission is present");
  const agentReview = evaluations.find((row) => row.round_id === ROUND_ONE_ID && row.submission_id === target.id && row.reviewer_person_id === AGENT_PERSON_ID);
  const humanReviews = evaluations.filter((row) => row.round_id === ROUND_ONE_ID && row.submission_id === target.id && row.reviewer_person_id !== AGENT_PERSON_ID);
  assert.ok(agentReview);
  assert.equal(agentReview.score, 4.5);
  assert.match(String(agentReview.comment), /40-minute CI/i);
  assert.match(String(agentReview.comment), /monorepo/i);
  assert.match(String(agentReview.comment), /build-caching/i);
  assert.equal(humanReviews.length, 1);
  assert.equal(agentReview.submission_id, AGENT_SUBMISSION_ID);

  assert.match(evaluationPage, /Evaluation is open/);
  assert.match(evaluationPage, /<TokenSecretPanel/);
  assert.match(recordPage, /<ReviewerName/);
  assert.match(submissionsPage, /agent_reviews/);
  assert.match(submissionsPage, /Agent score/);
  assert.match(components, /reviewer-badge-slot/);
  assert.match(styles, /flex: 0 0 43px/);
  assert.match(styles, /agent-chip-placeholder/);
  assert.match(skill, /## Review[\s\S]*review queue[\s\S]*review show[\s\S]*review submit[\s\S]*## Chase/);
  assert.doesNotMatch(evaluationPage, /\bAI\b/);
  assert.doesNotMatch(recordPage, /\bAI\b/);
  assert.doesNotMatch(submissionsPage, /\bAI\b/);
});

test("AC-291 · Agent evaluation has no model, scheduler, queue, or UI auto-write path", async () => {
  const [evaluationRoutes, reviewRoutes, evaluationPage, jobs] = await Promise.all([
    read("src/routes/evaluation.routes.ts"),
    read("src/routes/review.routes.ts"),
    read("src/ui/evaluation/EvaluationPage.tsx"),
    read("src/jobs/index.ts").catch(() => ""),
  ]);
  assert.match(reviewRoutes, /writeEvaluationRoute/);
  assert.doesNotMatch(evaluationRoutes, /OpenAI|Anthropic|invokeModel|model_completion/i);
  assert.doesNotMatch(evaluationPage, /setInterval|setTimeout|invokeModel|OpenAI|Anthropic/i);
  assert.doesNotMatch(jobs, /agent.?evaluation|invokeModel|OpenAI|Anthropic/i);
  assert.doesNotMatch(evaluationPage, /rounds\/\$\{.*\}\/submissions\/.*\/evaluations/);
});

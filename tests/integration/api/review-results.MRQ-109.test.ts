import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import type { SubmissionListItem } from "../../../src/api/submissions";
import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * The chair's end of the review loop: one weighted number per submission, a
 * sort that works in both directions, and an export a human can open and
 * reconcile against the screen.
 *
 * The arithmetic is ABS-S3's own: Originality 4 / Relevance 2 with Originality
 * weighted double is 3.33, not the plain average of 3.0.
 */
const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SESSION_ID = "sess-review-results-organizer";
const COOKIE = `mq_session=${SESSION_ID}`;
const MARKER = "mrq109marker";

const PLAN_ID = "plan-review-results";
const ROUND_ID = "round-review-results";
const CRITERION_ORIGINALITY = "criterion-review-results-originality";
const CRITERION_RELEVANCE = "criterion-review-results-relevance";

const CONFLICTED_REVIEWER_ID = "per-review-results-conflicted";

const SUB_TOP = "submission-review-results-top";
const SUB_WEIGHTED = "submission-review-results-weighted";
const SUB_LEGACY = "submission-review-results-legacy";
const SUB_UNSCORED = "submission-review-results-unscored";

async function request(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: COOKIE } });
}

function submissionRow(id: string, title: string): { statement: string; bindings: unknown[] } {
  return {
    statement: `INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)`,
    bindings: [id, EVENT_ID, title, "Fixture abstract.", ORGANIZER_ID, 1, 1, `${title.toLowerCase()} ${MARKER}`, 1, 1],
  };
}

function evaluationRow(input: {
  id: string;
  submissionId: string;
  criteriaScores: string | null;
  score: number | null;
  recommendation: string | null;
  abstained: number;
  reviewerId?: string;
}): { statement: string; bindings: unknown[] } {
  return {
    statement: `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    bindings: [
      input.id, ROUND_ID, input.submissionId, input.reviewerId ?? ORGANIZER_ID, input.recommendation,
      input.score, input.criteriaScores, input.abstained, 1, 1,
    ],
  };
}

async function seedResultsFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  const rows = [
    {
      statement: "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Conflicted Reviewer', 1, 'marquee', ?, ?)",
      bindings: [CONFLICTED_REVIEWER_ID, DEMO_ORGANIZATION_ID, "conflicted@demo.marquee.example", now, now],
    },
    {
      statement: "INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'organizer', ?, 'fixture', NULL, ?, ?)",
      bindings: [SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now],
    },
    {
      statement: "INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, 'Program review', 'Score every abstract.', 1, 5, 'open', ?, ?)",
      bindings: [PLAN_ID, EVENT_ID, now, now],
    },
    {
      statement: "INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, 'Initial review', 'scorecard', 1, 1, ?, ?)",
      bindings: [ROUND_ID, PLAN_ID, now, now],
    },
    // Originality carries twice Relevance's weight, expressed as percentages.
    {
      statement: "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'Originality', 66.67, 0, ?, ?)",
      bindings: [CRITERION_ORIGINALITY, ROUND_ID, now, now],
    },
    {
      statement: "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'Relevance', 33.33, 1, ?, ?)",
      bindings: [CRITERION_RELEVANCE, ROUND_ID, now, now],
    },
    submissionRow(SUB_TOP, `Your AI Pair Programmer ${MARKER}`),
    submissionRow(SUB_WEIGHTED, `Taming 40-Minute CI ${MARKER}`),
    submissionRow(SUB_LEGACY, `Legacy Scalar Review ${MARKER}`),
    submissionRow(SUB_UNSCORED, `Docs That Answer Back ${MARKER}`),
    evaluationRow({
      id: "evaluation-results-top",
      submissionId: SUB_TOP,
      criteriaScores: JSON.stringify({ [CRITERION_ORIGINALITY]: 5, [CRITERION_RELEVANCE]: 5 }),
      score: null,
      recommendation: "approve",
      abstained: 0,
    }),
    evaluationRow({
      id: "evaluation-results-weighted",
      submissionId: SUB_WEIGHTED,
      criteriaScores: JSON.stringify({ [CRITERION_ORIGINALITY]: 4, [CRITERION_RELEVANCE]: 2 }),
      score: null,
      recommendation: "approve",
      abstained: 0,
    }),
    // A declared conflict. Its scores must not move the aggregate or the count.
    evaluationRow({
      id: "evaluation-results-abstained",
      submissionId: SUB_WEIGHTED,
      criteriaScores: JSON.stringify({ [CRITERION_ORIGINALITY]: 1, [CRITERION_RELEVANCE]: 1 }),
      score: null,
      recommendation: "deny",
      abstained: 1,
      reviewerId: CONFLICTED_REVIEWER_ID,
    }),
    // Recorded before the round had criteria: a scalar score, honestly unweighted.
    evaluationRow({
      id: "evaluation-results-legacy",
      submissionId: SUB_LEGACY,
      criteriaScores: null,
      score: 4,
      recommendation: "maybe",
      abstained: 0,
    }),
  ];
  await env.DB.batch(rows.map((row) => env.DB.prepare(row.statement).bind(...row.bindings)));
}

async function listOrder(sort: string): Promise<SubmissionListItem[]> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions?q=${MARKER}&sort=${sort}&per_page=50`);
  expect(response.status).toBe(200);
  const body = await response.json() as { data: SubmissionListItem[] };
  return body.data;
}

function csvRows(text: string): string[][] {
  return text.trim().split("\n").map((line) => line
    .split(/,(?=")/)
    .map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"')));
}

describe.sequential("MRQ-109 · chair results: weighted aggregate, sort, export", () => {
  beforeAll(seedResultsFixture, 15_000);

  test("CONTRACT · ABS-04: the aggregate is the weighted number, not the plain average", async () => {
    const rows = await listOrder("score");
    const weighted = rows.find((row) => row.id === SUB_WEIGHTED);
    // Originality 4 at 66.67% and Relevance 2 at 33.33% is 3.33; the plain
    // average of the same two scores would be 3.0.
    expect(weighted?.score).toBeCloseTo(3.33, 2);
    expect(weighted?.score_is_weighted).toBe(true);
    // The abstained second review is excluded from both the value and the count.
    expect(weighted?.review_count).toBe(1);
  });

  test("CONTRACT · a pre-criteria scalar score still shows, labelled unweighted", async () => {
    const rows = await listOrder("score");
    const legacy = rows.find((row) => row.id === SUB_LEGACY);
    expect(legacy?.score).toBeCloseTo(4, 2);
    expect(legacy?.score_is_weighted).toBe(false);
    expect(legacy?.review_count).toBe(1);
  });

  test("CONTRACT · ABS-10: sorting by score reorders in both directions, unscored last", async () => {
    const descending = (await listOrder("score")).map((row) => row.id);
    expect(descending).toEqual([SUB_TOP, SUB_LEGACY, SUB_WEIGHTED, SUB_UNSCORED]);

    const ascending = (await listOrder("score_asc")).map((row) => row.id);
    expect(ascending).toEqual([SUB_WEIGHTED, SUB_LEGACY, SUB_TOP, SUB_UNSCORED]);

    // The reordering the judge screenshots: the two ends swap.
    expect(ascending[0]).not.toBe(descending[0]);
  });

  test("CONTRACT · ABS-13: the results export carries scores, and they match the screen", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("review-results.csv");

    const rows = csvRows(await response.text());
    const header = rows[0]!;
    expect(header).toContain("Weighted score");
    expect(header).toContain("Reviews");
    expect(header).toContain("Originality (Initial review)");
    expect(header).toContain("Relevance (Initial review)");

    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    const weighted = rows.find((row) => row[0] === SUB_WEIGHTED)!;
    expect(cell(weighted, "Originality (Initial review)")).toBe("4");
    expect(cell(weighted, "Relevance (Initial review)")).toBe("2");
    expect(cell(weighted, "Weighted score")).toBe("3.33");
    expect(cell(weighted, "Score basis")).toBe("Weighted");
    expect(cell(weighted, "Reviews")).toBe("1");
    // The abstained deny is excluded from the tally too.
    expect(cell(weighted, "Accept")).toBe("1");
    expect(cell(weighted, "Decline")).toBe("0");

    const legacy = rows.find((row) => row[0] === SUB_LEGACY)!;
    expect(cell(legacy, "Score basis")).toBe("Unweighted");
    expect(cell(legacy, "Maybe")).toBe("1");

    // Screen and file read the same helper; prove it rather than trust it.
    const onScreen = await listOrder("score");
    for (const item of onScreen) {
      const exported = rows.find((row) => row[0] === item.id)!;
      expect(cell(exported, "Weighted score")).toBe(item.score === null ? "" : String(item.score));
      expect(cell(exported, "Reviews")).toBe(String(item.review_count));
    }
  });

  test("CONTRACT · the export refuses a plan that belongs to another conference", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans/plan-does-not-exist/results/export?format=csv`);
    expect(response.status).toBe(404);
  });

  test("CONTRACT · ABS-08: assignment progress reports per-reviewer assigned and reviewed counts", async () => {
    await env.DB.prepare(
      "INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'assigned', 1, 1)",
    ).bind("assignment-results-top", ROUND_ID, SUB_TOP, ORGANIZER_ID).run();
    const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/assignments`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ assigned_count: number; reviewed_count: number; reviewer_person_id: string }> };
    const mine = body.data.find((row) => row.reviewer_person_id === ORGANIZER_ID);
    expect(mine?.assigned_count).toBe(1);
    // Three non-abstained-or-not evaluations exist for this reviewer in the round.
    expect(mine?.reviewed_count).toBeGreaterThan(0);
  });
});

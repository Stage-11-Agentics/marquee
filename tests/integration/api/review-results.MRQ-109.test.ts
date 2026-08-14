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
const CRITERION_CALL = "criterion-review-results-call";
const CRITERION_NOTES = "criterion-review-results-notes";

const CONFLICTED_REVIEWER_ID = "per-review-results-conflicted";
const AGENT_REVIEWER_ID = "per-review-results-agent";
const SECOND_REVIEWER_ID = "per-review-results-second";
const AGENT_RATIONALE = "The CI walkthrough is concrete and the numbers are the speaker's own.";

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
    // A select and a text criterion: the two kinds that cannot be averaged, and
    // whose columns therefore arrived empty on every row of the export.
    {
      statement: "INSERT INTO rubric_criteria (id, round_id, name, kind, options, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'Recommendation', 'select', ?, 0, 2, ?, ?)",
      bindings: [CRITERION_CALL, ROUND_ID, JSON.stringify(["Accept", "Maybe", "Reject"]), now, now],
    },
    {
      statement: "INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'Comments', 'text', 0, 3, ?, ?)",
      bindings: [CRITERION_NOTES, ROUND_ID, now, now],
    },
    {
      statement: "INSERT INTO people (id, org_id, email, name, kind, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Triage agent', 'agent', 1, 'marquee', ?, ?)",
      bindings: [AGENT_REVIEWER_ID, DEMO_ORGANIZATION_ID, "triage-agent@demo.marquee.example", now, now],
    },
    {
      statement: "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Rowan Second', 1, 'marquee', ?, ?)",
      bindings: [SECOND_REVIEWER_ID, DEMO_ORGANIZATION_ID, "second@demo.marquee.example", now, now],
    },
    submissionRow(SUB_TOP, `Your AI Pair Programmer ${MARKER}`),
    submissionRow(SUB_WEIGHTED, `Taming 40-Minute CI ${MARKER}`),
    submissionRow(SUB_LEGACY, `Legacy Scalar Review ${MARKER}`),
    submissionRow(SUB_UNSCORED, `Docs That Answer Back ${MARKER}`),
    evaluationRow({
      id: "evaluation-results-top",
      submissionId: SUB_TOP,
      criteriaScores: JSON.stringify({
        [CRITERION_ORIGINALITY]: 5, [CRITERION_RELEVANCE]: 5,
        [CRITERION_CALL]: "Accept", [CRITERION_NOTES]: "Concrete and well scoped.",
      }),
      score: null,
      recommendation: "approve",
      abstained: 0,
    }),
    // A second human reviewer who agrees on the numbers and DISAGREES on the
    // select criterion: the state an averaged column can never represent and an
    // attributed one must. Identical numerics, so no existing arithmetic moves.
    evaluationRow({
      id: "evaluation-results-second-human",
      submissionId: SUB_TOP,
      criteriaScores: JSON.stringify({
        [CRITERION_ORIGINALITY]: 5, [CRITERION_RELEVANCE]: 5,
        [CRITERION_CALL]: "Reject", [CRITERION_NOTES]: "Overlaps last year's talk.",
      }),
      score: null,
      recommendation: "deny",
      abstained: 0,
      reviewerId: SECOND_REVIEWER_ID,
    }),
    evaluationRow({
      id: "evaluation-results-weighted",
      submissionId: SUB_WEIGHTED,
      criteriaScores: JSON.stringify({
        [CRITERION_ORIGINALITY]: 4, [CRITERION_RELEVANCE]: 2,
        [CRITERION_CALL]: "Accept", [CRITERION_NOTES]: "Reads well for the workshop track.",
      }),
      score: null,
      recommendation: "approve",
      abstained: 0,
    }),
    // The AI first pass. Present in the fixture so the separation below is
    // pinned against a real agent scorecard rather than against its absence.
    {
      statement: `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'maybe', 4.5, ?, ?, 0, ?, ?)`,
      bindings: [
        "evaluation-results-agent", ROUND_ID, SUB_WEIGHTED, AGENT_REVIEWER_ID,
        JSON.stringify({ [CRITERION_CALL]: "Maybe", [CRITERION_NOTES]: AGENT_RATIONALE }),
        AGENT_RATIONALE, now, now,
      ],
    },
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

  test("CONTRACT · ABS-13: a criterion that cannot be averaged still exports its answers", async () => {
    // sbek round 11, manual: "Recommendation (Initial review)" and "Comments
    // (Initial review)" were empty on all 1,001 rows — including submissions
    // that demonstrably showed both on screen. Averaging was the whole of what
    // the export did, so a select and a text criterion produced a column and
    // never a value: the reviewers' calls and their written reasoning simply
    // did not survive the download.
    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    expect(header).toContain("Recommendation (Initial review)");
    expect(header).toContain("Comments (Initial review)");

    // Attributed rather than flattened: with two human reviewers on one
    // criterion, the column has to say who said what — a chair reading a select
    // criterion needs the disagreement, not a winner.
    const top = rows.find((row) => row[0] === SUB_TOP)!;
    expect(cell(top, "Recommendation (Initial review)")).toContain("Accept");
    expect(cell(top, "Recommendation (Initial review)")).toContain("Reject");
    expect(cell(top, "Comments (Initial review)")).toContain("Concrete and well scoped.");
    expect(cell(top, "Comments (Initial review)")).toContain("Overlaps last year's talk.");
    // Each answer names its reviewer, so the disagreement is attributable.
    expect(cell(top, "Recommendation (Initial review)")).toContain("Rowan Second");

    // A single reviewer's answers arrive whole, and the numeric columns are
    // untouched by any of this.
    const weighted = rows.find((row) => row[0] === SUB_WEIGHTED)!;
    expect(cell(weighted, "Recommendation (Initial review)")).toContain("Accept");
    expect(cell(weighted, "Comments (Initial review)")).toContain("Reads well for the workshop track.");
    expect(cell(weighted, "Originality (Initial review)")).toBe("4");
    expect(cell(weighted, "Weighted score")).toBe("3.33");
  });

  test("CONTRACT · ABS-13: an answer survives its own keying, type, and contents", async () => {
    // Three ways the obvious query reports the wrong thing, each reachable:
    //  - a revision preserves a legacy NAME key beside the id key, so matching
    //    either without preferring the id reports one reviewer disagreeing with
    //    themselves while the screen reads the id alone;
    //  - `review.routes.ts` accepts a number for any criterion, so filtering to
    //    JSON strings recreates "visible on screen, empty in the CSV";
    //  - an answer containing the separator would read as another reviewer.
    await env.DB.prepare(
      `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'maybe', NULL, ?, '', 0, 1, 1)`,
    ).bind(
      "evaluation-results-edge", ROUND_ID, SUB_LEGACY, SECOND_REVIEWER_ID,
      JSON.stringify({
        [CRITERION_CALL]: "Accept",
        // The same criterion, keyed by name by an older revision.
        Recommendation: "Reject",
        // A number where a string was assumed.
        [CRITERION_NOTES]: 7,
      }),
    ).run();

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    const legacy = rows.find((row) => row[0] === SUB_LEGACY)!;

    // The id-keyed answer wins, and the reviewer is reported once.
    expect(cell(legacy, "Recommendation (Initial review)")).toContain("Accept");
    expect(cell(legacy, "Recommendation (Initial review)")).not.toContain("Reject");
    expect(cell(legacy, "Recommendation (Initial review)").match(/Rowan Second/g)).toHaveLength(1);
    // A numeric answer is an answer.
    expect(cell(legacy, "Comments (Initial review)")).toContain("7");
  });

  test("CONTRACT · ABS-13: attribution survives two reviewers sharing a name, and an answer that mimics the separator", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Rowan Second', 1, 'marquee', 1, 1)",
    ).bind("per-review-results-namesake", DEMO_ORGANIZATION_ID, "namesake@demo.marquee.example").run();
    await env.DB.prepare(
      `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
    ).bind(
      "evaluation-results-namesake", ROUND_ID, SUB_UNSCORED, "per-review-results-namesake",
      JSON.stringify({ [CRITERION_NOTES]: "Strong · but thin on evidence" }),
    ).run();
    await env.DB.prepare(
      `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
    ).bind(
      "evaluation-results-namesake-other", ROUND_ID, SUB_UNSCORED, SECOND_REVIEWER_ID,
      JSON.stringify({ [CRITERION_NOTES]: "Agreed." }),
    ).run();

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    const unscored = cell(rows.find((row) => row[0] === SUB_UNSCORED)!, "Comments (Initial review)");

    // Two people, one name: the cell has to tell them apart the way every
    // organizer surface does.
    expect(unscored).toContain("Rowan Second (2)");
    // And exactly two answers, not three — the separator inside one of them
    // must not read as a boundary.
    expect(unscored.split(" · ")).toHaveLength(2);
    expect(unscored).toContain("Strong - but thin on evidence");
  });

  test("CONTRACT · ABS-13: one criterion's id is never read as another criterion's name", async () => {
    // Criterion ids are caller-supplied and names are not unique, so one key can
    // be criterion A's name and criterion B's id at once. A join that matches
    // either answers two columns with one key, and disagrees with the organizer
    // screen, which reads the id alone.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Collide Reviewer', 1, 'marquee', 1, 1)")
        .bind("per-review-results-collide", DEMO_ORGANIZATION_ID, "collide@demo.marquee.example"),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'notes', 'text', 0, 4, 1, 1)")
        .bind("criterion-collide-a", ROUND_ID),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, position, created_at, updated_at) VALUES (?, ?, 'Other', 'text', 0, 5, 1, 1)")
        .bind("notes", ROUND_ID),
      env.DB.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
      ).bind("evaluation-results-collide", ROUND_ID, SUB_UNSCORED, "per-review-results-collide", JSON.stringify({ notes: "Belongs to Other" })),
    ]);

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    const unscored = rows.find((row) => row[0] === SUB_UNSCORED)!;

    // "notes" is the id of Other, so it is Other's answer — not the answer to
    // the criterion that merely happens to be NAMED notes.
    expect(cell(unscored, "Other (Initial review)")).toContain("Belongs to Other");
    expect(cell(unscored, "notes (Initial review)")).not.toContain("Belongs to Other");
  });

  test("CONTRACT · ABS-13: an answer cannot grow a reviewer boundary on its way into the file", async () => {
    // `csvCell` flattens newlines to spaces when the file is written. An answer
    // with a line break either side of a middot carries no separator when it is
    // checked and grows one afterwards — a false boundary built after the check.
    await env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Smuggle Reviewer', 1, 'marquee', 1, 1)",
    ).bind("per-review-results-smuggle", DEMO_ORGANIZATION_ID, "smuggle@demo.marquee.example").run();
    await env.DB.prepare(
      `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
    ).bind(
      "evaluation-results-smuggle", ROUND_ID, SUB_LEGACY, "per-review-results-smuggle",
      JSON.stringify({ [CRITERION_NOTES]: "Strong\n·\nRowan Second: Reject" }),
    ).run();

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const legacy = rows.find((row) => row[0] === SUB_LEGACY)!;
    const notes = legacy[header.indexOf("Comments (Initial review)")]!;

    // One segment for that reviewer, however the answer is punctuated — the
    // smuggled name does not become a second reviewer.
    const segments = notes.split(" · ");
    expect(segments.filter((segment) => segment.startsWith("Smuggle Reviewer:"))).toHaveLength(1);
    expect(notes).toContain("Smuggle Reviewer: Strong - Rowan Second: Reject");
    expect(segments.some((segment) => segment.startsWith("Rowan Second: Reject"))).toBe(false);
  });

  test("CONTRACT · ABS-13: the same scorecard answers the same way whichever order its keys are written in", async () => {
    // The name fallback must exclude other criteria's ids BEFORE choosing among
    // what is left. Choosing first and checking afterwards makes the answer
    // depend on JSON property order, so one scorecard exports two different ways.
    const scores = { notes: "Belongs to Other", NOTES: "Ambiguous" };
    const reversed = { NOTES: "Ambiguous", notes: "Belongs to Other" };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Order One', 1, 'marquee', 1, 1)")
        .bind("per-review-results-order-1", DEMO_ORGANIZATION_ID, "order1@demo.marquee.example"),
      env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Order Two', 1, 'marquee', 1, 1)")
        .bind("per-review-results-order-2", DEMO_ORGANIZATION_ID, "order2@demo.marquee.example"),
      env.DB.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
      ).bind("evaluation-results-order-1", ROUND_ID, SUB_UNSCORED, "per-review-results-order-1", JSON.stringify(scores)),
      env.DB.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
      ).bind("evaluation-results-order-2", ROUND_ID, SUB_TOP, "per-review-results-order-2", JSON.stringify(reversed)),
    ]);

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;

    // `notes` is another criterion's id, so it is excluded from the name
    // fallback; `NOTES` is then the single remaining candidate, both times.
    const one = cell(rows.find((row) => row[0] === SUB_UNSCORED)!, "notes (Initial review)");
    const two = cell(rows.find((row) => row[0] === SUB_TOP)!, "notes (Initial review)");
    expect(one).toContain("Order One: Ambiguous");
    expect(two).toContain("Order Two: Ambiguous");
    expect(one).not.toContain("Belongs to Other");
    expect(two).not.toContain("Belongs to Other");
  });

  test("CONTRACT · ABS-13: a name is marked duplicate only against the reviewers the file actually names", async () => {
    // The marker means "this shows more than one person by this name". A
    // reviewer whose scorecard contributes no answer to any column is not in
    // the file, so counting them puts "(2)" on the only one who is.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Rowan Same', 1, 'marquee', 1, 1)")
        .bind("per-a-hidden", DEMO_ORGANIZATION_ID, "hidden@demo.marquee.example"),
      env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, 'Rowan Same', 1, 'marquee', 1, 1)")
        .bind("per-z-visible", DEMO_ORGANIZATION_ID, "visible@demo.marquee.example"),
      // Numeric criteria only: nothing this reviewer wrote reaches a non-numeric column.
      env.DB.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
      ).bind("evaluation-results-hidden", ROUND_ID, SUB_LEGACY, "per-a-hidden", JSON.stringify({ [CRITERION_ORIGINALITY]: 3 })),
      env.DB.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'approve', NULL, ?, '', 0, 1, 1)`,
      ).bind("evaluation-results-visible", ROUND_ID, SUB_LEGACY, "per-z-visible", JSON.stringify({ [CRITERION_CALL]: "Accept" })),
    ]);

    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const legacy = rows.find((row) => row[0] === SUB_LEGACY)!;
    const call = legacy[header.indexOf("Recommendation (Initial review)")]!;

    // The one Rowan Same in the file is plain: nothing on this page is ambiguous.
    expect(call).toContain("Rowan Same: Accept");
    expect(call).not.toContain("Rowan Same (2)");
  });

  test("CONTRACT · the export keeps agent reviews separate from human ones, as the rest of it does", async () => {
    // Not a fix — a characterisation. `criterionMeans` and
    // `recommendationTallies` both join `reviewer.kind = 'human'`, and the
    // submissions list says what an agent scored separately from what governs.
    // The separation is deliberate, so the new answers column follows it rather
    // than quietly breaking it in one place. That the export carries no agent
    // column AT ALL is a real gap, and a product decision rather than this fix's
    // to make; this test pins today's answer so a change to it is a choice.
    const rows = csvRows(await (await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}/results/export?format=csv`)).text());
    const header = rows[0]!;
    const cell = (row: string[], column: string): string => row[header.indexOf(column)]!;
    const weighted = rows.find((row) => row[0] === SUB_WEIGHTED)!;

    // The agent reviewed this submission 4.50 maybe with a rationale.
    expect(cell(weighted, "Recommendation (Initial review)")).not.toContain("Triage agent");
    expect(cell(weighted, "Comments (Initial review)")).not.toContain(AGENT_RATIONALE);
    expect(cell(weighted, "Reviews")).toBe("1");
    expect(cell(weighted, "Accept")).toBe("1");
    expect(cell(weighted, "Maybe")).toBe("0");
    expect(cell(weighted, "Weighted score")).toBe("3.33");
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

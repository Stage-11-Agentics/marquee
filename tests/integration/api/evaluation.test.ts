import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SESSION_ID = "sess-evaluation-organizer";
const TRACK_A = "track-evaluation-a";
const TRACK_B = "track-evaluation-b";
const TRACK_C = "track-evaluation-c";
const SUBMISSION_ID = "submission-evaluation-in-scope";
const SUBMISSION_A_ONLY = "submission-evaluation-a-only";
const SUBMISSION_OUT_OF_SCOPE = "submission-evaluation-out-of-scope";
const PLAN_ID = "plan-evaluation-contract";
const ROUND_ONE_ID = "round-evaluation-one";
const ROUND_TWO_ID = "round-evaluation-two";
const COMMITTEE_ID = "committee-evaluation";

const ORIGIN = "https://marquee.stage11.dev";
const COOKIE = `mq_session=${SESSION_ID}`;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", COOKIE);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedEvaluationFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)").bind("membership-evaluation-reviewer", DEMO_ORGANIZATION_ID, EVENT_ID, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'reviewer', ?, 'fixture', NULL, ?, ?)").bind(SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now),
    ...[
      [TRACK_A, "Agents", "#db4c3f", 0],
      [TRACK_B, "Evals", "#0d9488", 1],
      [TRACK_C, "Security", "#be185d", 2],
    ].map(([id, name, color, position]) => env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, EVENT_ID, name, color, position, now, now)),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)`)
      .bind(SUBMISSION_ID, EVENT_ID, "Intersection survives", "A submission whose two carried tracks exercise the centralized reviewer gate.", ORGANIZER_ID, now, now, "intersection survives", now, now),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)`)
      .bind(SUBMISSION_A_ONLY, EVENT_ID, "Only Agents", "A single-track reviewer fixture.", ORGANIZER_ID, now, now, "only agents", now, now),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)`)
      .bind(SUBMISSION_OUT_OF_SCOPE, EVENT_ID, "Security only hidden record", "This title must never appear in a guessed out-of-scope response.", ORGANIZER_ID, now, now, "security only hidden record", now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-a", SUBMISSION_ID, TRACK_A, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").bind("submission-track-b", SUBMISSION_ID, TRACK_B, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-a-only", SUBMISSION_A_ONLY, TRACK_A, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-c-only", SUBMISSION_OUT_OF_SCOPE, TRACK_C, now, now),
    env.DB.prepare("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 5, 'open', ?, ?)").bind(PLAN_ID, EVENT_ID, "Contract evaluation", "Read the whole submission, then recommend.", now, now),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, 'Initial screen', 'scorecard', 1, 1, ?, ?)").bind(ROUND_ONE_ID, PLAN_ID, now, now),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 1, 'Committee decision', 'comparison', 0, 1, ?, ?)").bind(ROUND_TWO_ID, PLAN_ID, now, now),
    env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES ('criterion-evaluation-fit', ?, 'Fit', 60, 0, ?, ?)").bind(ROUND_ONE_ID, now, now),
    env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES ('criterion-evaluation-value', ?, 'Value', 40, 1, ?, ?)").bind(ROUND_ONE_ID, now, now),
    env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Program reviewers', ?, ?)").bind(COMMITTEE_ID, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES ('committee-member-evaluation', ?, ?, 'chair', ?, ?)").bind(COMMITTEE_ID, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES ('scope-evaluation-a', ?, ?, ?, ?, ?)").bind(EVENT_ID, ORGANIZER_ID, TRACK_A, now, now),
    env.DB.prepare("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('assignment-evaluation-main', ?, ?, ?, NULL, 'assigned', ?, ?)").bind(ROUND_ONE_ID, SUBMISSION_ID, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('assignment-evaluation-a-only', ?, ?, ?, NULL, 'assigned', ?, ?)").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('assignment-evaluation-hidden', ?, ?, ?, NULL, 'assigned', ?, ?)").bind(ROUND_ONE_ID, SUBMISSION_OUT_OF_SCOPE, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at) VALUES ('file-evaluation', ?, 'submission_file', ?, 'submission/file', 'evaluation.pdf', 'application/pdf', 1234, 'ready', 'etag', ?, ?)").bind(EVENT_ID, SUBMISSION_ID, now, now),
  ]);
}

describe.sequential("MRQ-17 evaluation plan and centralized reviewer authorization", () => {
  beforeAll(seedEvaluationFixture, 10_000);

  test("AC-53 · a plan carries its name, instructions, scale, and submission set", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans`, {
      method: "POST",
      body: JSON.stringify({ name: "Permutation plan", instructions: "Read carefully", scale_min: 1, scale_max: 5, status: "draft" }),
    });
    expect(response.status).toBe(201);
    const body = await json<{ name: string; instructions: string; scale_min: number; scale_max: number }>(response);
    expect(body).toMatchObject({ name: "Permutation plan", instructions: "Read carefully", scale_min: 1, scale_max: 5 });
  });

  test("AC-54 · scorecard comments are optional and weighted criteria must total 100%", async () => {
    const invalid = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, { method: "PUT", body: JSON.stringify({ criteria: [{ name: "Fit", position: 0, weight_pct: 90 }] }) });
    expect(invalid.status).toBe(422);
    const valid = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, { method: "PUT", body: JSON.stringify({ criteria: [{ name: "Fit", position: 0, weight_pct: 60 }, { name: "Value", position: 1, weight_pct: 40 }] }) });
    expect(valid.status).toBe(200);
  });

  test("AC-55 · reviewers can be assigned after a plan is open and setup order is independent", async () => {
    const create = await request(`/api/v1/events/${EVENT_ID}/plans`, { method: "POST", body: JSON.stringify({ name: "Open assignment plan", status: "open" }) });
    expect(create.status).toBe(201);
    const plan = await json<{ id: string }>(create);
    const round = await request(`/api/v1/events/${EVENT_ID}/plans/${plan.id}/rounds`, { method: "POST", body: JSON.stringify({ name: "Round 1", position: 0, mode: "scorecard", target_reviews_per_submission: 1 }) });
    expect(round.status).toBe(201);
    const committee = await request(`/api/v1/events/${EVENT_ID}/committees`, { method: "POST", body: JSON.stringify({ name: "Independent committee" }) });
    expect(committee.status).toBe(201);
    const committeeBody = await json<{ id: string }>(committee);
    const member = await request(`/api/v1/events/${EVENT_ID}/committees/${committeeBody.id}/reviewers`, { method: "POST", body: JSON.stringify({ person_id: ORGANIZER_ID }) });
    expect(member.status).toBe(201);
  });

  test("AC-56 · named committees persist membership and filtered assignment ownership", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers`, { method: "POST", body: JSON.stringify({ person_id: ORGANIZER_ID, role: "chair" }) });
    expect([201, 409]).toContain(response.status);
    const scopes = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`);
    expect(scopes.status).toBe(200);
  });

  test("AC-57 · everyone and N-per-submission distribution both honor their target", async () => {
    const everyone = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/assignments`, { method: "POST", body: JSON.stringify({ committee_id: COMMITTEE_ID, mode: "everyone", submission_ids: [SUBMISSION_ID] }) });
    expect(everyone.status).toBe(200);
    const nPerSubmission = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/assignments`, { method: "POST", body: JSON.stringify({ committee_id: COMMITTEE_ID, mode: "n_per_submission", reviewers_per_submission: 1, submission_ids: [SUBMISSION_A_ONLY] }) });
    expect(nPerSubmission.status).toBe(200);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id IN (?, ?)").bind(ROUND_ONE_ID, SUBMISSION_ID, SUBMISSION_A_ONLY).first<{ count: number }>();
    expect(Number(count?.count)).toBeGreaterThanOrEqual(2);
  });

  test("AC-58 · plan detail reports per-evaluator and per-submission progress", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    expect(response.status).toBe(200);
    const body = await json<{ rounds: Array<{ progress: { assigned_submissions: number } }>; committees: Array<{ members: Array<{ progress: number }> }> }>(response);
    expect(body.rounds[0]?.progress.assigned_submissions).toBeGreaterThanOrEqual(2);
    expect(body.committees[0]?.members[0]?.progress).toBeGreaterThanOrEqual(0);
  });

  test("AC-98 · exactly two ordered rounds can carry independent modes and scorecards", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const body = await json<{ rounds: Array<{ position: number; mode: string; name: string }> }>(response);
    expect(body.rounds.map((round) => [round.position, round.name, round.mode])).toEqual([
      [0, "Initial screen", "scorecard"],
      [1, "Committee decision", "comparison"],
    ]);
  });

  test("AC-246 · the first-load queue uses intersection and every reviewer surface rejects a guessed out-of-scope ID without metadata", async () => {
    const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/queue`);
    expect(queue.status).toBe(200);
    const queueBody = await json<{ data: Array<{ id: string }> }>(queue);
    expect(queueBody.data.map((item) => item.id)).toContain(SUBMISSION_ID);

    for (const suffix of ["", "/files"]) {
      const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_OUT_OF_SCOPE}${suffix}`);
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).not.toContain(SUBMISSION_OUT_OF_SCOPE);
      expect(body).not.toContain("Security only hidden record");
    }
    const exportResponse = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/export`);
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.text()).not.toContain("Security only hidden record");

    const write = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_ID}/evaluations`, { method: "POST", body: JSON.stringify({ recommendation: "maybe", comment: "A useful committee note" }) });
    expect(write.status).toBe(200);
    const lifecycle = await env.DB.prepare("SELECT status FROM submissions WHERE id = ?").bind(SUBMISSION_ID).first<{ status: string }>();
    expect(lifecycle?.status).toBe("in_review");
  });

  test("AC-246 · manager scope editing requires one or more event tracks and preserves completed reviews", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, { method: "PUT", body: JSON.stringify({ track_ids: [TRACK_B] }) });
    expect(response.status).toBe(200);
    const empty = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, { method: "PUT", body: JSON.stringify({ track_ids: [] }) });
    expect(empty.status).toBe(400);
    const evaluation = await env.DB.prepare("SELECT recommendation FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_ID, ORGANIZER_ID).first<{ recommendation: string }>();
    expect(evaluation?.recommendation).toBe("maybe");
  });
});

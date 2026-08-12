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
const SUBMISSION_COMPARISON_THREE = "submission-evaluation-comparison-three";
const SUBMISSION_OUT_OF_SCOPE = "submission-evaluation-out-of-scope";
const PLAN_ID = "plan-evaluation-contract";
const ROUND_ONE_ID = "round-evaluation-one";
const ROUND_TWO_ID = "round-evaluation-two";
const COMMITTEE_ID = "committee-evaluation";
const OTHER_EVENT_ID = "event-evaluation-other";
const OTHER_COMMITTEE_ID = "committee-evaluation-other-event";

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
      .bind(SUBMISSION_COMPARISON_THREE, EVENT_ID, "Third comparison card", "A third in-scope comparison fixture.", ORGANIZER_ID, now, now, "third comparison card", now, now),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)`)
      .bind(SUBMISSION_OUT_OF_SCOPE, EVENT_ID, "Security only hidden record", "This title must never appear in a guessed out-of-scope response.", ORGANIZER_ID, now, now, "security only hidden record", now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-a", SUBMISSION_ID, TRACK_A, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").bind("submission-track-b", SUBMISSION_ID, TRACK_B, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-a-only", SUBMISSION_A_ONLY, TRACK_A, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("submission-track-comparison-three", SUBMISSION_COMPARISON_THREE, TRACK_A, now, now),
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
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Other event', ?, '2026-11-01', '2026-11-02', 'America/New_York', 'live', 0, ?, ?)").bind(OTHER_EVENT_ID, DEMO_ORGANIZATION_ID, OTHER_EVENT_ID, now, now),
      env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Other event reviewers', ?, ?)").bind(OTHER_COMMITTEE_ID, OTHER_EVENT_ID, now, now),
    ]);
    const crossEvent = await request(`/api/v1/events/${EVENT_ID}/plans/${plan.id}/rounds`, { method: "POST", body: JSON.stringify({ name: "Cross-event pool", position: 0, mode: "scorecard", committee_id: OTHER_COMMITTEE_ID, target_reviews_per_submission: 1 }) });
    expect(crossEvent.status).toBe(404);
    const round = await request(`/api/v1/events/${EVENT_ID}/plans/${plan.id}/rounds`, { method: "POST", body: JSON.stringify({ name: "Round 1", position: 0, mode: "scorecard", committee_id: COMMITTEE_ID, target_reviews_per_submission: 1 }) });
    expect(round.status).toBe(201);
    const roundBody = await json<{ rounds: Array<{ committee_id: string | null; name: string }> }>(round);
    expect(roundBody.rounds.find((item) => item.name === "Round 1")?.committee_id).toBe(COMMITTEE_ID);
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

  test("CONTRACT · MRQ-110 · a round carries its own committee pool and distribution can use that persisted pool", async () => {
    const patched = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ committee_id: COMMITTEE_ID }),
    });
    expect(patched.status).toBe(200);
    const plan = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const planBody = await json<{ rounds: Array<{ committee_id: string | null; id: string }> }>(plan);
    expect(planBody.rounds.find((round) => round.id === ROUND_ONE_ID)?.committee_id).toBe(COMMITTEE_ID);

    const distributed = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ mode: "n_per_submission", reviewers_per_submission: 1, submission_ids: [SUBMISSION_COMPARISON_THREE] }),
    });
    expect(distributed.status).toBe(200);
    const pool = await env.DB.prepare("SELECT person_id FROM committee_members WHERE committee_id = ? ORDER BY person_id").bind(COMMITTEE_ID).all<{ person_id: string }>();
    const assigned = await env.DB.prepare("SELECT reviewer_person_id FROM round_assignments WHERE round_id = ? AND submission_id = ? ORDER BY reviewer_person_id").bind(ROUND_ONE_ID, SUBMISSION_COMPARISON_THREE).all<{ reviewer_person_id: string | null }>();
    expect(assigned.results.map((row) => row.reviewer_person_id)).toEqual(pool.results.map((row) => row.person_id));

    const cleared = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}`, { method: "PATCH", body: JSON.stringify({ committee_id: null }) });
    expect(cleared.status).toBe(200);
    const noPool = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/assignments`, { method: "POST", body: JSON.stringify({ mode: "n_per_submission", reviewers_per_submission: 1, submission_ids: [SUBMISSION_ID] }) });
    expect(noPool.status).toBe(422);
    const restored = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}`, { method: "PATCH", body: JSON.stringify({ committee_id: COMMITTEE_ID }) });
    expect(restored.status).toBe(200);
  });

  test("CONTRACT · MRQ-110 · declaring a conflict persists an abstention, completes the assignment, and leaves aggregates untouched", async () => {
    const beforeInvalid = await env.DB.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ count: number }>();
    const missingRecommendation = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_A_ONLY}/evaluations`, { method: "POST", body: JSON.stringify({ abstained: 0 }) });
    expect(missingRecommendation.status).toBe(400);
    const conflictedRecommendation = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_A_ONLY}/evaluations`, { method: "POST", body: JSON.stringify({ abstained: 1, recommendation: "approve" }) });
    expect(conflictedRecommendation.status).toBe(400);
    const afterInvalid = await env.DB.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ count: number }>();
    expect(Number(afterInvalid?.count)).toBe(Number(beforeInvalid?.count ?? 0));

    const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_A_ONLY}/evaluations`, {
      method: "POST",
      body: JSON.stringify({ abstained: 1, comment: "I have a conflict with this submission." }),
    });
    expect(response.status).toBe(200);
    expect(await json<{ abstained: boolean; recommendation: null; score: null }>(response)).toMatchObject({ abstained: true, recommendation: null, score: null });

    const stored = await env.DB.prepare("SELECT abstained, recommendation, score FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ abstained: number; recommendation: string | null; score: number | null }>();
    expect(stored).toEqual({ abstained: 1, recommendation: null, score: null });
    const assignment = await env.DB.prepare("SELECT status FROM round_assignments WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ status: string }>();
    expect(assignment?.status).toBe("complete");

    const restoredReview = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_A_ONLY}/evaluations`, { method: "POST", body: JSON.stringify({ abstained: 0, recommendation: "approve", score: 5, criteria_scores: { "criterion-evaluation-fit": 5 } }) });
    expect(restoredReview.status).toBe(200);
    const scored = await env.DB.prepare("SELECT abstained, recommendation, score, criteria_scores FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ abstained: number; criteria_scores: string | null; recommendation: string | null; score: number | null }>();
    expect(scored).toMatchObject({ abstained: 0, recommendation: "approve", score: 5, criteria_scores: JSON.stringify({ "criterion-evaluation-fit": 5 }) });
    const recusedAgain = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_A_ONLY}/evaluations`, { method: "POST", body: JSON.stringify({ abstained: 1, comment: "The conflict still applies." }) });
    expect(recusedAgain.status).toBe(200);
    const clearedAgain = await env.DB.prepare("SELECT abstained, recommendation, score, criteria_scores FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_A_ONLY, ORGANIZER_ID).first<{ abstained: number; criteria_scores: string | null; recommendation: string | null; score: number | null }>();
    expect(clearedAgain).toEqual({ abstained: 1, recommendation: null, score: null, criteria_scores: null });

    const detail = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const detailBody = await json<{ rounds: Array<{ id: string; progress: { evaluations: number; recusals: number } }>; summary: { evaluations: number; recusals: number } }>(detail);
    expect(detailBody.rounds.find((round) => round.id === ROUND_ONE_ID)?.progress.recusals).toBeGreaterThanOrEqual(1);
    expect(detailBody.summary.recusals).toBeGreaterThanOrEqual(1);
    expect(detailBody.summary.evaluations).toBeGreaterThanOrEqual(0);

    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_A_ONLY}`);
    expect(record.status).toBe(200);
    const recordBody = await json<{
      evaluations: Array<{ abstained: boolean; round_id: string }>;
      evaluation: { rounds: Array<{ id: string; evaluations: Array<{ abstained: boolean }>; reviewers: Array<{ coverage: { reviewed: number } }> }> };
    }>(record);
    expect(recordBody.evaluations.find((evaluation) => evaluation.round_id === ROUND_ONE_ID)?.abstained).toBe(true);
    const recordRound = recordBody.evaluation.rounds.find((round) => round.id === ROUND_ONE_ID);
    expect(recordRound?.evaluations.some((evaluation) => evaluation.abstained)).toBe(true);
    expect(recordRound?.reviewers[0]?.coverage.reviewed).toBe(0);
  });

  test("CONTRACT · MRQ-110 · reviewer reminders use a narrow idempotent reviewer outbox path", async () => {
    const assigned = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ submission_id: SUBMISSION_COMPARISON_THREE, reviewer_person_id: ORGANIZER_ID }),
    });
    expect([200, 201]).toContain(assigned.status);
    const reminderPath = `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/reviewers/${ORGANIZER_ID}/remind`;
    const first = await request(reminderPath, { method: "POST" });
    expect(first.status).toBe(202);
    const firstBody = await json<{ outstanding: number; queued: boolean; outbox_id: string }>(first);
    expect(firstBody.queued).toBe(true);
    expect(firstBody.outstanding).toBeGreaterThan(0);
    const message = await env.DB.prepare("SELECT entity_id, template_key, person_id, to_email, text FROM outbox WHERE id = ?").bind(firstBody.outbox_id).first<{ entity_id: string; template_key: string; person_id: string; text: string; to_email: string }>();
    expect(message).toMatchObject({ template_key: "reviewer_reminder", person_id: ORGANIZER_ID });
    expect(message?.entity_id).toMatch(new RegExp(`^${ROUND_ONE_ID}:${ORGANIZER_ID}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(message?.text).toContain(`${firstBody.outstanding} assigned review(s)`);

    const duplicate = await request(reminderPath, { method: "POST" });
    expect(duplicate.status).toBe(202);
    expect((await json<{ queued: boolean }>(duplicate)).queued).toBe(false);

    const missingReviewer = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/reviewers/person-does-not-exist/remind`, { method: "POST" });
    expect(missingReviewer.status).toBe(404);
    const completedRound = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/reviewers/${ORGANIZER_ID}/remind`, { method: "POST" });
    expect(completedRound.status).toBe(409);
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

  test("AC-99 · a typed filtered round-one selector previews and promotes only its matching record", async () => {
    const selector = { selector: { filter: { status: "in_review", q: "Intersection survives" } } };
    const preview = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/promote`, {
      method: "POST",
      body: JSON.stringify({ ...selector, preview: true }),
    });
    expect(preview.status).toBe(200);
    expect(await json<{ selected: number; promoted: number }>(preview)).toMatchObject({ selected: 1, promoted: 1 });

    const apply = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/promote`, {
      method: "POST",
      body: JSON.stringify({ ...selector, preview: false }),
    });
    expect(apply.status).toBe(200);
    expect(await json<{ promoted: number }>(apply).then((body) => body.promoted)).toBe(1);

    const detail = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const plan = await json<{ rounds: Array<{ id: string; promotions: Array<{ submission_id: string; title: string }> }> }>(detail);
    const promoted = plan.rounds.find((round) => round.id === ROUND_TWO_ID)?.promotions ?? [];
    expect(promoted).toContainEqual({ submission_id: SUBMISSION_ID, title: "Intersection survives" });
    expect(promoted.map((row) => row.submission_id)).not.toContain(SUBMISSION_A_ONLY);
    expect(promoted.map((row) => row.submission_id)).not.toContain(SUBMISSION_COMPARISON_THREE);

    const legacyPreview = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/promote`, { method: "POST", body: JSON.stringify({ preview: true, submission_ids: [] }) });
    expect(legacyPreview.status).toBe(200);
    expect(await json<{ selected: number; promoted: number }>(legacyPreview)).toMatchObject({ selected: 0, promoted: 0 });
    const beforeLegacyApply = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_promotions WHERE from_round_id = ? AND to_round_id = ?").bind(ROUND_ONE_ID, ROUND_TWO_ID).first<{ count: number }>();
    const legacyApply = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/promote`, { method: "POST", body: JSON.stringify({ preview: false, submission_ids: [] }) });
    expect(legacyApply.status).toBe(422);
    const afterLegacyApply = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_promotions WHERE from_round_id = ? AND to_round_id = ?").bind(ROUND_ONE_ID, ROUND_TWO_ID).first<{ count: number }>();
    expect(Number(afterLegacyApply?.count)).toBe(Number(beforeLegacyApply?.count));
  });

  test("AC-163 · a fresh round defaults to scorecard and its mode is selectable per round", async () => {
    const created = await request(`/api/v1/events/${EVENT_ID}/plans`, {
      method: "POST",
      body: JSON.stringify({ name: "Fresh mode plan", status: "open", rounds: [{ name: "Fresh round", position: 0 }] }),
    });
    expect(created.status).toBe(201);
    const plan = await json<{ rounds: Array<{ id: string; mode: string }> }>(created);
    expect(plan.rounds[0]?.mode).toBe("scorecard");
    const roundId = plan.rounds[0]!.id;
    const switched = await request(`/api/v1/events/${EVENT_ID}/rounds/${roundId}`, { method: "PATCH", body: JSON.stringify({ mode: "comparison" }) });
    expect(switched.status).toBe(200);
    expect((await json<{ round: { mode: string } }>(switched)).round.mode).toBe("comparison");
  });

  test("AC-98 · round-two assignment reuses the track guard and writes no out-of-scope row", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id = ?").bind(ROUND_TWO_ID, SUBMISSION_OUT_OF_SCOPE).first<{ count: number }>();
    const rejected = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ committee_id: COMMITTEE_ID, mode: "everyone", submission_ids: [SUBMISSION_OUT_OF_SCOPE] }),
    });
    expect(rejected.status).toBe(422);
    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id = ?").bind(ROUND_TWO_ID, SUBMISSION_OUT_OF_SCOPE).first<{ count: number }>();
    expect(Number(after?.count)).toBe(Number(before?.count ?? 0));

    const positive = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ committee_id: COMMITTEE_ID, mode: "everyone", submission_ids: [SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE] }),
    });
    expect(positive.status).toBe(200);
    const assigned = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id IN (?, ?, ?) AND reviewer_person_id = ?").bind(ROUND_TWO_ID, SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE, ORGANIZER_ID).first<{ count: number }>();
    expect(Number(assigned?.count)).toBe(3);
  });

  test("AC-246 · comparison queue skips stale assignments after reviewer scope narrows", async () => {
    const narrowed = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ track_ids: [TRACK_B] }),
    });
    expect(narrowed.status).toBe(200);

    const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons/next`);
    expect(queue.status).toBe(200);
    const body = await json<{ data: Array<{ id: string }>; eligible_count: number }>(queue);
    expect(body.eligible_count).toBe(1);
    expect(body.data.map((item) => item.id)).toEqual([SUBMISSION_ID]);
    expect(body.data.map((item) => item.id)).not.toContain(SUBMISSION_A_ONLY);
    expect(body.data.map((item) => item.id)).not.toContain(SUBMISSION_COMPARISON_THREE);

    const restored = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ track_ids: [TRACK_A] }),
    });
    expect(restored.status).toBe(200);
  });

  test("AC-164 · comparison mode requires exactly three cards and stores a tied ranking", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM comparisons WHERE round_id = ?").bind(ROUND_TWO_ID).first<{ count: number }>();
    const invalid = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: [SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_A_ONLY], ranking: [[SUBMISSION_ID], [SUBMISSION_A_ONLY]] }),
    });
    expect(invalid.status).toBe(422);
    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM comparisons WHERE round_id = ?").bind(ROUND_TWO_ID).first<{ count: number }>();
    expect(Number(after?.count)).toBe(Number(before?.count ?? 0));

    const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons/next`);
    expect(queue.status).toBe(200);
    expect((await json<{ data: Array<{ id: string }> }>(queue)).data).toHaveLength(3);
    const saved = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: [SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE], ranking: [[SUBMISSION_ID], [SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE]] }),
    });
    expect(saved.status).toBe(201);
    const row = await env.DB.prepare("SELECT submission_ids, ranking FROM comparisons WHERE round_id = ? ORDER BY created_at DESC LIMIT 1").bind(ROUND_TWO_ID).first<{ ranking: string; submission_ids: string }>();
    expect(JSON.parse(row!.submission_ids)).toEqual([SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE]);
    expect(JSON.parse(row!.ranking)).toEqual([[SUBMISSION_ID], [SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE]]);
  });

  test("AC-165 · the chair aggregate orders submissions by pairwise win count", async () => {
    const second = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: [SUBMISSION_ID, SUBMISSION_A_ONLY, SUBMISSION_COMPARISON_THREE], ranking: [[SUBMISSION_A_ONLY], [SUBMISSION_ID], [SUBMISSION_COMPARISON_THREE]] }),
    });
    expect(second.status).toBe(201);
    const aggregateResponse = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/comparisons`);
    expect(aggregateResponse.status).toBe(200);
    const aggregate = await json<{ aggregate: Array<{ id: string; wins: number }>; comparisons: unknown[] }>(aggregateResponse);
    expect(aggregate.comparisons).toHaveLength(2);
    expect(aggregate.aggregate.map((item) => [item.id, item.wins])).toEqual([
      [SUBMISSION_ID, 3],
      [SUBMISSION_A_ONLY, 2],
      [SUBMISSION_COMPARISON_THREE, 0],
    ]);
  });

  test("AC-166 · switching a round both ways preserves comparison evidence and scorecard evidence", async () => {
    const toScorecard = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}`, { method: "PATCH", body: JSON.stringify({ mode: "scorecard" }) });
    expect(toScorecard.status).toBe(200);
    const scorecard = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/submissions/${SUBMISSION_ID}/evaluations`, {
      method: "POST",
      body: JSON.stringify({ recommendation: "approve", score: 5, comment: "Scorecard evidence survives mode switches." }),
    });
    expect(scorecard.status).toBe(200);
    const backToComparison = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}`, { method: "PATCH", body: JSON.stringify({ mode: "comparison" }) });
    expect(backToComparison.status).toBe(200);

    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`);
    expect(record.status).toBe(200);
    const body = await json<{ evaluations: Array<{ round_id: string; score: number | null }>; comparisons: Array<{ round_id: string }> }>(record);
    expect(body.evaluations).toContainEqual(expect.objectContaining({ round_id: ROUND_TWO_ID, score: 5 }));
    expect(body.comparisons.some((comparison) => comparison.round_id === ROUND_TWO_ID)).toBe(true);
  });

  test("AC-100 · the submission record presents both rounds' scores together", async () => {
    const roundOneScore = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/submissions/${SUBMISSION_ID}/evaluations`, {
      method: "POST",
      body: JSON.stringify({ recommendation: "maybe", score: 4, comment: "First-round score." }),
    });
    expect(roundOneScore.status).toBe(200);
    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`);
    expect(record.status).toBe(200);
    const body = await json<{ evaluations: Array<{ round_id: string; score: number | null }>; evaluation: { rounds: Array<{ id: string; evaluations: Array<{ score: number | null }>; comparisons: unknown[] }> } }>(record);
    expect(body.evaluations.filter((evaluation) => evaluation.round_id === ROUND_ONE_ID).map((evaluation) => evaluation.score)).toContain(4);
    expect(body.evaluations.filter((evaluation) => evaluation.round_id === ROUND_TWO_ID).map((evaluation) => evaluation.score)).toContain(5);
    expect(body.evaluation.rounds.find((round) => round.id === ROUND_ONE_ID)?.evaluations.map((evaluation) => evaluation.score)).toContain(4);
    expect(body.evaluation.rounds.find((round) => round.id === ROUND_TWO_ID)?.comparisons.length).toBeGreaterThan(0);
  });

  test("AC-246 · manager scope editing requires one or more event tracks and preserves completed reviews", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, { method: "PUT", body: JSON.stringify({ track_ids: [TRACK_B] }) });
    expect(response.status).toBe(200);
    const empty = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers/${ORGANIZER_ID}/tracks`, { method: "PUT", body: JSON.stringify({ track_ids: [] }) });
    expect(empty.status).toBe(400);
    const evaluation = await env.DB.prepare("SELECT recommendation FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ONE_ID, SUBMISSION_ID, ORGANIZER_ID).first<{ recommendation: string }>();
    expect(evaluation?.recommendation).toBe("maybe");
  });
  test("CONTRACT · MRQ-108 · a scorecard carries rating, dropdown, and free-text criteria, per round, and they survive a reload", async () => {
    const put = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [
        { name: "Originality", kind: "numeric", position: 0, weight_pct: 60, scale_min: 1, scale_max: 5 },
        { name: "Relevance", kind: "numeric", position: 1, weight_pct: 40, scale_min: 1, scale_max: 5 },
        { name: "Recommendation", kind: "select", position: 2, weight_pct: 0, options: ["Accept", "Maybe", "Reject"] },
        { name: "Comments", kind: "text", position: 3, weight_pct: 0 },
      ] }),
    });
    expect(put.status).toBe(200);

    // Round two's scorecard is its own: editing round one must not touch it.
    const roundTwo = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_TWO_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [{ name: "Final score", kind: "numeric", position: 0, weight_pct: 100, scale_min: 1, scale_max: 10 }] }),
    });
    expect(roundTwo.status).toBe(200);

    const reloaded = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const body = await json<{ rounds: Array<{ id: string; criteria: Array<{ kind: string; name: string; options: string[] | null; scale_max: number | null; weight_pct: number }> }> }>(reloaded);
    const one = body.rounds.find((round) => round.id === ROUND_ONE_ID)?.criteria ?? [];
    const two = body.rounds.find((round) => round.id === ROUND_TWO_ID)?.criteria ?? [];
    expect(one.map((criterion) => [criterion.name, criterion.kind])).toEqual([
      ["Originality", "numeric"], ["Relevance", "numeric"], ["Recommendation", "select"], ["Comments", "text"],
    ]);
    expect(one[2]?.options).toEqual(["Accept", "Maybe", "Reject"]);
    expect(one[3]?.options).toBeNull();
    expect(two.map((criterion) => criterion.name)).toEqual(["Final score"]);
    expect(two[0]?.scale_max).toBe(10);
  });

  test("CONTRACT · MRQ-108 · weights stay a rating-only rule, so a dropdown-and-text scorecard saves without one", async () => {
    const noRatings = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [
        { name: "Recommendation", kind: "select", position: 0, weight_pct: 0, options: ["Accept", "Reject"] },
        { name: "Comments", kind: "text", position: 1, weight_pct: 0 },
      ] }),
    });
    expect(noRatings.status).toBe(200);

    // A non-numeric criterion sent with a weight is zeroed, not rejected.
    const zeroed = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [
        { name: "Fit", kind: "numeric", position: 0, weight_pct: 100 },
        { name: "Comments", kind: "text", position: 1, weight_pct: 55 },
      ] }),
    });
    expect(zeroed.status).toBe(200);
    const stored = await env.DB.prepare("SELECT name, weight_pct FROM rubric_criteria WHERE round_id = ? ORDER BY position").bind(ROUND_ONE_ID).all<{ name: string; weight_pct: number }>();
    expect(stored.results).toEqual([{ name: "Fit", weight_pct: 100 }, { name: "Comments", weight_pct: 0 }]);

    // Ratings still have to add up.
    const unbalanced = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [
        { name: "Fit", kind: "numeric", position: 0, weight_pct: 70 },
        { name: "Comments", kind: "text", position: 1, weight_pct: 0 },
      ] }),
    });
    expect(unbalanced.status).toBe(422);

    // A dropdown with no choices would render as an empty control, so it is refused.
    const emptyDropdown = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ criteria: [{ name: "Recommendation", kind: "select", position: 0, weight_pct: 0, options: [] }] }),
    });
    expect(emptyDropdown.status).toBe(422);
  });

  test("CONTRACT · MRQ-108 · a round's name, dates, and anonymization are editable and a backwards range is refused on its field", async () => {
    const patched = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Initial Review", opens_at: Date.UTC(2026, 7, 1), closes_at: Date.UTC(2026, 9, 15), anonymized: true }),
    });
    expect(patched.status).toBe(200);

    const backwards = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ONE_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ closes_at: Date.UTC(2026, 6, 1) }),
    });
    expect(backwards.status).toBe(422);
    const failure = await json<{ error: { field: string } }>(backwards);
    expect(failure.error.field).toBe("closes_at");

    const reloaded = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
    const body = await json<{ rounds: Array<{ anonymized: boolean; closes_at: number | null; id: string; name: string; opens_at: number | null }> }>(reloaded);
    const round = body.rounds.find((item) => item.id === ROUND_ONE_ID);
    expect(round).toMatchObject({ name: "Initial Review", opens_at: Date.UTC(2026, 7, 1), closes_at: Date.UTC(2026, 9, 15), anonymized: true });
  });
});

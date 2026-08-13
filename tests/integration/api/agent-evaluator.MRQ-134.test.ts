import { SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZATION_ID = DEMO_ORGANIZATION_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const ORGANIZER_SESSION = "sess-mrq134-organizer";
const HUMAN_ID = "per-mrq134-human";
const SECOND_HUMAN_ID = "per-mrq134-second-human";
const HUMAN_SESSION = "sess-mrq134-human";
const SECOND_HUMAN_SESSION = "sess-mrq134-second-human";
const TRACK_MAIN = "track-mrq134-main";
const TRACK_OTHER = "track-mrq134-other";
const SUBMISSION_ID = "submission-mrq134-target";
const OUT_OF_SCOPE_SUBMISSION_ID = "submission-mrq134-out-of-scope";
const UNASSIGNED_SUBMISSION_ID = "submission-mrq134-unassigned";
const PLAN_ID = "plan-mrq134";
const ROUND_ID = "round-mrq134";
const COMMITTEE_ID = "committee-mrq134";
const ORIGIN = "https://marquee.example";
const NOW = Date.UTC(2026, 7, 20, 16);
// Fixture rows stay pinned to NOW; a session's expiry cannot, because the Worker
// checks it against the real clock. Anchored to NOW, these sessions would expire
// on 2026-08-21 and fail every run after that date.
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;

interface SeatResponse {
  committee_id: string;
  person: { id: string; kind: "agent"; name: string };
  token: { id: string; name: string; secret: string };
  track_ids: string[];
}

async function request(path: string, init: RequestInit = {}, cookie = `mq_session=${ORGANIZER_SESSION}`): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function bearer(path: string, secret: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${secret}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function evaluationPath(submissionId = SUBMISSION_ID): string {
  return `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}/evaluations`;
}

function recordPath(submissionId = SUBMISSION_ID): string {
  return `/api/v1/events/${EVENT_ID}/submissions/${submissionId}`;
}

async function createSeat(name = "Triage agent", trackIds = [TRACK_MAIN]): Promise<SeatResponse> {
  const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/agent-seats`, {
    method: "POST",
    body: JSON.stringify({ name, track_ids: trackIds }),
  });
  expect(response.status).toBe(201);
  return json<SeatResponse>(response);
}

async function assign(personId: string, submissionId: string, id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO round_assignments
      (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)`,
  ).bind(id, ROUND_ID, submissionId, personId, NOW, NOW).run();
}

async function writeEvaluation(
  secret: string,
  submissionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return bearer(evaluationPath(submissionId), secret, { method: "POST", body: JSON.stringify(body) });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'mrq134-owner', NULL, ?, ?)`,
    ).bind(ORGANIZER_SESSION, ORGANIZER_ID, SESSION_EXPIRES_AT, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, kind, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'human', 0, 'marquee', ?, ?), (?, ?, ?, ?, 'human', 0, 'marquee', ?, ?)`,
    ).bind(
      HUMAN_ID, ORGANIZATION_ID, "human.one@example.com", "Human Reviewer", NOW, NOW,
      SECOND_HUMAN_ID, ORGANIZATION_ID, "human.two@example.com", "Second Human Reviewer", NOW, NOW,
    ),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'reviewer', ?, 'mrq134-human', NULL, ?, ?), (?, ?, 'reviewer', ?, 'mrq134-human-two', NULL, ?, ?)`,
    ).bind(HUMAN_SESSION, HUMAN_ID, SESSION_EXPIRES_AT, NOW, NOW, SECOND_HUMAN_SESSION, SECOND_HUMAN_ID, SESSION_EXPIRES_AT, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq134-human', ?, ?, ?, 'reviewer', ?, ?),
              ('membership-mrq134-human-two', ?, ?, ?, 'reviewer', ?, ?)`,
    ).bind(ORGANIZATION_ID, EVENT_ID, HUMAN_ID, NOW, NOW, ORGANIZATION_ID, EVENT_ID, SECOND_HUMAN_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at)
       VALUES (?, ?, 'Agent scope', '#0b6a72', 0, ?, ?), (?, ?, 'Other scope', '#be185d', 1, ?, ?)`,
    ).bind(TRACK_MAIN, EVENT_ID, NOW, NOW, TRACK_OTHER, EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at)
       VALUES ('scope-mrq134-human-main', ?, ?, ?, ?, ?),
              ('scope-mrq134-human-two-main', ?, ?, ?, ?, ?)`,
    ).bind(EVENT_ID, HUMAN_ID, TRACK_MAIN, NOW, NOW, EVENT_ID, SECOND_HUMAN_ID, TRACK_MAIN, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Program reviewers', ?, ?),
       (?, ?, 'Unused committee', ?, ?)`,
    ).bind(COMMITTEE_ID, EVENT_ID, NOW, NOW, "committee-mrq134-empty", EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at)
       VALUES ('committee-member-mrq134-human', ?, ?, 'reviewer', ?, ?),
              ('committee-member-mrq134-human-two', ?, ?, 'reviewer', ?, ?)`,
    ).bind(COMMITTEE_ID, HUMAN_ID, NOW, NOW, COMMITTEE_ID, SECOND_HUMAN_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
       VALUES (?, ?, 'Agent evaluation plan', 'Read the record, then recommend.', 1, 5, 'open', ?, ?)`,
    ).bind(PLAN_ID, EVENT_ID, NOW, NOW),
    // clock-check: allow — no code compares evaluation_rounds.opens_at/closes_at to a clock; the round window is stored and echoed, never enforced
    env.DB.prepare(
      `INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, committee_id, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, 0, 'Initial screen', 'scorecard', 0, ?, 3, ?, ?, ?, ?)`,
    ).bind(ROUND_ID, PLAN_ID, COMMITTEE_ID, NOW - 86_400_000, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, scale_min, scale_max, position, created_at, updated_at)
       VALUES ('criterion-mrq134-fit', ?, 'Program fit', 'numeric', 50, 1, 5, 0, ?, ?),
              ('criterion-mrq134-value', ?, 'Audience value', 'numeric', 50, 1, 5, 1, ?, ?)`,
    ).bind(ROUND_ID, NOW, NOW, ROUND_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
       VALUES (?, ?, 'abstract', 0, 'MRQ-134 target', 'A target abstract.', 'in_review', 'public', ?, ?, ?, 'mrq-134 target', ?, ?),
              (?, ?, 'abstract', 0, 'MRQ-134 out of scope', 'A hidden abstract.', 'in_review', 'public', ?, ?, ?, 'mrq-134 out of scope', ?, ?),
              (?, ?, 'abstract', 0, 'MRQ-134 unassigned', 'An unassigned abstract.', 'in_review', 'public', ?, ?, ?, 'mrq-134 unassigned', ?, ?)`,
    ).bind(
      SUBMISSION_ID, EVENT_ID, ORGANIZER_ID, NOW, NOW, NOW, NOW,
      OUT_OF_SCOPE_SUBMISSION_ID, EVENT_ID, ORGANIZER_ID, NOW, NOW, NOW, NOW,
      UNASSIGNED_SUBMISSION_ID, EVENT_ID, ORGANIZER_ID, NOW, NOW, NOW, NOW,
    ),
    env.DB.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES ('submission-track-mrq134-target', ?, ?, 1, ?, ?),
              ('submission-track-mrq134-out', ?, ?, 1, ?, ?),
              ('submission-track-mrq134-unassigned', ?, ?, 1, ?, ?)`,
    ).bind(SUBMISSION_ID, TRACK_MAIN, NOW, NOW, OUT_OF_SCOPE_SUBMISSION_ID, TRACK_OTHER, NOW, NOW, UNASSIGNED_SUBMISSION_ID, TRACK_MAIN, NOW, NOW),
  ]);
}

beforeEach(seedFixture);

test("AC-288 · an Agent seat provisions atomically and its bound credential records attributed evidence", async () => {
  const seat = await createSeat();
  const person = await env.DB.prepare("SELECT kind, org_id FROM people WHERE id = ?").bind(seat.person.id).first<{ kind: string; org_id: string }>();
  expect(person).toEqual({ kind: "agent", org_id: ORGANIZATION_ID });
  const membership = await env.DB.prepare("SELECT role FROM memberships WHERE event_id = ? AND person_id = ?").bind(EVENT_ID, seat.person.id).first<{ role: string }>();
  expect(membership?.role).toBe("reviewer");
  const roles = await env.DB.prepare("SELECT role FROM memberships WHERE person_id = ?").bind(seat.person.id).all<{ role: string }>();
  expect(roles.results.map((row) => row.role)).toEqual(["reviewer"]);
  const scope = await env.DB.prepare("SELECT track_id FROM reviewer_track_scopes WHERE event_id = ? AND person_id = ?").bind(EVENT_ID, seat.person.id).all<{ track_id: string }>();
  expect(scope.results.map((row) => row.track_id)).toEqual([TRACK_MAIN]);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM committee_members WHERE committee_id = ? AND person_id = ?").bind(COMMITTEE_ID, seat.person.id).first<{ n: number }>())?.n).toBe(1);
  const token = await env.DB.prepare("SELECT acts_as_person_id, scopes FROM api_tokens WHERE id = ?").bind(seat.token.id).first<{ acts_as_person_id: string; scopes: string }>();
  expect(token?.acts_as_person_id).toBe(seat.person.id);
  expect(JSON.parse(token!.scopes)).toEqual({ permissions: ["review:write"], event_ids: [EVENT_ID] });
  expect(seat.token.secret).toMatch(/^mq_/);

  await assign(seat.person.id, SUBMISSION_ID, "assignment-mrq134-agent");
  const saved = await writeEvaluation(seat.token.secret, SUBMISSION_ID, {
    comment: "The rationale names the concrete tradeoff.",
    criteria_scores: { "Program fit": 4, "Audience value": 5 },
    recommendation: "maybe",
    score: 4.5,
  });
  expect(saved.status).toBe(200);
  const evaluation = await env.DB.prepare("SELECT reviewer_person_id, score, criteria_scores, comment FROM evaluations WHERE round_id = ? AND submission_id = ?").bind(ROUND_ID, SUBMISSION_ID).first<{ reviewer_person_id: string; score: number; criteria_scores: string; comment: string }>();
  expect(evaluation).toEqual({ reviewer_person_id: seat.person.id, score: 4.5, criteria_scores: JSON.stringify({ "Program fit": 4, "Audience value": 5 }), comment: "The rationale names the concrete tradeoff." });
  const record = await json<{ evaluations: Array<{ reviewer_person_id: string; reviewer_kind: string; comment: string }> }>(await request(recordPath()));
  expect(record.evaluations).toContainEqual(expect.objectContaining({ reviewer_person_id: seat.person.id, reviewer_kind: "agent", comment: "The rationale names the concrete tradeoff." }));
});

  test("AC-289 · issue-time binding rejects an attempted human seat binding", async () => {
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens").first<{ n: number }>();
  const response = await request("/api/v1/org/tokens", {
    method: "POST",
    body: JSON.stringify({
      acts_as_person_id: HUMAN_ID,
      name: "Human impersonation attempt",
      scopes: { permissions: ["review:write"], event_ids: [EVENT_ID] },
    }),
  });
  expect(response.status).toBe(400);
  const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens").first<{ n: number }>();
  expect(after?.n).toBe(before?.n);
});

  test("AC-289 · changing a live seat to human fails closed at token resolution", async () => {
  const seat = await createSeat();
  await env.DB.prepare("UPDATE people SET kind = 'human' WHERE id = ?").bind(seat.person.id).run();
  const response = await bearer(`/api/v1/events/${EVENT_ID}/reviewer/queue`, seat.token.secret);
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(seat.person.id);
});

  test("AC-289 · an unbound bearer has an empty queue but cannot read or write a reviewer resource", async () => {
  const secret = "mq_unbound_mrq134";
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, acts_as_person_id, created_at, updated_at)
     VALUES ('token-mrq134-unbound', ?, ?, 'Unbound reviewer token', ?, 'mq_unbo', ?, ?, NULL, ?, ?)`,
  ).bind(ORGANIZATION_ID, EVENT_ID, await sha256Hex(secret), JSON.stringify({ permissions: ["review:write"], event_ids: [EVENT_ID] }), ORGANIZER_ID, NOW, NOW).run();
  const queue = await bearer(`/api/v1/events/${EVENT_ID}/reviewer/queue`, secret);
  expect(queue.status).toBe(200);
  expect(await json<{ data: unknown[]; scopes: unknown[] }>(queue)).toMatchObject({ data: [], scopes: [] });
  const record = await bearer(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${SUBMISSION_ID}`, secret);
  expect(record.status).toBe(403);
  const recordBody = await record.text();
  expect(recordBody).not.toContain(SUBMISSION_ID);
  const write = await bearer(evaluationPath(), secret, { method: "POST", body: JSON.stringify({ recommendation: "maybe", comment: "must not write" }) });
  expect(write.status).toBe(403);
  expect(await write.text()).not.toContain(SUBMISSION_ID);
});

  test("AC-289 · track and assignment boundaries reject guessed resources without metadata", async () => {
  const seat = await createSeat();
  await assign(seat.person.id, OUT_OF_SCOPE_SUBMISSION_ID, "assignment-mrq134-agent-out");
  const withoutTrack = await bearer(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${OUT_OF_SCOPE_SUBMISSION_ID}`, seat.token.secret);
  expect(withoutTrack.status).toBe(403);
  expect(await withoutTrack.text()).not.toContain(OUT_OF_SCOPE_SUBMISSION_ID);
  const withoutAssignment = await bearer(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${UNASSIGNED_SUBMISSION_ID}`, seat.token.secret);
  expect(withoutAssignment.status).toBe(403);
  expect(await withoutAssignment.text()).not.toContain(UNASSIGNED_SUBMISSION_ID);
});

test("AC-290 · a bound seat has only reviewer authority, review scope, and no issuer memberships", async () => {
  const seat = await createSeat();
  const organizerPlans = await request(`/api/v1/events/${EVENT_ID}/plans`);
  expect(organizerPlans.status).toBe(200);
  const seatPlans = await bearer(`/api/v1/events/${EVENT_ID}/plans`, seat.token.secret);
  expect(seatPlans.status).toBe(403);
  const roles = await env.DB.prepare("SELECT role FROM memberships WHERE person_id = ?").bind(seat.person.id).all<{ role: string }>();
  expect(roles.results.map((row) => row.role)).toEqual(["reviewer"]);
  const token = await env.DB.prepare("SELECT scopes FROM api_tokens WHERE id = ?").bind(seat.token.id).first<{ scopes: string }>();
  expect(JSON.parse(token!.scopes).permissions).toEqual(["review:write"]);
  const invalid = await request("/api/v1/org/tokens", {
    method: "POST",
    body: JSON.stringify({ acts_as_person_id: HUMAN_ID, name: "Too broad", scopes: { permissions: ["program:write"], event_ids: [EVENT_ID] } }),
  });
  expect(invalid.status).toBe(400);
});

test("AC-290 · revocation returns 401 and preserves the seat's evaluation attribution", async () => {
  const seat = await createSeat();
  await assign(seat.person.id, SUBMISSION_ID, "assignment-mrq134-agent-revoke");
  await writeEvaluation(seat.token.secret, SUBMISSION_ID, { comment: "Preserve this judgment.", recommendation: "approve", score: 4 });
  const before = await env.DB.prepare("SELECT reviewer_person_id, score, comment, updated_at FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ID, SUBMISSION_ID, seat.person.id).first<Record<string, string | number>>();
  const revoked = await request(`/api/v1/org/tokens/${seat.token.id}`, { method: "DELETE" });
  expect(revoked.status).toBe(200);
  const afterRequest = await bearer(`/api/v1/events/${EVENT_ID}/reviewer/queue`, seat.token.secret);
  expect(afterRequest.status).toBe(401);
  const after = await env.DB.prepare("SELECT reviewer_person_id, score, comment, updated_at FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ID, SUBMISSION_ID, seat.person.id).first<Record<string, string | number>>();
  expect(after).toEqual(before);
});

test("AC-291 · human and Agent rows coexist and each resubmission updates only its own row", async () => {
  const seat = await createSeat();
  await assign(seat.person.id, SUBMISSION_ID, "assignment-mrq134-agent-coexist");
  await assign(HUMAN_ID, SUBMISSION_ID, "assignment-mrq134-human-coexist");
  await writeEvaluation(seat.token.secret, SUBMISSION_ID, { comment: "Agent rationale", recommendation: "maybe", score: 4 });
  const humanWrite = await request(evaluationPath(), { method: "POST", body: JSON.stringify({ comment: "Human rationale", recommendation: "approve", score: 3 }) }, `mq_session=${HUMAN_SESSION}`);
  expect(humanWrite.status).toBe(200);
  const beforeHuman = await env.DB.prepare("SELECT score, comment, updated_at FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ID, SUBMISSION_ID, HUMAN_ID).first<Record<string, string | number>>();
  await new Promise((resolve) => setTimeout(resolve, 2));
  await writeEvaluation(seat.token.secret, SUBMISSION_ID, { comment: "Agent rationale revised", recommendation: "deny", score: 2 });
  const afterAgent = await env.DB.prepare("SELECT score, comment, reviewer_person_id FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ID, SUBMISSION_ID, seat.person.id).first<Record<string, string | number>>();
  const afterHuman = await env.DB.prepare("SELECT score, comment, updated_at FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(ROUND_ID, SUBMISSION_ID, HUMAN_ID).first<Record<string, string | number>>();
  expect(afterAgent).toMatchObject({ reviewer_person_id: seat.person.id, score: 2, comment: "Agent rationale revised" });
  expect(afterHuman).toEqual(beforeHuman);
  const record = await json<{ evaluations: Array<{ reviewer_person_id: string; reviewer_kind: string; comment: string }> }>(await request(recordPath()));
  expect(record.evaluations.filter((row) => [seat.person.id, HUMAN_ID].includes(row.reviewer_person_id))).toHaveLength(2);
  expect(record.evaluations.find((row) => row.reviewer_person_id === seat.person.id)?.reviewer_kind).toBe("agent");
  expect(record.evaluations.find((row) => row.reviewer_person_id === HUMAN_ID)?.reviewer_kind).toBe("human");
});

test("AC-292 · Agent scores stay out of the human aggregate but count toward coverage and render separately", async () => {
  const seat = await createSeat();
  await assign(seat.person.id, SUBMISSION_ID, "assignment-mrq134-agent-aggregate");
  await assign(HUMAN_ID, SUBMISSION_ID, "assignment-mrq134-human-aggregate");
  await assign(SECOND_HUMAN_ID, SUBMISSION_ID, "assignment-mrq134-human-two-aggregate");
  await writeEvaluation(seat.token.secret, SUBMISSION_ID, { comment: "Agent evidence", recommendation: "maybe", score: 5 });
  const humanOne = await request(evaluationPath(), { method: "POST", body: JSON.stringify({ comment: "Human one", recommendation: "approve", score: 3 }) }, `mq_session=${HUMAN_SESSION}`);
  const humanTwo = await request(evaluationPath(), { method: "POST", body: JSON.stringify({ comment: "Human two", recommendation: "approve", score: 4 }) }, `mq_session=${SECOND_HUMAN_SESSION}`);
  expect(humanOne.status).toBe(200);
  expect(humanTwo.status).toBe(200);
  const list = await json<{ data: Array<{ id: string; score: number | null; review_count: number; agent_reviews: Array<{ name: string; score: number | null; comment: string }> }> }>(await request(`/api/v1/events/${EVENT_ID}/submissions?sort=score&per_page=100`));
  const item = list.data.find((row) => row.id === SUBMISSION_ID);
  expect(item).toMatchObject({ score: 3.5, review_count: 2 });
  expect(item?.agent_reviews).toEqual([expect.objectContaining({ name: seat.person.name, score: 5, comment: "Agent evidence" })]);
  const plan = await json<{ rounds: Array<{ id: string; progress: { evaluations: number } }>; summary: { evaluations: number } }>(await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`));
  expect(plan.rounds.find((round) => round.id === ROUND_ID)?.progress.evaluations).toBe(3);
  expect(plan.summary.evaluations).toBe(2);
  const assignment = await env.DB.prepare("SELECT status FROM round_assignments WHERE id = ?").bind("assignment-mrq134-agent-aggregate").first<{ status: string }>();
  expect(assignment?.status).toBe("complete");
});

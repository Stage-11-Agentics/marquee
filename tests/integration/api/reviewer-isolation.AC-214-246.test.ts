import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.example";
// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();
const ORG_ID = "org-reviewer-boundary";
const OTHER_ORG_ID = "org-reviewer-other";
const EVENT_A = "event-reviewer-a";
const EVENT_B = "event-reviewer-b";
const EVENT_C = "event-reviewer-c";
const OWNER_ID = "person-reviewer-owner";
const REVIEWER_A = "person-reviewer-a";
const REVIEWER_B = "person-reviewer-b";
const REVIEWER_A_SESSION = "session-reviewer-a";
const OWNER_SESSION = "session-reviewer-owner";
const TRACK_A = "track-reviewer-a";
const TRACK_A_OTHER = "track-reviewer-a-other";
const TRACK_B = "track-reviewer-b";
const TRACK_C = "track-reviewer-c";
const PLAN_A = "plan-reviewer-a";
const PLAN_B = "plan-reviewer-b";
const PLAN_C = "plan-reviewer-c";
const ROUND_A_ONE = "round-reviewer-a-one";
const ROUND_A_TWO = "round-reviewer-a-two";
const ROUND_B_ONE = "round-reviewer-b-one";
const ROUND_B_TWO = "round-reviewer-b-two";
const ROUND_C_ONE = "round-reviewer-c-one";
const COMMITTEE_A = "committee-reviewer-a";
const COMMITTEE_B = "committee-reviewer-b";
const SUBMISSION_A_IN = "submission-reviewer-a-in";
const SUBMISSION_A_OUT = "submission-reviewer-a-out";
const SUBMISSION_A_ASSIGNMENT = "submission-reviewer-a-assignment";
const SUBMISSION_A_COMMITTEE_IN = "submission-reviewer-a-committee-in";
const SUBMISSION_A_COMMITTEE_OUT = "submission-reviewer-a-committee-out";
const SUBMISSION_A_COMPARISONS = [
  "submission-reviewer-a-comparison-1",
  "submission-reviewer-a-comparison-2",
  "submission-reviewer-a-comparison-3",
] as const;
const SUBMISSION_A_OUT_COMPARISONS = [
  "submission-reviewer-a-out-comparison-1",
  "submission-reviewer-a-out-comparison-2",
  "submission-reviewer-a-out-comparison-3",
] as const;
const SUBMISSION_B = [
  "submission-reviewer-b-1",
  "submission-reviewer-b-2",
  "submission-reviewer-b-3",
] as const;
const SUBMISSION_C = "submission-reviewer-c";

async function request(path: string, init: RequestInit = {}, sessionId = REVIEWER_A_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${sessionId}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function count(table: "round_assignments" | "evaluations" | "comparisons"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function assignmentSnapshot(roundId: string, submissionIds: readonly string[]) {
  const placeholders = submissionIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id, submission_id, reviewer_person_id, committee_id, status
     FROM round_assignments
     WHERE round_id = ? AND submission_id IN (${placeholders})
     ORDER BY id`,
  ).bind(roundId, ...submissionIds).all<{ committee_id: string | null; id: string; reviewer_person_id: string | null; status: string; submission_id: string }>();
  return rows.results;
}

function eventStatement(id: string, slug: string) {
  return env.DB.prepare(`
    INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)
  `).bind(id, ORG_ID, `Conference ${slug}`, slug, NOW, NOW);
}

function personStatement(id: string, email: string, name: string) {
  return env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, ORG_ID, email, name, NOW, NOW);
}

function trackStatement(id: string, eventId: string, name: string) {
  return env.DB.prepare(
    "INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, '#0d9488', 0, ?, ?)",
  ).bind(id, eventId, name, NOW, NOW);
}

function submissionStatement(id: string, eventId: string, title: string, trackId: string) {
  return [
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(`
      INSERT INTO submissions (id, event_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'in_review', 'public', ?, ?, ?)
    `).bind(id, eventId, title, `${title} abstract`, OWNER_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(`submission-track-${id}`, id, trackId, NOW, NOW),
  ];
}

function directAssignment(id: string, roundId: string, submissionId: string, reviewerId: string) {
  return env.DB.prepare(`
    INSERT INTO round_assignments
      (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)
  `).bind(id, roundId, submissionId, reviewerId, NOW, NOW);
}

/**
 * MRQ-169: a pool becomes rows. Work handed to a committee is materialized per
 * member, so these two cards prove that track scope still governs even when the
 * row exists — the assignment alone never opens an out-of-scope abstract.
 */
function pooledAssignment(id: string, roundId: string, submissionId: string, reviewerId: string) {
  return directAssignment(id, roundId, submissionId, reviewerId);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const submissions = [
    ...submissionStatement(SUBMISSION_A_IN, EVENT_A, "Authorized event and track", TRACK_A),
    ...submissionStatement(SUBMISSION_A_OUT, EVENT_A, "Hidden other track", TRACK_A_OTHER),
    ...submissionStatement(SUBMISSION_A_ASSIGNMENT, EVENT_A, "Assignment positive control", TRACK_A),
    ...submissionStatement(SUBMISSION_A_COMMITTEE_IN, EVENT_A, "Authorized committee card", TRACK_A),
    ...submissionStatement(SUBMISSION_A_COMMITTEE_OUT, EVENT_A, "Hidden committee card", TRACK_A_OTHER),
    ...SUBMISSION_A_COMPARISONS.flatMap((id, index) => submissionStatement(id, EVENT_A, `Authorized comparison ${index + 1}`, TRACK_A)),
    ...SUBMISSION_A_OUT_COMPARISONS.flatMap((id, index) => submissionStatement(id, EVENT_A, `Hidden comparison ${index + 1}`, TRACK_A_OTHER)),
    ...SUBMISSION_B.flatMap((id, index) => submissionStatement(id, EVENT_B, `Other event card ${index + 1}`, TRACK_B)),
    ...submissionStatement(SUBMISSION_C, EVENT_C, "Cross-org membership card", TRACK_C),
  ];

  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Boundary Org', 'boundary-org', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Other Org', 'other-org', ?, ?)").bind(OTHER_ORG_ID, NOW, NOW),
    eventStatement(EVENT_A, "a"),
    eventStatement(EVENT_B, "b"),
    eventStatement(EVENT_C, "c"),
    personStatement(OWNER_ID, "owner@boundary.example", "Program owner"),
    personStatement(REVIEWER_A, "reviewer-a@boundary.example", "Event A reviewer"),
    personStatement(REVIEWER_B, "reviewer-b@boundary.example", "Event B reviewer"),
    env.DB.prepare(`
      INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
      VALUES ('membership-owner', ?, NULL, ?, 'owner', ?, ?),
        ('membership-reviewer-a', ?, ?, ?, 'reviewer', ?, ?),
        ('membership-reviewer-b', ?, ?, ?, 'reviewer', ?, ?),
        ('membership-reviewer-a-wrong-org', ?, ?, ?, 'reviewer', ?, ?)
    `).bind(ORG_ID, OWNER_ID, NOW, NOW, ORG_ID, EVENT_A, REVIEWER_A, NOW, NOW, ORG_ID, EVENT_B, REVIEWER_B, NOW, NOW, OTHER_ORG_ID, EVENT_C, REVIEWER_A, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(`
      INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
      VALUES (?, ?, 'reviewer', ?, 'boundary', NULL, ?, ?), (?, ?, 'owner', ?, 'boundary', NULL, ?, ?)
    `).bind(REVIEWER_A_SESSION, REVIEWER_A, NOW + 86_400_000, NOW, NOW, OWNER_SESSION, OWNER_ID, NOW + 86_400_000, NOW, NOW),
    trackStatement(TRACK_A, EVENT_A, "Authorized track"),
    trackStatement(TRACK_A_OTHER, EVENT_A, "Other track"),
    trackStatement(TRACK_B, EVENT_B, "Other event track"),
    trackStatement(TRACK_C, EVENT_C, "Cross-org row track"),
    env.DB.prepare(`
      INSERT INTO evaluation_plans (id, event_id, name, status, created_at, updated_at)
      VALUES (?, ?, 'Event A review', 'open', ?, ?), (?, ?, 'Event B review', 'open', ?, ?), (?, ?, 'Event C review', 'open', ?, ?)
    `).bind(PLAN_A, EVENT_A, NOW, NOW, PLAN_B, EVENT_B, NOW, NOW, PLAN_C, EVENT_C, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
      VALUES (?, ?, 0, 'Round one', 'scorecard', 1, 1, ?, ?),
        (?, ?, 1, 'Round two', 'comparison', 0, 1, ?, ?),
        (?, ?, 0, 'Round one', 'scorecard', 1, 1, ?, ?),
        (?, ?, 1, 'Round two', 'comparison', 0, 1, ?, ?),
        (?, ?, 0, 'Round one', 'scorecard', 1, 1, ?, ?)
    `).bind(ROUND_A_ONE, PLAN_A, NOW, NOW, ROUND_A_TWO, PLAN_A, NOW, NOW, ROUND_B_ONE, PLAN_B, NOW, NOW, ROUND_B_TWO, PLAN_B, NOW, NOW, ROUND_C_ONE, PLAN_C, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO committees (id, event_id, name, created_at, updated_at)
      VALUES (?, ?, 'Event A committee', ?, ?), (?, ?, 'Event B committee', ?, ?)
    `).bind(COMMITTEE_A, EVENT_A, NOW, NOW, COMMITTEE_B, EVENT_B, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at)
      VALUES ('committee-member-a', ?, ?, 'reviewer', ?, ?), ('committee-member-b', ?, ?, 'reviewer', ?, ?)
    `).bind(COMMITTEE_A, REVIEWER_A, NOW, NOW, COMMITTEE_B, REVIEWER_B, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at)
      VALUES ('scope-a', ?, ?, ?, ?, ?), ('scope-b', ?, ?, ?, ?, ?), ('scope-c', ?, ?, ?, ?, ?)
    `).bind(EVENT_A, REVIEWER_A, TRACK_A, NOW, NOW, EVENT_B, REVIEWER_B, TRACK_B, NOW, NOW, EVENT_C, REVIEWER_A, TRACK_C, NOW, NOW),
    ...submissions,
    env.DB.prepare(`
      INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
      VALUES ('file-a-in', ?, 'submission_file', ?, 'review/a-in', 'authorized.pdf', 'application/pdf', 12, 'ready', 'etag-a-in', ?, ?),
        ('file-a-out', ?, 'submission_file', ?, 'review/a-out', 'hidden.pdf', 'application/pdf', 12, 'ready', 'etag-a-out', ?, ?),
        ('file-b-in', ?, 'submission_file', ?, 'review/b-in', 'other-event.pdf', 'application/pdf', 12, 'ready', 'etag-b-in', ?, ?)
    `).bind(EVENT_A, SUBMISSION_A_IN, NOW, NOW, EVENT_A, SUBMISSION_A_OUT, NOW, NOW, EVENT_B, SUBMISSION_B[0], NOW, NOW),
    directAssignment("assignment-a-in", ROUND_A_ONE, SUBMISSION_A_IN, REVIEWER_A),
    directAssignment("assignment-a-out", ROUND_A_ONE, SUBMISSION_A_OUT, REVIEWER_A),
    pooledAssignment("assignment-a-committee-in", ROUND_A_ONE, SUBMISSION_A_COMMITTEE_IN, REVIEWER_A),
    pooledAssignment("assignment-a-committee-out", ROUND_A_ONE, SUBMISSION_A_COMMITTEE_OUT, REVIEWER_A),
    ...SUBMISSION_A_COMPARISONS.map((id, index) => directAssignment(`assignment-a-comparison-${index}`, ROUND_A_TWO, id, REVIEWER_A)),
    ...SUBMISSION_A_OUT_COMPARISONS.map((id, index) => directAssignment(`assignment-a-out-comparison-${index}`, ROUND_A_TWO, id, REVIEWER_A)),
    ...SUBMISSION_B.map((id, index) => directAssignment(`assignment-b-one-${index}`, ROUND_B_ONE, id, REVIEWER_B)),
    ...SUBMISSION_B.map((id, index) => directAssignment(`assignment-b-two-${index}`, ROUND_B_TWO, id, REVIEWER_B)),
    directAssignment("assignment-c-one", ROUND_C_ONE, SUBMISSION_C, REVIEWER_A),
  ]);
}

function evaluationPath(eventId: string, roundId: string, submissionId: string) {
  return `/api/v1/events/${eventId}/rounds/${roundId}/submissions/${submissionId}/evaluations`;
}

function comparisonPath(eventId: string, roundId: string) {
  return `/api/v1/events/${eventId}/rounds/${roundId}/comparisons`;
}

function comparisonBody(ids: readonly string[]) {
  return { ranking: [...ids], submission_ids: [...ids] };
}

async function expectForbiddenWithoutMetadata(response: Response, ...forbiddenValues: string[]) {
  expect(response.status).toBe(403);
  const body = await response.text();
  for (const value of forbiddenValues) expect(body).not.toContain(value);
}

describe.sequential("reviewer event and track isolation", () => {
  beforeAll(seedFixture, 10_000);

  test("CONTRACT · every reviewer read surface is event- and track-bound", async () => {
    const positiveQueue = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/queue`);
    expect(positiveQueue.status).toBe(200);
    const positiveQueueBody = await json<{ data: Array<{ id: string }> }>(positiveQueue);
    expect(positiveQueueBody.data.map((row) => row.id)).toEqual(expect.arrayContaining([SUBMISSION_A_IN, SUBMISSION_A_COMMITTEE_IN]));
    expect(positiveQueueBody.data.map((row) => row.id)).not.toContain(SUBMISSION_A_OUT);

    const contextQueue = await request(`/api/v1/events/${EVENT_A}/reviewer/queue`);
    expect(contextQueue.status).toBe(200);
    expect((await json<{ data: Array<{ id: string }> }>(contextQueue)).data.map((row) => row.id)).toContain(SUBMISSION_A_IN);

    const positiveComparisonQueue = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_TWO}/comparisons/next`);
    expect(positiveComparisonQueue.status).toBe(200);
    const positiveComparisonBody = await json<{ data: Array<{ id: string }>; eligible_count: number }>(positiveComparisonQueue);
    expect(positiveComparisonBody.data.map((row) => row.id)).toEqual([...SUBMISSION_A_COMPARISONS]);
    expect(positiveComparisonBody.eligible_count).toBe(3);

    const positiveRecord = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/submissions/${SUBMISSION_A_IN}`);
    expect(positiveRecord.status).toBe(200);
    expect((await json<{ id: string; title: string }>(positiveRecord))).toMatchObject({ id: SUBMISSION_A_IN, title: "Authorized event and track" });

    const positiveFile = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/submissions/${SUBMISSION_A_IN}/files`);
    expect(positiveFile.status).toBe(200);
    expect((await json<{ data: Array<{ filename: string }> }>(positiveFile)).data).toEqual([expect.objectContaining({ filename: "authorized.pdf" })]);

    const positiveExport = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/export`);
    expect(positiveExport.status).toBe(200);
    const positiveCsv = await positiveExport.text();
    expect(positiveCsv).toContain(SUBMISSION_A_IN);
    expect(positiveCsv).not.toContain(SUBMISSION_A_OUT);

    const outTrackQueue = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/queue`);
    expect(outTrackQueue.status).toBe(200);
    expect((await json<{ data: Array<{ id: string }> }>(outTrackQueue)).data.map((row) => row.id)).not.toContain(SUBMISSION_A_OUT);
    await expectForbiddenWithoutMetadata(
      await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/submissions/${SUBMISSION_A_OUT}`),
      SUBMISSION_A_OUT,
      "Hidden other track",
    );
    await expectForbiddenWithoutMetadata(
      await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/submissions/${SUBMISSION_A_OUT}/files`),
      SUBMISSION_A_OUT,
      "hidden.pdf",
    );
    const outTrackExport = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/export`);
    expect(outTrackExport.status).toBe(200);
    const outTrackCsv = await outTrackExport.text();
    expect(outTrackCsv).not.toContain(SUBMISSION_A_OUT);
    expect(outTrackCsv).not.toContain("Hidden other track");

    const outTrackComparisonQueue = await request(`/api/v1/events/${EVENT_A}/rounds/${ROUND_A_TWO}/comparisons/next`);
    expect(outTrackComparisonQueue.status).toBe(200);
    const outTrackComparisonBody = await json<{ data: Array<{ id: string }>; eligible_count: number }>(outTrackComparisonQueue);
    expect(outTrackComparisonBody.data.map((row) => row.id)).toEqual([...SUBMISSION_A_COMPARISONS]);
    expect(outTrackComparisonBody.data.map((row) => row.id)).not.toEqual(expect.arrayContaining([...SUBMISSION_A_OUT_COMPARISONS]));

    const eventBPaths = [
      `/api/v1/events/${EVENT_B}/reviewer/queue`,
      `/api/v1/events/${EVENT_B}/rounds/${ROUND_B_ONE}/queue`,
      `/api/v1/events/${EVENT_B}/rounds/${ROUND_B_TWO}/comparisons/next`,
      `/api/v1/events/${EVENT_B}/rounds/${ROUND_B_ONE}/submissions/${SUBMISSION_B[0]}`,
      `/api/v1/events/${EVENT_B}/rounds/${ROUND_B_ONE}/submissions/${SUBMISSION_B[0]}/files`,
      `/api/v1/events/${EVENT_B}/rounds/${ROUND_B_ONE}/export`,
    ];
    for (const path of eventBPaths) await expectForbiddenWithoutMetadata(await request(path), EVENT_B, SUBMISSION_B[0], "Other event card 1", "other-event.pdf");

    const beforeCrossOrgMembershipAssignments = await count("round_assignments");
    await expectForbiddenWithoutMetadata(
      await request(`/api/v1/events/${EVENT_C}/rounds/${ROUND_C_ONE}/queue`),
      EVENT_C,
      SUBMISSION_C,
      "Cross-org membership card",
    );
    expect(await count("round_assignments")).toBe(beforeCrossOrgMembershipAssignments);
  });

  test("CONTRACT · denied evidence writes leave every row and assignment status unchanged", async () => {
    const beforeAssignments = await assignmentSnapshot(ROUND_A_ONE, [SUBMISSION_A_OUT]);
    const beforeOutTrackEvaluations = await count("evaluations");
    const deniedOutTrackEvaluation = await request(evaluationPath(EVENT_A, ROUND_A_ONE, SUBMISSION_A_OUT), {
      method: "POST",
      body: JSON.stringify({ recommendation: "maybe" }),
    });
    await expectForbiddenWithoutMetadata(deniedOutTrackEvaluation, SUBMISSION_A_OUT, "Hidden other track");
    expect(await count("evaluations")).toBe(beforeOutTrackEvaluations);
    expect(await assignmentSnapshot(ROUND_A_ONE, [SUBMISSION_A_OUT])).toEqual(beforeAssignments);

    const beforeOutEventEvaluations = await count("evaluations");
    const beforeOutEventAssignments = await assignmentSnapshot(ROUND_B_ONE, SUBMISSION_B);
    const deniedOutEventEvaluation = await request(evaluationPath(EVENT_B, ROUND_B_ONE, SUBMISSION_B[0]), {
      method: "POST",
      body: JSON.stringify({ recommendation: "deny" }),
    });
    await expectForbiddenWithoutMetadata(deniedOutEventEvaluation, EVENT_B, SUBMISSION_B[0]);
    expect(await count("evaluations")).toBe(beforeOutEventEvaluations);
    expect(await assignmentSnapshot(ROUND_B_ONE, SUBMISSION_B)).toEqual(beforeOutEventAssignments);

    const beforeOutTrackComparisons = await count("comparisons");
    const beforeOutTrackComparisonAssignments = await assignmentSnapshot(ROUND_A_TWO, SUBMISSION_A_OUT_COMPARISONS);
    const deniedOutTrackComparison = await request(comparisonPath(EVENT_A, ROUND_A_TWO), {
      method: "POST",
      body: JSON.stringify(comparisonBody(SUBMISSION_A_OUT_COMPARISONS)),
    });
    await expectForbiddenWithoutMetadata(deniedOutTrackComparison, SUBMISSION_A_OUT_COMPARISONS[0], "Hidden comparison 1");
    expect(await count("comparisons")).toBe(beforeOutTrackComparisons);
    expect(await assignmentSnapshot(ROUND_A_TWO, SUBMISSION_A_OUT_COMPARISONS)).toEqual(beforeOutTrackComparisonAssignments);

    const beforeOutEventComparisons = await count("comparisons");
    const beforeOutEventComparisonAssignments = await assignmentSnapshot(ROUND_B_TWO, SUBMISSION_B);
    const deniedOutEventComparison = await request(comparisonPath(EVENT_B, ROUND_B_TWO), {
      method: "POST",
      body: JSON.stringify(comparisonBody(SUBMISSION_B)),
    });
    await expectForbiddenWithoutMetadata(deniedOutEventComparison, EVENT_B, SUBMISSION_B[0]);
    expect(await count("comparisons")).toBe(beforeOutEventComparisons);
    expect(await assignmentSnapshot(ROUND_B_TWO, SUBMISSION_B)).toEqual(beforeOutEventComparisonAssignments);

    const beforePositiveEvaluation = await count("evaluations");
    const positiveEvaluation = await request(evaluationPath(EVENT_A, ROUND_A_ONE, SUBMISSION_A_IN), {
      method: "POST",
      body: JSON.stringify({ recommendation: "approve", comment: "Authorized control" }),
    });
    expect(positiveEvaluation.status).toBe(200);
    expect(await count("evaluations")).toBe(beforePositiveEvaluation + 1);

    const beforePositiveComparison = await count("comparisons");
    const positiveComparison = await request(comparisonPath(EVENT_A, ROUND_A_TWO), {
      method: "POST",
      body: JSON.stringify(comparisonBody(SUBMISSION_A_COMPARISONS)),
    });
    expect(positiveComparison.status).toBe(201);
    expect(await count("comparisons")).toBe(beforePositiveComparison + 1);
    expect(await assignmentSnapshot(ROUND_A_TWO, SUBMISSION_A_COMPARISONS)).toEqual(
      expect.arrayContaining(SUBMISSION_A_COMPARISONS.map((submission_id) => expect.objectContaining({ submission_id, status: "complete" }))),
    );
  });

  test("AC-246 · assignment distribution refuses event and track mismatches before writing", async () => {
    const assignmentPath = `/api/v1/events/${EVENT_A}/rounds/${ROUND_A_ONE}/assignments`;
    const beforeOutEvent = await count("round_assignments");
    const outEvent = await request(assignmentPath, {
      method: "POST",
      body: JSON.stringify({ reviewer_person_id: REVIEWER_B, submission_id: SUBMISSION_A_ASSIGNMENT }),
    }, OWNER_SESSION);
    expect(outEvent.status).toBe(422);
    expect(await count("round_assignments")).toBe(beforeOutEvent);

    const beforeOutTrack = await count("round_assignments");
    const outTrack = await request(assignmentPath, {
      method: "POST",
      body: JSON.stringify({ reviewer_person_id: REVIEWER_A, submission_id: SUBMISSION_A_OUT }),
    }, OWNER_SESSION);
    expect(outTrack.status).toBe(422);
    expect(await count("round_assignments")).toBe(beforeOutTrack);

    const beforePositive = await count("round_assignments");
    const positive = await request(assignmentPath, {
      method: "POST",
      body: JSON.stringify({ reviewer_person_id: REVIEWER_A, submission_id: SUBMISSION_A_ASSIGNMENT }),
    }, OWNER_SESSION);
    expect(positive.status).toBe(201);
    expect(await count("round_assignments")).toBe(beforePositive + 1);
  });
});

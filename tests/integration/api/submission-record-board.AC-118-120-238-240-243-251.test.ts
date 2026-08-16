import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SPEAKER_ID = DEMO_SPEAKER_PERSON_ID;
const ADMIN_SESSION_ID = "sess-mrq-33-admin";
const REVIEWER_ID = "per-mrq-33-reviewer";
const REVIEWER_SESSION_ID = "sess-mrq-33-reviewer";
const TRACK_IN = "track-mrq-33-in";
const TRACK_OUT = "track-mrq-33-out";
const FORMAT_ID = "format-mrq-33-session";
const ROOM_ID = "room-mrq-33";
const BUILDING_ID = "building-mrq-33";
const PLAN_ID = "plan-mrq-33";
const ROUND_ID = "round-mrq-33";

const ORIGIN = "https://marquee.stage11.dev";

async function request(path: string, init: RequestInit = {}, sessionId = ADMIN_SESSION_ID): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${sessionId}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function body<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(`
      INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
      VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)
    `).bind(ADMIN_SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now),
    env.DB.prepare(`
      INSERT INTO people (id, org_id, email, name, company, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, 'reviewer@mrq-33.example', 'Morgan Reviewer', 'Scope Lab', 0, 'marquee', ?, ?)
    `).bind(REVIEWER_ID, DEMO_ORGANIZATION_ID, now, now),
    env.DB.prepare(`
      INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
      VALUES ('membership-mrq-33-reviewer', ?, ?, ?, 'reviewer', ?, ?)
    `).bind(DEMO_ORGANIZATION_ID, EVENT_ID, REVIEWER_ID, now, now),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(`
      INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
      VALUES (?, ?, 'reviewer', ?, 'fixture', NULL, ?, ?)
    `).bind(REVIEWER_SESSION_ID, REVIEWER_ID, now + 86_400_000, now, now),
    env.DB.prepare(`
      INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at)
      VALUES (?, ?, 'In scope', '#0d9488', 0, ?, ?), (?, ?, 'Out of scope', '#db4c3f', 1, ?, ?)
    `).bind(TRACK_IN, EVENT_ID, now, now, TRACK_OUT, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO formats (id, event_id, name, min_duration_min, max_duration_min, default_duration_min, position, created_at, updated_at)
      VALUES (?, ?, 'Session', 20, 60, 30, 0, ?, ?)
    `).bind(FORMAT_ID, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
      VALUES (?, ?, 'Marquee Hall', '1 Example Way', 0, NULL, NULL, 5, NULL, ?, ?)
    `).bind(BUILDING_ID, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO rooms (id, building_id, event_id, name, capacity, av_capabilities, notes, position, created_at, updated_at)
      VALUES (?, ?, ?, 'Room 101', 100, '[]', NULL, 0, ?, ?)
    `).bind(ROOM_ID, BUILDING_ID, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
      VALUES (?, ?, 'MRQ-33 plan', '', 1, 5, 'open', ?, ?)
    `).bind(PLAN_ID, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
      VALUES (?, ?, 0, 'Initial review', 'scorecard', 0, 1, ?, ?)
    `).bind(ROUND_ID, PLAN_ID, now, now),
    env.DB.prepare(`
      INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at)
      VALUES ('scope-mrq-33', ?, ?, ?, ?, ?)
    `).bind(EVENT_ID, REVIEWER_ID, TRACK_IN, now, now),
  ]);
}

async function createSubmission(input: Record<string, unknown>): Promise<{ id: string; [key: string]: unknown }> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions`, { method: "POST", body: JSON.stringify(input) });
  expect(response.status).toBe(201);
  return body(response);
}

describe.sequential("MRQ-33 admin record and program board", () => {
  beforeAll(seedFixture, 10_000);

  test("AC-118, AC-119, AC-120 · admin-created Abstracts and bypassed Sessions persist the full record and admin origin", async () => {
    const abstract = await createSubmission({
      kind: "abstract",
      title: "Admin-created abstract with answers",
      abstract: "A complete program record created by the organizer.",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_IN],
    });
    expect(abstract).toMatchObject({ kind: "abstract", origin: "admin", status: "submitted", bypass_evaluation: false });
    const abstractReference = await env.DB.prepare("SELECT reference_code FROM submissions WHERE id = ?").bind(abstract.id).first<{ reference_code: string | null }>();
    expect(abstractReference?.reference_code).toMatch(/^SUB-[1-9]\d*$/);
    expect((abstract.participants as Array<{ person_id: string }>).length).toBeGreaterThan(0);

    const session = await createSubmission({
      kind: "session",
      title: "Admin-created bypass Session",
      abstract: "This Session is ready for the working agenda.",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_IN],
      format_id: FORMAT_ID,
    });
    expect(session).toMatchObject({ kind: "session", origin: "admin", status: "accepted", bypass_evaluation: true });
    const sessionReference = await env.DB.prepare("SELECT reference_code FROM submissions WHERE id = ?").bind(session.id).first<{ reference_code: string | null }>();
    expect(sessionReference?.reference_code).toMatch(/^SUB-[1-9]\d*$/);
    expect((session.evaluations as unknown[]).length).toBe(0);

    const sessionRecord = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}`);
    expect(sessionRecord.status).toBe(200);
    expect(await body<{ is_published: boolean; slot: unknown }>(sessionRecord)).toMatchObject({ is_published: false, slot: null });

    const listed = await request(`/api/v1/events/${EVENT_ID}/submissions?q=Admin-created%20abstract&per_page=10`);
    expect(listed.status).toBe(200);
    const list = await body<{ data: Array<{ id: string; origin: string }> }>(listed);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: abstract.id, origin: "admin" });
  });

  test("AC-238, AC-240, AC-243 · the read-only board derives one stable stage per non-draft record and exposes scheduled legibility", async () => {
    const session = await createSubmission({
      kind: "session",
      title: "Board session with a private slot",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_IN],
      format_id: FORMAT_ID,
    });
    const scheduled = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ starts_at: Date.UTC(2026, 9, 20, 15, 30), duration_min: 30, room_id: ROOM_ID, track_id: TRACK_IN }),
    });
    expect(scheduled.status).toBe(200);
    const scheduledRecord = await body<{ slot: { day: string; time: string; room: string; is_published: boolean }; stage: string; actions: { can_decide: boolean; can_schedule: boolean } }>(scheduled);
    expect(scheduledRecord).toMatchObject({ stage: "scheduled", slot: { room: "Room 101", is_published: false }, actions: { can_decide: false, can_schedule: false } });
    expect(scheduledRecord.slot.day).toContain("·");
    expect(scheduledRecord.slot.time).toMatch(/:/);

    const boardResponse = await request(`/api/v1/events/${EVENT_ID}/board?per_page=100`);
    expect(boardResponse.status).toBe(200);
    const board = await body<{ data: Array<{ id: string; stage: string; slot: { room: string; is_published: boolean } | null }>; total: number; columns: Array<{ count: number }> }>(boardResponse);
    expect(board.data.every((card) => card.stage !== "draft")).toBe(true);
    expect(new Set(board.data.map((card) => card.id)).size).toBe(board.data.length);
    expect(board.columns.reduce((sum, column) => sum + column.count, 0)).toBe(board.total);
    expect(board.data.find((card) => card.id === session.id)).toMatchObject({ stage: "scheduled", slot: { room: "Room 101", is_published: false } });

    const filteredResponse = await request(`/api/v1/events/${EVENT_ID}/board?kind=session&track=${TRACK_IN}&q=private%20slot&per_page=100`);
    expect(filteredResponse.status).toBe(200);
    const filtered = await body<{ data: Array<{ id: string }> }>(filteredResponse);
    expect(filtered.data.map((card) => card.id)).toEqual([session.id]);

    const published = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    const publicRecord = await body<{ stage: string; slot: { is_published: boolean }; actions: { can_decide: boolean } }>(published);
    expect(publicRecord).toMatchObject({ stage: "published", slot: { is_published: true }, actions: { can_decide: false } });
  });

  test("AC-251 · the evaluation panel assignment guard rejects an out-of-scope reviewer before any row is written and updates the reviewer queue in scope", async () => {
    const inScope = await createSubmission({
      kind: "abstract",
      title: "Reviewer assignment in scope",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_IN],
    });
    const outOfScope = await createSubmission({
      kind: "abstract",
      title: "Reviewer assignment outside scope",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_OUT],
    });

    const accepted = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ submission_id: inScope.id, reviewer_person_id: REVIEWER_ID }),
    });
    expect(accepted.status).toBe(201);
    const acceptedBody = await body<{ id: string; reviewer_person_id: string }>(accepted);
    expect(acceptedBody).toMatchObject({ reviewer_person_id: REVIEWER_ID });

    const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`, {}, REVIEWER_SESSION_ID);
    expect(queue.status).toBe(200);
    const queueBody = await body<{ data: Array<{ id: string }> }>(queue);
    expect(queueBody.data.map((item) => item.id)).toContain(inScope.id);

    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
    ).bind(ROUND_ID, outOfScope.id, REVIEWER_ID).first<{ count: number }>();
    expect(Number(before?.count ?? 0)).toBe(0);
    const rejected = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/assignments`, {
      method: "POST",
      body: JSON.stringify({ submission_id: outOfScope.id, reviewer_person_id: REVIEWER_ID }),
    });
    expect(rejected.status).toBe(422);
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM round_assignments WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
    ).bind(ROUND_ID, outOfScope.id, REVIEWER_ID).first<{ count: number }>();
    expect(Number(after?.count ?? 0)).toBe(0);

    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${inScope.id}`);
    expect(record.status).toBe(200);
    const recordBody = await body<{ evaluation: { rounds: Array<{ reviewers: Array<{ assignment_id: string; coverage: { assigned: number } }> }> } }>(record);
    expect(recordBody.evaluation.rounds[0]?.reviewers[0]).toMatchObject({ assignment_id: acceptedBody.id, coverage: { assigned: 1 } });

    const removed = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/assignments/${acceptedBody.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM round_assignments WHERE id = ?").bind(acceptedBody.id).first<{ count: number }>();
    expect(Number(remaining?.count ?? 0)).toBe(0);
  });

  test("CONTRACT · CNT-12 · one Session can leave and return to the public agenda with audited dual-flag transitions", async () => {
    const title = "CNT-12 reversible publication control";
    const session = await createSubmission({
      kind: "session",
      title,
      abstract: "A Session used to prove publication reversal.",
      submitter_person_id: SPEAKER_ID,
      participants: [{ person_id: SPEAKER_ID, role: "speaker" }],
      track_ids: [TRACK_IN],
      format_id: FORMAT_ID,
    });
    const scheduled = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ starts_at: Date.UTC(2026, 9, 22, 16, 0), duration_min: 30, room_id: ROOM_ID, track_id: TRACK_IN }),
    });
    expect(scheduled.status).toBe(200);

    const event = await env.DB.prepare("SELECT slug FROM events WHERE id = ?").bind(EVENT_ID).first<{ slug: string }>();
    expect(event?.slug).toBeTruthy();
    const before = await env.DB.prepare(`
      SELECT s.is_published AS submission_is_published, s.updated_at AS submission_updated_at,
        item.is_published AS agenda_is_published, item.updated_at AS agenda_updated_at
      FROM submissions s
      JOIN agenda_items item ON item.submission_id = s.id AND item.event_id = s.event_id AND item.kind = 'session'
      WHERE s.id = ? AND s.event_id = ?
    `).bind(session.id, EVENT_ID).first<{ submission_is_published: number; submission_updated_at: number; agenda_is_published: number; agenda_updated_at: number }>();
    expect(before).toMatchObject({ submission_is_published: 0, agenda_is_published: 0 });

    const published = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    const publishedRecord = await body<{ is_published: boolean; slot: { is_published: boolean }; actions: { can_publish: boolean; can_unpublish: boolean } }>(published);
    expect(publishedRecord).toMatchObject({ is_published: true, slot: { is_published: true }, actions: { can_publish: false, can_unpublish: true } });

    const publishedFlags = await env.DB.prepare(`
      SELECT s.is_published AS submission_is_published, s.updated_at AS submission_updated_at,
        item.is_published AS agenda_is_published, item.updated_at AS agenda_updated_at
      FROM submissions s
      JOIN agenda_items item ON item.submission_id = s.id AND item.event_id = s.event_id AND item.kind = 'session'
      WHERE s.id = ? AND s.event_id = ?
    `).bind(session.id, EVENT_ID).first<{ submission_is_published: number; submission_updated_at: number; agenda_is_published: number; agenda_updated_at: number }>();
    expect(publishedFlags).toMatchObject({ submission_is_published: 1, agenda_is_published: 1 });
    expect(publishedFlags!.submission_updated_at).toBeGreaterThan(before!.submission_updated_at);
    expect(publishedFlags!.agenda_updated_at).toBeGreaterThan(before!.agenda_updated_at);

    const publicAgenda = await request(`/agenda?event=${encodeURIComponent(event!.slug)}`);
    expect(publicAgenda.status).toBe(200);
    const publicAgendaHtml = await publicAgenda.text();
    expect(publicAgendaHtml).toContain(title);
    const publicData = await request(`/api/v1/public/agenda?event=${encodeURIComponent(event!.slug)}`);
    expect(publicData.status).toBe(200);
    const publicPayload = await body<{ sessions: Array<{ title: string; slug: string }> }>(publicData);
    const publicSession = publicPayload.sessions.find((item) => item.title === title);
    expect(publicSession).toBeTruthy();
    const publicEmbed = await request(`/api/v1/public/embeds/${encodeURIComponent(`${event!.slug}-agenda`)}?event=${encodeURIComponent(event!.slug)}`);
    expect(publicEmbed.status).toBe(200);
    const publicEmbedPayload = await body<{ sessions: Array<{ title: string }> }>(publicEmbed);
    expect(publicEmbedPayload.sessions.map((item) => item.title)).toContain(title);
    const publicSessionPage = await request(`/s/${encodeURIComponent(publicSession!.slug)}?event=${encodeURIComponent(event!.slug)}`);
    expect(publicSessionPage.status).toBe(200);
    expect(await publicSessionPage.text()).toContain(title);

    const unpublished = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/unpublish`, { method: "POST" });
    expect(unpublished.status).toBe(200);
    const unpublishedRecord = await body<{ is_published: boolean; slot: { is_published: boolean }; actions: { can_publish: boolean; can_unpublish: boolean } }>(unpublished);
    expect(unpublishedRecord).toMatchObject({ is_published: false, slot: { is_published: false }, actions: { can_publish: true, can_unpublish: false } });

    const unpublishedFlags = await env.DB.prepare(`
      SELECT s.is_published AS submission_is_published, s.updated_at AS submission_updated_at,
        item.is_published AS agenda_is_published, item.updated_at AS agenda_updated_at
      FROM submissions s
      JOIN agenda_items item ON item.submission_id = s.id AND item.event_id = s.event_id AND item.kind = 'session'
      WHERE s.id = ? AND s.event_id = ?
    `).bind(session.id, EVENT_ID).first<{ submission_is_published: number; submission_updated_at: number; agenda_is_published: number; agenda_updated_at: number }>();
    expect(unpublishedFlags).toMatchObject({ submission_is_published: 0, agenda_is_published: 0 });
    expect(unpublishedFlags!.submission_updated_at).toBeGreaterThan(publishedFlags!.submission_updated_at);
    expect(unpublishedFlags!.agenda_updated_at).toBeGreaterThan(publishedFlags!.agenda_updated_at);

    const hiddenAgenda = await request(`/agenda?event=${encodeURIComponent(event!.slug)}`);
    expect(hiddenAgenda.status).toBe(200);
    expect(await hiddenAgenda.text()).not.toContain(title);
    const hiddenEmbed = await request(`/api/v1/public/embeds/${encodeURIComponent(`${event!.slug}-agenda`)}?event=${encodeURIComponent(event!.slug)}`);
    expect(hiddenEmbed.status).toBe(200);
    const hiddenEmbedPayload = await body<{ sessions: Array<{ title: string }> }>(hiddenEmbed);
    expect(hiddenEmbedPayload.sessions.map((item) => item.title)).not.toContain(title);
    const hiddenSessionPage = await request(`/s/${encodeURIComponent(publicSession!.slug)}?event=${encodeURIComponent(event!.slug)}`);
    expect(hiddenSessionPage.status).toBe(404);

    const republished = await request(`/api/v1/events/${EVENT_ID}/submissions/${session.id}/publish`, { method: "POST" });
    expect(republished.status).toBe(200);
    expect(await body<{ is_published: boolean; slot: { is_published: boolean } }>(republished)).toMatchObject({ is_published: true, slot: { is_published: true } });
    const restoredAgenda = await request(`/agenda?event=${encodeURIComponent(event!.slug)}`);
    expect(await restoredAgenda.text()).toContain(title);
    const restoredEmbed = await request(`/api/v1/public/embeds/${encodeURIComponent(`${event!.slug}-agenda`)}?event=${encodeURIComponent(event!.slug)}`);
    expect(restoredEmbed.status).toBe(200);
    const restoredEmbedPayload = await body<{ sessions: Array<{ title: string }> }>(restoredEmbed);
    expect(restoredEmbedPayload.sessions.map((item) => item.title)).toContain(title);

    const auditRows = await env.DB.prepare(`
      SELECT action, before_json, after_json
      FROM audit_log
      WHERE event_id = ? AND entity_type = 'submission' AND entity_id = ?
        AND action IN ('published', 'unpublished')
      ORDER BY created_at ASC, id ASC
    `).bind(EVENT_ID, session.id).all<{ action: string; before_json: string; after_json: string }>();
    expect(auditRows.results.map((row) => row.action)).toEqual(["published", "unpublished", "published"]);
    expect(JSON.parse(auditRows.results[1]!.before_json)).toMatchObject({ agenda_is_published: true, submission_is_published: true });
    expect(JSON.parse(auditRows.results[1]!.after_json)).toMatchObject({ agenda_is_published: false, submission_is_published: false });
  });
});

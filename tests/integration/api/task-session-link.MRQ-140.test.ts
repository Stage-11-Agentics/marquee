/**
 * MRQ-140 · a task assigned through the speaker picker keeps its session.
 *
 * `speaker_tasks.submission_id` is the only thing that tells the files library
 * and the bulk export which talk a deliverable belongs to. The assignment API
 * has always accepted it; the picker never sent it, so every manually assigned
 * file task was born unattached and the export's default session grouping had
 * nowhere to put the deck. These tests hold the resolution order the fix
 * introduces — the organizer's pick, then a batch-wide session, then the
 * speaker's own session when they have exactly one.
 */
import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;
// Deadlines ride the real clock: the server compares due dates against
// Date.now(), so a date pinned to the fixture anchor would quietly become a
// past deadline and change what these tests mean.
const DUE_AT = Date.now() + 30 * 86_400_000;
const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq140";
const EVENT_ID = "evt_mrq140";
const OTHER_EVENT_ID = "evt_mrq140_other";
const ORGANIZER_ID = "person_mrq140_organizer";
const MARCUS_ID = "person_mrq140_marcus";
const PRIYA_ID = "person_mrq140_priya";
const DANA_ID = "person_mrq140_dana";
const AUTH_SESSION = "auth_mrq140";
const MARCUS_SESSION = "sub_mrq140_marcus";
const MARCUS_REJECTED = "sub_mrq140_marcus_rejected";
const PRIYA_KEYNOTE = "sub_mrq140_priya_keynote";
const PRIYA_WORKSHOP = "sub_mrq140_priya_workshop";
const OTHER_SESSION = "sub_mrq140_other_event";
const TEMPLATE_ID = "template_mrq140";
const ATTACHMENT_ID = "attachment_mrq140";

interface FilesResponse {
  data: { rows: Array<{ id: string; person: { id: string; name: string }; session: { id: string; title: string } | null }> };
}
interface SpeakerTasksResponse {
  data: Array<{ id: string; person: { id: string }; submission_id: string | null; submission_title: string | null }>;
}
interface AssigneesResponse {
  data: Array<{ id: string; name: string; sessions: Array<{ id: string; title: string }> }>;
}
interface ErrorResponse { error: { code: string; field?: string; message: string } }

function runtimeEnv(): Env {
  return {
    ...env,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${AUTH_SESSION}`);
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, runtimeEnv());
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function person(id: string, name: string, email: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 0, ?, ?)",
  ).bind(id, ORG_ID, email, name, NOW, NOW);
}

function submission(id: string, eventId: string, title: string, status: string, submitterId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at)
     VALUES (?, ?, NULL, 'session', ?, '', ?, 'admin', ?, ?, ?)`,
  ).bind(id, eventId, title, status, submitterId, NOW, NOW);
}

function participation(id: string, submissionId: string, personId: string, position: number): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', ?, ?, ?)",
  ).bind(id, submissionId, personId, position, NOW, NOW);
}

async function assignedTasks(): Promise<Map<string, string | null>> {
  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  return new Map(tasks.data.map((task) => [task.person.id, task.submission_id]));
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Session Link Conf', 'session-link-mrq140', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Session Link Conf', 'session-link-mrq140', NULL, '2026-10-12', '2026-10-13', 'America/New_York', NULL, 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Another Conference', 'another-mrq140', NULL, '2026-11-12', '2026-11-13', 'UTC', NULL, 'live', 0, ?, ?)`).bind(OTHER_EVENT_ID, ORG_ID, NOW, NOW),
    person(ORGANIZER_ID, "Jordan Alvarez", "jordan@mrq140.test"),
    person(MARCUS_ID, "Marcus Okafor", "marcus@mrq140.test"),
    person(PRIYA_ID, "Priya Raman", "priya@mrq140.test"),
    person(DANA_ID, "Dana Whitfield", "dana@mrq140.test"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq140_organizer', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, EVENT_ID, ORGANIZER_ID, NOW, NOW),
    // Dana is on the roster without a session of her own — the case that stays
    // unattached however hard the resolver tries.
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq140_dana', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, EVENT_ID, DANA_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'mrq140', NULL, ?, ?)").bind(AUTH_SESSION, ORGANIZER_ID, SESSION_EXPIRES_AT, NOW, NOW),
    submission(MARCUS_SESSION, EVENT_ID, "Agents in Production", "accepted", MARCUS_ID),
    // A rejected session is gone, not ambiguous: Marcus still has exactly one.
    submission(MARCUS_REJECTED, EVENT_ID, "A talk that did not make it", "rejected", MARCUS_ID),
    submission(PRIYA_KEYNOTE, EVENT_ID, "Keynote: The Long Loop", "accepted", PRIYA_ID),
    submission(PRIYA_WORKSHOP, EVENT_ID, "Workshop: Evals From Scratch", "in_review", PRIYA_ID),
    submission(OTHER_SESSION, OTHER_EVENT_ID, "Someone else's conference", "accepted", MARCUS_ID),
    participation("part_mrq140_marcus", MARCUS_SESSION, MARCUS_ID, 0),
    participation("part_mrq140_marcus_rejected", MARCUS_REJECTED, MARCUS_ID, 0),
    participation("part_mrq140_priya_keynote", PRIYA_KEYNOTE, PRIYA_ID, 0),
    participation("part_mrq140_priya_workshop", PRIYA_WORKSHOP, PRIYA_ID, 0),
    participation("part_mrq140_other", OTHER_SESSION, MARCUS_ID, 0),
    env.DB.prepare(`INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Session Presentation', 'file', 'Final deck as a PDF.', ?, NULL, NULL, NULL, 0, 0, ?, ?)`).bind(TEMPLATE_ID, EVENT_ID, DUE_AT, NOW, NOW),
  ]);
});

test("CONTRACT · MRQ-140 · the picker attaches a speaker's only session without asking", async () => {
  const assigned = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, {
    template_id: TEMPLATE_ID,
    person_ids: [MARCUS_ID, PRIYA_ID, DANA_ID],
  });
  expect(assigned.status).toBe(201);

  const sessions = await assignedTasks();
  expect(sessions.get(MARCUS_ID)).toBe(MARCUS_SESSION);
  // Two live sessions is a real question, and nobody but the organizer can
  // answer it; none at all has no answer to give.
  expect(sessions.get(PRIYA_ID)).toBeNull();
  expect(sessions.get(DANA_ID)).toBeNull();

  // The files library is the surface that broke: its SESSION column reads
  // straight off the task's submission.
  const files = await responseJson<FilesResponse>(await request(`/api/v1/events/${EVENT_ID}/files`));
  const marcusRow = files.data.rows.find((row) => row.person.id === MARCUS_ID);
  expect(marcusRow?.session).toMatchObject({ id: MARCUS_SESSION, title: "Agents in Production" });
});

test("CONTRACT · MRQ-140 · the organizer's per-speaker pick is what gets written", async () => {
  const assigned = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, {
    template_id: TEMPLATE_ID,
    person_ids: [MARCUS_ID, PRIYA_ID],
    session_assignments: [
      { person_id: PRIYA_ID, submission_id: PRIYA_WORKSHOP },
      // "No session" is a real answer for a release form or a bio, and it has
      // to beat the automatic one.
      { person_id: MARCUS_ID, submission_id: null },
    ],
  });
  expect(assigned.status).toBe(201);

  const sessions = await assignedTasks();
  expect(sessions.get(PRIYA_ID)).toBe(PRIYA_WORKSHOP);
  expect(sessions.get(MARCUS_ID)).toBeNull();
});

test("CONTRACT · MRQ-140 · a session the speaker is not on is refused, and nothing is assigned", async () => {
  const wrongSpeaker = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, {
    template_id: TEMPLATE_ID,
    person_ids: [MARCUS_ID],
    session_assignments: [{ person_id: MARCUS_ID, submission_id: PRIYA_KEYNOTE }],
  });
  expect(wrongSpeaker.status).toBe(422);
  expect((await responseJson<ErrorResponse>(wrongSpeaker)).error).toMatchObject({ field: "session_assignments" });

  const otherConference = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, {
    template_id: TEMPLATE_ID,
    person_ids: [MARCUS_ID],
    session_assignments: [{ person_id: MARCUS_ID, submission_id: OTHER_SESSION }],
  });
  expect(otherConference.status).toBe(422);

  expect((await assignedTasks()).size).toBe(0);
});

test("CONTRACT · MRQ-140 · creating a task with assignees resolves sessions the same way", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, {
    name: "Upload Final Headshot",
    kind: "file",
    due_at: DUE_AT,
    assign_to: [MARCUS_ID, PRIYA_ID],
    session_assignments: [{ person_id: PRIYA_ID, submission_id: PRIYA_KEYNOTE }],
  });
  expect(created.status).toBe(201);

  const sessions = await assignedTasks();
  expect(sessions.get(MARCUS_ID)).toBe(MARCUS_SESSION);
  expect(sessions.get(PRIYA_ID)).toBe(PRIYA_KEYNOTE);
});

test("CONTRACT · MRQ-140 · the assignee list carries the sessions the picker offers", async () => {
  const assignees = await responseJson<AssigneesResponse>(await request(`/api/v1/events/${EVENT_ID}/task-assignees`));
  const byId = new Map(assignees.data.map((assignee) => [assignee.id, assignee]));
  expect(byId.get(MARCUS_ID)?.sessions.map((session) => session.id)).toEqual([MARCUS_SESSION]);
  expect(byId.get(PRIYA_ID)?.sessions.map((session) => session.title)).toEqual(["Keynote: The Long Loop", "Workshop: Evals From Scratch"]);
  expect(byId.get(DANA_ID)?.sessions).toEqual([]);
});

test("CONTRACT · MRQ-140 · a deliverable with no session exports under its own folder, not with the unscheduled", async () => {
  await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, { template_id: TEMPLATE_ID, person_ids: [DANA_ID] });
  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  const taskId = tasks.data[0]?.id as string;

  const key = `uploads/${EVENT_ID}/task_upload/${ATTACHMENT_ID}.pdf`;
  const object = await env.MEDIA.put(key, "deck bytes");
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
     VALUES (?, ?, 'task_upload', ?, ?, 'slides.pdf', 'application/pdf', 10, 'ready', NULL, ?, ?, ?)`,
  ).bind(ATTACHMENT_ID, EVENT_ID, taskId, key, object?.etag ?? null, NOW, NOW).run();

  const exported = await postJson(`/api/v1/events/${EVENT_ID}/files/export`, { task_ids: [taskId], grouping: "session" });
  expect(exported.status).toBe(200);
  const archive = new TextDecoder().decode(new Uint8Array(await exported.arrayBuffer()));
  expect(archive).toContain("No_Session_Dana_Whitfield/slides.pdf");
  expect(archive).not.toContain("Unscheduled_Dana_Whitfield");
});

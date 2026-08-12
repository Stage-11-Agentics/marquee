/**
 * MRQ-114 · task authoring — templates and multi-speaker assignment.
 *
 * Rubric surface: CNT-01 (w3) wants both fixture file tasks to exist after
 * creation with their literal due dates and speaker assignment, shown pending;
 * SPK-05 (w2) wants plain mark-complete tasks with a title, a due date, and at
 * least two assignees. The dates here are the fixtures' own — 2027-05-01 and
 * 2027-04-14 — because a date that survives the round trip in this suite is the
 * same date the organizer reads back off the screen.
 */
import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";
import { dueAtFromDateInput } from "../../../src/lib/task-due";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_task_authoring_mrq114";
const EVENT_ID = "evt_task_authoring_mrq114";
const OTHER_EVENT_ID = "evt_task_authoring_other_mrq114";
const SESSION_ID = "session_task_authoring_mrq114";
const COOKIE = `mq_session=${SESSION_ID}`;
const ORGANIZER_ID = "person_task_authoring_organizer";
const PRIYA_ID = "person_task_authoring_priya";
const MARCUS_ID = "person_task_authoring_marcus";
const OUTSIDER_ID = "person_task_authoring_outsider";
const SUBMISSION_ID = "sub_task_authoring_mrq114";
const OTHER_FORM_ID = "form_task_authoring_other";

const SLIDES_DUE = dueAtFromDateInput("2027-05-01") as number;
const HEADSHOT_DUE = dueAtFromDateInput("2027-04-14") as number;

interface TemplateBody {
  id: string;
  name: string;
  kind: string;
  due_at: number | null;
  due_offset_days: number | null;
  assigned_count: number;
  open_count: number;
  file_config: unknown;
  auto_assign: number;
}
interface CreateResponse { data: TemplateBody; assigned: number; skipped: number }
interface ListResponse { data: TemplateBody[] }
interface SpeakerTasksResponse {
  data: Array<{ id: string; template_id: string; title: string; due_at: number; status: string; cancelled: boolean; person: { id: string; name: string } }>;
}
interface AssigneesResponse { data: Array<{ id: string; name: string; accepted_session_count: number }> }
interface AssignResponse { assigned: number; skipped: number }
interface ErrorResponse { error: { code: string; field?: string; message: string } }

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function request(path: string, init: RequestInit = {}, cookie = COOKIE): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }, env);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function personRow(id: string, name: string, email: string) {
  const now = Date.now();
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
  ).bind(id, ORG_ID, email, name, now, now);
}

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "Task authoring", "task-authoring-mrq114", now, now),
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_other_mrq114", "Other org", "other-mrq114", now, now),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, "DevFlow Conf 2027", "devflow-2027-mrq114", "2027-05-12", "2027-05-14", "America/Los_Angeles", now, now),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'live', 1, ?, ?)`,
    ).bind(OTHER_EVENT_ID, ORG_ID, "Another conference", "another-mrq114", "2027-06-01", "2027-06-02", "UTC", now, now),
    personRow(ORGANIZER_ID, "Jordan Alvarez", "jordan@example.com"),
    personRow(PRIYA_ID, "Priya Raman", "priya@example.com"),
    personRow(MARCUS_ID, "Marcus Okafor", "marcus@example.com"),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, 'org_other_mrq114', ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
    ).bind(OUTSIDER_ID, "outsider@example.com", "Someone Else", now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)")
      .bind("membership_organizer_mrq114", ORG_ID, EVENT_ID, ORGANIZER_ID, now, now),
    // Priya arrives through a membership; Marcus arrives only through his
    // session. Both must be assignable — that is the whole point of the union.
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("membership_priya_mrq114", ORG_ID, EVENT_ID, PRIYA_ID, now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'task-authoring-mrq114', NULL, ?, ?)`,
    ).bind(SESSION_ID, ORGANIZER_ID, now + 3_600_000, now, now),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, last_write_source, created_at, updated_at)
       VALUES (?, ?, NULL, 'session', ?, '', 'accepted', 'admin', ?, 'marquee', ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, "Lightning: Agents in Production Q&A", MARCUS_ID, now, now),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)",
    ).bind("part_marcus_mrq114", SUBMISSION_ID, MARCUS_ID, now, now),
    env.DB.prepare(
      `INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'abstract', 'draft', ?, ?)`,
    ).bind(OTHER_FORM_ID, OTHER_EVENT_ID, "Form on the other conference", "other-form-mrq114", now, now),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("CONTRACT · MRQ-114 · CNT-01 · a file task created with a literal due date lands assigned to both speakers, pending", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, {
    name: "Upload Session Presentation",
    kind: "file",
    description: "Final slide deck as a PDF, 16:9 aspect ratio.",
    due_at: SLIDES_DUE,
    assign_to: [PRIYA_ID, MARCUS_ID],
  });
  expect(created.status).toBe(201);
  const body = await responseJson<CreateResponse>(created);
  expect(body.assigned).toBe(2);
  expect(body.data).toMatchObject({ name: "Upload Session Presentation", kind: "file", due_at: SLIDES_DUE, due_offset_days: null, assigned_count: 2, open_count: 2 });

  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  expect(tasks.data).toHaveLength(2);
  expect(tasks.data.every((task) => task.status === "open" && task.due_at === SLIDES_DUE)).toBe(true);
  expect(tasks.data.map((task) => task.person.name).sort()).toEqual(["Marcus Okafor", "Priya Raman"]);
});

test("CONTRACT · MRQ-114 · CNT-01 · both fixture tasks coexist with their own names and dates", async () => {
  await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Upload Session Presentation", kind: "file", due_at: SLIDES_DUE, assign_to: [PRIYA_ID, MARCUS_ID] });
  await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Upload Final Headshot (print quality)", kind: "file", due_at: HEADSHOT_DUE, assign_to: [PRIYA_ID, MARCUS_ID] });

  const list = await responseJson<ListResponse>(await request(`/api/v1/events/${EVENT_ID}/task-templates`));
  expect(list.data.map((template) => [template.name, template.due_at])).toEqual([
    ["Upload Session Presentation", SLIDES_DUE],
    ["Upload Final Headshot (print quality)", HEADSHOT_DUE],
  ]);
  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  expect(tasks.data).toHaveLength(4);
  expect(tasks.data.filter((task) => task.status === "open")).toHaveLength(4);
});

test("CONTRACT · MRQ-114 · SPK-05 · a mark-complete task carries a title, a due date, and two assignees", async () => {
  const releaseDue = dueAtFromDateInput("2027-04-15") as number;
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, {
    name: "Sign speaker release form",
    kind: "acknowledge",
    due_at: releaseDue,
    assign_to: [PRIYA_ID, MARCUS_ID],
  });
  expect(created.status).toBe(201);
  expect((await responseJson<CreateResponse>(created)).data).toMatchObject({ kind: "acknowledge", file_config: null, due_at: releaseDue });

  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  expect(tasks.data.map((task) => task.title)).toEqual(["Sign speaker release form", "Sign speaker release form"]);
  expect(new Set(tasks.data.map((task) => task.person.id))).toEqual(new Set([PRIYA_ID, MARCUS_ID]));
});

test("CONTRACT · MRQ-114 · a task needs exactly one deadline, never both and never neither", async () => {
  const neither = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "No deadline", kind: "acknowledge" });
  expect(neither.status).toBe(422);
  expect((await responseJson<ErrorResponse>(neither)).error).toMatchObject({ code: "unprocessable", field: "due_at" });

  const both = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Two deadlines", kind: "acknowledge", due_at: SLIDES_DUE, due_offset_days: 14 });
  expect(both.status).toBe(422);

  const offset = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Offset deadline", kind: "acknowledge", due_offset_days: 21 });
  expect(offset.status).toBe(201);
  expect((await responseJson<CreateResponse>(offset)).data).toMatchObject({ due_at: null, due_offset_days: 21 });
});

test("CONTRACT · MRQ-114 · an offset task resolves its assignee deadline from the moment it is assigned", async () => {
  const before = Date.now();
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Confirm participation", kind: "acknowledge", due_offset_days: 10, assign_to: [PRIYA_ID] });
  expect(created.status).toBe(201);
  const tasks = await responseJson<SpeakerTasksResponse>(await request(`/api/v1/events/${EVENT_ID}/speaker-tasks`));
  expect(tasks.data[0].due_at).toBeGreaterThanOrEqual(before + 10 * 86_400_000);
  expect(tasks.data[0].due_at).toBeLessThan(Date.now() + 11 * 86_400_000);
});

test("CONTRACT · MRQ-114 · a form task needs a form, and it must be this conference's form", async () => {
  const missing = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Fill the travel form", kind: "form", due_at: SLIDES_DUE });
  expect(missing.status).toBe(422);
  expect((await responseJson<ErrorResponse>(missing)).error).toMatchObject({ field: "form_id" });

  const foreign = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Fill the travel form", kind: "form", due_at: SLIDES_DUE, form_id: OTHER_FORM_ID });
  expect(foreign.status).toBe(422);
  expect((await responseJson<ErrorResponse>(foreign)).error).toMatchObject({ field: "form_id" });
});

test("CONTRACT · MRQ-114 · only a file task may carry an upload policy", async () => {
  const response = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, {
    name: "Read the handbook",
    kind: "acknowledge",
    due_at: SLIDES_DUE,
    file_config: { accept: ["pdf"], maxBytes: 1024 * 1024 },
  });
  expect(response.status).toBe(422);
  expect((await responseJson<ErrorResponse>(response)).error).toMatchObject({ field: "file_config" });
});

test("CONTRACT · MRQ-114 · a moved deadline reaches the speakers who still owe the task, and spares the one who finished", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Complete bio and profile", kind: "acknowledge", due_at: SLIDES_DUE, assign_to: [PRIYA_ID, MARCUS_ID] });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;
  await env.DB.prepare("UPDATE speaker_tasks SET status = 'done', completed_at = ? WHERE template_id = ? AND person_id = ?")
    .bind(Date.now(), templateId, MARCUS_ID).run();

  const moved = dueAtFromDateInput("2027-04-01") as number;
  const patched = await patchJson(`/api/v1/events/${EVENT_ID}/task-templates/${templateId}`, { name: "Complete bio and headshot", due_at: moved });
  expect(patched.status).toBe(200);

  const rows = await env.DB.prepare("SELECT person_id, title, due_at, status FROM speaker_tasks WHERE template_id = ? ORDER BY person_id").bind(templateId)
    .all<{ person_id: string; title: string; due_at: number; status: string }>();
  const priya = rows.results.find((row) => row.person_id === PRIYA_ID);
  const marcus = rows.results.find((row) => row.person_id === MARCUS_ID);
  expect(priya).toMatchObject({ title: "Complete bio and headshot", due_at: moved, status: "open" });
  expect(marcus).toMatchObject({ title: "Complete bio and profile", due_at: SLIDES_DUE, status: "done" });
});

test("CONTRACT · MRQ-114 · a file-config-only PATCH still works and leaves the rest of the template alone", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Upload Session Presentation", kind: "file", due_at: SLIDES_DUE });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;

  const patched = await patchJson(`/api/v1/events/${EVENT_ID}/task-templates/${templateId}`, { file_config: { accept: [".PDF", "pptx"], maxBytes: 30 * 1024 * 1024 } });
  expect(patched.status).toBe(200);
  expect((await responseJson<{ data: TemplateBody }>(patched)).data).toMatchObject({
    name: "Upload Session Presentation",
    due_at: SLIDES_DUE,
    file_config: { accept: ["pdf", "pptx"], maxBytes: 30 * 1024 * 1024 },
  });
});

test("CONTRACT · MRQ-114 · what a task asks for cannot change under speakers already holding it", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Confirm participation", kind: "acknowledge", due_at: SLIDES_DUE, assign_to: [PRIYA_ID] });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;

  const blocked = await patchJson(`/api/v1/events/${EVENT_ID}/task-templates/${templateId}`, { kind: "file" });
  expect(blocked.status).toBe(409);

  const unassigned = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Nobody holds this", kind: "acknowledge", due_at: SLIDES_DUE });
  const freeId = (await responseJson<CreateResponse>(unassigned)).data.id;
  const allowed = await patchJson(`/api/v1/events/${EVENT_ID}/task-templates/${freeId}`, { kind: "file" });
  expect(allowed.status).toBe(200);
});

test("CONTRACT · MRQ-114 · deleting a task clears its outstanding work but refuses to erase completed work", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Sign speaker release form", kind: "acknowledge", due_at: SLIDES_DUE, assign_to: [PRIYA_ID, MARCUS_ID] });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;
  await env.DB.prepare("UPDATE speaker_tasks SET status = 'done', completed_at = ? WHERE template_id = ? AND person_id = ?")
    .bind(Date.now(), templateId, PRIYA_ID).run();

  const refused = await request(`/api/v1/events/${EVENT_ID}/task-templates/${templateId}`, { method: "DELETE" });
  expect(refused.status).toBe(409);
  expect((await responseJson<ErrorResponse>(refused)).error.message).toContain("completed");
  const survived = await env.DB.prepare("SELECT COUNT(*) AS count FROM task_templates WHERE id = ?").bind(templateId).first<{ count: number }>();
  expect(Number(survived?.count)).toBe(1);

  await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL WHERE template_id = ?").bind(templateId).run();
  const deleted = await request(`/api/v1/events/${EVENT_ID}/task-templates/${templateId}`, { method: "DELETE" });
  expect(deleted.status).toBe(204);
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE template_id = ?").bind(templateId).first<{ count: number }>();
  expect(Number(remaining?.count)).toBe(0);
});

test("CONTRACT · MRQ-114 · SPK-05 · assigning an existing task to more speakers never mints a duplicate", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Confirm participation", kind: "acknowledge", due_at: SLIDES_DUE, assign_to: [PRIYA_ID] });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;

  const assigned = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, { template_id: templateId, person_ids: [PRIYA_ID, MARCUS_ID] });
  expect(assigned.status).toBe(201);
  expect(await responseJson<AssignResponse>(assigned)).toEqual({ assigned: 1, skipped: 1 });

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE template_id = ?").bind(templateId).first<{ count: number }>();
  expect(Number(count?.count)).toBe(2);
});

test("CONTRACT · MRQ-114 · assignment refuses people outside the conference's organization", async () => {
  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "Confirm participation", kind: "acknowledge", due_at: SLIDES_DUE });
  const templateId = (await responseJson<CreateResponse>(created)).data.id;

  const response = await postJson(`/api/v1/events/${EVENT_ID}/speaker-tasks`, { template_id: templateId, person_ids: [OUTSIDER_ID] });
  expect(response.status).toBe(422);
  expect((await responseJson<ErrorResponse>(response)).error).toMatchObject({ field: "person_ids" });
});

test("CONTRACT · MRQ-114 · the assignee list holds speakers from a membership and from a session alike", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/task-assignees`);
  expect(response.status).toBe(200);
  const body = await responseJson<AssigneesResponse>(response);
  expect(body.data.map((person) => person.name)).toEqual(["Marcus Okafor", "Priya Raman"]);
  expect(body.data.find((person) => person.id === MARCUS_ID)?.accepted_session_count).toBe(1);
  expect(body.data.some((person) => person.id === OUTSIDER_ID)).toBe(false);
});

test("CONTRACT · MRQ-114 · authoring needs a credential and a real conference", async () => {
  const unauthenticated = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, { name: "x", kind: "acknowledge", due_at: SLIDES_DUE });
  const anonymous = await app.request(`${ORIGIN}/api/v1/events/${EVENT_ID}/task-templates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x", kind: "acknowledge", due_at: SLIDES_DUE }),
  }, env);
  expect(unauthenticated.status).toBe(201);
  expect(anonymous.status).toBe(401);

  // Authorization answers before the handler does, so an id nobody holds a
  // grant on is 403 rather than 404 — the caller learns nothing about whether
  // that conference exists, which is the right answer to give a stranger.
  const missingEvent = await postJson(`/api/v1/events/evt_does_not_exist/task-templates`, { name: "x", kind: "acknowledge", due_at: SLIDES_DUE });
  expect(missingEvent.status).toBe(403);

  const tasksAnonymous = await app.request(`${ORIGIN}/api/v1/events/${EVENT_ID}/speaker-tasks`, {}, env);
  expect(tasksAnonymous.status).toBe(401);
});

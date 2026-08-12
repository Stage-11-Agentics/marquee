import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_task_templates_mrq96";
const SESSION_ID = "session_task_templates_mrq96";
const COOKIE = `mq_session=${SESSION_ID}`;
const FILE_TEMPLATE_ID = "template_task_file_mrq96";
const ACK_TEMPLATE_ID = "template_task_ack_mrq96";

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_task_templates_mrq96", "Task templates API", "task-templates-mrq96", now, now),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, "org_task_templates_mrq96", "Task templates fixture", "task-templates-mrq96", null, "2026-10-12", "2026-10-14", "America/New_York", null, now, now),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
    ).bind("person_task_templates_mrq96", "org_task_templates_mrq96", "templates@example.com", "Task Template Operator", now, now),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)",
    ).bind("membership_task_templates_mrq96", "org_task_templates_mrq96", EVENT_ID, "person_task_templates_mrq96", now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'task-templates-mrq96', NULL, ?, ?)`,
    ).bind(SESSION_ID, "person_task_templates_mrq96", now + 3_600_000, now, now),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
       VALUES (?, ?, ?, 'file', ?, NULL, 14, NULL, ?, 0, 1, ?, ?)`,
    ).bind(FILE_TEMPLATE_ID, EVENT_ID, "Presentation Upload", "Upload your deck.", JSON.stringify({ accept: [".pdf", ".pptx", ".key"], maxBytes: 26_214_400 }), now, now),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
       VALUES (?, ?, ?, 'acknowledge', ?, NULL, 7, NULL, NULL, 1, 0, ?, ?)`,
    ).bind(ACK_TEMPLATE_ID, EVENT_ID, "Read the handbook", "Read and acknowledge.", now, now),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

async function request(path: string, init: RequestInit = {}, cookie = COOKIE): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }, env);
}

test("MRQ-96 · list returns task templates in position order and canonicalizes seeded config", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/task-templates`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [
      { id: FILE_TEMPLATE_ID, kind: "file", file_config: { accept: ["pdf", "pptx", "key"], maxBytes: 26_214_400 } },
      { id: ACK_TEMPLATE_ID, kind: "acknowledge", file_config: null },
    ],
  });
});

test("MRQ-96 · file policy edits normalize, cap to the R2 ceiling, and survive reload", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/task-templates/${FILE_TEMPLATE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_config: { accept: [".PDF", "pdf", "PPTX"], maxBytes: 200 * 1024 * 1024 } }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data.file_config).toEqual({ accept: ["pdf", "pptx"], maxBytes: 100 * 1024 * 1024 });

  const stored = await env.DB.prepare("SELECT file_config FROM task_templates WHERE id = ?").bind(FILE_TEMPLATE_ID).first<{ file_config: string }>();
  expect(JSON.parse(stored?.file_config ?? "{}")).toEqual({ accept: ["pdf", "pptx"], maxBytes: 100 * 1024 * 1024 });
  const reloaded = await request(`/api/v1/events/${EVENT_ID}/task-templates`);
  expect((await reloaded.json()).data[0].file_config).toEqual({ accept: ["pdf", "pptx"], maxBytes: 100 * 1024 * 1024 });
});

test("MRQ-96 · empty lists and non-file templates are rejected without changing stored config", async () => {
  const empty = await request(`/api/v1/events/${EVENT_ID}/task-templates/${FILE_TEMPLATE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_config: { accept: [], maxBytes: 10 * 1024 * 1024 } }),
  });
  expect(empty.status).toBe(422);
  expect((await empty.json()).error).toMatchObject({ code: "unprocessable", field: "accept" });

  const nonFile = await request(`/api/v1/events/${EVENT_ID}/task-templates/${ACK_TEMPLATE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_config: null }),
  });
  expect(nonFile.status).toBe(422);
  expect((await nonFile.json()).error).toMatchObject({ code: "unprocessable", field: "file_config" });
  const stored = await env.DB.prepare("SELECT file_config FROM task_templates WHERE id = ?").bind(FILE_TEMPLATE_ID).first<{ file_config: string }>();
  expect(stored?.file_config).toContain(".pdf");
});

test("MRQ-96 · null preserves the system-default behavior and auth remains required", async () => {
  const cleared = await request(`/api/v1/events/${EVENT_ID}/task-templates/${FILE_TEMPLATE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_config: null }),
  });
  expect(cleared.status).toBe(200);
  expect((await cleared.json()).data.file_config).toBeNull();

  const unauthenticated = await request(`/api/v1/events/${EVENT_ID}/task-templates`, {}, "");
  expect(unauthenticated.status).toBe(401);
});

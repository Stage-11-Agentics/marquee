import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

// The fixture clock stays absolute here on purpose: this suite asserts ZIP
// entry names built from the session's weekday and time ("Thu-1400-..."), which
// a moving anchor would change every day.
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
// The session row is the one fixture that cannot be absolute. Auth compares
// expires_at against the real Date.now(), so an absolute expiry turns this whole
// suite into 401s the moment the wall clock passes it.
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;
const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq117";
const EVENT_ID = "evt_mrq117";
const EVENT_OTHER_ID = "evt_mrq117_other";
const PERSON_ID = "person_mrq117";
const OTHER_PERSON_ID = "person_mrq117_other";
const SESSION_ID = "session_mrq117";
const AUTH_SESSION = "auth_mrq117";
const TEMPLATE_ID = "template_mrq117";
const OTHER_TEMPLATE_ID = "template_mrq117_other";
const TASK_ID = "task_mrq117";
const MISSING_TASK_ID = "task_mrq117_missing";
const OTHER_TASK_ID = "task_mrq117_other";
const OLD_ATTACHMENT_ID = "attachment_mrq117_old";
const LATEST_ATTACHMENT_ID = "attachment_mrq117_latest";
const LATEST_KEY = `uploads/${EVENT_ID}/task_upload/${LATEST_ATTACHMENT_ID}.pdf`;
const BUILDING_ID = "building_mrq117";
const ROOM_ID = "room_mrq117";

function runtimeEnv(): Env {
  return {
    ...env,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq117-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq117-upload-rate-secret",
    MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}, session = AUTH_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  if (session) headers.set("cookie", `mq_session=${session}`);
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, runtimeEnv());
}

async function storeAttachment(id: string, key: string, content: string): Promise<void> {
  const object = await env.MEDIA.put(key, content);
  if (!object) throw new Error(`R2 did not store ${key}`);
  await env.DB.prepare(
    `INSERT INTO attachments
      (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
     VALUES (?, ?, 'task_upload', ?, ?, ?, 'application/pdf', ?, 'ready', NULL, ?, ?, ?)`,
  ).bind(id, EVENT_ID, TASK_ID, key, id === OLD_ATTACHMENT_ID ? "old.pdf" : "latest.pdf", content.length, object.etag, NOW, NOW).run();
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'ZIP Conference', 'zip-conference', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'ZIP Conference', 'zip-conference', NULL, '2026-10-12', '2026-10-13', 'America/New_York', NULL, 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Other Conference', 'other-conference', NULL, '2026-10-12', '2026-10-13', 'America/New_York', NULL, 'live', 0, ?, ?)`).bind(EVENT_OTHER_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO buildings
      (id, event_id, name, address, position, created_at, updated_at)
      VALUES (?, ?, 'ZIP Building', '1 Main Street', 0, ?, ?)`).bind(BUILDING_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO rooms
      (id, event_id, building_id, name, capacity, position, created_at, updated_at)
      VALUES (?, ?, ?, 'Studio A', 100, 0, ?, ?)`).bind(ROOM_ID, EVENT_ID, BUILDING_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'organizer@example.com', 'Priya Raman', '[]', 0, ?, ?)").bind(PERSON_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'other@example.com', 'Other Speaker', '[]', 0, ?, ?)").bind(OTHER_PERSON_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('membership_mrq117', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, PERSON_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(AUTH_SESSION, PERSON_ID, SESSION_EXPIRES_AT, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions
      (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, NULL, 'session', 'Taming 40-Minute CI', 'An abstract', 'accepted', 'admin', ?, 'Taming 40-Minute CI', ?, ?)`).bind(SESSION_ID, EVENT_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items
      (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at)
      VALUES ('agenda_mrq117', ?, ?, 'session', ?, 30, ?, 0, ?, ?)`).bind(EVENT_ID, SESSION_ID, NOW + 2 * 60 * 60_000, ROOM_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates
      (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload slides', 'file', 'Final deck', ?, NULL, NULL, NULL, 0, 1, ?, ?)`).bind(TEMPLATE_ID, EVENT_ID, NOW, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates
      (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload other slides', 'file', 'Final deck', ?, NULL, NULL, NULL, 0, 1, ?, ?)`).bind(OTHER_TEMPLATE_ID, EVENT_OTHER_ID, NOW, NOW, NOW),
  ]);
  await storeAttachment(OLD_ATTACHMENT_ID, `uploads/${EVENT_ID}/task_upload/${OLD_ATTACHMENT_ID}.pdf`, "old bytes");
  await storeAttachment(LATEST_ATTACHMENT_ID, `uploads/${EVENT_ID}/task_upload/${LATEST_ATTACHMENT_ID}.pdf`, "latest bytes");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO speaker_tasks
      (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', 'Final deck', ?, 'done', ?, NULL, ?, ?, ?)`).bind(TASK_ID, EVENT_ID, PERSON_ID, SESSION_ID, TEMPLATE_ID, NOW, NOW, LATEST_ATTACHMENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks
      (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Final Headshot', 'file', 'Print quality', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(MISSING_TASK_ID, EVENT_ID, PERSON_ID, SESSION_ID, TEMPLATE_ID, NOW, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks
      (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'Upload Other Deck', 'file', 'Final deck', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(OTHER_TASK_ID, EVENT_OTHER_ID, OTHER_PERSON_ID, OTHER_TEMPLATE_ID, NOW, NOW, NOW),
  ]);
});

test("CONTRACT · CNT-14 · export includes the pointer-selected latest and a missing manifest entry", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/files/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_ids: [TASK_ID, MISSING_TASK_ID], grouping: "session" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/zip");
  expect(response.headers.get("content-disposition")).toContain("deliverables-session");
  const text = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));
  expect(text).toContain("latest.pdf");
  expect(text).not.toContain("old.pdf");
  expect(text).toContain("Upload Final Headshot");
  expect(text).toContain("no completed upload");
  expect(text).toContain("Thu-1400-Studio_A_Priya_Raman/latest.pdf");

  const speakerResponse = await request(`/api/v1/events/${EVENT_ID}/files/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_ids: [TASK_ID], grouping: "speaker" }),
  });
  expect(speakerResponse.status).toBe(200);
  const speakerText = new TextDecoder().decode(new Uint8Array(await speakerResponse.arrayBuffer()));
  expect(speakerText).toContain("Priya_Raman/Thu-1400-Studio_A_Priya_Raman/latest.pdf");
});

test("CONTRACT · CNT-14 · export follows the pointer even when an older ready version is current", async () => {
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ? WHERE id = ?").bind(OLD_ATTACHMENT_ID, TASK_ID).run();
  const response = await request(`/api/v1/events/${EVENT_ID}/files/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_ids: [TASK_ID], grouping: "session" }),
  });
  expect(response.status).toBe(200);
  const text = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));
  expect(text).toContain("old.pdf");
  expect(text).not.toContain("latest.pdf");
});

test("CONTRACT · CNT-14 · export refuses an unauthenticated or cross-event selection", async () => {
  const body = JSON.stringify({ task_ids: [TASK_ID] });
  expect((await request(`/api/v1/events/${EVENT_ID}/files/export`, { method: "POST", headers: { "content-type": "application/json" }, body }, "")).status).toBe(401);
  expect((await request(`/api/v1/events/${EVENT_ID}/files/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task_ids: [OTHER_TASK_ID] }) })).status).toBe(404);
});

test("CONTRACT · CNT-14 · a lost R2 object stays visible in the manifest", async () => {
  await env.MEDIA.delete(LATEST_KEY);
  const response = await request(`/api/v1/events/${EVENT_ID}/files/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_ids: [TASK_ID], grouping: "session" }),
  });
  expect(response.status).toBe(200);
  const text = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));
  expect(text).toContain("the latest upload bytes are unavailable");
});

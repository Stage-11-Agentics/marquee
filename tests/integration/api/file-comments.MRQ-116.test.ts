import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();
const ORG_ID = "org_mrq116";
const EVENT_ID = "evt_mrq116";
const ORGANIZER_ID = "per_mrq116_organizer";
const SPEAKER_ID = "per_mrq116_speaker";
const ORGANIZER_SESSION = "sess_mrq116_organizer";
const SPEAKER_SESSION = "sess_mrq116_speaker";
const TEMPLATE_ID = "tpl_mrq116_slides";
const TASK_ID = "task_mrq116_slides";
const V1_ID = "att_mrq116_v1";
const V2_ID = "att_mrq116_v2";

async function request(path: string, init: RequestInit = {}, sessionId = SPEAKER_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${sessionId}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  return body;
}

async function commentCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM file_comments").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function insertVersion(id: string, filename: string, createdAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO attachments
       (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
     VALUES (?, ?, 'task_upload', ?, ?, ?, 'application/pdf', 100, 'ready', ?, ?, ?)`,
  ).bind(id, EVENT_ID, TASK_ID, `uploads/${id}`, filename, `etag-${id}`, createdAt, createdAt).run();
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Comments Conference', 'comments-conference', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Comments 2026', 'comments-2026', '2026-10-12', '2026-10-13', 'America/New_York', 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'jordan@example.com', 'Jordan Alvarez', '[]', 0, ?, ?)").bind(ORGANIZER_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'priya@example.com', 'Priya Raman', '[]', 0, ?, ?)").bind(SPEAKER_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mrq116_owner', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, EVENT_ID, ORGANIZER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mrq116_speaker', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, EVENT_ID, SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(ORGANIZER_SESSION, ORGANIZER_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)").bind(SPEAKER_SESSION, SPEAKER_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates
      (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Session Presentation', 'file', 'Upload your slides.', NULL, 7, NULL, ?, 0, 0, ?, ?)`).bind(TEMPLATE_ID, EVENT_ID, JSON.stringify({ accept: ["pdf"], max_bytes: 1_000_000 }), NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks
      (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'Upload Session Presentation', 'file', 'Upload your slides.', ?, 'done', ?, ?, NULL, ?, ?)`).bind(TASK_ID, EVENT_ID, SPEAKER_ID, TEMPLATE_ID, NOW + 86_400_000, NOW, null, NOW, NOW),
  ]);
  await insertVersion(V1_ID, "slides.pdf", NOW - 10_000);
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ? WHERE id = ? AND event_id = ?").bind(V1_ID, TASK_ID, EVENT_ID).run();
});

test("CONTRACT · MRQ-116 speaker comment survives replacement and organizer replies on the slot thread", async () => {
  const speakerPost = await request(`/api/v1/me/tasks/${TASK_ID}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "Draft deck - final version coming Friday.", attachment_id: V1_ID }),
  });
  expect(speakerPost.status).toBe(200);
  const posted = await responseJson<{ comment: { author_name: string; author_role: string; attachment_version: number; created_at: number } }>(speakerPost);
  expect(posted.comment.author_name).toBe("Priya Raman");
  expect(posted.comment.author_role).toBe("speaker");
  expect(posted.comment.attachment_version).toBe(1);
  expect(posted.comment.created_at).toBeGreaterThan(0);

  // A person can carry an org-wide role as well as an event role. The thread
  // must report the role that applies to this conference, not the broader one.
  await env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mrq116_speaker_org_owner', ?, NULL, ?, 'owner', ?, ?)").bind(ORG_ID, SPEAKER_ID, NOW, NOW).run();

  await insertVersion(V2_ID, "slides.pdf", NOW + 10_000);
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ?, updated_at = ? WHERE id = ? AND event_id = ?").bind(V2_ID, NOW + 10_000, TASK_ID, EVENT_ID).run();

  const organizerPost = await request(`/api/v1/events/${EVENT_ID}/files/${TASK_ID}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "Thanks - please confirm the final version by Tuesday.", attachment_id: V2_ID }),
  }, ORGANIZER_SESSION);
  expect(organizerPost.status).toBe(200);
  const organizerComment = await responseJson<{ comment: { author_name: string; author_role: string; attachment_version: number } }>(organizerPost);
  expect(organizerComment.comment.author_name).toBe("Jordan Alvarez");
  expect(organizerComment.comment.author_role).toBe("owner");
  expect(organizerComment.comment.attachment_version).toBe(2);

  const organizerRead = await request(`/api/v1/events/${EVENT_ID}/files/${TASK_ID}/comments`, {}, ORGANIZER_SESSION);
  expect(organizerRead.status).toBe(200);
  const thread = await responseJson<{ comments: Array<{ body: string; author_role: string; attachment_version: number | null }> }>(organizerRead);
  expect(thread.comments).toHaveLength(2);
  expect(thread.comments.map((comment) => comment.body)).toEqual([
    "Draft deck - final version coming Friday.",
    "Thanks - please confirm the final version by Tuesday.",
  ]);
  expect(thread.comments.map((comment) => comment.attachment_version)).toEqual([1, 2]);
  expect(thread.comments.map((comment) => comment.author_role)).toEqual(["speaker", "owner"]);
});

test("CONTRACT · MRQ-116 invalid attachment is refused with no comment write", async () => {
  const before = await commentCount();
  const response = await request(`/api/v1/me/tasks/${TASK_ID}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "This must not be stored", attachment_id: "att-from-another-slot" }),
  });
  expect(response.status).toBe(422);
  expect(await commentCount()).toBe(before);
});

test("CONTRACT · MRQ-116 speaker cannot read the organizer Files comment route", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/files/${TASK_ID}/comments`);
  expect(response.status).toBe(403);
});

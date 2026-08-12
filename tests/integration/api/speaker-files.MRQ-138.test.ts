import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import type { SpeakerFilesSnapshot } from "../../../src/routes/speaker-files.queries";
import { applyMigrations, env } from "../apply-migrations";

/**
 * MRQ-138 · the organizer's speaker record can say what the speaker has sent.
 *
 * Before this route existed, a headshot uploaded through the speaker portal
 * was stored, pointed at by `people.headshot_attachment_id`, and rendered as a
 * roster avatar — with no filename, no upload date, and no way to download it
 * anywhere in the organizer surface. /files is scoped to file-request tasks,
 * so it could not answer for a profile photo at all.
 *
 * The claim defended here is the one an organizer actually makes: open one
 * speaker, see everything that human has sent, with a name, a date and a link.
 */

const NOW = Date.now();
const DAY = 86_400_000;
const REAL_NOW = Date.now();
const ORG_ID = "org_mrq138";
const EVENT_ID = "evt_mrq138";
const ORIGIN = "https://marquee.stage11.dev";
const MEDIA_ORIGIN = "media.marquee.test";
const FORM_ID = "form_mrq138";
const ORGANIZER = "per_mrq138_organizer";
const PRIYA = "per_mrq138_priya";
const MARCUS = "per_mrq138_marcus";
const ORGANIZER_SESSION = "sess_mrq138_organizer";
const PRIYA_SESSION = "sess_mrq138_priya";
const PRIYA_SUBMISSION = "sub_mrq138_priya";
const SLIDES_TEMPLATE = "tpl_mrq138_slides";
const PRIYA_SLIDES_TASK = "task_mrq138_priya_slides";
const HEADSHOT_ATTACHMENT = "att_mrq138_headshot";
const SLIDES_ATTACHMENT = "att_mrq138_slides";

function runtimeEnv(): Env {
  return { ...env, MEDIA_PUBLIC_ORIGIN: MEDIA_ORIGIN } as unknown as Env;
}

async function speakerFiles(personId: string, sessionId = ORGANIZER_SESSION): Promise<Response> {
  const headers = new Headers();
  if (sessionId) headers.set("cookie", `mq_session=${sessionId}`);
  return app.request(`${ORIGIN}/api/v1/events/${EVENT_ID}/speakers/${personId}/files`, { headers }, runtimeEnv());
}

async function snapshotFor(personId: string): Promise<SpeakerFilesSnapshot> {
  const response = await speakerFiles(personId);
  expect(response.status).toBe(200);
  return (await response.json() as { data: SpeakerFilesSnapshot }).data;
}

async function storeUpload(
  id: string,
  ownerType: "person_headshot" | "task_upload",
  ownerId: string,
  filename: string,
  contentType: string,
  createdAt: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, filename, content_type, size_bytes, r2_key, r2_etag, sha256, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 2097152, ?, ?, NULL, 'ready', ?, ?)`,
  ).bind(id, EVENT_ID, ownerType, ownerId, filename, contentType, `uploads/${EVENT_ID}/${ownerType}/${id}`, `etag-${id}`, createdAt, createdAt).run();
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'DevFlow', 'devflow', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'DevFlow Conf 2027', 'devflow-2027', NULL, '2027-05-12', '2027-05-14', 'America/Los_Angeles', 'Moscone West', '#0b6a72', 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'jordan@example.com', 'Jordan Alvarez', '[]', 0, ?, ?)").bind(ORGANIZER, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'priya@example.com', 'Priya Raman', '[]', 0, ?, ?)").bind(PRIYA, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'marcus@example.com', 'Marcus Okafor', '[]', 0, ?, ?)").bind(MARCUS, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq138_owner', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq138_priya', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, PRIYA, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq138_marcus', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, MARCUS, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(ORGANIZER_SESSION, ORGANIZER, NOW + DAY, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)").bind(PRIYA_SESSION, PRIYA, NOW + DAY, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, 'Call for Proposals', 'cfp', 'session', 'open', NULL, ?, ?)").bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Taming 40-Minute CI', 'An abstract', 'accepted', 'public', ?, 'Taming 40-Minute CI', ?, ?)`).bind(PRIYA_SUBMISSION, EVENT_ID, FORM_ID, PRIYA, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Session Presentation', 'file', 'Final deck.', ?, NULL, NULL, NULL, 0, 1, ?, ?)`).bind(SLIDES_TEMPLATE, EVENT_ID, REAL_NOW + 30 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(PRIYA_SLIDES_TASK, EVENT_ID, PRIYA, PRIYA_SUBMISSION, SLIDES_TEMPLATE, REAL_NOW + 30 * DAY, NOW, NOW),
  ]);

  // Exactly what the speaker portal leaves behind: an attachment row plus the
  // person pointer the roster avatar already reads.
  await storeUpload(HEADSHOT_ATTACHMENT, "person_headshot", PRIYA, "priya-raman-headshot.jpg", "image/jpeg", NOW - 3 * DAY);
  await env.DB.prepare("UPDATE people SET headshot_attachment_id = ? WHERE id = ?").bind(HEADSHOT_ATTACHMENT, PRIYA).run();
  await storeUpload(SLIDES_ATTACHMENT, "task_upload", PRIYA_SLIDES_TASK, "taming-ci.pdf", "application/pdf", NOW - DAY);
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ?, status = 'done', completed_at = ? WHERE id = ?")
    .bind(SLIDES_ATTACHMENT, NOW - DAY, PRIYA_SLIDES_TASK).run();
});

test("CONTRACT · MRQ-138 — the speaker record can name the headshot the speaker uploaded, when it arrived, and where to open it", async () => {
  const snapshot = await snapshotFor(PRIYA);
  const headshot = snapshot.groups.find((group) => group.kind === "headshot");
  expect(headshot, "the profile photo must appear on the organizer's record, not only as an avatar").toBeDefined();
  expect(headshot!.versions.latest?.filename).toBe("priya-raman-headshot.jpg");
  expect(headshot!.versions.latest?.uploaded_at).toBe(NOW - 3 * DAY);
  expect(headshot!.versions.latest?.attachment_id).toBe(HEADSHOT_ATTACHMENT);
  expect(headshot!.versions.latest?.url.startsWith(`https://${MEDIA_ORIGIN}/api/v1/media/`)).toBe(true);
  expect(headshot!.versions.latest_source).toBe("pointer");
});

test("CONTRACT · MRQ-138 — requested deliverables appear on the same record, with their session and due date", async () => {
  const snapshot = await snapshotFor(PRIYA);
  const deliverable = snapshot.groups.find((group) => group.id === PRIYA_SLIDES_TASK);
  expect(deliverable).toBeDefined();
  expect(deliverable!.kind).toBe("deliverable");
  expect(deliverable!.label).toBe("Upload Session Presentation");
  expect(deliverable!.session?.title).toBe("Taming 40-Minute CI");
  expect(deliverable!.due_at).toBe(REAL_NOW + 30 * DAY);
  expect(deliverable!.versions.latest?.filename).toBe("taming-ci.pdf");
  // The photo leads the record; it is the file every speaker has.
  expect(snapshot.groups[0].kind).toBe("headshot");
  expect(snapshot).toMatchObject({ expected: 1, received: 1, link_policy: "unauthenticated-capability-url" });
});

test("CONTRACT · MRQ-138 — a speaker who has sent nothing still gets a row that says so", async () => {
  const snapshot = await snapshotFor(MARCUS);
  expect(snapshot.groups).toHaveLength(1);
  expect(snapshot.groups[0].kind).toBe("headshot");
  expect(snapshot.groups[0].versions.latest).toBeNull();
  expect(snapshot.groups[0].versions.versions).toEqual([]);
  expect(snapshot).toMatchObject({ expected: 0, received: 0 });
});

test("CONTRACT · MRQ-138 — the route is organizer-only and 404s for a stranger to this conference", async () => {
  expect((await speakerFiles(PRIYA, "")).status).toBe(401);
  expect((await speakerFiles("per_mrq138_nobody")).status).toBe(404);
});

test("CONTRACT · MRQ-138 — a speaker cannot read another speaker's files", async () => {
  // The route hands out capability URLs: anyone holding one can fetch the
  // object. So the grant that guards it is load-bearing, and the assertion
  // that would catch a future policy edit is this one, not the 401 above.
  // A speaker seat holds speaker:write and no program:read.
  expect((await speakerFiles(MARCUS, PRIYA_SESSION)).status).toBe(403);
  // Not even their own — this is the organizer's view of a person, and the
  // speaker's own files live on the portal behind /api/v1/me.
  expect((await speakerFiles(PRIYA, PRIYA_SESSION)).status).toBe(403);
});

import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { listVersionsFor, listVersionsForOwners } from "../../../src/lib/files/versions";
import type { FilesRow, FilesSnapshot } from "../../../src/routes/files.queries";
import { applyMigrations, env } from "../apply-migrations";

/**
 * MRQ-115 · the files library and the version derivation underneath it.
 *
 * Defends CNT-13 (the library lists the upload with its session, speaker,
 * date, and version count), CNT-04 (two versions, latest marked, the older one
 * still reachable), and the human half of the same screen: a deliverable that
 * has NOT arrived is a row too, or the AV lead cannot chase it.
 *
 * The load-bearing claim is that `is_latest` is derived from
 * `speaker_tasks.attachment_id` and never stored — so the pointer wins even
 * when it names an older upload.
 */

// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();
const ORG_ID = "org_mrq115";
const EVENT_ID = "evt_mrq115";
const ORIGIN = "https://marquee.stage11.dev";
const MEDIA_ORIGIN = "media.marquee.test";
const MEDIA_SECRET = "mrq115-upload-token-secret";
const FORM_ID = "form_mrq115";
const ORGANIZER = "per_mrq115_organizer";
const PRIYA = "per_mrq115_priya";
const MARCUS = "per_mrq115_marcus";
const ORGANIZER_SESSION = "sess_mrq115_organizer";
const SPEAKER_SESSION = "sess_mrq115_speaker";
const PRIYA_SUBMISSION = "sub_mrq115_priya";
const MARCUS_SUBMISSION = "sub_mrq115_marcus";
const SLIDES_TEMPLATE = "tpl_mrq115_slides";
const HEADSHOT_TEMPLATE = "tpl_mrq115_headshot";
const PRIYA_SLIDES_TASK = "task_mrq115_priya_slides";
const PRIYA_HEADSHOT_TASK = "task_mrq115_priya_headshot";
const MARCUS_SLIDES_TASK = "task_mrq115_marcus_slides";
const SLIDES_V1 = "att_mrq115_slides_v1";
const SLIDES_V2 = "att_mrq115_slides_v2";
const SLIDES_PENDING = "att_mrq115_slides_pending";

const DAY = 86_400_000;
/**
 * Due dates are anchored to the real clock, not the fixture's, because
 * "overdue" is a comparison against now that the route makes for real. Upload
 * timestamps stay on the fixture clock — they are displayed, not compared.
 */
const REAL_NOW = Date.now();

function runtimeEnv(): Env {
  return {
    ...env,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq115-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq115-upload-rate-secret",
    MEDIA_PUBLIC_ORIGIN: MEDIA_ORIGIN,
  } as unknown as Env;
}

async function request(path: string, sessionId?: string): Promise<Response> {
  const headers = new Headers();
  if (sessionId) headers.set("cookie", `mq_session=${sessionId}`);
  return app.request(`${ORIGIN}${path}`, { headers }, runtimeEnv());
}

async function library(query = ""): Promise<FilesSnapshot> {
  const response = await request(`/api/v1/events/${EVENT_ID}/files${query}`, ORGANIZER_SESSION);
  expect(response.status).toBe(200);
  return (await response.json() as { data: FilesSnapshot }).data;
}

function rowFor(snapshot: FilesSnapshot, taskId: string): FilesRow {
  const row = snapshot.rows.find((candidate) => candidate.id === taskId);
  expect(row, `no library row for ${taskId}`).toBeDefined();
  return row!;
}

/** Every presign mints its own row; this is what the upload path already leaves behind. */
async function storeUpload(id: string, taskId: string, filename: string, createdAt: number, status: "ready" | "pending", sizeBytes = 4_194_304): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, filename, content_type, size_bytes, r2_key, r2_etag, sha256, status, created_at, updated_at)
     VALUES (?, ?, 'task_upload', ?, ?, 'application/pdf', ?, ?, ?, NULL, ?, ?, ?)`,
  ).bind(
    id, EVENT_ID, taskId, filename, sizeBytes, `uploads/${EVENT_ID}/task_upload/${id}.pdf`,
    status === "ready" ? `etag-${id}` : null, status, createdAt, createdAt,
  ).run();
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
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq115_owner', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq115_speaker', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, PRIYA, EVENT_ID, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(ORGANIZER_SESSION, ORGANIZER, NOW + DAY, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)").bind(SPEAKER_SESSION, PRIYA, NOW + DAY, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, 'Call for Proposals', 'cfp', 'session', 'open', NULL, ?, ?)").bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Taming 40-Minute CI: Incremental Builds at Monorepo Scale', 'An abstract', 'accepted', 'public', ?, 'Taming 40-Minute CI', ?, ?)`).bind(PRIYA_SUBMISSION, EVENT_ID, FORM_ID, PRIYA, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Lightning: Agents in Production Q&A', 'An abstract', 'accepted', 'public', ?, 'Lightning Agents', ?, ?)`).bind(MARCUS_SUBMISSION, EVENT_ID, FORM_ID, MARCUS, NOW, NOW),
    env.DB.prepare(`INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
      VALUES ('part_mrq115_priya', ?, ?, 'speaker', 0, ?, ?)`).bind(PRIYA_SUBMISSION, PRIYA, NOW, NOW),
    env.DB.prepare(`INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
      VALUES ('part_mrq115_marcus', ?, ?, 'speaker', 0, ?, ?)`).bind(MARCUS_SUBMISSION, MARCUS, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Session Presentation', 'file', 'Final slide deck as a PDF, 16:9 aspect ratio.', ?, NULL, NULL, NULL, 0, 1, ?, ?)`).bind(SLIDES_TEMPLATE, EVENT_ID, REAL_NOW + 30 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Final Headshot (print quality)', 'file', 'Print-quality headshot.', ?, NULL, NULL, NULL, 1, 1, ?, ?)`).bind(HEADSHOT_TEMPLATE, EVENT_ID, REAL_NOW - 5 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(PRIYA_SLIDES_TASK, EVENT_ID, PRIYA, PRIYA_SUBMISSION, SLIDES_TEMPLATE, REAL_NOW + 30 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Final Headshot (print quality)', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(PRIYA_HEADSHOT_TASK, EVENT_ID, PRIYA, PRIYA_SUBMISSION, HEADSHOT_TEMPLATE, REAL_NOW - 5 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(MARCUS_SLIDES_TASK, EVENT_ID, MARCUS, MARCUS_SUBMISSION, SLIDES_TEMPLATE, REAL_NOW + 30 * DAY, NOW, NOW),
  ]);

  // Priya uploaded slides.pdf twice, exactly as CNT-S2 does: two rows, the
  // task pointing at the second.
  await storeUpload(SLIDES_V1, PRIYA_SLIDES_TASK, "slides.pdf", NOW - 2 * DAY, "ready", 4_000_000);
  await storeUpload(SLIDES_V2, PRIYA_SLIDES_TASK, "slides.pdf", NOW - DAY, "ready", 4_300_000);
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ?, status = 'done', completed_at = ? WHERE id = ?")
    .bind(SLIDES_V2, NOW - DAY, PRIYA_SLIDES_TASK).run();
});

test("CONTRACT · MRQ-115/CNT-13 — the library lists the upload with its session, speaker, date, and a version count of 2", async () => {
  const row = rowFor(await library(), PRIYA_SLIDES_TASK);
  expect(row.state).toBe("uploaded");
  expect(row.latest?.filename).toBe("slides.pdf");
  expect(row.version_count).toBe(2);
  expect(row.person.name).toBe("Priya Raman");
  expect(row.session?.title).toBe("Taming 40-Minute CI: Incremental Builds at Monorepo Scale");
  expect(row.latest?.uploaded_at).toBe(NOW - DAY);
  expect(row.latest?.size_bytes).toBe(4_300_000);
});

test("CONTRACT · MRQ-182 · a legacy unlinked upload derives its speaker's only accepted session and search finds it", async () => {
  // MRQ-140 fixed new assignments. This is the old row already in a real
  // conference: the upload exists, the task has no link, and Priya has one
  // accepted Session that the library can recover without a migration.
  await env.DB.prepare("UPDATE speaker_tasks SET submission_id = NULL WHERE id = ?").bind(PRIYA_SLIDES_TASK).run();

  const row = rowFor(await library(), PRIYA_SLIDES_TASK);
  expect(row.latest?.filename).toBe("slides.pdf");
  expect(row.version_count).toBe(2);
  expect(row.session).toEqual({ id: PRIYA_SUBMISSION, title: "Taming 40-Minute CI: Incremental Builds at Monorepo Scale" });
  expect(row.session_candidates).toEqual([]);
  expect((await library("?q=40-Minute")).rows.map((candidate) => candidate.id)).toContain(PRIYA_SLIDES_TASK);
});

test("CONTRACT · MRQ-182 · ambiguous accepted sessions stay honest and name the choices", async () => {
  const secondSubmission = "sub_mrq115_priya_second";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Second Priya Session', 'Another abstract', 'accepted', 'public', ?, 'second priya session', ?, ?)`).bind(secondSubmission, EVENT_ID, FORM_ID, PRIYA, NOW, NOW),
    env.DB.prepare(`INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
      VALUES ('part_mrq115_priya_second', ?, ?, 'speaker', 0, ?, ?)`).bind(secondSubmission, PRIYA, NOW, NOW),
    env.DB.prepare("UPDATE speaker_tasks SET submission_id = NULL WHERE id = ?").bind(PRIYA_SLIDES_TASK),
  ]);

  const row = rowFor(await library(), PRIYA_SLIDES_TASK);
  expect(row.session).toBeNull();
  expect(row.session_candidates.map((session) => session.title)).toEqual([
    "Second Priya Session",
    "Taming 40-Minute CI: Incremental Builds at Monorepo Scale",
  ]);
  expect((await library("?q=Second Priya Session")).rows.map((candidate) => candidate.id)).toContain(PRIYA_SLIDES_TASK);
});

test("CONTRACT · MRQ-115/CNT-04 — both versions are listed newest-first, the latest is flagged, and the older one keeps its own URL", async () => {
  const row = rowFor(await library(), PRIYA_SLIDES_TASK);
  expect(row.versions.map((version) => version.version)).toEqual([2, 1]);
  expect(row.versions.map((version) => version.is_latest)).toEqual([true, false]);
  const [second, first] = row.versions;
  expect(first.attachment_id).toBe(SLIDES_V1);
  expect(second.attachment_id).toBe(SLIDES_V2);
  // A superseded version is still individually retrievable — the whole point
  // of keeping it — and never shares a URL with the current one.
  expect(first.url).not.toBe(second.url);
  expect(first.url.startsWith(`https://${MEDIA_ORIGIN}/api/v1/media/`)).toBe(true);
});

test("CONTRACT · MRQ-115 — is_latest follows the deliverable pointer even when the pointer names an older upload", async () => {
  // The pointer is what the portal writes and what AV stages from. If a
  // "newest wins" rule ever creeps in, this is the test that catches it.
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ? WHERE id = ?").bind(SLIDES_V1, PRIYA_SLIDES_TASK).run();
  const list = await listVersionsFor(env.DB, "task_upload", PRIYA_SLIDES_TASK, MEDIA_ORIGIN, MEDIA_SECRET);
  expect(list.latest?.attachment_id).toBe(SLIDES_V1);
  expect(list.latest?.version).toBe(1);
  expect(list.latest_source).toBe("pointer");
  expect(list.versions.filter((version) => version.is_latest)).toHaveLength(1);
});

test("CONTRACT · MRQ-115 — an upload that never completed is not a version", async () => {
  await storeUpload(SLIDES_PENDING, PRIYA_SLIDES_TASK, "slides.pdf", NOW, "pending");
  const list = await listVersionsFor(env.DB, "task_upload", PRIYA_SLIDES_TASK, MEDIA_ORIGIN, MEDIA_SECRET);
  expect(list.version_count).toBe(2);
  expect(list.versions.map((version) => version.attachment_id)).not.toContain(SLIDES_PENDING);
  // And the count the organizer reads stays 2, not a hopeful 3.
  expect(rowFor(await library(), PRIYA_SLIDES_TASK).version_count).toBe(2);
});

test("CONTRACT · MRQ-115 — the batch read numbers each owner independently and answers for owners with nothing", async () => {
  const lists = await listVersionsForOwners(env.DB, "task_upload", [PRIYA_SLIDES_TASK, MARCUS_SLIDES_TASK], MEDIA_ORIGIN, MEDIA_SECRET, NOW);
  expect(lists.get(PRIYA_SLIDES_TASK)?.version_count).toBe(2);
  const marcus = lists.get(MARCUS_SLIDES_TASK);
  expect(marcus, "an owner with no uploads still gets an answer").toBeDefined();
  expect(marcus?.versions).toEqual([]);
  expect(marcus?.latest).toBeNull();
  const single = await listVersionsFor(env.DB, "task_upload", PRIYA_SLIDES_TASK, MEDIA_ORIGIN, MEDIA_SECRET, NOW);
  expect(single).toEqual(lists.get(PRIYA_SLIDES_TASK));
});

test("CONTRACT · MRQ-115 — a deliverable nobody has uploaded is a row, not an absence", async () => {
  const snapshot = await library();
  // The human half: the AV lead's screen has to name what is missing.
  const marcus = rowFor(snapshot, MARCUS_SLIDES_TASK);
  expect(marcus.state).toBe("missing");
  expect(marcus.latest).toBeNull();
  expect(marcus.version_count).toBe(0);
  expect(marcus.person.name).toBe("Marcus Okafor");
  const headshot = rowFor(snapshot, PRIYA_HEADSHOT_TASK);
  expect(headshot.state).toBe("overdue");
  expect(snapshot.metrics).toEqual({ expected: 3, received: 1, missing: 2, overdue: 1 });
});

test("CONTRACT · MRQ-115 — filters change the visible set and the counts agree with the rows they produce", async () => {
  const uploaded = await library("?state=uploaded");
  expect(uploaded.rows.map((row) => row.id)).toEqual([PRIYA_SLIDES_TASK]);
  const missing = await library("?state=missing");
  expect(missing.rows.map((row) => row.id).sort()).toEqual([PRIYA_HEADSHOT_TASK, MARCUS_SLIDES_TASK].sort());
  const overdue = await library("?state=overdue");
  expect(overdue.rows.map((row) => row.id)).toEqual([PRIYA_HEADSHOT_TASK]);
  const all = await library();
  expect(all.counts).toEqual({ all: 3, uploaded: 1, missing: 2, overdue: 1 });
  expect(all.rows).toHaveLength(all.counts.all);
});

test("CONTRACT · MRQ-115 — search reaches the filename, the speaker, and the session", async () => {
  expect((await library("?q=slides.pdf")).rows.map((row) => row.id)).toEqual([PRIYA_SLIDES_TASK]);
  expect((await library("?q=Marcus")).rows.map((row) => row.id)).toEqual([MARCUS_SLIDES_TASK]);
  expect((await library("?q=40-Minute")).rows.map((row) => row.id).sort()).toEqual([PRIYA_SLIDES_TASK, PRIYA_HEADSHOT_TASK].sort());
  expect((await library("?q=nothing-matches-this")).rows).toEqual([]);
});

test("CONTRACT · MRQ-115 — a cancelled deliverable keeps its file but stops being owed", async () => {
  await env.DB.prepare("UPDATE speaker_tasks SET cancelled_at = ? WHERE id = ?").bind(NOW, MARCUS_SLIDES_TASK).run();
  const snapshot = await library();
  expect(rowFor(snapshot, MARCUS_SLIDES_TASK).state).toBe("cancelled");
  expect(snapshot.counts.missing).toBe(1);
  expect(snapshot.metrics.expected).toBe(2);
  // Cancelled work sorts to the bottom rather than out of the record.
  expect(snapshot.rows[snapshot.rows.length - 1].id).toBe(MARCUS_SLIDES_TASK);
});

test("CONTRACT · MRQ-115 — the library is organizer-only and answers honestly for a conference that does not exist", async () => {
  expect((await request(`/api/v1/events/${EVENT_ID}/files`)).status).toBe(401);
  expect((await request(`/api/v1/events/${EVENT_ID}/files`, SPEAKER_SESSION)).status).toBe(403);
  // A conference this organizer holds no grant on is refused before the
  // handler's own not-found ever runs — the event-scoped grant check cannot
  // find a membership to authorize. Pinning 403 keeps the test honest about
  // where the answer actually comes from.
  expect((await request(`/api/v1/events/evt_does_not_exist/files`, ORGANIZER_SESSION)).status).toBe(403);
});

test("CONTRACT · MRQ-115/CNT-02 — the speaker portal names the file it is holding, with its version count", async () => {
  const response = await request("/api/v1/me/portal", SPEAKER_SESSION);
  expect(response.status).toBe(200);
  const snapshot = await response.json() as { tasks: { id: string; payload: Record<string, unknown> }[] };
  const task = snapshot.tasks.find((candidate) => candidate.id === PRIYA_SLIDES_TASK);
  expect(task, "the portal lists the speaker's file task").toBeDefined();
  expect(task!.payload.version_count).toBe(2);
  expect((task!.payload.latest as { filename: string }).filename).toBe("slides.pdf");
  expect((task!.payload.versions as unknown[])).toHaveLength(2);
  // The speaker's own view of "current" is the organizer's view of it.
  expect((task!.payload.latest as { attachment_id: string }).attachment_id).toBe(SLIDES_V2);
});

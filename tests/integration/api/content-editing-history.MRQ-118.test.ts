import { SELF } from "cloudflare:test";
import { beforeAll, beforeEach, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * Organizer content editing, attributed history, and restore (MRQ-118).
 *
 * Before this ticket `patchDraft` rejected every non-draft, so an organizer
 * could not fix a typo in an accepted talk's title at all — and the record's
 * History card rendered the literal string "user" where an editor's name
 * belongs. Both halves are asserted here, plus the property the whole feature
 * rests on: a restore ADDS a row and never edits or removes one.
 *
 * Rubric: CNT-09 (edit persists, list reflects it), CNT-11 (attributed
 * timestamped entries + a working restore).
 */

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SESSION_ID = "sess-mrq-118-admin";
const ORIGIN = "https://marquee.stage11.dev";
const ROOM_ID = "room-mrq-118";
const BUILDING_ID = "building-mrq-118";

const ORIGINAL_TITLE = "Taming 40-Minute CI: Incremental Builds at Monorepo Scale";
const ORIGINAL_ABSTRACT = "A tour of incremental build graphs.";
const LIVE_DEMO = " This session now includes a live demo of remote build caching.";
const LAPTOP = " Attendees should bring a laptop.";

interface HistoryEntry {
  id: string;
  action: string;
  actor_name: string | null;
  created_at: number;
  before: { title?: string; abstract?: string | null } | null;
  after: { title?: string; abstract?: string | null } | null;
  restorable: boolean;
}

interface RecordView {
  title: string;
  abstract: string | null;
  history: HistoryEntry[];
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${SESSION_ID}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function readRecord(id: string): Promise<RecordView> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<RecordView>;
}

function editContent(id: string, body: Record<string, unknown>): Promise<Response> {
  return request(`/api/v1/events/${EVENT_ID}/submissions/${id}/content`, { method: "PATCH", body: JSON.stringify(body) });
}

function restoreContent(id: string, body: Record<string, unknown>): Promise<Response> {
  return request(`/api/v1/events/${EVENT_ID}/submissions/${id}/content/restore`, { method: "POST", body: JSON.stringify(body) });
}

async function insertSubmission(id: string, status: string, title = ORIGINAL_TITLE, abstract: string | null = ORIGINAL_ABSTRACT): Promise<void> {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM audit_log WHERE entity_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();
  await env.DB.prepare(
    `INSERT INTO submissions (id, event_id, kind, title, abstract, search_blob, status, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
     VALUES (?, ?, 'session', ?, ?, ?, ?, 'public', ?, ?, ?, ?, ?)`,
  ).bind(id, EVENT_ID, title, abstract, `${title} ${abstract ?? ""}`.toLowerCase(), status, ORGANIZER_ID, now, now, now, now).run();
}

async function auditRows(id: string): Promise<Array<{ id: string; action: string; before_json: string | null; after_json: string | null }>> {
  const rows = await env.DB
    .prepare("SELECT id, action, before_json, after_json FROM audit_log WHERE entity_id = ? ORDER BY created_at, id")
    .bind(id)
    .all<{ id: string; action: string; before_json: string | null; after_json: string | null }>();
  return rows.results;
}

beforeAll(async () => {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
     VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)`,
  ).bind(SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now).run();
  await env.DB.prepare(
    `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
     VALUES (?, ?, 'MRQ-118 Hall', '1 Example Way', 0, NULL, NULL, 5, NULL, ?, ?)`,
  ).bind(BUILDING_ID, EVENT_ID, now, now).run();
  await env.DB.prepare(
    `INSERT INTO rooms (id, building_id, event_id, name, capacity, av_capabilities, notes, position, created_at, updated_at)
     VALUES (?, ?, ?, 'Room 118', 100, '[]', NULL, 0, ?, ?)`,
  ).bind(ROOM_ID, BUILDING_ID, EVENT_ID, now, now).run();
});

beforeEach(async () => {
  await insertSubmission("sub-118-accepted", "accepted");
});

test("CNT-09: an organizer edits an accepted Session's title and abstract, and it persists on reload", async () => {
  const response = await editContent("sub-118-accepted", {
    title: `UPDATED: ${ORIGINAL_TITLE}`,
    abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}`,
  });
  expect(response.status).toBe(200);

  const reloaded = await readRecord("sub-118-accepted");
  expect(reloaded.title).toBe(`UPDATED: ${ORIGINAL_TITLE}`);
  expect(reloaded.abstract).toContain("live demo of remote build caching");
});

test("CNT-09: the edit maintains search_blob, so the session is still findable by its new title", async () => {
  await editContent("sub-118-accepted", { title: `UPDATED: ${ORIGINAL_TITLE}` });
  const row = await env.DB.prepare("SELECT search_blob FROM submissions WHERE id = ?").bind("sub-118-accepted").first<{ search_blob: string }>();
  expect(row?.search_blob).toContain("updated: taming 40-minute ci");
});

test("MRQ-118: one edit writes exactly one audit row carrying both before and after", async () => {
  await editContent("sub-118-accepted", { title: "First edit" });
  const rows = await auditRows("sub-118-accepted");
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe("content_updated");
  expect(JSON.parse(rows[0].before_json ?? "{}")).toMatchObject({ title: ORIGINAL_TITLE });
  expect(JSON.parse(rows[0].after_json ?? "{}")).toMatchObject({ title: "First edit" });
});

test("MRQ-118: a save that changes nothing writes no history row", async () => {
  const response = await editContent("sub-118-accepted", { title: ORIGINAL_TITLE, abstract: ORIGINAL_ABSTRACT });
  expect(response.status).toBe(200);
  expect(await auditRows("sub-118-accepted")).toHaveLength(0);
});

test("CNT-11: history entries carry the editor's NAME, not the literal string 'user'", async () => {
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}` });
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}${LAPTOP}` });

  const record = await readRecord("sub-118-accepted");
  const content = record.history.filter((entry) => entry.action === "content_updated");
  expect(content).toHaveLength(2);
  for (const entry of content) {
    expect(entry.actor_name).toBeTruthy();
    expect(entry.actor_name).not.toBe("user");
    expect(entry.created_at).toBeGreaterThan(0);
    expect(entry.restorable).toBe(true);
  }
  // Newest first, so the panel reads top-down as most-recent-first.
  expect(content[0].created_at).toBeGreaterThanOrEqual(content[1].created_at);
});

test("CNT-11: restoring the version before the second edit drops that edit and keeps the first", async () => {
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}` });
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}${LAPTOP}` });

  const before = await readRecord("sub-118-accepted");
  const secondEdit = before.history.filter((entry) => entry.action === "content_updated")[0];
  const response = await restoreContent("sub-118-accepted", { audit_id: secondEdit.id });
  expect(response.status).toBe(200);

  const after = await readRecord("sub-118-accepted");
  expect(after.abstract).toContain("live demo of remote build caching");
  expect(after.abstract).not.toContain("bring a laptop");
});

test("MRQ-118: a restore ADDS a row and leaves every earlier row byte-identical", async () => {
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}` });
  await editContent("sub-118-accepted", { abstract: `${ORIGINAL_ABSTRACT}${LIVE_DEMO}${LAPTOP}` });
  const originals = await auditRows("sub-118-accepted");
  expect(originals).toHaveLength(2);

  const record = await readRecord("sub-118-accepted");
  const secondEdit = record.history.filter((entry) => entry.action === "content_updated")[0];
  await restoreContent("sub-118-accepted", { audit_id: secondEdit.id });

  const afterRestore = await auditRows("sub-118-accepted");
  expect(afterRestore).toHaveLength(3);
  // The two originals are untouched — same ids, same payloads, same order.
  expect(afterRestore.slice(0, 2)).toEqual(originals);
  expect(afterRestore[2].action).toBe("content_restored");
  // The restore's own before/after describes what the RESTORE changed.
  expect(JSON.parse(afterRestore[2].before_json ?? "{}").abstract).toContain("bring a laptop");
  expect(JSON.parse(afterRestore[2].after_json ?? "{}").abstract).not.toContain("bring a laptop");
});

test("MRQ-118: the status allowlist is enforced — rejected and withdrawn content cannot be rewritten", async () => {
  for (const status of ["rejected", "withdrawn"]) {
    await insertSubmission(`sub-118-${status}`, status);
    const response = await editContent(`sub-118-${status}`, { title: "Rewriting the record" });
    expect(response.status).toBe(409);
    const row = await env.DB.prepare("SELECT title FROM submissions WHERE id = ?").bind(`sub-118-${status}`).first<{ title: string }>();
    expect(row?.title).toBe(ORIGINAL_TITLE);
  }
});

test("MRQ-118: every allowlisted status accepts an edit", async () => {
  for (const status of ["submitted", "in_review", "accepted", "waitlisted"]) {
    await insertSubmission(`sub-118-ok-${status}`, status);
    const response = await editContent(`sub-118-ok-${status}`, { title: `Edited while ${status}` });
    expect(response.status, `status ${status} should be editable`).toBe(200);
  }
});

test("MRQ-118: a live Session refuses a silent edit and accepts a confirmed one", async () => {
  await insertSubmission("sub-118-live", "accepted");
  const now = Date.now();
  await env.DB.prepare("DELETE FROM agenda_items WHERE submission_id = ?").bind("sub-118-live").run();
  await env.DB.prepare(
    `INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
     VALUES (?, ?, ?, 'session', NULL, ?, 30, ?, NULL, 1, ?, ?)`,
  ).bind("agenda-118-live", EVENT_ID, "sub-118-live", now + 86_400_000, ROOM_ID, now, now).run();

  const blocked = await editContent("sub-118-live", { title: "Changed under attendees" });
  expect(blocked.status).toBe(409);
  expect(await auditRows("sub-118-live")).toHaveLength(0);

  const confirmed = await editContent("sub-118-live", { title: "Changed on purpose", confirm_published: true });
  expect(confirmed.status).toBe(200);
});

test("MRQ-118: restore refuses a history id belonging to another record", async () => {
  await insertSubmission("sub-118-other", "accepted");
  await editContent("sub-118-other", { title: "Other record edit" });
  const other = await readRecord("sub-118-other");
  const foreignEntry = other.history.filter((entry) => entry.action === "content_updated")[0];

  const response = await restoreContent("sub-118-accepted", { audit_id: foreignEntry.id });
  expect(response.status).toBe(404);
  const untouched = await readRecord("sub-118-accepted");
  expect(untouched.title).toBe(ORIGINAL_TITLE);
});

test("MRQ-118: restore refuses a history row that records no earlier content", async () => {
  // `published` is a real audit action with no `before` payload — the shape a
  // restore must decline rather than apply as an empty record.
  await editContent("sub-118-accepted", { title: "An edit" });
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id)
     VALUES (?, ?, ?, 'user', 'published', 'submission', ?, NULL, ?, ?, NULL)`,
  ).bind("aud-118-nobefore", EVENT_ID, ORGANIZER_ID, "sub-118-accepted", JSON.stringify({ is_published: true }), now).run();

  const response = await restoreContent("sub-118-accepted", { audit_id: "aud-118-nobefore" });
  expect(response.status).toBe(404);
});

test("MRQ-118: non-content rows appear in the History card but offer no restore", async () => {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id)
     VALUES (?, ?, ?, 'user', 'scheduled', 'submission', ?, NULL, ?, ?, NULL)`,
  ).bind("aud-118-scheduled", EVENT_ID, ORGANIZER_ID, "sub-118-accepted", JSON.stringify({ room_id: ROOM_ID }), now).run();

  const record = await readRecord("sub-118-accepted");
  const scheduled = record.history.find((entry) => entry.action === "scheduled");
  expect(scheduled).toBeDefined();
  expect(scheduled?.restorable).toBe(false);
  expect(scheduled?.actor_name).toBeTruthy();
});

test("MRQ-118: a draft edit still works and now earns a history row too", async () => {
  await insertSubmission("sub-118-draft", "draft");
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/sub-118-draft`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Draft retitled" }),
  });
  expect(response.status).toBe(200);

  const record = await readRecord("sub-118-draft");
  expect(record.title).toBe("Draft retitled");
  const rows = await auditRows("sub-118-draft");
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe("content_updated");
});

import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { purgePublicEmbedCache } from "../../../src/lib/public-site";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const SESSION_ID = "sess-agenda-organizer";
const COOKIE = `mq_session=${SESSION_ID}`;
// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", COOKIE);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'agenda-fixture', NULL, ?, ?)").bind(SESSION_ID, DEMO_ORGANIZER_PERSON_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("building-agenda", DEMO_EVENT_ID, "North Hall", "1 Conference Way", 0, 40.7625, -73.9814, 5, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("room-agenda", DEMO_EVENT_ID, "building-agenda", "Room 101", 120, 0, JSON.stringify(["HDMI", "Recording"]), "Load-in uses the side door.", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("format-agenda", DEMO_EVENT_ID, "Stage Talk", 20, 15, 20, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-agenda", DEMO_EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    ...[
      ["sub-agenda-accepted", "session", "accepted", "Accepted session"],
      ["sub-agenda-waitlisted", "session", "waitlisted", "Maybe session"],
      ["sub-agenda-submitted", "abstract", "submitted", "Submitted abstract"],
      ["sub-agenda-placed", "session", "accepted", "Already placed"],
    ].map(([id, kind, status, title]) => env.DB.prepare(`
      INSERT INTO submissions
        (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 0, ?, 'Agenda fixture', ?, 'format-agenda', 'track-agenda', 'admin', ?, ?, ?, 0, ?, 'marquee', ?, ?)
    `).bind(id, DEMO_EVENT_ID, kind, title, status, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, title.toLowerCase(), NOW, NOW)),
    ...["sub-agenda-accepted", "sub-agenda-waitlisted", "sub-agenda-submitted", "sub-agenda-placed"].flatMap((submissionId) => [
      env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind(`participation-${submissionId}`, submissionId, DEMO_ORGANIZER_PERSON_ID, NOW, NOW),
      env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, 'track-agenda', 1, ?, ?)").bind(`submission-track-${submissionId}`, submissionId, NOW, NOW),
    ]),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 20, 'room-agenda', 'track-agenda', 0, ?, ?)").bind("agenda-already-placed", DEMO_EVENT_ID, "sub-agenda-placed", NOW, NOW, NOW),
  ]);
}

describe.sequential("MRQ-20 agenda API", () => {
  beforeAll(seedFixture, 10_000);

  test("CONTRACT · MRQ-142 · the builder API reports Sessions scheduled outside the conference window", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    expect(response.status).toBe(200);
    const body = await response.json<{ schedule_window: { outside_window_session_count: number }; sessions: Array<{ title: string }> }>();
    expect(body.schedule_window).toEqual({ outside_window_session_count: 1 });
    expect(body.sessions.some((session) => session.title === "Already placed")).toBe(true);
  });

  test("CONTRACT · CNT-12 + AIA-07 show every accepted Session but publish only scheduled ones", async () => {
    const initial = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const initialBody = await initial.json<{ publication: { live: number; not_yet_public: number; candidates: Array<{ submission_id: string; title: string; scheduled: boolean; can_publish: boolean; blocked_reason: string | null; starts_at: number | null; room: string | null; building: string | null; speakers: Array<{ name: string }> }> } }>();
    expect(initialBody.publication).toMatchObject({ live: 0, not_yet_public: 1 });
    const placedCandidate = initialBody.publication.candidates.find((candidate) => candidate.submission_id === "sub-agenda-placed");
    expect(placedCandidate).toMatchObject({ submission_id: "sub-agenda-placed", title: "Already placed", scheduled: true, can_publish: true, room: "Room 101", building: "North Hall" });
    expect(placedCandidate?.speakers[0]?.name).toBe("Demo Organizer");
    expect(initialBody.publication.candidates.find((candidate) => candidate.submission_id === "sub-agenda-accepted")).toMatchObject({
      submission_id: "sub-agenda-accepted",
      title: "Accepted session",
      scheduled: false,
      can_publish: false,
      blocked_reason: "needs a room and time before it can go public",
      starts_at: null,
      room: null,
      building: null,
    });

    await env.DB.prepare("UPDATE submissions SET status = 'withdrawn' WHERE id = ? AND event_id = ?").bind("sub-agenda-placed", DEMO_EVENT_ID).run();
    const withdrawn = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/publish`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: ["sub-agenda-placed"] }),
    });
    expect(withdrawn.status).toBe(409);
    expect(await env.DB.prepare("SELECT is_published FROM agenda_items WHERE submission_id = ?").bind("sub-agenda-placed").first<{ is_published: number }>()).toMatchObject({ is_published: 0 });

    await env.DB.prepare("UPDATE submissions SET status = 'accepted' WHERE id = ? AND event_id = ?").bind("sub-agenda-placed", DEMO_EVENT_ID).run();
    const mixed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/publish`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: ["sub-agenda-placed", "sub-agenda-accepted"] }),
    });
    expect(mixed.status).toBe(409);
    expect(await env.DB.prepare("SELECT is_published FROM agenda_items WHERE submission_id = ?").bind("sub-agenda-placed").first<{ is_published: number }>()).toMatchObject({ is_published: 0 });

    const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/publish`, {
      method: "POST",
      body: JSON.stringify({ submission_ids: ["sub-agenda-placed"] }),
    });
    expect(published.status).toBe(200);
    expect(await published.json<{ published_count: number; live: number; not_yet_public: number; public_agenda_url: string }>()).toMatchObject({
      published_count: 1,
      live: 1,
      not_yet_public: 0,
      public_agenda_url: "/agenda?event=aie-nyc-2026",
    });
    expect(await env.DB.prepare("SELECT is_published FROM submissions WHERE id = ?").bind("sub-agenda-placed").first<{ is_published: number }>()).toMatchObject({ is_published: 1 });
    expect(await env.DB.prepare("SELECT action, entity_type FROM audit_log WHERE entity_id = ? AND action = 'published'").bind("sub-agenda-placed").first<{ action: string; entity_type: string }>()).toMatchObject({ action: "published", entity_type: "submission" });

    const publicResponse = await SELF.fetch(`${ORIGIN}/api/v1/public/agenda?event=aie-nyc-2026`);
    expect(publicResponse.status).toBe(200);
    const publicBody = await publicResponse.json<{ sessions: Array<{ title: string }> }>();
    expect(publicBody.sessions.length).toBeGreaterThan(0);
    expect(publicBody.sessions.some((session) => session.title === "Already placed")).toBe(true);
    expect(publicBody.sessions.some((session) => session.title === "Accepted session")).toBe(false);
  });

  test("CONTRACT · AIA-07 · a published agenda item is not reported as an unpublished candidate", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE submissions SET is_published = 0 WHERE id = ? AND event_id = ?")
        .bind("sub-agenda-placed", DEMO_EVENT_ID),
      env.DB.prepare("UPDATE agenda_items SET is_published = 1 WHERE id = ? AND event_id = ?")
        .bind("agenda-already-placed", DEMO_EVENT_ID),
    ]);
    try {
      const state = await env.DB.prepare(`
        SELECT submission.is_published AS submission_is_published, item.is_published AS agenda_is_published
        FROM submissions submission
        JOIN agenda_items item ON item.submission_id = submission.id AND item.event_id = submission.event_id
        WHERE submission.id = ? AND submission.event_id = ? AND item.kind = 'session'
      `).bind("sub-agenda-placed", DEMO_EVENT_ID).first<{ submission_is_published: number; agenda_is_published: number }>();
      expect(state).toEqual({ submission_is_published: 0, agenda_is_published: 1 });

      const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
      expect(response.status).toBe(200);
      const body = await response.json<{ publication: { live: number; not_yet_public: number; candidates: Array<{ submission_id: string }> } }>();
      expect(body.publication).toMatchObject({ live: 1, not_yet_public: 0 });
      expect(body.publication.candidates.some((candidate) => candidate.submission_id === "sub-agenda-placed")).toBe(false);
      expect(body.publication.candidates.some((candidate) => candidate.submission_id === "sub-agenda-accepted")).toBe(true);

      const publicResponse = await SELF.fetch(`${ORIGIN}/api/v1/public/agenda?event=aie-nyc-2026`);
      expect(publicResponse.status).toBe(200);
      const publicBody = await publicResponse.json<{ sessions: Array<{ title: string }> }>();
      expect(publicBody.sessions.some((session) => session.title === "Already placed")).toBe(true);

      await env.DB.batch([
        env.DB.prepare("UPDATE agenda_items SET is_published = 0 WHERE id = ? AND event_id = ?")
          .bind("agenda-already-placed", DEMO_EVENT_ID),
        env.DB.prepare("UPDATE submissions SET is_published = 1 WHERE id = ? AND event_id = ?")
          .bind("sub-agenda-placed", DEMO_EVENT_ID),
      ]);
      const recovered = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
      const recoveredBody = await recovered.json<{ publication: { candidates: Array<{ submission_id: string; scheduled: boolean; can_publish: boolean }> } }>();
      expect(recoveredBody.publication.candidates.find((candidate) => candidate.submission_id === "sub-agenda-placed")).toMatchObject({
        submission_id: "sub-agenda-placed",
        scheduled: true,
        can_publish: true,
      });
      const republished = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/publish`, {
        method: "POST",
        body: JSON.stringify({ submission_ids: ["sub-agenda-placed"] }),
      });
      expect(republished.status).toBe(200);
    } finally {
      await env.DB.batch([
        env.DB.prepare("UPDATE agenda_items SET is_published = 0 WHERE id = ? AND event_id = ?")
          .bind("agenda-already-placed", DEMO_EVENT_ID),
        env.DB.prepare("UPDATE submissions SET is_published = 1 WHERE id = ? AND event_id = ?")
          .bind("sub-agenda-placed", DEMO_EVENT_ID),
      ]);
    }
  });

  test("CONTRACT · MRQ-179 · accepted abstracts are not publication candidates", async () => {
    const before = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const beforeBody = await before.json<{ publication: { candidates: Array<{ submission_id: string }> } }>();
    expect(beforeBody.publication.candidates.some((candidate) => candidate.submission_id === "sub-agenda-accepted")).toBe(true);

    await env.DB.prepare("UPDATE submissions SET status = 'accepted' WHERE id = ? AND event_id = ?").bind("sub-agenda-submitted", DEMO_EVENT_ID).run();
    try {
      const after = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
      const afterBody = await after.json<{ publication: { candidates: Array<{ submission_id: string }> } }>();
      expect(afterBody.publication.candidates).toHaveLength(beforeBody.publication.candidates.length);
      expect(afterBody.publication.candidates.some((candidate) => candidate.submission_id === "sub-agenda-accepted")).toBe(true);
      expect(afterBody.publication.candidates.some((candidate) => candidate.submission_id === "sub-agenda-submitted")).toBe(false);
    } finally {
      await env.DB.prepare("UPDATE submissions SET status = 'submitted' WHERE id = ? AND event_id = ?").bind("sub-agenda-submitted", DEMO_EVENT_ID).run();
    }
  });

  test("AC-70 · GET derives the unscheduled pool from accepted and unplaced submissions", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    expect(response.status).toBe(200);
    const body = await response.json<{ unscheduled: Array<{ submission_id: string }>; rooms: Array<{ label: string }>; venue: { pinned_building_count: number; primary_building_name: string | null } }>();
    expect(body.unscheduled.map((item) => item.submission_id)).toEqual(["sub-agenda-accepted"]);
    expect(body.rooms[0]?.label).toBe("Room 101 · North Hall");
    expect(body.venue).toEqual({ pinned_building_count: 1, primary_building_name: "North Hall" });
  });

  test("AC-71 · PUT changes the qualifying statuses and the next read honors them", async () => {
    const update = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/settings`, {
      method: "PUT",
      body: JSON.stringify({ schedulable_statuses: ["accepted", "waitlisted"] }),
    });
    expect(update.status).toBe(200);
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const body = await response.json<{ schedulable_statuses: string[]; unscheduled: Array<{ submission_id: string }> }>();
    expect(body.schedulable_statuses).toEqual(["accepted", "waitlisted"]);
    expect(new Set(body.unscheduled.map((item) => item.submission_id))).toEqual(new Set(["sub-agenda-waitlisted", "sub-agenda-accepted"]));
  });

  test("AC-72 · pool records carry the source title, speaker, format, and track", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const body = await response.json<{ unscheduled: Array<{ title: string; format: string; speakers: Array<{ name: string }>; tracks: Array<{ name: string }> }> }>();
    const item = body.unscheduled.find((candidate) => candidate.title === "Accepted session");
    expect(item).toMatchObject({ format: "Stage Talk", speakers: [{ name: "Demo Organizer" }], tracks: [{ name: "Agents" }] });
  });

  test("AC-73 · POST places a pool item immediately and DELETE returns it to the pool", async () => {
    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: "sub-agenda-accepted", starts_at: NOW + 3_600_000, room_id: "room-agenda" }),
    });
    expect(placed.status).toBe(201);
    const placedBody = await placed.json<{ id: string; etag: string; duration_min: number }>();
    expect(placedBody.duration_min).toBe(20);

    const deleted = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items/${placedBody.id}`, { method: "DELETE", headers: { "If-Match": placedBody.etag } });
    expect(deleted.status).toBe(204);
    const agenda = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const body = await agenda.json<{ unscheduled: Array<{ submission_id: string }> }>();
    expect(body.unscheduled.some((item) => item.submission_id === "sub-agenda-accepted")).toBe(true);
  });

  test("AC-74 · PATCH persists room/time/resize and rejects a stale placement", async () => {
    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: "sub-agenda-accepted", starts_at: NOW, room_id: "room-agenda" }),
    });
    const created = await placed.json<{ id: string; etag: string }>();
    const update = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": created.etag },
      body: JSON.stringify({ starts_at: NOW + 7_200_000, duration_min: 15 }),
    });
    expect(update.status).toBe(200);
    const updated = await update.json<{ etag: string; starts_at: number; duration_min: number }>();
    expect(updated).toMatchObject({ starts_at: NOW + 7_200_000, duration_min: 15 });

    const firstAudit = await env.DB.prepare(`
      SELECT before_json, after_json
      FROM audit_log
      WHERE event_id = ? AND action = 'agenda_item_updated' AND entity_id = ?
      ORDER BY created_at ASC, id ASC
    `).bind(DEMO_EVENT_ID, created.id).first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(firstAudit!.before_json)).toEqual({
      starts_at: NOW,
      duration_min: 20,
      room_id: "room-agenda",
      track_id: "track-agenda",
    });
    expect(JSON.parse(firstAudit!.after_json)).toEqual({
      starts_at: NOW + 7_200_000,
      duration_min: 15,
      room_id: "room-agenda",
      track_id: "track-agenda",
    });

    const noOp = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": updated.etag },
      body: JSON.stringify({}),
    });
    expect(noOp.status).toBe(200);
    const auditCountAfterNoOp = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE event_id = ? AND action = 'agenda_item_updated' AND entity_id = ?",
    ).bind(DEMO_EVENT_ID, created.id).first<{ count: number }>();
    expect(Number(auditCountAfterNoOp?.count ?? 0)).toBe(2);

    const stale = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": created.etag },
      body: JSON.stringify({ duration_min: 20 }),
    });
    expect(stale.status).toBe(409);
    const auditCountAfterStale = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE event_id = ? AND action = 'agenda_item_updated' AND entity_id = ?",
    ).bind(DEMO_EVENT_ID, created.id).first<{ count: number }>();
    expect(Number(auditCountAfterStale?.count ?? 0)).toBe(2);
  });

  test("AC-252 · agenda room metadata renders Room · Building", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const body = await response.json<{ rooms: Array<{ label: string; building: { address: string } }> }>();
    expect(body.rooms[0]).toMatchObject({ label: "Room 101 · North Hall", building: { address: "1 Conference Way" } });
  });

  test("AC-253 · AV tags and notes are present in the private room projection", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    const body = await response.json<{ rooms: Array<{ av_capabilities: string[]; notes: string }> }>();
    expect(body.rooms[0]).toMatchObject({ av_capabilities: ["HDMI", "Recording"], notes: "Load-in uses the side door." });
  });

  test("AC-75 + AC-79 · a conflicting placement persists and remains warning-only", async () => {
    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: "sub-agenda-waitlisted", starts_at: NOW, room_id: "room-agenda" }),
    });
    expect(placed.status).toBe(201);

    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    expect(response.status).toBe(200);
    const body = await response.json<{ sessions: Array<{ submission_id: string }>; conflicts: Array<{ kind: string }> }>();
    expect(body.sessions.some((session) => session.submission_id === "sub-agenda-waitlisted")).toBe(true);
    expect(body.conflicts.some((conflict) => conflict.kind === "room")).toBe(true);
  });

  test("AC-89 · bulk agenda publish purges cached embeds before the KV TTL", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE submissions SET status = 'accepted', is_published = 0 WHERE id = ? AND event_id = ?")
        .bind("sub-agenda-placed", DEMO_EVENT_ID),
      env.DB.prepare("UPDATE agenda_items SET is_published = 0 WHERE id = ? AND event_id = ?")
        .bind("agenda-already-placed", DEMO_EVENT_ID),
    ]);
    await purgePublicEmbedCache(env.CACHE, { eventId: DEMO_EVENT_ID });

    try {
      const before = await SELF.fetch(`${ORIGIN}/api/v1/public/embeds/aie-nyc-2026-agenda?event=aie-nyc-2026`);
      expect(before.status).toBe(200);
      const beforeBody = await before.json<{ sessions: Array<{ title: string }> }>();
      expect(beforeBody.sessions.some((session) => session.title === "Already placed")).toBe(false);

      const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/publish`, {
        method: "POST",
        body: JSON.stringify({ submission_ids: ["sub-agenda-placed"] }),
      });
      expect(published.status).toBe(200);

      const after = await SELF.fetch(`${ORIGIN}/api/v1/public/embeds/aie-nyc-2026-agenda?event=aie-nyc-2026`);
      expect(after.status).toBe(200);
      const afterBody = await after.json<{ sessions: Array<{ title: string }> }>();
      expect(afterBody.sessions.some((session) => session.title === "Already placed")).toBe(true);
    } finally {
      await env.DB.batch([
        env.DB.prepare("UPDATE submissions SET status = 'accepted', is_published = 0 WHERE id = ? AND event_id = ?")
          .bind("sub-agenda-placed", DEMO_EVENT_ID),
        env.DB.prepare("UPDATE agenda_items SET is_published = 0 WHERE id = ? AND event_id = ?")
          .bind("agenda-already-placed", DEMO_EVENT_ID),
      ]);
      await purgePublicEmbedCache(env.CACHE, { eventId: DEMO_EVENT_ID });
    }
  });
});

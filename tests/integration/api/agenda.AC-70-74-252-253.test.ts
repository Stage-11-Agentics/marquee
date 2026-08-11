import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.example";
const SESSION_ID = "sess-agenda-organizer";
const COOKIE = `mq_session=${SESSION_ID}`;
const NOW = Date.UTC(2026, 9, 12, 13);

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
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'agenda-fixture', NULL, ?, ?)").bind(SESSION_ID, DEMO_ORGANIZER_PERSON_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("building-agenda", DEMO_EVENT_ID, "North Hall", "1 Conference Way", 0, 40.7625, -73.9814, 5, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("room-agenda", DEMO_EVENT_ID, "building-agenda", "Room 101", 120, 0, JSON.stringify(["HDMI", "Recording"]), "Load-in uses the side door.", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("format-agenda", DEMO_EVENT_ID, "Stage Talk", 20, 15, 20, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-agenda", DEMO_EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    ...[
      ["sub-agenda-accepted", "accepted", "Accepted session"],
      ["sub-agenda-waitlisted", "waitlisted", "Maybe session"],
      ["sub-agenda-submitted", "submitted", "Submitted abstract"],
      ["sub-agenda-placed", "accepted", "Already placed"],
    ].map(([id, status, title]) => env.DB.prepare(`
      INSERT INTO submissions
        (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, NULL, 'abstract', 0, ?, 'Agenda fixture', ?, 'format-agenda', 'track-agenda', 'admin', ?, ?, ?, 0, ?, 'marquee', ?, ?)
    `).bind(id, DEMO_EVENT_ID, title, status, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, title.toLowerCase(), NOW, NOW)),
    ...["sub-agenda-accepted", "sub-agenda-waitlisted", "sub-agenda-submitted", "sub-agenda-placed"].flatMap((submissionId) => [
      env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind(`participation-${submissionId}`, submissionId, DEMO_ORGANIZER_PERSON_ID, NOW, NOW),
      env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, 'track-agenda', 1, ?, ?)").bind(`submission-track-${submissionId}`, submissionId, NOW, NOW),
    ]),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 20, 'room-agenda', 'track-agenda', 0, ?, ?)").bind("agenda-already-placed", DEMO_EVENT_ID, "sub-agenda-placed", NOW, NOW, NOW),
  ]);
}

describe.sequential("MRQ-20 agenda API", () => {
  beforeAll(seedFixture, 10_000);

  test("AC-70 · GET derives the unscheduled pool from accepted and unplaced submissions", async () => {
    const response = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    expect(response.status).toBe(200);
    const body = await response.json<{ unscheduled: Array<{ submission_id: string }>; rooms: Array<{ label: string }> }>();
    expect(body.unscheduled.map((item) => item.submission_id)).toEqual(["sub-agenda-accepted"]);
    expect(body.rooms[0]?.label).toBe("Room 101 · North Hall");
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
    const stale = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": created.etag },
      body: JSON.stringify({ duration_min: 20 }),
    });
    expect(stale.status).toBe(409);
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
});

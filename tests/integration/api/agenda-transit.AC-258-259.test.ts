import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.example";
const SESSION_ID = "sess-agenda-transit-organizer";
const COOKIE = `mq_session=${SESSION_ID}`;
const NOW = Date.UTC(2026, 9, 19, 13);

interface AgendaConflict {
  kind: string;
  label?: string;
  message: string;
  session_ids: [string, string];
  person_id?: string;
}

interface AgendaSnapshot {
  sessions: Array<{ id: string }>;
  conflicts: AgendaConflict[];
}

interface DashboardSnapshot {
  metrics: Array<{ id: string; label: string; count: number; href: string; note: string }>;
}

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
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'agenda-transit-fixture', NULL, ?, ?)").bind(SESSION_ID, DEMO_ORGANIZER_PERSON_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("building-sheraton", DEMO_EVENT_ID, "Sheraton New York Times Square", "7th Avenue", 0, 40.7625188, -73.9814528, 0, "Main entrance", NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("building-marriott", DEMO_EVENT_ID, "New York Marriott Marquis", "Broadway", 1, 40.7585971, -73.9861935, 3, "Use the Broadway lobby", NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("room-sheraton", DEMO_EVENT_ID, "building-sheraton", "Metropolitan Ballroom", 300, 0, JSON.stringify(["HDMI"]), null, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("room-marriott", DEMO_EVENT_ID, "building-marriott", "Marquis Room A", 200, 0, JSON.stringify(["HDMI"]), null, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("format-transit", DEMO_EVENT_ID, "Stage Talk", 45, 15, 60, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-transit", DEMO_EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    ...[
      ["sub-transit-first", "Transit origin"],
      ["sub-transit-second", "Transit destination"],
      ["sub-transit-placement", "Placement remains legal"],
    ].map(([id, title]) => env.DB.prepare(`
      INSERT INTO submissions
        (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, NULL, 'abstract', 0, ?, 'Transit fixture', 'accepted', 'format-transit', 'track-transit', 'admin', ?, ?, ?, 0, ?, 'marquee', ?, ?)
    `).bind(id, DEMO_EVENT_ID, title, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, title.toLowerCase(), NOW, NOW)),
    ...["sub-transit-first", "sub-transit-second", "sub-transit-placement"].flatMap((submissionId) => [
      env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind(`participation-${submissionId}`, submissionId, DEMO_ORGANIZER_PERSON_ID, NOW, NOW),
      env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, 'track-transit', 1, ?, ?)").bind(`submission-track-${submissionId}`, submissionId, NOW, NOW),
    ]),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 45, ?, 'track-transit', 0, ?, ?)").bind("agenda-transit-first", DEMO_EVENT_ID, "sub-transit-first", NOW, "room-sheraton", NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 45, ?, 'track-transit', 0, ?, ?)").bind("agenda-transit-second", DEMO_EVENT_ID, "sub-transit-second", NOW + 30 * 60_000, "room-marriott", NOW, NOW),
  ]);
}

describe.sequential("MRQ-63 transit surfacing", () => {
  beforeAll(seedFixture, 10_000);

  test("AC-258 + AC-259 · the seeded Transit conflict reaches the agenda API and dashboard while placement remains warning-only", async () => {
    const agendaResponse = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`);
    expect(agendaResponse.status).toBe(200);
    const agenda = await agendaResponse.json<AgendaSnapshot>();
    const transit = agenda.conflicts.find((conflict) => conflict.kind === "transit");
    expect(transit).toMatchObject({
      kind: "transit",
      label: "Transit",
      message: "Transit — 9 min walk to New York Marriott Marquis, plus 3 min building access. Needs 12 min; has 0.",
      session_ids: ["agenda-transit-first", "agenda-transit-second"],
    });
    expect(agenda.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "person",
        session_ids: ["agenda-transit-first", "agenda-transit-second"],
      }),
    ]));
    expect(new Set(transit?.session_ids)).toEqual(new Set(["agenda-transit-first", "agenda-transit-second"]));
    expect(JSON.stringify(agenda)).not.toContain("Travel");

    const dashboardResponse = await request(`/api/v1/events/${DEMO_EVENT_ID}/dashboard`);
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json<DashboardSnapshot>();
    expect(dashboard.metrics.find((metric) => metric.id === "conflicts")).toMatchObject({
      label: "Conflicts",
      count: agenda.conflicts.length,
      href: "/agenda-builder",
    });

    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: "sub-transit-placement", starts_at: NOW + 90 * 60_000, room_id: "room-marriott" }),
    });
    expect(placed.status).toBe(201);
  });
});

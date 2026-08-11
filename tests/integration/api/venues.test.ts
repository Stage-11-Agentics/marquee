import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = "evt_venue_api";
const SESSION_ID = "session_venue_api";
const COOKIE = `mq_session=${SESSION_ID}`;

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("org_venue_api", "Venue API", "venue-api", now, now).run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
  ).bind(EVENT_ID, "org_venue_api", "Venue API Conference", "venue-api", "", "2026-10-12", "2026-10-14", "America/New_York", "Sheraton", now, now).run();
  await env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
  ).bind("person_venue_api", "org_venue_api", "venue-api@example.com", "Venue Operator", now, now).run();
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)",
  ).bind("membership_venue_api", "org_venue_api", EVENT_ID, "person_venue_api", now, now).run();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
     VALUES (?, ?, 'program_lead', ?, 'venue-api-test', NULL, ?, ?)`,
  ).bind(SESSION_ID, "person_venue_api", now + 3_600_000, now, now).run();
  await env.DB.prepare(
    `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
     VALUES ('building_api_main', ?, 'Sheraton New York Times Square', '811 7th Ave, New York, NY 10019', 0, 40.7625188, -73.9814528, 0, 'Main entrance', ?, ?)`,
  ).bind(EVENT_ID, now, now).run();
  await env.DB.prepare(
    `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
     VALUES ('room_api_main', ?, 'building_api_main', 'Metropolitan Ballroom', 2500, 0, '["Projector"]', 'Stage notes', ?, ?)`,
  ).bind(EVENT_ID, now, now).run();
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("AC-255 · venue GET preserves nullable coordinates and access notes", async () => {
  const response = await app.request(`/api/v1/events/${EVENT_ID}/venues`, { headers: { cookie: COOKIE } }, env);
  expect(response.status).toBe(200);
  const body = await response.json<{ buildings: Array<{ access_note: string | null; lat: number | null }>; rooms: Array<{ av_capabilities: string[] }> }>();
  expect(body.buildings[0]).toMatchObject({ access_note: "Main entrance", lat: 40.7625188 });
  expect(body.rooms[0]?.av_capabilities).toEqual(["Projector"]);
});

test("AC-256 · one venue save persists building and room create/edit/remove as one model", async () => {
  const response = await app.request(`/api/v1/events/${EVENT_ID}/venues`, {
    method: "PUT",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({
      buildings: [
        { id: "building_api_main", name: "Sheraton updated", address: "811 7th Ave, New York, NY 10019", position: 0, lat: 40.7625188, lng: -73.9814528, access_minutes: 1, access_note: "Use the main entrance" },
        { id: "building_api_new", name: "New York Marriott Marquis", address: "1535 Broadway, New York, NY 10036", position: 1, lat: 40.7585971, lng: -73.9861935, access_minutes: 3, access_note: null },
      ],
      rooms: [
        { id: "room_api_new", building_id: "building_api_new", name: "Marquis Room A", capacity: 60, position: 0, av_capabilities: ["Projector", "Mics"], notes: "Room-specific note" },
      ],
    }),
  }, env);
  expect(response.status).toBe(200);
  const saved = await response.json<{ buildings: Array<{ id: string }>; rooms: Array<{ id: string; building_id: string }> }>();
  expect(saved.buildings.map((building) => building.id)).toEqual(["building_api_main", "building_api_new"]);
  expect(saved.rooms).toEqual([{ id: "room_api_new", building_id: "building_api_new", name: "Marquis Room A", capacity: 60, position: 0, av_capabilities: ["Projector", "Mics"], notes: "Room-specific note" }]);

  const reloaded = await app.request(`/api/v1/events/${EVENT_ID}/venues`, { headers: { cookie: COOKIE } }, env);
  expect((await reloaded.json<{ buildings: Array<{ name: string }>; rooms: Array<{ id: string }> }>())).toMatchObject({ buildings: [{ name: "Sheraton updated" }, { name: "New York Marriott Marquis" }], rooms: [{ id: "room_api_new" }] });
});

test("AC-256 · venue routes fail closed without an authenticated program reader", async () => {
  const response = await app.request(`/api/v1/events/${EVENT_ID}/venues`, {}, env);
  expect(response.status).toBe(401);
});

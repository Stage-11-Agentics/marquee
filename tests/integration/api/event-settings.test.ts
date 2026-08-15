import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_settings_api";
const SESSION_ID = "session_settings_api";
const COOKIE = `mq_session=${SESSION_ID}`;

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind("org_settings_api", "Settings API", "settings-api", now, now).run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
  ).bind(EVENT_ID, "org_settings_api", "Conference settings fixture", "settings-api", "A coherent fixture", "2026-10-12", "2026-10-14", "America/New_York", "Sheraton New York Times Square", now, now).run();
  await env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
  ).bind("person_settings_api", "org_settings_api", "settings@example.com", "Settings Operator", now, now).run();
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)",
  ).bind("membership_settings_api", "org_settings_api", EVENT_ID, "person_settings_api", now, now).run();
  // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
     VALUES (?, ?, 'program_lead', ?, 'settings-test', NULL, ?, ?)`,
  ).bind(SESSION_ID, "person_settings_api", now + 3_600_000, now, now).run();
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie: COOKIE, ...(init?.headers ?? {}) } }, env);
}

test("AC-5 + AC-6 · conference details and timezone persist through the settings writer", async () => {
  const saved = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "AI Engineer New York 2026",
      starts_on: "2026-10-13",
      ends_on: "2026-10-15",
      timezone: "Europe/London",
      venue: "Sheraton New York Times Square",
      logo_key: "events/aie/logo.webp",
    }),
  });
  expect(saved.status).toBe(200);
  const body = await saved.json<{ data: { event: Record<string, unknown> } }>();
  expect(body.data.event).toMatchObject({ name: "AI Engineer New York 2026", starts_on: "2026-10-13", ends_on: "2026-10-15", timezone: "Europe/London", logo_key: "events/aie/logo.webp" });

  const reloaded = await request(`/api/v1/events/${EVENT_ID}`);
  expect((await reloaded.json<{ data: { event: Record<string, unknown> } }>()).data.event.timezone).toBe("Europe/London");
});

test("CONTRACT · MRQ-142 · settings reports the count of scheduled Sessions outside the saved date window", async () => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?)").bind("building_settings_window", EVENT_ID, "Settings Hall", "1 Conference Way", now, now),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 20, 0, '[]', NULL, ?, ?)").bind("room_settings_window", EVENT_ID, "building_settings_window", "Room 1", now, now),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)").bind("submission_settings_window", EVENT_ID, "Outside the window", "person_settings_api", now, now),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)").bind("agenda_settings_window", EVENT_ID, "submission_settings_window", Date.UTC(2026, 9, 16, 14), "room_settings_window", now, now),
  ]);

  const response = await request(`/api/v1/events/${EVENT_ID}`);
  expect(response.status).toBe(200);
  const body = await response.json<{ data: { schedule_window: { outside_window_session_count: number } } }>();
  expect(body.data.schedule_window).toEqual({ outside_window_session_count: 1 });
});

test("AC-8 + AC-9 · a format stores its range and default independently for downstream session consumers", async () => {
  const created = await request(`/api/v1/events/${EVENT_ID}/formats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Workshop", min_duration_min: 60, default_duration_min: 90, max_duration_min: 120, position: 0 }),
  });
  expect(created.status).toBe(201);
  const createdFormat = (await created.json<{ data: { id: string; default_duration_min: number } }>()).data;
  expect(createdFormat.default_duration_min).toBe(90);

  const updated = await request(`/api/v1/events/${EVENT_ID}/formats/${createdFormat.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ min_duration_min: 75, max_duration_min: 150 }),
  });
  expect(updated.status).toBe(200);
  expect((await updated.json<{ data: { min_duration_min: number; default_duration_min: number; max_duration_min: number } }>()).data).toMatchObject({ min_duration_min: 75, default_duration_min: 90, max_duration_min: 150 });
});

test("AC-10 · formats are returned as an ordered list for form selection and filtering", async () => {
  await request(`/api/v1/events/${EVENT_ID}/formats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Stage Talk", min_duration_min: 15, default_duration_min: 20, max_duration_min: 30, position: 0 }),
  });
  const response = await request(`/api/v1/events/${EVENT_ID}/formats`);
  expect(response.status).toBe(200);
  expect((await response.json<{ data: Array<{ name: string; position: number }> }>()).data).toEqual([expect.objectContaining({ name: "Stage Talk", position: 0 })]);
});

test("AC-11 + AC-12 · tracks can be renamed, recolored, reordered, and read in stable order", async () => {
  const first = await request(`/api/v1/events/${EVENT_ID}/tracks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Agents", color: "#7C5CFC", position: 0 }),
  });
  const second = await request(`/api/v1/events/${EVENT_ID}/tracks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Evals", color: "#2AA198", position: 1 }),
  });
  const firstId = (await first.json<{ data: { id: string } }>()).data.id;
  const secondId = (await second.json<{ data: { id: string } }>()).data.id;
  const updated = await request(`/api/v1/events/${EVENT_ID}/tracks/${firstId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Agents & infra", color: "#D97757", position: 1 }),
  });
  expect(updated.status).toBe(200);
  const tracks = await request(`/api/v1/events/${EVENT_ID}/tracks`);
  expect((await tracks.json<{ data: Array<{ id: string; name: string; color: string; position: number }> }>()).data).toEqual([
    { id: secondId, event_id: EVENT_ID, name: "Evals", color: "#2AA198", position: 0, created_at: expect.any(Number), updated_at: expect.any(Number) },
    { id: firstId, event_id: EVENT_ID, name: "Agents & infra", color: "#D97757", position: 1, created_at: expect.any(Number), updated_at: expect.any(Number) },
  ]);
});

test("AC-13 · settings hands venue capacity and room authoring to the Venues surface", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}`);
  expect(response.status).toBe(200);
  const body = await response.json<{ data: { event: { name: string }; formats: unknown[]; tracks: unknown[] } }>();
  expect(body.data).toMatchObject({ event: { name: "Conference settings fixture" } });
  expect(body.data).not.toHaveProperty("buildings");
  expect(body.data).not.toHaveProperty("rooms");
});

/**
 * Which social profiles a conference asks its speakers for is a conference
 * setting, so it rides the settings endpoint rather than a route of its own.
 * The unset case is the one worth pinning: a conference that never opens the
 * screen has to get every shipped platform, not an empty speaker form.
 */
test("CONTRACT · a conference that has never touched the setting is asked for every shipped platform", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}`);
  expect(response.status).toBe(200);
  const body = await response.json<{ data: { speaker_social_platforms: string[] } }>();
  expect(body.data.speaker_social_platforms).toEqual(["x", "linkedin"]);
});

test("CONTRACT · turning a platform off persists, and turning them all off is a real choice", async () => {
  const saved = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker_social_platforms: ["x"] }),
  });
  expect(saved.status).toBe(200);
  expect((await saved.json<{ data: { speaker_social_platforms: string[] } }>()).data.speaker_social_platforms).toEqual(["x"]);

  const emptied = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker_social_platforms: [] }),
  });
  // An empty array must survive the read, or "we collect none" would silently
  // read back as "we collect every one".
  expect((await emptied.json<{ data: { speaker_social_platforms: string[] } }>()).data.speaker_social_platforms).toEqual([]);
});

test("CONTRACT · omitting the field leaves the conference's existing choice alone", async () => {
  await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker_social_platforms: ["linkedin"] }),
  });
  const renamed = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "A rename that says nothing about social profiles" }),
  });
  expect((await renamed.json<{ data: { speaker_social_platforms: string[] } }>()).data.speaker_social_platforms).toEqual(["linkedin"]);
});

test("CONTRACT · an unknown platform id is refused rather than stored", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker_social_platforms: ["myspace"] }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
});

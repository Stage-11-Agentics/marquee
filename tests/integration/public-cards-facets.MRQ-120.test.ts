import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import {
  loadPublicAgenda,
  publicEmbedCacheKey,
} from "../../src/lib/public-site";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_mrq120_cards";
const EVENT_SLUG = "cards-conf";
const LONG_ABSTRACT_TAIL = "PRIVATE ABSTRACT TAIL SHOULD NOT SHIP";
const LONG_ABSTRACT = `${Array.from({ length: 120 }, (_, index) => `A conference detail sentence ${index}.`).join(" ")} ${LONG_ABSTRACT_TAIL}`;

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function request(path: string): Promise<Response> {
  return app.request(path, {}, runtimeEnv());
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("org_mrq120_cards", "Cards Conference", "cards-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "org_mrq120_cards", "Cards Conference 2026", EVENT_SLUG, "A published program", "2026-10-12", "2026-10-13", "America/New_York", "Cards Hall", "#db4c3f", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-stage", EVENT_ID, "Stage", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-workshop", EVENT_ID, "Workshops", "#0b6a72", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 45, 30, 60, ?, ?, ?)")
      .bind("format-stage", EVENT_ID, "Stage Talk", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 60, 45, 90, ?, ?, ?)")
      .bind("format-workshop", EVENT_ID, "Workshop", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("building-cards", EVENT_ID, "Cards Hall", "1 Conference Way", NOW, NOW),
    env.DB.prepare(`INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, 100, ?, ?, ?)`)
      .bind("room-stage", EVENT_ID, "building-cards", "Main Stage", 0, NOW, NOW),
    env.DB.prepare(`INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, 80, ?, ?, ?)`)
      .bind("room-workshop", EVENT_ID, "building-cards", "Workshop Room", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-stage", "org_mrq120_cards", "stage@example.com", "Stage Speaker", "Principal Engineer", "Card Co", "Stage biography", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-workshop", "org_mrq120_cards", "workshop@example.com", "Workshop Speaker", "Staff Engineer", "Workshop Co", "Workshop biography", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-stage", EVENT_ID, "Stage session", LONG_ABSTRACT, "format-stage", "track-stage", "person-stage", "Stage session Stage Speaker Card Co", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-workshop", EVENT_ID, "Workshop session", "A short workshop description.", "format-workshop", "track-workshop", "person-workshop", "Workshop session Workshop Speaker Workshop Co", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-stage", "sub-stage", "track-stage", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-workshop", "sub-workshop", "track-workshop", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-stage", "sub-stage", "person-stage", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-workshop", "sub-workshop", "person-workshop", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-stage", EVENT_ID, "sub-stage", Date.UTC(2026, 9, 12, 14), "room-stage", "track-stage", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 60, ?, ?, 1, ?, ?)`)
      .bind("agenda-workshop", EVENT_ID, "sub-workshop", Date.UTC(2026, 9, 13, 15), "room-workshop", "track-workshop", NOW, NOW),
  ]);
});

test("AC-83 · public agenda cards expose bounded descriptions, speaker credits, formats, rooms, and stable hooks", async () => {
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain("Stage session");
  expect(body).toContain("Workshop session");
  expect(body).toContain("Principal Engineer, Card Co");
  expect(body).toContain("Staff Engineer, Workshop Co");
  expect(body).toContain("Stage Talk");
  expect(body).toContain("Workshop");
  expect(body).toContain("Main Stage");
  expect(body).toContain("Workshop Room");
  expect(body).toContain("Show more");
  expect(body).toContain('data-public-session-id="sub-stage"');
  expect(body).toContain('data-public-session-slug="stage-session"');
  expect(body).toContain('data-public-session-start="1791813600000"');
  expect(body).toContain('data-public-session-day="2026-10-12"');
  expect(body).toContain('class="public-day-head"');
  expect(body).toContain('class="public-slot-head">10:00</h3>');
  expect(body).toContain('class="public-slot-head">11:00</h3>');
  expect(body).not.toContain(LONG_ABSTRACT_TAIL);
});

test("AC-85 · format and room facets narrow the public agenda and preserve an honest empty state", async () => {
  const byFormat = await request(`/agenda?event=${EVENT_SLUG}&format=format-workshop`);
  const byFormatBody = await byFormat.text();
  expect(byFormat.status).toBe(200);
  expect(byFormatBody).toContain("Workshop session");
  expect(byFormatBody).not.toContain("Stage session");

  const byFormatName = await request(`/agenda?event=${EVENT_SLUG}&format=Workshop`);
  expect((await byFormatName.text())).toContain("Workshop session");

  const byRoom = await request(`/api/v1/public/agenda?event=${EVENT_SLUG}&room=room-stage`);
  const byRoomPayload = await byRoom.json<{ sessions: Array<{ id: string }> }>();
  expect(byRoom.status).toBe(200);
  expect(byRoomPayload.sessions.map((session) => session.id)).toEqual(["sub-stage"]);

  const combinedEmpty = await request(`/agenda?event=${EVENT_SLUG}&format=format-stage&room=room-workshop`);
  const combinedEmptyBody = await combinedEmpty.text();
  expect(combinedEmpty.status).toBe(200);
  expect(combinedEmptyBody).toContain("No published sessions match");
  expect(combinedEmptyBody).not.toContain("Stage session");
  expect(combinedEmptyBody).not.toContain("Workshop session");
});

test("AC-89 · rendered session embeds carry the public card fields and cache every facet variant", async () => {
  const response = await request(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}&format=format-stage&room=room-stage`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain('<section class="embed-flat-list"');
  expect(body).toContain("Stage session");
  expect(body).not.toContain("Workshop session");
  expect(body).toContain("Main Stage");
  expect(body).toContain("Principal Engineer");
  expect(body).toContain("Stage Talk");
  expect(body).toContain('data-public-session-id="sub-stage"');

  const formatKey = publicEmbedCacheKey(EVENT_ID, `${EVENT_SLUG}-sessions`, { format: "format-stage" });
  const roomKey = publicEmbedCacheKey(EVENT_ID, `${EVENT_SLUG}-sessions`, { room: "room-stage" });
  expect(formatKey).not.toBe(roomKey);
  expect(formatKey).toContain("format-stage");
  expect(roomKey).toContain("room-stage");
});

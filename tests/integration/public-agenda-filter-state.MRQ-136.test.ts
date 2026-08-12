import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { applyMigrations, env } from "./apply-migrations";

/**
 * MRQ-136 — the public agenda's controls have to describe the view a shared
 * link actually produced. Every facet accepts an id or a display name, so a
 * link carrying `?track=Workshops` narrows the list; before this the select
 * still read "All tracks" and the day tabs sat unhighlighted, telling anyone
 * arriving on that link they were looking at the whole program.
 */

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_mrq136_state";
const EVENT_SLUG = "filter-state-conf";

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function body(path: string): Promise<string> {
  const response = await app.request(path, {}, runtimeEnv());
  expect(response.status).toBe(200);
  return response.text();
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("org_mrq136", "Filter State Conference", "filter-state-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "org_mrq136", "Filter State 2026", EVENT_SLUG, "A published program", "2026-10-12", "2026-10-13", "America/New_York", "State Hall", "#0b6a72", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-stage", EVENT_ID, "Stage", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-workshop", EVENT_ID, "Workshops", "#0b6a72", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 45, 30, 60, ?, ?, ?)")
      .bind("format-stage", EVENT_ID, "Stage Talk", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 60, 45, 90, ?, ?, ?)")
      .bind("format-workshop", EVENT_ID, "Workshop", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("building-state", EVENT_ID, "State Hall", "1 Conference Way", NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 100, ?, ?, ?)")
      .bind("room-stage", EVENT_ID, "building-state", "Main Stage", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 80, ?, ?, ?)")
      .bind("room-workshop", EVENT_ID, "building-state", "Workshop Room", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-stage", "org_mrq136", "stage@example.com", "Stage Speaker", "Principal Engineer", "State Co", "Stage biography", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-workshop", "org_mrq136", "workshop@example.com", "Workshop Speaker", "Staff Engineer", "Workshop Co", "Workshop biography", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-stage", EVENT_ID, "Stage session", "A short stage description.", "format-stage", "track-stage", "person-stage", "Stage session Stage Speaker State Co", NOW, NOW),
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

test("CONTRACT · MRQ-136 a name-form track link renders the agenda's track select on that track", async () => {
  const byName = await body(`/agenda?event=${EVENT_SLUG}&track=Workshops`);
  expect(byName).toContain("Workshop session");
  expect(byName).not.toContain("Stage session");
  expect(byName).toContain('<option selected value="track-workshop">Workshops</option>');
  expect(byName).not.toContain("<option selected value>All tracks</option>");

  const byId = await body(`/agenda?event=${EVENT_SLUG}&track=track-workshop`);
  expect(byId).toContain('<option selected value="track-workshop">Workshops</option>');

  const unfiltered = await body(`/agenda?event=${EVENT_SLUG}`);
  expect(unfiltered).toContain("<option selected value>All tracks</option>");
});

test("CONTRACT · MRQ-136 name-form format and location links render their own selects on the facet in effect", async () => {
  const byFormat = await body(`/agenda?event=${EVENT_SLUG}&format=Workshop`);
  expect(byFormat).toContain('<option selected value="format-workshop">Workshop</option>');
  expect(byFormat).not.toContain("<option selected value>All formats</option>");

  const byRoom = await body(`/agenda?event=${EVENT_SLUG}&room=Workshop%20Room`);
  expect(byRoom).toContain('<option selected value="room-workshop">Workshop Room</option>');
  expect(byRoom).not.toContain("<option selected value>All locations</option>");
});

test("CONTRACT · MRQ-136 a day link highlights its tab whether it carries the date or the label", async () => {
  const byDate = await body(`/agenda?event=${EVENT_SLUG}&day=2026-10-13`);
  expect(byDate).toContain('name="day" value="2026-10-13" class="active"');
  expect(byDate).toContain('name="day" value="all" class ');

  const byLabel = await body(`/agenda?event=${EVENT_SLUG}&day=Tue%2C%20Oct%2013`);
  expect(byLabel).toContain("Workshop session");
  expect(byLabel).not.toContain("Stage session");
  expect(byLabel).toContain('name="day" value="2026-10-13" class="active"');

  const unfiltered = await body(`/agenda?event=${EVENT_SLUG}`);
  expect(unfiltered).toContain('name="day" value="all" class="active"');
});

test("CONTRACT · MRQ-136 the embed widget's controls hold the same line for a name-form track", async () => {
  const embed = await body(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}&track=Workshops`);
  expect(embed).toContain("Workshop session");
  expect(embed).not.toContain("Stage session");
  expect(embed).toContain('<option selected value="track-workshop">Workshops</option>');
});

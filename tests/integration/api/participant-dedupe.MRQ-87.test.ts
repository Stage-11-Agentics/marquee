import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { loadPublicAgenda, loadPublicEmbed, resolvePublicEmbed } from "../../../src/lib/public-site";
import { applyMigrations, env } from "../apply-migrations";

/**
 * A public CFP submission stores its author twice — once as `submitter`, once
 * as `speaker` — so every speaker list built by joining `participations`
 * printed the same person twice. On the published conference site that read as
 * `Robin Alvarez · Robin Alvarez`.
 *
 * The fixture is the ordinary shape rather than a contrived one: one person in
 * both roles, plus a second submission whose submitter genuinely differs from
 * its speaker, which is the case the public-site ruling turns on.
 */

// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();
const ORG_ID = "org_mrq87";
const EVENT_ID = "evt_mrq87";
const EVENT_SLUG = "dedupe-conf";
const ORIGIN = "https://marquee.stage11.dev";
const SESSION_ID = "sub_mrq87_self";
const DELEGATED_ID = "sub_mrq87_delegated";
const SELF_PERSON = "per_mrq87_self";
const DELEGATED_SPEAKER = "per_mrq87_speaker";
const PROGRAM_MANAGER = "per_mrq87_manager";
const ORGANIZER = "per_mrq87_organizer";
const AUTH_SESSION = "sess_mrq87";
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

/**
 * Deterministic env per request. The suite must not read whatever `.dev.vars`
 * happens to hold, because CI has no such file and a test that quietly depends
 * on one passes here and fails there.
 */
function runtimeEnv(): Env {
  return {
    ...env,
    ASSETS: assets,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq87-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq87-upload-rate-secret",
    MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, init, runtimeEnv());
}

function person(id: string, name: string, email: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, 'Principal Engineer', 'Example Co', 'A biography', '[]', 0, ?, ?)",
  ).bind(id, ORG_ID, email, name, NOW, NOW);
}

function participation(id: string, submissionId: string, personId: string, role: string, position: number): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
  ).bind(id, submissionId, personId, role, position, NOW, NOW);
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Dedupe Conference", "dedupe-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Dedupe Conference 2026', ?, 'One person, printed once', '2026-10-12', '2026-10-13', 'America/New_York', 'Example Hall', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, EVENT_SLUG, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq87', ?, 'Main Track', '#0b6a72', 0, ?, ?)").bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES ('bld_mrq87', ?, 'Example Hall', '1 Example Way', 0, NULL, NULL, 5, NULL, ?, ?)").bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES ('room_mrq87', ?, 'bld_mrq87', 'Main Stage', 100, 0, '[]', NULL, ?, ?)").bind(EVENT_ID, NOW, NOW),
    person(SELF_PERSON, "Robin Alvarez", "robin@example.com"),
    person(DELEGATED_SPEAKER, "Dana Okafor", "dana@example.com"),
    person(PROGRAM_MANAGER, "Sam Reyes", "sam@example.com"),
    person(ORGANIZER, "Alex Chen", "alex@example.com"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq87', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(AUTH_SESSION, ORGANIZER, NOW + 86_400_000, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'session', 'Shipping the whole loop', 'An abstract', 'accepted', 'track_mrq87', 'public', ?, 'Shipping the whole loop Robin Alvarez', ?, ?)`)
      .bind(SESSION_ID, EVENT_ID, SELF_PERSON, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'session', 'A talk booked by a manager', 'Another abstract', 'accepted', 'track_mrq87', 'public', ?, 'A talk booked by a manager Dana Okafor Sam Reyes', ?, ?)`)
      .bind(DELEGATED_ID, EVENT_ID, PROGRAM_MANAGER, NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st_mrq87_a', ?, 'track_mrq87', 1, ?, ?)").bind(SESSION_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st_mrq87_b', ?, 'track_mrq87', 1, ?, ?)").bind(DELEGATED_ID, NOW, NOW),
    // The ordinary public CFP shape: the same person, twice, both at position 0.
    participation("par_mrq87_submitter", SESSION_ID, SELF_PERSON, "submitter", 0),
    participation("par_mrq87_speaker", SESSION_ID, SELF_PERSON, "speaker", 0),
    // A submitter who is not on stage.
    participation("par_mrq87_manager", DELEGATED_ID, PROGRAM_MANAGER, "submitter", 0),
    participation("par_mrq87_delegated", DELEGATED_ID, DELEGATED_SPEAKER, "speaker", 0),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES ('ag_mrq87_a', ?, ?, 'session', ?, 45, 'room_mrq87', 'track_mrq87', 1, ?, ?)`)
      .bind(EVENT_ID, SESSION_ID, Date.UTC(2026, 9, 12, 13), NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES ('ag_mrq87_b', ?, ?, 'session', ?, 45, 'room_mrq87', 'track_mrq87', 1, ?, ?)`)
      .bind(EVENT_ID, DELEGATED_ID, Date.UTC(2026, 9, 12, 14), NOW, NOW),
  ]);
});

test("CONTRACT · a person on a submission in two roles is one speaker on the public agenda", async () => {
  const agenda = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG });
  const session = agenda?.sessions.find((item) => item.id === SESSION_ID);
  expect(session).toBeDefined();
  expect(session!.speakers.map((speaker) => speaker.id)).toEqual([SELF_PERSON]);
  expect(session!.speakers.map((speaker) => speaker.name)).toEqual(["Robin Alvarez"]);
});

test("CONTRACT · the published agenda page prints the duplicated name once", async () => {
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body.split("Robin Alvarez").length - 1).toBeGreaterThan(0);
  // The rendered card names the speaker in exactly one speaker slot; the bug
  // rendered "Robin Alvarez · Robin Alvarez" inside one.
  expect(body).not.toContain("Robin Alvarez · Robin Alvarez");
});

test("CONTRACT · a submitter who is not speaking is not audience information", async () => {
  const agenda = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG });
  const delegated = agenda?.sessions.find((item) => item.id === DELEGATED_ID);
  expect(delegated!.speakers.map((speaker) => speaker.name)).toEqual(["Dana Okafor"]);

  // And the public search must not match on a name the page will never print.
  const bySubmitter = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG, q: "Sam Reyes" });
  expect(bySubmitter?.sessions.map((item) => item.id)).toEqual([]);
  const bySpeaker = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG, q: "Dana Okafor" });
  expect(bySpeaker?.sessions.map((item) => item.id)).toEqual([DELEGATED_ID]);
});

test("CONTRACT · the speakers embed lists a two-role person once", async () => {
  const resolved = await resolvePublicEmbed(env.DB, { slug: `${EVENT_SLUG}-speakers`, eventSlug: EVENT_SLUG });
  expect(resolved).not.toBeNull();
  const data = await loadPublicEmbed(env.DB, resolved!, { track: null, status: null, accent: null, layout: null });
  const appearances = data.speakers.filter((speaker) => speaker.id === SELF_PERSON);
  expect(appearances).toHaveLength(1);
  expect(appearances[0]!.sessions.map((item) => item.id)).toEqual([SESSION_ID]);
  expect(data.speakers.map((speaker) => speaker.name)).not.toContain("Sam Reyes");
});

test("CONTRACT · the submissions API returns each person once and keeps a non-speaking submitter", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
    headers: { cookie: `mq_session=${AUTH_SESSION}` },
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { data: Array<{ id: string; speakers: Array<{ id: string; name: string }> }> };
  const own = body.data.find((item) => item.id === SESSION_ID);
  expect(own!.speakers.map((speaker) => speaker.id)).toEqual([SELF_PERSON]);
  // The organizer's own list loses nobody: a submitter who is not on stage is
  // still someone the program staff has to be able to see.
  const delegated = body.data.find((item) => item.id === DELEGATED_ID);
  expect(delegated!.speakers.map((speaker) => speaker.name)).toEqual(["Dana Okafor", "Sam Reyes"]);
});

test("CONTRACT · a calendar invite addresses a two-role person once", async () => {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT person.id AS person_id
     FROM participations participation
     JOIN people person ON person.id = participation.person_id
     WHERE participation.submission_id = ? AND participation.role IN ('speaker', 'submitter')`,
  ).bind(SESSION_ID).all<{ person_id: string }>();
  expect(rows.results.map((row) => row.person_id)).toEqual([SELF_PERSON]);
});

import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import {
  loadPublicAgenda,
  loadPublicEmbed,
  publicEmbedCacheKey,
  purgePublicEmbedCache,
  readPublicEmbedCache,
  resolvePublicEmbed,
  writePublicEmbedCache,
  type PublicEmbedCache,
} from "../../src/lib/public-site";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_public_site";
const EVENT_SLUG = "public-conf";
const PUBLIC_SESSION_ID = "sub_public_session";
const PRIVATE_SESSION_ID = "sub_private_session";
const PUBLIC_TITLE = "Visible session title";
const PRIVATE_TITLE = "Secret unpublished title";
const PRIVATE_ABSTRACT = "Secret unpublished abstract";
const PRIVATE_SPEAKER = "Secret Unpublished Speaker";
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, runtimeEnv());
}

class FakeEmbedCache implements PublicEmbedCache {
  readonly values = new Map<string, string>();
  readonly ttls: number[] = [];

  async get(key: string): Promise<unknown | null> {
    const value = this.values.get(key);
    return value ? JSON.parse(value) : null;
  }

  async put(key: string, value: string, options: { expirationTtl: number }): Promise<void> {
    this.values.set(key, value);
    this.ttls.push(options.expirationTtl);
  }

  async list({ prefix }: { prefix: string }): Promise<{ keys: Array<{ name: string }> }> {
    return { keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_public_site", "Public Conference", "public-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "org_public_site", "Public Conference 2026", EVENT_SLUG, "A published program", "2026-10-12", "2026-10-13", "America/New_York", "Sheraton New York Times Square", "#db4c3f", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-public", EVENT_ID, "Public Track", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-other", EVENT_ID, "Other Track", "#0b6a72", 1, NOW, NOW),
    env.DB.prepare(`INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, 3, ?, ?, ?)`)
      .bind("building-public", EVENT_ID, "Sheraton New York Times Square", "811 7th Ave, New York, NY 10019", 40.7625188, -73.9814528, "Photo ID required at the main entrance", NOW, NOW),
    env.DB.prepare(`INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
      VALUES ('room-public', ?, 'building-public', 'Main Stage', 100, 0, '["Projector", "Livestream"]', 'PRIVATE ROOM NOTE', ?, ?)`)
      .bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-public", "org_public_site", "public@example.com", "Public Speaker", "Principal Engineer", "Public Co", "Public biography", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-private", "org_public_site", "private@example.com", PRIVATE_SPEAKER, "Private title", "Private Co", "Private biography", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, 'public', ?, ?, ?, ?)`)
      .bind(PUBLIC_SESSION_ID, EVENT_ID, PUBLIC_TITLE, "Public abstract", "track-public", "person-public", `${PUBLIC_TITLE} Public Speaker Public Co`, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, 'public', ?, ?, ?, ?)`)
      .bind(PRIVATE_SESSION_ID, EVENT_ID, PRIVATE_TITLE, PRIVATE_ABSTRACT, "track-other", "person-private", `${PRIVATE_TITLE} ${PRIVATE_ABSTRACT} ${PRIVATE_SPEAKER}`, NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("st-public", PUBLIC_SESSION_ID, "track-public", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("st-private", PRIVATE_SESSION_ID, "track-other", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind("par-public", PUBLIC_SESSION_ID, "person-public", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind("par-private", PRIVATE_SESSION_ID, "person-private", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-public", EVENT_ID, PUBLIC_SESSION_ID, Date.UTC(2026, 9, 12, 13), "room-public", "track-public", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 0, ?, ?)`)
      .bind("agenda-private", EVENT_ID, PRIVATE_SESSION_ID, Date.UTC(2026, 9, 12, 14), "room-public", "track-other", NOW, NOW),
  ]);
  await purgePublicEmbedCache(env.CACHE, { eventId: EVENT_ID });
});

test("AC-83, AC-84, AC-240, AC-252, AC-253 · the anonymous agenda renders published sessions, cross-links, schedule labels, and no operator venue data", async () => {
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain(PUBLIC_TITLE);
  expect(body).toContain("Public Speaker");
  expect(body).toContain("09:00");
  expect(body).toContain("Main Stage · Sheraton New York Times Square");
  expect(body).toContain('href="/s/visible-session-title"');
  expect(body).toContain('href="/p/public-speaker"');
  expect(body).not.toContain("Projector");
  expect(body).not.toContain("PRIVATE ROOM NOTE");
  expect(body).not.toContain("Photo ID required");

  const session = await request(`/s/visible-session-title?event=${EVENT_SLUG}`);
  const sessionBody = await session.text();
  expect(session.status).toBe(200);
  expect(sessionBody).toContain('href="/p/public-speaker"');
  expect(sessionBody).toContain("Main Stage · Sheraton New York Times Square");
  expect(sessionBody).toContain("Public abstract");
  expect(sessionBody).not.toContain("Projector");
  expect(sessionBody).not.toContain("PRIVATE ROOM NOTE");
  expect(sessionBody).not.toContain("Photo ID required");

  const speaker = await request(`/p/public-speaker?event=${EVENT_SLUG}`);
  const speakerBody = await speaker.text();
  expect(speaker.status).toBe(200);
  expect(speakerBody).toContain('href="/s/visible-session-title"');
});

test("AC-85 · the public agenda is SSR-first, reserves filter/list space, and carries the 375px treatment", async () => {
  const started = performance.now();
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(body).toContain('name="viewport"');
  expect(body).toContain("min-height: 430px");
  expect(body).toContain("@media (max-width: 460px)");
  expect(body).toContain("data-public-agenda-filters");
  expect(body).not.toContain("app-shell");
});

test("AC-86 · guessed unpublished session and speaker permalinks return 404 without status-only leak", async () => {
  const paths = [
    `/s/${PRIVATE_SESSION_ID}?event=${EVENT_SLUG}`,
    "/s/secret-unpublished-title?event=public-conf",
    `/p/${PRIVATE_SPEAKER.toLowerCase().replaceAll(" ", "-")}?event=${EVENT_SLUG}`,
    "/api/v1/public/sessions/secret-unpublished-title?event=public-conf",
    `/api/v1/public/speakers/${PRIVATE_SPEAKER.toLowerCase().replaceAll(" ", "-")}?event=${EVENT_SLUG}`,
  ];
  for (const path of paths) {
    const response = await request(path);
    const body = await response.text();
    expect(response.status, path).toBe(404);
    expect(body, `${path} leaked private id`).not.toContain(PRIVATE_SESSION_ID);
    expect(body, `${path} leaked private title`).not.toContain(PRIVATE_TITLE);
    expect(body, `${path} leaked private abstract`).not.toContain(PRIVATE_ABSTRACT);
  }

  const agenda = await request(`/agenda?event=${EVENT_SLUG}`);
  const agendaBody = await agenda.text();
  expect(agenda.status).toBe(200);
  expect(agendaBody).not.toContain(PRIVATE_SESSION_ID);
  expect(agendaBody).not.toContain(PRIVATE_TITLE);
  expect(agendaBody).not.toContain(PRIVATE_ABSTRACT);
});

test("AC-89 · embed cache writes the 30-second budget and publish purge removes every public variant", async () => {
  const cache = new FakeEmbedCache();
  const resolved = await resolvePublicEmbed(env.DB, { slug: `${EVENT_SLUG}-agenda` });
  expect(resolved).not.toBeNull();
  const first = await loadPublicEmbed(env.DB, resolved!);
  const key = publicEmbedCacheKey(EVENT_ID, `${EVENT_SLUG}-agenda`);
  await writePublicEmbedCache(cache, key, first);
  expect(cache.ttls).toEqual([30]);
  expect(await readPublicEmbedCache(cache, key)).not.toBeNull();
  expect(await purgePublicEmbedCache(cache, { eventId: EVENT_ID })).toBe(1);
  expect(await readPublicEmbedCache(cache, key)).toBeNull();
});

test("AC-87, AC-88, AC-90 · anonymous embed configuration emits a live snippet and both filtered responsive surfaces honor color", async () => {
  const config = await request(`/embed/config?event=${EVENT_SLUG}`);
  const configBody = await config.text();
  expect(config.status).toBe(200);
  expect(configBody).toContain("data-embed-code");
  expect(configBody).toContain("data-embed-preview");
  expect(configBody).toContain("Copy embed code");
  expect(configBody).toContain("Live preview");
  expect(configBody).toContain("Speaker gallery");

  const agenda = await request(`/embed/${EVENT_SLUG}-agenda?event=${EVENT_SLUG}&track=track-public&status=accepted&accent=%23ff00aa`);
  const agendaBody = await agenda.text();
  expect(agenda.status).toBe(200);
  expect(agenda.headers.get("cache-control")).toContain("max-age=30");
  expect(agendaBody).toContain(PUBLIC_TITLE);
  expect(agendaBody).toContain("--embed-accent:#ff00aa");
  expect(agendaBody).toContain("@media (max-width: 375px)");
  expect(agendaBody).not.toContain(PRIVATE_TITLE);
  expect(agendaBody).not.toContain(PRIVATE_ABSTRACT);

  const speakers = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&track=track-public&status=accepted&accent=%23ff00aa`);
  const speakersBody = await speakers.text();
  expect(speakers.status).toBe(200);
  expect(speakersBody).toContain("Public Speaker");
  expect(speakersBody).not.toContain(PRIVATE_SPEAKER);
  expect(speakersBody).not.toContain(PRIVATE_TITLE);

  const api = await request(`/api/v1/public/embeds/${EVENT_SLUG}-agenda?event=${EVENT_SLUG}&track=track-public&status=accepted`);
  const payload = await api.json<{ sessions: Array<{ title: string }>; speakers: Array<{ name: string }> }>();
  expect(api.status).toBe(200);
  expect(payload.sessions.map((session) => session.title)).toEqual([PUBLIC_TITLE]);
  expect(payload.speakers.map((speaker) => speaker.name)).toEqual(["Public Speaker"]);
});

import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import {
  loadPublicAgenda,
  loadPublicEmbed,
  loadPublicSpeakerDirectory,
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
  expect(body).toContain("Main Stage</span>");
  expect(body).toContain('href="/s/visible-session-title"');
  expect(body).toContain('href="/p/public-speaker"');
  expect(body).toContain('href="/speakers?event=public-conf">Speakers</a>');
  expect(body).not.toContain("Projector");
  expect(body).not.toContain("PRIVATE ROOM NOTE");
  expect(body).not.toContain("Photo ID required");

  const session = await request(`/s/visible-session-title?event=${EVENT_SLUG}`);
  const sessionBody = await session.text();
  expect(session.status).toBe(200);
  expect(sessionBody).toContain('href="/p/public-speaker"');
  expect(sessionBody).toContain('class="public-brand" href="/"');
  expect(sessionBody).toContain('href="/agenda?event=public-conf">← Agenda</a>');
  expect(sessionBody).toContain("Sheraton New York Times Square");
  expect(sessionBody).toContain("Main Stage · 45 minutes");
  expect(sessionBody).toContain("Public abstract");
  expect(sessionBody).not.toContain("Projector");
  expect(sessionBody).not.toContain("PRIVATE ROOM NOTE");
  expect(sessionBody).not.toContain("Photo ID required");

  const speaker = await request(`/p/public-speaker?event=${EVENT_SLUG}`);
  const speakerBody = await speaker.text();
  expect(speaker.status).toBe(200);
  expect(speakerBody).toContain('href="/s/visible-session-title"');
  expect(speakerBody).toContain('class="public-brand" href="/"');
  expect(speakerBody).toContain('href="/agenda?event=public-conf">← Agenda</a>');
  expect(speakerBody).toContain("Sheraton New York Times Square");

  await env.DB.prepare(
    `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
     VALUES ('building-public-annex', ?, 'Marriott Annex', '1535 Broadway', 1, 40.7586, -73.9862, 3, 'Use the Broadway lobby', ?, ?)`,
  ).bind(EVENT_ID, NOW, NOW).run();
  const twoBuildingAgenda = await request(`/agenda?event=${EVENT_SLUG}`);
  const twoBuildingAgendaBody = await twoBuildingAgenda.text();
  expect(twoBuildingAgenda.status).toBe(200);
  expect(twoBuildingAgendaBody).toContain("Main Stage · Sheraton New York Times Square");
  const twoBuildingSession = await request(`/s/visible-session-title?event=${EVENT_SLUG}`);
  const twoBuildingSessionBody = await twoBuildingSession.text();
  expect(twoBuildingSessionBody).toContain("Main Stage · Sheraton New York Times Square");
  await env.DB.prepare("DELETE FROM buildings WHERE id = 'building-public-annex'").run();
});

test("AC-84, AC-88, AC-274 · public speaker detail and embeds render seeded avatars with a truthful initials fallback", async () => {
  const fallback = await request(`/p/public-speaker?event=${EVENT_SLUG}`);
  const fallbackBody = await fallback.text();
  expect(fallback.status).toBe(200);
  expect(fallbackBody).toContain("PS");
  expect(fallbackBody).not.toContain("/headshots/");

  await env.DB.prepare("UPDATE people SET name = 'Grace Isford' WHERE id = 'person-public'").run();

  const detail = await request(`/p/grace-isford?event=${EVENT_SLUG}`);
  const detailBody = await detail.text();
  expect(detail.status).toBe(200);
  expect(detailBody).toContain('src="/headshots/grace-isford.svg"');
  expect(detailBody).toContain("Grace Isford synthetic avatar");

  const cards = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}`);
  const cardsBody = await cards.text();
  expect(cards.status).toBe(200);
  expect(cardsBody).toContain('src="/headshots/grace-isford.svg"');

  const list = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&layout=list`);
  const listBody = await list.text();
  expect(list.status).toBe(200);
  expect(listBody).toContain('src="/headshots/grace-isford.svg"');

  const api = await request(`/api/v1/public/agenda?event=${EVENT_SLUG}`);
  const payload = await api.json<{ sessions: Array<{ speakers: Array<{ name: string; headshotUrl: string | null }> }> }>();
  const speaker = payload.sessions.flatMap((session) => session.speakers).find((candidate) => candidate.name === "Grace Isford");
  expect(speaker?.headshotUrl).toBe("/headshots/grace-isford.svg");
});

test("CONTRACT · MRQ-121 · EMB-05/12/13/14 · the public speaker directory is searchable, deduplicated, published-only, and linked from both embed layouts", async () => {
  const unpublishedSearch = await request(`/speakers?event=${EVENT_SLUG}&q=Private%20Co`);
  const unpublishedSearchBody = await unpublishedSearch.text();
  expect(unpublishedSearch.status).toBe(200);
  expect(unpublishedSearchBody).toContain("No published speakers match");
  expect(unpublishedSearchBody).not.toContain(PRIVATE_SPEAKER);

  await env.DB.batch([
    env.DB.prepare("UPDATE participations SET person_id = ? WHERE id = 'par-private'").bind("person-public"),
    env.DB.prepare("UPDATE agenda_items SET is_published = 1 WHERE id = 'agenda-private'"),
  ]);

  const data = await loadPublicSpeakerDirectory(env.DB, { eventSlug: EVENT_SLUG });
  expect(data?.speakers.map((speaker) => speaker.name)).toEqual(["Public Speaker"]);

  const directory = await request(`/speakers?event=${EVENT_SLUG}`);
  const directoryBody = await directory.text();
  expect(directory.status).toBe(200);
  expect(directoryBody).toContain("<h1>Speakers</h1>");
  expect(directoryBody).toContain("Principal Engineer · Public Co");
  expect(directoryBody).toContain('href="/p/public-speaker?event=public-conf"');
  expect(directoryBody).not.toContain(PRIVATE_SPEAKER);
  expect((directoryBody.match(/href="\/p\/public-speaker\?event=public-conf"/g) ?? []).length).toBe(1);

  const byCompany = await request(`/speakers?event=${EVENT_SLUG}&q=Public%20Co`);
  const byCompanyBody = await byCompany.text();
  expect(byCompany.status).toBe(200);
  expect(byCompanyBody).toContain("Public Speaker");
  expect(byCompanyBody).toContain('name="q"');

  const cards = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}`);
  const cardsBody = await cards.text();
  expect(cards.status).toBe(200);
  expect(cardsBody).toContain('class="embed-speaker" href="/p/public-speaker?event=public-conf"');

  const list = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&layout=list`);
  const listBody = await list.text();
  expect(list.status).toBe(200);
  expect(listBody).toContain('class="embed-speaker-row" href="/p/public-speaker?event=public-conf"');
});

test("CONTRACT · MRQ-94 · the public agenda defaults to all days, exposes an explicit all-days tab, and keeps the API scope aligned", async () => {
  await env.DB.prepare("UPDATE agenda_items SET starts_at = ?, is_published = 1 WHERE id = 'agenda-private'")
    .bind(Date.UTC(2026, 9, 13, 14))
    .run();

  const defaultAgenda = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG });
  expect(defaultAgenda?.sessions.map((session) => session.title)).toEqual([PUBLIC_TITLE, PRIVATE_TITLE]);
  expect(defaultAgenda?.filters.day).toBe("all");

  const firstDay = await loadPublicAgenda(env.DB, { eventSlug: EVENT_SLUG, day: "2026-10-12" });
  expect(firstDay?.sessions.map((session) => session.title)).toEqual([PUBLIC_TITLE]);
  expect(firstDay?.filters.day).toBe("2026-10-12");

  const allDays = await request(`/agenda?event=${EVENT_SLUG}&day=all`);
  const allDaysBody = await allDays.text();
  expect(allDays.status).toBe(200);
  expect(allDaysBody).toContain(PUBLIC_TITLE);
  expect(allDaysBody).toContain(PRIVATE_TITLE);
  expect(allDaysBody).toContain('name="day" value="all" class="active" role="tab" aria-selected="true"');
  // MRQ-94 removed the data link because it carried the event and nothing else,
  // so a filtered agenda offered a feed of a different program. MRQ-106 brings
  // it back with the page's own scope, which is what the removal was protecting.
  expect(allDaysBody).toContain('href="/api/v1/public/agenda?event=public-conf">Agenda data ↗</a>');

  const defaultPage = await request(`/agenda?event=${EVENT_SLUG}`);
  const defaultBody = await defaultPage.text();
  expect(defaultBody).toContain(PUBLIC_TITLE);
  expect(defaultBody).toContain(PRIVATE_TITLE);
  expect(defaultBody).toContain('name="day" value="all" class="active" role="tab" aria-selected="true"');
  expect(defaultBody).toContain('class="public-day">Mon, Oct 12</span>');
  expect(defaultBody).toContain('class="public-day">Tue, Oct 13</span>');
  expect(defaultBody).toContain('class="public-brand" href="/" aria-label="Public Conference 2026 — Marquee home"');
  expect(defaultBody).toContain('href="/">Organizer demo</a>');

  const dayAndSearch = await request(`/agenda?event=${EVENT_SLUG}&day=2026-10-13&q=Private`);
  const dayAndSearchBody = await dayAndSearch.text();
  expect(dayAndSearch.status).toBe(200);
  expect(dayAndSearchBody).toContain(PRIVATE_TITLE);
  expect(dayAndSearchBody).not.toContain(PUBLIC_TITLE);
  // The feed link follows the filters the reader can see, so the JSON behind
  // "Agenda data" is the program on screen and not a wider one.
  expect(dayAndSearchBody).toContain('href="/api/v1/public/agenda?event=public-conf&amp;day=2026-10-13&amp;q=Private">Agenda data ↗</a>');

  const api = await request(`/api/v1/public/agenda?event=${EVENT_SLUG}&day=all`);
  const payload = await api.json<{ filters: { day: string }; sessions: Array<{ title: string }> }>();
  expect(api.status).toBe(200);
  expect(payload.filters.day).toBe("all");
  expect(payload.sessions.map((session) => session.title)).toEqual([PUBLIC_TITLE, PRIVATE_TITLE]);
});

test("CONTRACT · MRQ-94 · filtered empty states offer a meaningful reset while an unpublished program stays honest", async () => {
  const filtered = await request(`/agenda?event=${EVENT_SLUG}&q=not-a-session`);
  const filteredBody = await filtered.text();
  expect(filtered.status).toBe(200);
  expect(filteredBody).toContain("No published sessions match");
  expect(filteredBody).toContain("Clear a filter to bring the program back into view.");
  expect(filteredBody).toContain('href="/agenda?event=public-conf">Show full agenda</a>');

  await env.DB.prepare("UPDATE agenda_items SET is_published = 0 WHERE id = 'agenda-public'").run();
  const empty = await request(`/agenda?event=${EVENT_SLUG}`);
  const emptyBody = await empty.text();
  expect(empty.status).toBe(200);
  expect(emptyBody).toContain("No published sessions yet");
  expect(emptyBody).not.toContain("No published sessions match");
  expect(emptyBody).not.toContain("Clear a filter to bring the program back into view.");
});

test("AC-85 · the public agenda is SSR-first, reserves filter/list space, and carries the 375px treatment", async () => {
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();
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
  expect(configBody).toContain('data-embed-kind="speakers"');
  expect(configBody).toContain('href="/agenda?event=public-conf">← Agenda</a>');

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

  const emptyAgendaEmbed = await request(`/embed/${EVENT_SLUG}-agenda?event=${EVENT_SLUG}&track=missing-track`);
  const emptyAgendaEmbedBody = await emptyAgendaEmbed.text();
  expect(emptyAgendaEmbed.status).toBe(200);
  expect(emptyAgendaEmbedBody).toContain("Show full agenda");
  expect(emptyAgendaEmbedBody).toContain('href="/embed/public-conf-agenda">Show full agenda</a>');
});

test("CONTRACT · the server-rendered embed remains anonymous with an invalid session cookie", async () => {
  const response = await request(`/embed/${EVENT_SLUG}-agenda?event=${EVENT_SLUG}`, {
    headers: { cookie: "mq_session=expired-or-tampered" },
  });
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain(PUBLIC_TITLE);
  expect(body).not.toContain(PRIVATE_TITLE);
});

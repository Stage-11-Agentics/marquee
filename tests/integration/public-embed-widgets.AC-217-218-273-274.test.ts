import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import {
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
const EVENT_ID = "evt_embed_widgets";
const EVENT_SLUG = "widget-conf";

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

  async get(key: string): Promise<unknown | null> {
    const value = this.values.get(key);
    return value ? JSON.parse(value) : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
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
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("org_embed_widgets", "Widget Conference", "widget-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "org_embed_widgets", "Widget Conference 2026", EVENT_SLUG, "A published program", "2026-10-12", "2026-10-13", "America/New_York", "Sheraton New York Times Square", "#db4c3f", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-agents", EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-evals", EVENT_ID, "Evals", "#0b6a72", 1, NOW, NOW),
    env.DB.prepare(`INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`)
      .bind("building-widget", EVENT_ID, "Sheraton New York Times Square", "811 7th Ave, New York, NY 10019", NOW, NOW),
    env.DB.prepare(`INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at)
      VALUES ('room-widget', ?, 'building-widget', 'Main Stage', 100, 0, ?, ?)`).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-agents", "org_embed_widgets", "agents@example.com", "Agents Speaker", "Principal Engineer", "Agents Co", "Agents biography", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-evals", "org_embed_widgets", "evals@example.com", "Evals Speaker", "Staff Engineer", "Evals Co", "Evals biography", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-agents", EVENT_ID, "Reliable multi-agent systems", "An abstract about agents", "track-agents", "person-agents", "Reliable multi-agent systems Agents Speaker Agents Co", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-evals", EVENT_ID, "Evaluation infrastructure at scale", "An abstract about evals", "track-evals", "person-evals", "Evaluation infrastructure at scale Evals Speaker Evals Co", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("st-agents", "sub-agents", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind("st-evals", "sub-evals", "track-evals", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind("par-agents", "sub-agents", "person-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind("par-evals", "sub-evals", "person-evals", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-agents", EVENT_ID, "sub-agents", Date.UTC(2026, 9, 12, 14), "room-widget", "track-agents", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-evals", EVENT_ID, "sub-evals", Date.UTC(2026, 9, 12, 15), "room-widget", "track-evals", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 30, 30, 30, 0, ?, ?)")
      .bind("format-stage", EVENT_ID, "Stage Talk", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 45, 30, 60, 1, ?, ?)")
      .bind("format-workshop", EVENT_ID, "Workshop", NOW, NOW),
  ]);
  await purgePublicEmbedCache(env.CACHE, { eventId: EVENT_ID });
});

test("AC-273 · the sessions embed is a flat title/track/time card list with public card details, filterable by track and status on the agenda's KV path", async () => {
  const all = await request(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}`);
  const allBody = await all.text();
  expect(all.status).toBe(200);
  expect(all.headers.get("cache-control")).toContain("max-age=30");
  expect(allBody).toContain("Reliable multi-agent systems");
  expect(allBody).toContain("Evaluation infrastructure at scale");
  expect(allBody).toContain('<section class="embed-flat-list"');
  // MRQ-120 keeps the sessions surface flat while giving it the same public
  // card anatomy: room, speaker credits, and the explicit format/track row.
  expect(allBody).toContain("Main Stage");
  expect(allBody).toContain("Agents Speaker");
  expect(allBody).toContain("Principal Engineer");
  expect(allBody).toContain("Format");
  expect(allBody).toContain("Track");
  expect(allBody).toContain('class="embed-format">—</span>');

  const filtered = await request(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}&track=track-agents`);
  const filteredBody = await filtered.text();
  expect(filtered.status).toBe(200);
  expect(filteredBody).toContain("Reliable multi-agent systems");
  expect(filteredBody).not.toContain("Evaluation infrastructure at scale");

  const statusFiltered = await request(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}&status=waitlisted`);
  const statusFilteredBody = await statusFiltered.text();
  expect(statusFiltered.status).toBe(200);
  expect(statusFilteredBody).not.toContain("Reliable multi-agent systems");

  const api = await request(`/api/v1/public/embeds/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}&track=track-agents`);
  const payload = await api.json<{ sessions: Array<{ title: string }> }>();
  expect(api.status).toBe(200);
  expect(payload.sessions.map((session) => session.title)).toEqual(["Reliable multi-agent systems"]);

  // Same KV cache/purge path as the agenda kind (AC-89): 30s TTL, purge clears it.
  const cache = new FakeEmbedCache();
  const resolved = await resolvePublicEmbed(env.DB, { slug: `${EVENT_SLUG}-sessions` });
  expect(resolved).not.toBeNull();
  const first = await loadPublicEmbed(env.DB, resolved!);
  const key = publicEmbedCacheKey(EVENT_ID, `${EVENT_SLUG}-sessions`);
  await writePublicEmbedCache(cache, key, first);
  expect(await readPublicEmbedCache(cache, key)).not.toBeNull();
  expect(await purgePublicEmbedCache(cache, { eventId: EVENT_ID })).toBe(1);
  expect(await readPublicEmbedCache(cache, key)).toBeNull();
});

test("AC-274 · the speakers embed offers cards and list layouts carried in the snippet URL, both responsive", async () => {
  const cardsDefault = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}`);
  const cardsDefaultBody = await cardsDefault.text();
  expect(cardsDefault.status).toBe(200);
  expect(cardsDefaultBody).toContain('<section class="embed-speaker-grid"');
  expect(cardsDefaultBody).not.toContain('<ul class="embed-speaker-list"');

  const list = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&layout=list`);
  const listBody = await list.text();
  expect(list.status).toBe(200);
  expect(listBody).toContain('<ul class="embed-speaker-list"');
  expect(listBody).not.toContain('<section class="embed-speaker-grid"');
  expect(listBody).toContain("Agents Speaker");
  expect(listBody).toContain("@media (max-width: 375px)");

  const cards = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&layout=cards`);
  expect((await cards.text())).toContain('<section class="embed-speaker-grid"');

  const config = await request(`/embed/config?event=${EVENT_SLUG}&kind=speakers&layout=list`);
  const configBody = await config.text();
  expect(config.status).toBe(200);
  expect(configBody).toContain("layout=list");
  expect(configBody).toContain('data-embed-layout="cards"');
  expect(configBody).toContain('data-embed-layout="list"');
  expect(configBody).toContain('data-embed-output="html"');
  expect(configBody).toContain('data-embed-output="json"');
  expect(configBody).toContain('data-embed-output="ical"');

  const configDefault = await request(`/embed/config?event=${EVENT_SLUG}&kind=speakers`);
  const configDefaultBody = await configDefault.text();
  expect(configDefaultBody).not.toContain("layout=list");
});

// An embedded speaker list is the public directory on someone else's page
// (EMB-04, EMB-12), and the two read as one product only if they order the
// same way. The directory moved to surname order; the embed kept sorting on
// the full name, so the same conference read "Aparna, Barr, Zoë" in one place
// and "Zoë, Aparna, Barr" in the other.
test("AC-274 · the speakers embed orders by surname, matching the public directory", async () => {
  const seedSpeaker = (key: string, name: string, title: string, startsAt: number) => [
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind(`person-${key}`, "org_embed_widgets", `${key}@example.com`, name, "Engineer", "Ordering Co", `${name} biography`, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', 'track-agents', 'public', ?, ?, ?, ?)`)
      .bind(`sub-${key}`, EVENT_ID, title, `An abstract by ${name}`, `person-${key}`, `${title} ${name}`, NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, 'track-agents', 1, ?, ?)")
      .bind(`st-${key}`, `sub-${key}`, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind(`par-${key}`, `sub-${key}`, `person-${key}`, NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, 'room-widget', 'track-agents', 1, ?, ?)`)
      .bind(`agenda-${key}`, EVENT_ID, `sub-${key}`, startsAt, NOW, NOW),
  ];

  await env.DB.batch([
    // First-name order here is Aparna → Barr → Zoë; surname order is the reverse.
    ...seedSpeaker("zoe", "Zoë Abernathy", "Retrieval at the edge", Date.UTC(2026, 9, 12, 16)),
    ...seedSpeaker("barr", "Barr Mikkelsen", "Budgets for eval suites", Date.UTC(2026, 9, 12, 17)),
    ...seedSpeaker("aparna", "Aparna Yardley", "Latency as a feature", Date.UTC(2026, 9, 12, 18)),
  ]);
  await purgePublicEmbedCache(env.CACHE, { eventId: EVENT_ID });

  const list = await request(`/embed/${EVENT_SLUG}-speakers?event=${EVENT_SLUG}&layout=list`);
  expect(list.status).toBe(200);
  const body = await list.text();
  const seeded = ["Zoë Abernathy", "Barr Mikkelsen", "Aparna Yardley"];
  expect(seeded.toSorted((left, right) => body.indexOf(left) - body.indexOf(right))).toEqual(seeded);
});

test("CONTRACT · EMB-15 · the public iCal output is a published-only calendar feed", async () => {
  const response = await request(`/embed/${EVENT_SLUG}-sessions.ics?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/calendar");
  expect(response.headers.get("content-disposition")).toContain("widget-conf-sessions.ics");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("METHOD:PUBLISH");
  expect(body).toContain("Reliable multi-agent systems");
  expect(body).toContain("Evaluation infrastructure at scale");
  expect(body).toContain("Main Stage");
  expect(body).not.toContain("PRIVATE");
});

test("AC-217 · the cfp embed renders the open deadline, formats, and a link to the public form; track/layout disable rather than disappear", async () => {
  await env.DB.prepare(
    `INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, created_at, updated_at)
     VALUES ('form-cfp', ?, 'Call for speakers', 'widget-cfp', 'abstract', 'open', ?, ?, ?, ?)`,
  ).bind(EVENT_ID, Date.now() - 86_400_000, Date.now() + 30 * 86_400_000, NOW, NOW).run();

  const embed = await request(`/embed/${EVENT_SLUG}-cfp?event=${EVENT_SLUG}`);
  const body = await embed.text();
  expect(embed.status).toBe(200);
  expect(body).toContain("Call for speakers is open");
  expect(body).toContain("Stage Talk");
  expect(body).toContain("Workshop");
  expect(body).toContain('href="/f/widget-cfp"');
  expect(body).toContain("Submit a proposal");

  const config = await request(`/embed/config?event=${EVENT_SLUG}&kind=cfp`);
  const configBody = await config.text();
  expect(config.status).toBe(200);
  expect(configBody).toContain('data-embed-kind="cfp"');
  expect(configBody).toMatch(/id="embed-track"[^>]*disabled/);
  expect(configBody).toContain("Not applicable — the block promotes the whole call");
  // Disabled, never removed — the segment and both selects are still present.
  expect(configBody).toContain('data-embed-kind="agenda"');
  expect(configBody).toContain('data-embed-kind="sessions"');
  expect(configBody).toContain('data-embed-kind="speakers"');
  expect(configBody).toContain('id="embed-status"');
});

test("AC-218 · the cfp embed flips to its closed state automatically from the form's close date, with no republish action", async () => {
  await env.DB.prepare(
    `INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, created_at, updated_at)
     VALUES ('form-cfp', ?, 'Call for speakers', 'widget-cfp', 'abstract', 'open', ?, ?, ?, ?)`,
  ).bind(EVENT_ID, Date.now() - 86_400_000, Date.now() + 30 * 86_400_000, NOW, NOW).run();

  const open = await request(`/embed/${EVENT_SLUG}-cfp?event=${EVENT_SLUG}`);
  expect(await open.text()).toContain("Call for speakers is open");

  // Move the deadline into the past — nothing else changes, no admin action, no redeploy.
  await env.DB.prepare("UPDATE forms SET closes_at = ? WHERE id = 'form-cfp'").bind(Date.now() - 1_000).run();
  await purgePublicEmbedCache(env.CACHE, { eventId: EVENT_ID });

  const closed = await request(`/embed/${EVENT_SLUG}-cfp?event=${EVENT_SLUG}`);
  const closedBody = await closed.text();
  expect(closed.status).toBe(200);
  expect(closedBody).toContain("Call for speakers is closed");
  expect(closedBody).not.toContain("Submit a proposal");
  expect(closedBody).not.toContain('href="/f/widget-cfp"');
});

test("CONTRACT · sessions and cfp embeds remain anonymous with an invalid session cookie", async () => {
  await env.DB.prepare(
    `INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, created_at, updated_at)
     VALUES ('form-cfp', ?, 'Call for speakers', 'widget-cfp', 'abstract', 'open', ?, ?, ?, ?)`,
  ).bind(EVENT_ID, Date.now() - 86_400_000, Date.now() + 30 * 86_400_000, NOW, NOW).run();

  const sessions = await request(`/embed/${EVENT_SLUG}-sessions?event=${EVENT_SLUG}`, {
    headers: { cookie: "mq_session=expired-or-tampered" },
  });
  expect(sessions.status).toBe(200);
  expect(await sessions.text()).toContain("Reliable multi-agent systems");

  const cfp = await request(`/embed/${EVENT_SLUG}-cfp?event=${EVENT_SLUG}`, {
    headers: { cookie: "mq_session=expired-or-tampered" },
  });
  expect(cfp.status).toBe(200);
  expect(await cfp.text()).toContain("Call for speakers is open");
});

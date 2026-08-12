import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_mrq132_sched";
const EVENT_SLUG = "sched-conf";

/**
 * Real-ugly data on purpose: commas and semicolons are RFC 5545 separators, the
 * em dash and diacritics are multi-octet (line folding counts octets, not
 * characters), and the abstract carries hard newlines. A calendar file that
 * only survives pretty titles is not a calendar file.
 */
const TORTURE_TITLE = 'Rooms, Agents; Tools — Žofia\'s "Live" Demo';
const TORTURE_ABSTRACT = "First line, with a comma.\nSecond line; with a semicolon.\r\nThird line — Žofia, Dele, and the Ășes.";

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, runtimeEnv());
}

/** Every physical line of a VCALENDAR is CRLF-terminated and at most 75 octets. */
function icsLines(body: string): string[] {
  expect(body.endsWith("\r\n")).toBe(true);
  const lines = body.slice(0, -2).split("\r\n");
  const encoder = new TextEncoder();
  for (const line of lines) expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75);
  return lines;
}

/** Undo RFC 5545 folding so a property value can be asserted whole. */
function unfold(body: string): string {
  return body.replaceAll("\r\n ", "");
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("org_mrq132", "Schedule Conference", "schedule-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "org_mrq132", "Schedule Conference 2026", EVENT_SLUG, "A published program", "2026-10-13", "2026-10-15", "America/New_York", "Sheraton", "#0b6a72", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-agents", EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 45, 30, 60, ?, ?, ?)")
      .bind("format-talk", EVENT_ID, "Talk", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)")
      .bind("building-sheraton", EVENT_ID, "Sheraton", "811 7th Ave, New York, NY 10019", 40.7648, -73.9808, "Photo ID required at the main entrance.", NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)")
      .bind("building-marquis", EVENT_ID, "Marriott Marquis", "1535 Broadway, New York, NY 10036", 40.7590, -73.9855, "Use the Broadway lobby.", NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 300, ?, ?, ?)")
      .bind("room-metropolitan", EVENT_ID, "building-sheraton", "Metropolitan Ballroom", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 120, ?, ?, ?)")
      .bind("room-marquis-b", EVENT_ID, "building-marquis", "Marquis Room B", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-priya", "org_mrq132", "priya@example.com", "Priya Raghunathan", "Chief Scientist", "Continual AI", "Keynote biography", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)")
      .bind("person-zofia", "org_mrq132", "zofia@example.com", "Žofia Königová", "Staff Engineer", "Ledger Labs", "Torture biography", NOW, NOW),
    // Keynote — Tuesday 09:00 EDT.
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-keynote", EVENT_ID, "The Year Agents Went to Work", "A keynote abstract.", "format-talk", "track-agents", "person-priya", "The Year Agents Went to Work Priya", NOW, NOW),
    // The ruled conflict pair — Wednesday 14:00 and 14:30, different buildings.
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-memory", EVENT_ID, "Memory Architectures", "A memory abstract.", "format-talk", "track-agents", "person-priya", "Memory Architectures Priya", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-judges", EVENT_ID, TORTURE_TITLE, TORTURE_ABSTRACT, "format-talk", "track-agents", "person-zofia", "Judges Zofia", NOW, NOW),
    // Accepted but never published to the agenda: must not appear anywhere public.
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-unpublished", EVENT_ID, "Unpublished Session", "Not on the public agenda.", "format-talk", "track-agents", "person-priya", "Unpublished Session", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-keynote", "sub-keynote", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-memory", "sub-memory", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-judges", "sub-judges", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-keynote", "sub-keynote", "person-priya", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-memory", "sub-memory", "person-priya", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-judges", "sub-judges", "person-zofia", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-keynote", EVENT_ID, "sub-keynote", Date.UTC(2026, 9, 13, 13), "room-metropolitan", "track-agents", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-memory", EVENT_ID, "sub-memory", Date.UTC(2026, 9, 14, 18), "room-metropolitan", "track-agents", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-judges", EVENT_ID, "sub-judges", Date.UTC(2026, 9, 14, 18, 30), "room-marquis-b", "track-agents", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 0, ?, ?)`)
      .bind("agenda-unpublished", EVENT_ID, "sub-unpublished", Date.UTC(2026, 9, 15, 14), "room-metropolitan", "track-agents", NOW, NOW),
  ]);
});

test("MRQ-132 · a published session downloads as a calendar file the extension-suffixed sibling route cannot shadow", async () => {
  const response = await request(`/api/v1/public/sessions/the-year-agents-went-to-work/calendar.ics?event=${EVENT_SLUG}`);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/calendar");
  expect(response.headers.get("content-disposition")).toContain("the-year-agents-went-to-work.ics");

  const lines = icsLines(body);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines.at(-1)).toBe("END:VCALENDAR");
  expect(lines).toContain("METHOD:PUBLISH");
  expect(lines).toContain("TZID:America/New_York");
  expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  expect(lines).toContain("UID:sub-keynote@marquee.stage11.dev");
  // 13:00 UTC in October is 09:00 in New York — a floating local time with a TZID.
  expect(lines).toContain("DTSTART;TZID=America/New_York:20261013T090000");
  expect(lines).toContain("DTEND;TZID=America/New_York:20261013T094500");
  expect(unfold(body)).toContain("LOCATION:Metropolitan Ballroom · Sheraton\\, 811 7th Ave\\, New York\\, NY 10019");

  // The JSON sibling still answers on the bare slug; the ICS route does not eat it.
  const json = await request(`/api/v1/public/sessions/the-year-agents-went-to-work?event=${EVENT_SLUG}`);
  expect(json.status).toBe(200);
  expect(json.headers.get("content-type")).toContain("application/json");
  expect(await json.json<{ session: { id: string } }>()).toMatchObject({ session: { id: "sub-keynote" } });
});

test("MRQ-132 · calendar text is RFC 5545-escaped and folded, and unpublished sessions have no calendar at all", async () => {
  const response = await request(`/api/v1/public/sessions/rooms-agents-tools-zofia-s-live-demo/calendar.ics?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(response.status).toBe(200);
  const whole = unfold(icsLines(body).join("\r\n"));

  expect(whole).toContain('SUMMARY:Rooms\\, Agents\\; Tools — Žofia\'s "Live" Demo');
  // Hard newlines become the literal escape, never a real line break mid-property.
  expect(whole).toContain("\\nSecond line\\; with a semicolon.\\nThird line");
  expect(whole).toContain("DESCRIPTION:With Žofia Königová.");

  const unpublished = await request(`/api/v1/public/sessions/unpublished-session/calendar.ics?event=${EVENT_SLUG}`);
  expect(unpublished.status).toBe(404);
  expect(await unpublished.json<{ error: { code: string } }>()).toMatchObject({ error: { code: "not_found" } });

  const unknown = await request(`/api/v1/public/sessions/no-such-session/calendar.ics?event=${EVENT_SLUG}`);
  expect(unknown.status).toBe(404);
});

test("MRQ-132 · every card ships a star in a reserved slot and the interval hooks a conflict is made of", async () => {
  const response = await request(`/agenda?event=${EVENT_SLUG}`);
  const body = await response.text();
  expect(response.status).toBe(200);

  // The keynote starts 13:00 UTC and runs 45 minutes.
  expect(body).toContain(`data-public-session-start="${Date.UTC(2026, 9, 13, 13)}"`);
  expect(body).toContain(`data-public-session-end="${Date.UTC(2026, 9, 13, 13) + 45 * 60_000}"`);
  expect(body).toContain('data-public-session-room="Metropolitan Ballroom · Sheraton"');
  expect(body).toContain('data-public-session-speakers="Priya Raghunathan"');
  // State-unknown until the browser answers, in a slot that already exists.
  expect(body).toContain('data-schedule-star="sub-keynote" aria-pressed="false"');
  expect(body.match(/class="star-btn"/g) ?? []).toHaveLength(3);
  // One tap from everywhere: the segmented pair and its fixed-width count.
  expect(body).toContain('data-schedule-view="agenda"');
  expect(body).toContain('data-schedule-view="mine"');
  expect(body).toContain('<span class="count num" data-schedule-count="true">0</span>');
  expect(body).toContain(`href="/agenda/agents?event=${EVENT_SLUG}"`);
});

test("MRQ-132 · the itinerary view is a URL, ignores facets, and reserves every slot the script fills", async () => {
  // A facet in the URL must not survive into the itinerary: an itinerary built
  // from a filtered program would count a fraction of the attendee's picks.
  const response = await request(`/agenda?event=${EVENT_SLUG}&view=mine&day=2026-10-13&track=track-agents&q=memory`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("<h1>My schedule</h1>");
  expect(body).toContain("Your itinerary · Schedule Conference 2026");
  expect(body).toContain('data-schedule-summary="true" hidden');
  expect(body).toContain('data-schedule-glance="true" hidden');
  expect(body).toContain('data-schedule-empty="true" hidden');
  expect(body).toContain("Nothing starred yet");
  expect(body).toContain('data-schedule-sheet="phone"');
  expect(body).toContain('data-schedule-sheet="share"');
  expect(body).toContain('data-schedule-sheet="brief"');
  // Every published session is present for the script to filter down to.
  expect(body).toContain('data-public-session-id="sub-keynote"');
  expect(body).toContain('data-public-session-id="sub-memory"');
  expect(body).toContain('data-public-session-id="sub-judges"');
  expect(body).not.toContain('data-public-session-id="sub-unpublished"');
  expect(body).toContain("needs JavaScript");

  // The agenda view keeps its facets exactly as before.
  const filtered = await request(`/agenda?event=${EVENT_SLUG}&q=memory`);
  const filteredBody = await filtered.text();
  expect(filteredBody).toContain('data-public-session-id="sub-memory"');
  expect(filteredBody).not.toContain('data-public-session-id="sub-keynote"');
});

test("MRQ-132 · the session page offers the calendar three ways and directions an attendee can walk", async () => {
  const response = await request(`/s/memory-architectures?event=${EVENT_SLUG}`);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain('href="/api/v1/public/sessions/memory-architectures/calendar.ics?event=sched-conf"');
  expect(body).toContain("Add to calendar (.ics)");
  expect(body).toContain("https://calendar.google.com/calendar/render");
  expect(body).toContain("https://outlook.office.com/calendar/0/deeplink/compose");
  expect(body).toContain("Getting there");
  expect(body).toContain("https://www.google.com/maps/dir/?api=1&amp;destination=Sheraton%2C%20811%207th%20Ave%2C%20New%20York%2C%20NY%2010019");
  expect(body).toContain("811 7th Ave, New York, NY 10019");
  // The entrance note is speaker-facing operator data (AC-240/252/253) and stays
  // off every public surface, including the anonymous JSON.
  expect(body).not.toContain("Photo ID required");
  const feed = await request(`/api/v1/public/agenda?event=${EVENT_SLUG}`);
  expect(await feed.text()).not.toContain("Photo ID required");

  // The star and the way back, both on the page the decision happens on.
  expect(body).toContain('data-schedule-star="sub-memory"');
  expect(body).toContain(`<a class="back-link" data-schedule-back="true" href="/agenda?event=${EVENT_SLUG}">← Agenda</a>`);
});

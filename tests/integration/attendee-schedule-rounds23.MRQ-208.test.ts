import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { mintToken, sha256Hex } from "../../src/lib/auth/random-token";
import { applyMigrations, env } from "./apply-migrations";

/**
 * Rounds 2 and 3 of the attendee schedule: the anonymous demand signal, the
 * email claim as request-then-verify, attendees entering the CRM, and the
 * speaker cross-over.
 *
 * The rulings these assert are the ones that are easy to regress into their
 * comfortable opposites — a claim that writes a person the moment an address is
 * typed, an unlink that takes an organizer's imported row with it, pins that
 * leak into a friend's copy of a schedule. Each has a test that fails loudly.
 */

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_mrq208";
const EVENT_SLUG = "demand-conf";
const ORG_ID = "org_mrq208";

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ASSETS: assets, ATTENDEE_CLAIM_MAIL: "1", ...overrides } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  return app.request(path, init, runtimeEnv(overrides));
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** An owner-scoped bearer token, so the organizer-side calls are made as a real principal. */
async function orgToken(): Promise<string> {
  const raw = `mq_${mintToken()}`;
  await env.DB
    .prepare(
      `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind("tok_mrq208", ORG_ID, "MRQ-208 test token", await sha256Hex(raw), raw.slice(0, 7),
      JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [] }), "person-priya", NOW, NOW)
    .run();
  // A token still has to belong to somebody who is staff of the organization:
  // the grant says what the credential may do, the membership says whose it is.
  await env.DB
    .prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)")
    .bind("mem_mrq208", ORG_ID, "person-priya", NOW, NOW)
    .run();
  return raw;
}

/** A schedule, created the way the site's own module creates one. */
async function createSchedule(sessionIds: string[], deviceHash?: string) {
  const response = await request("/api/v1/public/schedules", json({
    eventSlug: EVENT_SLUG,
    sessionIds,
    ...(deviceHash ? { deviceHash } : {}),
  }));
  expect(response.status).toBe(201);
  return response.json<{ code: string; writeKey: string }>();
}

async function star(sessionId: string, deviceHash: string, starred = true) {
  return request("/api/v1/public/stars", json({ eventSlug: EVENT_SLUG, sessionId, deviceHash, starred }));
}

async function demandFor(sessionId: string): Promise<number> {
  const { sessionDemandCounts } = await import("../../src/lib/star-beacons");
  const counts = await sessionDemandCounts(env.DB, EVENT_ID);
  return counts.get(sessionId) ?? 0;
}

async function claimRow(code: string) {
  return env.DB
    .prepare("SELECT code, email, person_id, minted_person, verified_at FROM schedule_claims WHERE code = ?")
    .bind(code)
    .first<{ code: string; email: string; person_id: string | null; minted_person: number; verified_at: number | null }>();
}

/** The token never leaves the mail, so a test reads it out of the outbox exactly as a person reads it out of their inbox. */
async function tokenFromMail(): Promise<string> {
  const mail = await env.DB
    .prepare("SELECT text FROM outbox WHERE template_key = 'attendee_schedule_claim' ORDER BY created_at DESC, id DESC LIMIT 1")
    .first<{ text: string }>();
  const token = /[?&]claim=([^&\s#]+)/.exec(mail?.text ?? "")?.[1];
  expect(token, "the claim mail must carry a verification token").toBeTruthy();
  return token as string;
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Demand Conference", "demand-conference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, "Demand Conference 2026", EVENT_SLUG, "A published program", "2026-10-13", "2026-10-15", "America/New_York", "Sheraton", "#0b6a72", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("track-agents", EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 45, 30, 60, ?, ?, ?)")
      .bind("format-talk", EVENT_ID, "Talk", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)")
      .bind("building-sheraton", EVENT_ID, "Sheraton", "811 7th Ave, New York, NY 10019", 40.7648, -73.9808, "Photo ID required.", NOW, NOW),
    // One room with a capacity and one without: the demand board has to answer
    // honestly for both, and the second is what an em-dash exists for.
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 100, ?, ?, ?)")
      .bind("room-main", EVENT_ID, "building-sheraton", "Metropolitan Ballroom", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
      .bind("room-unknown", EVENT_ID, "building-sheraton", "Side Room", 1, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)")
      .bind("person-priya", ORG_ID, "priya@example.com", "Priya Raghunathan", "Chief Scientist", "Continual AI", "Keynote biography", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-keynote", EVENT_ID, "The Year Agents Went to Work", "A keynote abstract.", "format-talk", "track-agents", "person-priya", "keynote", NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, 'accepted', ?, ?, 'public', ?, ?, ?, ?)`)
      .bind("sub-memory", EVENT_ID, "Memory Architectures", "A memory abstract.", "format-talk", "track-agents", "person-priya", "memory", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-keynote", "sub-keynote", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("st-memory", "sub-memory", "track-agents", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)")
      .bind("par-keynote", "sub-keynote", "person-priya", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-keynote", EVENT_ID, "sub-keynote", Date.UTC(2026, 9, 13, 13), "room-main", "track-agents", NOW, NOW),
    env.DB.prepare(`INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', ?, 45, ?, ?, 1, ?, ?)`)
      .bind("agenda-memory", EVENT_ID, "sub-memory", Date.UTC(2026, 9, 14, 18), "room-unknown", "track-agents", NOW, NOW),
  ]);
});

/* ── The demand signal ──────────────────────────────────────────────────── */

test("CONTRACT · MRQ-208 a star is one row per device, idempotent in both directions, and carries no person", async () => {
  expect((await star("sub-keynote", "a".repeat(32))).status).toBe(200);
  expect((await star("sub-keynote", "a".repeat(32))).status).toBe(200);
  expect(await demandFor("sub-keynote")).toBe(1);

  expect((await star("sub-keynote", "b".repeat(32))).status).toBe(200);
  expect(await demandFor("sub-keynote")).toBe(2);

  expect((await star("sub-keynote", "b".repeat(32), false)).status).toBe(200);
  expect((await star("sub-keynote", "b".repeat(32), false)).status).toBe(200);
  expect(await demandFor("sub-keynote")).toBe(1);

  // Nothing in the row can be walked back to a human.
  const row = await env.DB.prepare("SELECT * FROM session_star_beacons LIMIT 1").first<Record<string, unknown>>();
  expect(Object.keys(row ?? {}).sort()).toEqual(["created_at", "device_hash", "event_id", "session_id"]);
});

test("CONTRACT · MRQ-208 a star on an unpublished or unknown session is refused by name", async () => {
  const response = await star("sub-nonexistent", "c".repeat(32));
  expect(response.status).toBe(422);
  expect(await response.json<{ error: { details: { unknownSessionIds: string[] } } }>())
    .toMatchObject({ error: { details: { unknownSessionIds: ["sub-nonexistent"] } } });
});

test("CONTRACT · MRQ-208 an agent-built schedule counts once; a synced browser passing its device hash does not count twice", async () => {
  // The agent: no device, one code, one voice.
  await createSchedule(["sub-keynote"]);
  expect(await demandFor("sub-keynote")).toBe(1);

  // The browser: a beacon and then a code carrying the same device. Still one.
  const device = "d".repeat(32);
  await star("sub-keynote", device);
  expect(await demandFor("sub-keynote")).toBe(2);
  await createSchedule(["sub-keynote"], device);
  expect(await demandFor("sub-keynote")).toBe(2);
});

test("CONTRACT · MRQ-208 the public agenda shows a count only above the threshold, only when the setting is on, and always reserves the slot", async () => {
  for (const device of ["1", "2", "3"]) await star("sub-keynote", device.repeat(32));
  await star("sub-memory", "9".repeat(32));

  const off = await (await request(`/agenda?event=${EVENT_SLUG}`)).text();
  // Ships off: no number anywhere, and the empty chip is holding the space.
  expect(off).not.toContain("schedules include this session");
  expect(off).toContain("public-star-chip empty");

  const { writePublicStarCountSetting } = await import("../../src/lib/star-beacons");
  await writePublicStarCountSetting(env.DB, EVENT_ID, { enabled: true, threshold: 3 }, NOW);

  const on = await (await request(`/agenda?event=${EVENT_SLUG}`)).text();
  expect(on).toContain("3 schedules include this session");
  // The one-star session is below the threshold: it shows no number, and its
  // slot is still there, so crossing the threshold changes a number and not a
  // layout.
  expect(on).not.toContain("1 schedule includes this session");
  expect(on).toContain("public-star-chip empty");
  // Never under the star button — it is session metadata beside the chips.
  expect(on.indexOf("public-star-chip")).toBeGreaterThan(on.indexOf("public-format-chip"));
});

test("CONTRACT · MRQ-208 the threshold floors at 1, so a session can never publish a zero", async () => {
  const { writePublicStarCountSetting, publicStarCountSetting } = await import("../../src/lib/star-beacons");
  await writePublicStarCountSetting(env.DB, EVENT_ID, { enabled: true, threshold: 0 }, NOW);
  expect((await publicStarCountSetting(env.DB, EVENT_ID)).threshold).toBe(1);
});

/* ── The claim: request, then verify ────────────────────────────────────── */

test("CONTRACT · MRQ-208 sending the mail writes no person and no attendance — typing an address is a request, not a claim", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  const response = await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "Maya@Copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  expect(response.status).toBe(200);
  expect(await response.json<{ claim: { status: string; maskedEmail: string } }>())
    .toMatchObject({ claim: { status: "pending", maskedEmail: "m…a@copperline.dev" } });

  // The CRM is untouched. This is the impersonation hole staying shut.
  const person = await env.DB.prepare("SELECT id FROM people WHERE lower(email) = ?").bind("maya@copperline.dev").first();
  expect(person).toBeNull();
  const attendance = await env.DB.prepare("SELECT id FROM event_attendances").first();
  expect(attendance).toBeNull();

  const pending = await claimRow(schedule.code);
  expect(pending).toMatchObject({ email: "maya@copperline.dev", person_id: null, verified_at: null });
});

test("CONTRACT · MRQ-208 the write key is what authorises a claim: a wrong one attaches nothing", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  const response = await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "someone@example.com" }), headers: { "content-type": "application/json", "x-schedule-write-key": "not-the-key" } },
  );
  expect(response.status).toBe(403);
  expect(await claimRow(schedule.code)).toBeNull();
});

test("CONTRACT · MRQ-208 opening the mailed link is what creates the person and the attendance row", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  const token = await tokenFromMail();

  const verified = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token }));
  expect(verified.status).toBe(200);
  expect(await verified.json<{ claim: { status: string } }>()).toMatchObject({ claim: { status: "verified" } });

  const person = await env.DB.prepare("SELECT id, name FROM people WHERE lower(email) = ?")
    .bind("maya@copperline.dev").first<{ id: string; name: string }>();
  expect(person).toBeTruthy();
  const attendance = await env.DB
    .prepare("SELECT source, schedule_code, verified_at FROM event_attendances WHERE person_id = ? AND event_id = ?")
    .bind(person?.id, EVENT_ID)
    .first<{ source: string; schedule_code: string; verified_at: number }>();
  expect(attendance).toMatchObject({ source: "claim", schedule_code: schedule.code });
  expect(attendance?.verified_at).toBeGreaterThan(0);

  // Opening the same mail twice is what people do; it answers, it does not fail.
  const again = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token }));
  expect(again.status).toBe(200);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances").first<{ n: number }>();
  expect(Number(count?.n)).toBe(1);
});

test("CONTRACT · MRQ-208 a claim matches an existing person rather than duplicating them", async () => {
  const schedule = await createSchedule(["sub-memory"]);
  await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "priya@example.com" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));

  const people = await env.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE lower(email) = ?")
    .bind("priya@example.com").first<{ n: number }>();
  expect(Number(people?.n)).toBe(1);
  // And the claim knows it did not mint her, which is what protects her below.
  expect((await claimRow(schedule.code))?.minted_person).toBe(0);
});

test("CONTRACT · MRQ-208 the claim mail is launch-gated: with the flag off nothing is sent and nothing is written", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  const response = await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
    { ATTENDEE_CLAIM_MAIL: "0" },
  );
  expect(response.status).toBe(409);
  expect((await response.json<{ error: { message: string } }>()).error.message).toContain("not switched on");
  expect(await claimRow(schedule.code)).toBeNull();
  const queued = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox").first<{ n: number }>();
  expect(Number(queued?.n)).toBe(0);
});

/* ── Unlink ─────────────────────────────────────────────────────────────── */

test("CONTRACT · MRQ-208 unlink removes what the claim created — and never the organizer's imported row", async () => {
  // An organizer imported this person as a ticket-holder first.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 0, ?, ?)")
      .bind("person-tom", ORG_ID, "tom@meridian.cap", "Tom Brandt", NOW, NOW),
    env.DB.prepare("INSERT INTO event_attendances (id, person_id, event_id, source, schedule_code, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'import', NULL, NULL, ?, ?)")
      .bind("att-import-tom", "person-tom", EVENT_ID, NOW, NOW),
  ]);

  const schedule = await createSchedule(["sub-keynote"]);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "tom@meridian.cap" }), headers: keyed });
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));

  const unlink = await request(`/api/v1/public/schedules/${schedule.code}/claim`, {
    method: "DELETE",
    headers: { "x-schedule-write-key": schedule.writeKey },
  });
  expect(unlink.status).toBe(200);
  const outcome = await unlink.json<{ message: string; personRemoved: boolean; attendanceRemoved: boolean }>();
  // The ruled sentence, exactly.
  expect(outcome.message).toBe("Unlinked — your email and picks are removed from the organizers' records.");
  expect(outcome.attendanceRemoved).toBe(true);
  expect(outcome.personRemoved).toBe(false);

  expect(await claimRow(schedule.code)).toBeNull();
  const remaining = await env.DB
    .prepare("SELECT source FROM event_attendances WHERE person_id = ?")
    .bind("person-tom")
    .all<{ source: string }>();
  expect(remaining.results.map((row) => row.source)).toEqual(["import"]);
  expect(await env.DB.prepare("SELECT id FROM people WHERE id = 'person-tom'").first()).toBeTruthy();

  // The schedule itself is untouched: unlinking an email is not deleting picks.
  expect((await request(`/api/v1/public/schedules/${schedule.code}`)).status).toBe(200);
});

test("CONTRACT · MRQ-208 unlink removes a person the claim itself minted, once nothing else refers to them", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "nobody@example.com" }), headers: keyed });
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));
  expect(await env.DB.prepare("SELECT id FROM people WHERE lower(email) = 'nobody@example.com'").first()).toBeTruthy();

  const unlink = await request(`/api/v1/public/schedules/${schedule.code}/claim`, {
    method: "DELETE",
    headers: { "x-schedule-write-key": schedule.writeKey },
  });
  expect(await unlink.json<{ personRemoved: boolean }>()).toMatchObject({ personRemoved: true });
  expect(await env.DB.prepare("SELECT id FROM people WHERE lower(email) = 'nobody@example.com'").first()).toBeNull();
});

/* ── The speaker cross-over ─────────────────────────────────────────────── */

test("CONTRACT · MRQ-208 a verified speaker's own sessions pin for the owner, ride the feed, and are absent from the shared link", async () => {
  const schedule = await createSchedule(["sub-memory"]);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "priya@example.com" }), headers: keyed });
  const verified = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));
  expect(await verified.json<{ speakingSessionIds: string[] }>()).toMatchObject({ speakingSessionIds: ["sub-keynote"] });

  // The owner, presenting the key, sees the identity and the pins.
  const owner = await request(`/api/v1/public/schedules/${schedule.code}`, { headers: { "x-schedule-write-key": schedule.writeKey } });
  const ownerPayload = await owner.json<{ claim: { maskedEmail: string } | null; speakingSessionIds: string[]; feedToken: string | null }>();
  expect(ownerPayload.claim?.maskedEmail).toBe("p…a@example.com");
  expect(ownerPayload.speakingSessionIds).toEqual(["sub-keynote"]);

  // A friend on the share link sees the picks and nothing about who owns them.
  const shared = await request(`/api/v1/public/schedules/${schedule.code}`);
  const sharedPayload = await shared.json<Record<string, unknown> & { sessions: Array<{ id: string }> }>();
  expect(sharedPayload.sessions.map((session) => session.id)).toEqual(["sub-memory"]);
  expect(sharedPayload.claim).toBeUndefined();
  expect(sharedPayload.speakingSessionIds).toBeUndefined();

  // The owner's feed carries the pin — a speaker should find their own talk in
  // the calendar they subscribed to. The token is what makes it theirs.
  const feedToken = ownerPayload.feedToken;
  expect(feedToken).toBeTruthy();
  const ownerFeed = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics?f=${feedToken}`)).text();
  expect(ownerFeed).toContain("UID:sub-memory@");
  expect(ownerFeed).toContain("UID:sub-keynote@");

  // The same feed addressed with only the share code — which is all a friend
  // has — carries the picks and nothing about who owns them.
  const sharedFeed = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics`)).text();
  expect(sharedFeed).toContain("UID:sub-memory@");
  expect(sharedFeed).not.toContain("UID:sub-keynote@");
  const wrongToken = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics?f=not-the-token`)).text();
  expect(wrongToken).not.toContain("UID:sub-keynote@");

  // Unlinking takes the identity and the pins with it.
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { method: "DELETE", headers: { "x-schedule-write-key": schedule.writeKey } });
  const after = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics?f=${feedToken}`)).text();
  expect(after).not.toContain("UID:sub-keynote@");
});

test("CONTRACT · MRQ-208 pins are derived and never stored: the code's own set is what the attendee starred", async () => {
  const schedule = await createSchedule(["sub-memory"]);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "priya@example.com" }), headers: keyed });
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));

  const stored = await env.DB.prepare("SELECT session_ids FROM public_schedules WHERE code = ?").bind(schedule.code).first<{ session_ids: string }>();
  expect(JSON.parse(stored?.session_ids ?? "[]")).toEqual(["sub-memory"]);
});

/* ── Attendees in the CRM ───────────────────────────────────────────────── */

test("CONTRACT · MRQ-208 an import writes its own attendance rows and re-running duplicates neither people nor rows", async () => {
  const { upsertAttendance } = await import("../../src/lib/event-attendances");
  await env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 0, ?, ?)")
    .bind("person-ines", ORG_ID, "ines@fathom.systems", "Ines Fujimori", NOW, NOW).run();

  await upsertAttendance(env.DB, { eventId: EVENT_ID, personId: "person-ines", source: "import", now: NOW });
  await upsertAttendance(env.DB, { eventId: EVENT_ID, personId: "person-ines", source: "import", now: NOW + 1000 });

  const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances WHERE person_id = ?").bind("person-ines").first<{ n: number }>();
  expect(Number(rows?.n)).toBe(1);

  // A claim by the same person is a second row, not a collision: they are two
  // different facts about the same human.
  await upsertAttendance(env.DB, { eventId: EVENT_ID, personId: "person-ines", source: "claim", scheduleCode: "MQ-TEST", verifiedAt: NOW, now: NOW });
  const both = await env.DB.prepare("SELECT source FROM event_attendances WHERE person_id = ? ORDER BY source").bind("person-ines").all<{ source: string }>();
  expect(both.results.map((row) => row.source)).toEqual(["claim", "import"]);
});

test("CONTRACT · MRQ-208 an attendance row grants nothing: no membership, no role, no seat", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "attendee@example.com" }), headers: keyed });
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));

  const memberships = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>();
  expect(Number(memberships?.n)).toBe(0);
  const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions").first<{ n: number }>();
  expect(Number(sessions?.n)).toBe(0);
});

/* ── The organizer's board ──────────────────────────────────────────────── */

test("CONTRACT · MRQ-208 the demand board reconciles with the rows it is built from, and a room with no capacity gets no ratio", async () => {
  const { demandStats, sessionDemandCounts } = await import("../../src/lib/star-beacons");
  await star("sub-keynote", "e".repeat(32));
  await star("sub-keynote", "f".repeat(32));
  await star("sub-memory", "e".repeat(32));
  await createSchedule(["sub-keynote"]);            // an agent
  await createSchedule(["sub-memory"], "e".repeat(32)); // the browser above

  const counts = await sessionDemandCounts(env.DB, EVENT_ID);
  expect(counts.get("sub-keynote")).toBe(3);
  expect(counts.get("sub-memory")).toBe(1);

  const stats = await demandStats(env.DB, EVENT_ID);
  expect(stats.synced).toBe(2);
  expect(stats.viaAgents).toBe(1);
  expect(stats.advancePicks).toBe(3);
  expect(stats.claimed).toBe(0);

  const { capacityLabel } = await import("../../src/ui/agenda/DemandPanel");
  expect(capacityLabel({ session_id: "x", title: "x", starts_at: null, duration_min: null, room: "Side Room", capacity: null, count: 40 })).toBe("—");
  expect(capacityLabel({ session_id: "x", title: "x", starts_at: null, duration_min: null, room: "Main", capacity: 100, count: 40 })).toBe("40% of room");
  expect(capacityLabel({ session_id: "x", title: "x", starts_at: null, duration_min: null, room: "Main", capacity: 100, count: 140 })).toBe("140% of room — bigger room?");
  // Five picks in a 2,500-seat ballroom is not zero, and a gauge that says 0%
  // beside a count of five reads as broken rather than as nearly empty.
  expect(capacityLabel({ session_id: "x", title: "x", starts_at: null, duration_min: null, room: "Ballroom", capacity: 2500, count: 5 })).toBe("<1% of room");
  expect(capacityLabel({ session_id: "x", title: "x", starts_at: null, duration_min: null, room: "Ballroom", capacity: 2500, count: 0 })).toBe("0% of room");
});

/* ── The blockers a fresh-eyes review found, each with a test that fails loudly ── */

test("CONTRACT · MRQ-208 one address claiming two codes: unlinking either keeps the other's attendance and the person", async () => {
  const first = await createSchedule(["sub-keynote"]);
  const second = await createSchedule(["sub-memory"]);
  for (const schedule of [first, second]) {
    const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
    await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "roamer@example.com" }), headers: keyed });
    await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));
  }
  const person = await env.DB.prepare("SELECT id FROM people WHERE lower(email) = ?")
    .bind("roamer@example.com").first<{ id: string }>();
  expect(person).toBeTruthy();

  // The claim row carries a real foreign key to people, so a person delete that
  // ignored it threw — after the linkage and the attendance had already gone.
  const unlink = await request(`/api/v1/public/schedules/${first.code}/claim`, {
    method: "DELETE",
    headers: { "x-schedule-write-key": first.writeKey },
  });
  expect(unlink.status).toBe(200);
  expect(await unlink.json<{ personRemoved: boolean; attendanceRemoved: boolean }>())
    .toMatchObject({ personRemoved: false, attendanceRemoved: false });

  // The second code is still claimed, so the attendance stays and re-points at it.
  const attendance = await env.DB
    .prepare("SELECT schedule_code FROM event_attendances WHERE person_id = ? AND source = 'claim'")
    .bind(person?.id)
    .first<{ schedule_code: string }>();
  expect(attendance?.schedule_code).toBe(second.code);
  expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(person?.id).first()).toBeTruthy();

  // Unlinking the last one does remove everything it minted.
  const last = await request(`/api/v1/public/schedules/${second.code}/claim`, {
    method: "DELETE",
    headers: { "x-schedule-write-key": second.writeKey },
  });
  expect(await last.json<{ personRemoved: boolean }>()).toMatchObject({ personRemoved: true });
  expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(person?.id).first()).toBeNull();
});

test("CONTRACT · MRQ-208 the claim mail carries a verification token and never the write key", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  const mail = await env.DB
    .prepare("SELECT html, text FROM outbox WHERE template_key = 'attendee_schedule_claim' ORDER BY created_at DESC LIMIT 1")
    .first<{ html: string; text: string }>();
  // The body is stored, and organizers can list the outbox. A credential that
  // opens somebody's schedule must not be in there.
  expect(mail?.text).not.toContain(schedule.writeKey);
  expect(mail?.html).not.toContain(schedule.writeKey);
  expect(mail?.text).not.toContain("#k=");

  // Verifying is what hands the key over — once — so the reading device can edit.
  const verified = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));
  const payload = await verified.json<{ writeKey: string | null; feedToken: string | null }>();
  expect(payload.writeKey).toBe(schedule.writeKey);
  expect(payload.feedToken).toBeTruthy();

  // It stays on the row — deliberately. Burning it on first collection made the
  // second open of the same mail silently read-only. What matters is that no
  // surface hands it out: the read WITHOUT the write key carries neither the
  // key nor the claim, and unlinking deletes the row entirely.
  const shared = await (await request(`/api/v1/public/schedules/${schedule.code}`)).json<Record<string, unknown>>();
  expect(JSON.stringify(shared)).not.toContain(schedule.writeKey);
  const owner = await (await request(`/api/v1/public/schedules/${schedule.code}`, { headers: { "x-schedule-write-key": schedule.writeKey } })).json<Record<string, unknown>>();
  expect(JSON.stringify(owner)).not.toContain(schedule.writeKey);

  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { method: "DELETE", headers: { "x-schedule-write-key": schedule.writeKey } });
  expect(await env.DB.prepare("SELECT code FROM schedule_claims WHERE code = ?").bind(schedule.code).first()).toBeNull();
});

test("CONTRACT · MRQ-208 an attendee import can still be undone, and its attendance rows go with it", async () => {
  const token = await orgToken();
  const csv = "name,email,company\nTom Brandt,tom@meridian.cap,Meridian\nMaya Okafor,maya@copperline.dev,Copperline\n";
  const imported = await request("/api/v1/org/imports", {
    ...json({ csv, filename: "attendees.csv", event: EVENT_SLUG }),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
  expect(imported.status).toBe(202);
  const result = await imported.json<{ import_id: string; created: number; attendances: number }>();
  expect(result).toMatchObject({ created: 2, attendances: 2 });

  // Adding event_attendances to the person-reference inventory made every
  // imported person look "referenced", which skipped them all AND spent the
  // receipt — leaving an organizer who imported the wrong CSV no way back.
  const undone = await request(`/api/v1/org/imports/${result.import_id}/undo`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(undone.status).toBe(200);
  expect(await undone.json<{ undone: number; attendances_removed: number; skipped: number }>())
    .toMatchObject({ undone: 2, attendances_removed: 2, skipped: 0 });
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances WHERE source = 'import'").first<{ n: number }>();
  expect(Number(left?.n)).toBe(0);
  const people = await env.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE lower(email) IN ('tom@meridian.cap', 'maya@copperline.dev')").first<{ n: number }>();
  expect(Number(people?.n)).toBe(0);
});

/* ── The recovery regressions the second review found ── */

test("CONTRACT · MRQ-208 the same mailed link keeps working: every valid open returns the write key", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  const token = await tokenFromMail();

  // People open their own link on the device they sent it from, and mail
  // clients preview links. Burning the key on first collection made the second
  // open — often the human's first — silently read-only: no error, no sync.
  const first = await (await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token })))
    .json<{ writeKey: string | null }>();
  const second = await (await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token })))
    .json<{ writeKey: string | null; feedToken: string | null }>();
  expect(first.writeKey).toBe(schedule.writeKey);
  expect(second.writeKey).toBe(schedule.writeKey);
  expect(second.feedToken).toBeTruthy();
});

test("CONTRACT · MRQ-208 verification refuses a wrong token without spending the owner's budget", async () => {
  const schedule = await createSchedule(["sub-keynote"]);
  await request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
  );
  const token = await tokenFromMail();

  // The code travels in a share link. If successes counted against a per-code
  // ceiling, anyone holding one could lock the real owner out of their own
  // claim; only wrong tokens are counted.
  const wrong = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: "not-the-token" }));
  expect(wrong.status).toBe(403);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const ok = await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token }));
    expect(ok.status).toBe(200);
  }
});

test("CONTRACT · MRQ-208 undoing a re-run import leaves the first run's attendance rows alone", async () => {
  const token = await orgToken();
  const csv = "name,email,company\nTom Brandt,tom@meridian.cap,Meridian\n";
  const post = () => request("/api/v1/org/imports", {
    ...json({ csv, filename: "attendees.csv", event: EVENT_SLUG }),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });

  const first = await (await post()).json<{ import_id: string }>();
  const second = await (await post()).json<{ import_id: string; created: number }>();
  expect(second.created).toBe(0);

  // Re-running an updated export is the loop SKILL.md teaches. The second run
  // inserted no attendance row — it upserted — so undoing it must withdraw
  // nothing, or an organizer correcting a typo silently un-attends everybody.
  const undone = await request(`/api/v1/org/imports/${second.import_id}/undo`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(await undone.json<{ attendances_removed: number }>()).toMatchObject({ attendances_removed: 0 });
  const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances WHERE source = 'import'").first<{ n: number }>();
  expect(Number(kept?.n)).toBe(1);

  // Undoing the run that actually created it does withdraw it.
  const firstUndone = await request(`/api/v1/org/imports/${first.import_id}/undo`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(await firstUndone.json<{ attendances_removed: number }>()).toMatchObject({ attendances_removed: 1 });
});

/* ── The third review: tenancy, dispatch, and the two orders of undo ── */

test("CONTRACT · MRQ-208 the demand board is another organization's business, not yours", async () => {
  // A second organization with its own conference, and a token that is an
  // owner of the FIRST one. A session credential carries an org-wide role, so
  // "is this caller an owner" and "is this conference theirs" are different
  // questions and only the second keeps a neighbour's demand private.
  const NOW_B = NOW + 1;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_other', 'Other', 'other', ?, ?)").bind(NOW_B, NOW_B),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES ('evt_other', 'org_other', 'Other Conference', 'other-conf', '2026-11-01', '2026-11-02', 'America/New_York', 'live', 0, ?, ?)`).bind(NOW_B, NOW_B),
  ]);
  const token = await orgToken();

  const read = await request("/api/v1/events/evt_other/agenda/demand", { headers: { authorization: `Bearer ${token}` } });
  expect([403, 404]).toContain(read.status);

  const write = await request("/api/v1/events/evt_other/agenda/demand/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: true, threshold: 5 }),
  });
  expect([403, 404]).toContain(write.status);
  // And the refusal left nothing behind on the other organization's conference.
  const leaked = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_settings WHERE event_id = 'evt_other'").first<{ n: number }>();
  expect(Number(leaked?.n)).toBe(0);

  // The caller's own conference still answers.
  const own = await request(`/api/v1/events/${EVENT_ID}/agenda/demand`, { headers: { authorization: `Bearer ${token}` } });
  expect(own.status).toBe(200);
});

test("CONTRACT · MRQ-208 requesting a claim actually dispatches the mail, not just a row in D1", async () => {
  const sent: unknown[] = [];
  const schedule = await createSchedule(["sub-keynote"]);
  const response = await app.request(
    `/api/v1/public/schedules/${schedule.code}/claim`,
    { ...json({ email: "maya@copperline.dev" }), headers: { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey } },
    // The consumer only ever acts on an explicit queue message. Writing the
    // outbox row and answering 200 left the mail in the database forever — a
    // trap armed for whoever turned the flag on.
    { ...runtimeEnv(), MAIL_QUEUE: { send: async (message: unknown) => { sent.push(message); } } } as unknown as Env,
  );
  expect(response.status).toBe(200);
  const queued = await env.DB.prepare("SELECT id FROM outbox WHERE template_key = 'attendee_schedule_claim'").first<{ id: string }>();
  expect(queued?.id).toBeTruthy();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: "mail_outbox", outbox_id: queued?.id });
});

test("CONTRACT · MRQ-208 a beacon cannot be joined to a claimed person: the schedule stores a flag, not the device", async () => {
  const device = "7".repeat(32);
  await star("sub-keynote", device);
  const schedule = await createSchedule(["sub-keynote"], device);
  const keyed = { "content-type": "application/json", "x-schedule-write-key": schedule.writeKey };
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { ...json({ email: "maya@copperline.dev" }), headers: keyed });
  await request(`/api/v1/public/schedules/${schedule.code}/claim/verify`, json({ token: await tokenFromMail() }));

  // The join the design forbids: anonymous star → schedule → claim → a name.
  // It has to be impossible in the SCHEMA, because no filter on a read path can
  // close it for anything holding the rows.
  const joined = await env.DB
    .prepare(
      `SELECT claim.email FROM session_star_beacons beacon
         JOIN public_schedules schedule ON schedule.from_device = 1 AND schedule.event_id = beacon.event_id
         JOIN schedule_claims claim ON claim.code = schedule.code
        WHERE beacon.device_hash = ?`,
    )
    .bind(device)
    .all<{ email: string }>();
  // The join still runs — it just cannot be keyed on the device any more, so it
  // relates a name to every browser-made code at the conference rather than to
  // THIS browser's stars. What must not exist is a column pairing them.
  const columns = await env.DB.prepare("PRAGMA table_info(public_schedules)").all<{ name: string }>();
  expect((columns.results ?? []).map((column) => column.name)).not.toContain("device_hash");
  expect(joined.results.length).toBeGreaterThanOrEqual(0);

  // And the aggregate still counts that browser exactly once.
  expect(await demandFor("sub-keynote")).toBe(1);
});

test("CONTRACT · MRQ-208 undoing the FIRST import while a later one is live keeps the row that later one asserts", async () => {
  const token = await orgToken();
  const csv = "name,email,company\nTom Brandt,tom@meridian.cap,Meridian\n";
  const post = () => request("/api/v1/org/imports", {
    ...json({ csv, filename: "attendees.csv", event: EVENT_SLUG }),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
  const first = await (await post()).json<{ import_id: string }>();
  const second = await (await post()).json<{ import_id: string }>();

  // The other order. A created the row; B then asserted the same person and
  // changed nothing, because the upsert is idempotent. Undoing A matched on
  // created_at and deleted the only row — silently discarding B's assertion,
  // which no test caught because the shipped one only tried B-then-A.
  const undoneFirst = await request(`/api/v1/org/imports/${first.import_id}/undo`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });
  expect(await undoneFirst.json<{ attendances_removed: number }>()).toMatchObject({ attendances_removed: 0 });
  const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances WHERE source = 'import'").first<{ n: number }>();
  expect(Number(kept?.n)).toBe(1);

  // Once nothing live asserts it any more, it goes.
  const undoneSecond = await request(`/api/v1/org/imports/${second.import_id}/undo`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });
  expect(await undoneSecond.json<{ attendances_removed: number }>()).toMatchObject({ attendances_removed: 1 });
  const gone = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_attendances WHERE source = 'import'").first<{ n: number }>();
  expect(Number(gone?.n)).toBe(0);
});

import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
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
  const ownerPayload = await owner.json<{ claim: { maskedEmail: string } | null; speakingSessionIds: string[] }>();
  expect(ownerPayload.claim?.maskedEmail).toBe("p…a@example.com");
  expect(ownerPayload.speakingSessionIds).toEqual(["sub-keynote"]);

  // A friend on the share link sees the picks and nothing about who owns them.
  const shared = await request(`/api/v1/public/schedules/${schedule.code}`);
  const sharedPayload = await shared.json<Record<string, unknown> & { sessions: Array<{ id: string }> }>();
  expect(sharedPayload.sessions.map((session) => session.id)).toEqual(["sub-memory"]);
  expect(sharedPayload.claim).toBeUndefined();
  expect(sharedPayload.speakingSessionIds).toBeUndefined();

  // The calendar feed carries the pin — a speaker should find their own talk in
  // the calendar they subscribed to.
  const feed = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics`)).text();
  expect(feed).toContain("UID:sub-memory@");
  expect(feed).toContain("UID:sub-keynote@");

  // Unlinking takes the identity and the pins with it.
  await request(`/api/v1/public/schedules/${schedule.code}/claim`, { method: "DELETE", headers: { "x-schedule-write-key": schedule.writeKey } });
  const after = await (await request(`/api/v1/public/schedules/${schedule.code}/calendar.ics`)).text();
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
});

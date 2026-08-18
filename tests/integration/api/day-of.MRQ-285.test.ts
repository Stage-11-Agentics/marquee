import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { canMarkArrivals, resolveDayOfLink } from "../../../src/lib/day-of/links";
import { zonedStart } from "../../../src/lib/event-time";
import type { RunOfShow } from "../../../src/lib/day-of/run-of-show";
import { applyMigrations, env } from "../apply-migrations";

/**
 * MRQ-285 · the day-of credentials and the arrival grain underneath them.
 *
 * Three claims are load-bearing here, and each of them is a thing that can only
 * be got wrong once:
 *
 *   1. A link is a credential, so resolution and revocation have to be exact.
 *      Revoking is instant, applies to every copy of the URL at once, and a
 *      dead link is indistinguishable from one that never existed.
 *   2. Arrival is per (session, person). A panel of four is four separate
 *      facts, and "she is here today" is not one of them.
 *   3. The link reaches the two arrival routes and nothing else in the product.
 *      That containment is the entire safety argument for handing a URL to a
 *      volunteer with no account, so it is asserted rather than reasoned about.
 */

// Anchored to the real clock: the run-of-show query compares due dates against
// a real Date.now(), so a hardcoded anchor would silently change what
// "overdue" means as the wall clock passed it.
const NOW = Date.now();
const DAY = 86_400_000;

const ORG_ID = "org_mrq285";
const EVENT_ID = "evt_mrq285";
const OTHER_EVENT_ID = "evt_mrq285_other";
const ORIGIN = "https://marquee.stage11.dev";
const TZ = "America/Los_Angeles";
const DAY_ONE = "2027-05-12";
const DAY_TWO = "2027-05-13";

const ORGANIZER = "per_mrq285_organizer";
const PRIYA = "per_mrq285_priya";
const MARCUS = "per_mrq285_marcus";
const NINA = "per_mrq285_nina";
const OMAR = "per_mrq285_omar";
const PANELISTS = [PRIYA, MARCUS, NINA, OMAR] as const;

const ORGANIZER_SESSION = "sess_mrq285_organizer";
const SPEAKER_SESSION = "sess_mrq285_speaker";

const BUILDING = "bld_mrq285";
const BROADWAY = "room_mrq285_broadway";
const MERCER = "room_mrq285_mercer";
const FORM_ID = "form_mrq285";
const PANEL_SUBMISSION = "sub_mrq285_panel";
const TALK_SUBMISSION = "sub_mrq285_talk";
const PANEL_ITEM = "item_mrq285_panel";
const TALK_ITEM = "item_mrq285_talk";
const BREAK_ITEM = "item_mrq285_break";
const SLIDES_TEMPLATE = "tpl_mrq285_slides";
const PANEL_SLIDES_TASK = "task_mrq285_panel_slides";
const TALK_SLIDES_TASK = "task_mrq285_talk_slides";
const TALK_SLIDES_FILE = "att_mrq285_talk_slides";

function runtimeEnv(): Env {
  return {
    ...env,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq285-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq285-upload-rate-secret",
  } as unknown as Env;
}

interface Call {
  session?: string;
  key?: string;
  method?: string;
  body?: unknown;
}

async function call(path: string, options: Call = {}): Promise<Response> {
  const headers = new Headers();
  if (options.session) headers.set("cookie", `mq_session=${options.session}`);
  if (options.key) headers.set("x-marquee-day-of-key", options.key);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return app.request(`${ORIGIN}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, runtimeEnv());
}

async function mint(kind: "green_room" | "checkin", name: string): Promise<{ id: string; token: string; url: string }> {
  const response = await call(`/api/v1/events/${EVENT_ID}/day-of/links`, {
    session: ORGANIZER_SESSION,
    body: { kind, name },
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = await response.json() as { data: { id: string }; url: string };
  return { id: body.data.id, token: body.url.split("/").at(-1)!, url: body.url };
}

async function runOfShow(day = DAY_ONE): Promise<RunOfShow> {
  const response = await call(`/api/v1/events/${EVENT_ID}/run-of-show?day=${day}`, { session: ORGANIZER_SESSION });
  expect(response.status).toBe(200);
  return (await response.json() as { data: RunOfShow }).data;
}

function panel(snapshot: RunOfShow) {
  const room = snapshot.rooms.find((candidate) => candidate.id === BROADWAY)!;
  return room.sessions.find((session) => session.id === PANEL_ITEM)!;
}

async function auditRows(action: string): Promise<{ entity_id: string; actor_kind: string; after_json: string | null }[]> {
  const rows = await env.DB
    .prepare("SELECT entity_id, actor_kind, after_json FROM audit_log WHERE event_id = ? AND action = ? ORDER BY created_at ASC, id ASC")
    .bind(EVENT_ID, action)
    .all<{ entity_id: string; actor_kind: string; after_json: string | null }>();
  return rows.results;
}

beforeEach(async () => {
  await applyMigrations();
  const panelStart = zonedStart(DAY_ONE, "09:00", TZ);
  const talkStart = zonedStart(DAY_ONE, "10:40", TZ);
  const breakStart = zonedStart(DAY_ONE, "10:10", TZ);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Northbound', 'northbound', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Northbound 2027', 'northbound-2027', NULL, ?, ?, ?, 'Pier 27', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, DAY_ONE, DAY_TWO, TZ, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Northbound Fringe', 'northbound-fringe', NULL, ?, ?, ?, 'Pier 9', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(OTHER_EVENT_ID, ORG_ID, DAY_ONE, DAY_TWO, TZ, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'jordan@example.com', 'Jordan Alvarez', '[]', 0, ?, ?)").bind(ORGANIZER, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, custom_fields, is_demo, created_at, updated_at) VALUES (?, ?, 'priya@example.com', 'Priya Raman', '[]', ?, 0, ?, ?)")
      .bind(PRIYA, ORG_ID, JSON.stringify({ "Mobile phone": "+1 (415) 555-0142" }), NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'marcus@example.com', 'Marcus Okafor', '[]', 0, ?, ?)").bind(MARCUS, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'nina@example.com', 'Nina Bak', '[]', 0, ?, ?)").bind(NINA, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'omar@example.com', 'Omar Haddad', '[]', 0, ?, ?)").bind(OMAR, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq285_owner', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq285_speaker', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, PRIYA, EVENT_ID, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(ORGANIZER_SESSION, ORGANIZER, NOW + DAY, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)").bind(SPEAKER_SESSION, PRIYA, NOW + DAY, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES (?, ?, 'Pier 27', '', 0, ?, ?)").bind(BUILDING, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, 'Broadway', 400, 0, ?, 'Confidence monitor is stage left.', ?, ?)")
      .bind(BROADWAY, EVENT_ID, BUILDING, JSON.stringify(["HDMI", "Confidence monitor"]), NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, 'Mercer', 120, 1, '[]', NULL, ?, ?)")
      .bind(MERCER, EVENT_ID, BUILDING, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, 'Call for Proposals', 'cfp', 'session', 'open', NULL, ?, ?)").bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Panel: What Broke in Production', 'Four people, one hour.', 'accepted', 'public', ?, 'panel', ?, ?)`).bind(PANEL_SUBMISSION, EVENT_ID, FORM_ID, PRIYA, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Taming 40-Minute CI', 'An abstract.', 'accepted', 'public', ?, 'ci', ?, ?)`).bind(TALK_SUBMISSION, EVENT_ID, FORM_ID, PRIYA, NOW, NOW),
    ...PANELISTS.map((person, index) => env.DB
      .prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`part_mrq285_panel_${index}`, PANEL_SUBMISSION, person, index === 0 ? "moderator" : "speaker", index, NOW, NOW)),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mrq285_talk', ?, ?, 'speaker', 0, ?, ?)").bind(TALK_SUBMISSION, PRIYA, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 60, ?, NULL, 1, ?, ?)")
      .bind(PANEL_ITEM, EVENT_ID, PANEL_SUBMISSION, panelStart, BROADWAY, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, NULL, 'break', 'Coffee', ?, 30, ?, NULL, 1, ?, ?)")
      .bind(BREAK_ITEM, EVENT_ID, breakStart, BROADWAY, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 40, ?, NULL, 1, ?, ?)")
      .bind(TALK_ITEM, EVENT_ID, TALK_SUBMISSION, talkStart, BROADWAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload Session Presentation', 'file', '', ?, NULL, NULL, NULL, 0, 1, ?, ?)`).bind(SLIDES_TEMPLATE, EVENT_ID, NOW - 5 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(PANEL_SLIDES_TASK, EVENT_ID, PRIYA, PANEL_SUBMISSION, SLIDES_TEMPLATE, NOW - 5 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload Session Presentation', 'file', '', ?, 'open', NULL, NULL, NULL, ?, ?)`).bind(TALK_SLIDES_TASK, EVENT_ID, PRIYA, TALK_SUBMISSION, SLIDES_TEMPLATE, NOW + 5 * DAY, NOW, NOW),
  ]);
  // The talk's deck is in; the panel's is not, and its due date has passed.
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, filename, content_type, size_bytes, r2_key, r2_etag, sha256, status, created_at, updated_at)
     VALUES (?, ?, 'task_upload', ?, 'ci.pdf', 'application/pdf', 2000000, ?, 'etag', NULL, 'ready', ?, ?)`,
  ).bind(TALK_SLIDES_FILE, EVENT_ID, TALK_SLIDES_TASK, `uploads/${EVENT_ID}/task_upload/${TALK_SLIDES_FILE}.pdf`, NOW - DAY, NOW - DAY).run();
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ?, status = 'done', completed_at = ? WHERE id = ?")
    .bind(TALK_SLIDES_FILE, NOW - DAY, TALK_SLIDES_TASK).run();
});

test("CONTRACT · MRQ-285 — a minted link resolves, and revoking it makes it indistinguishable from one that never existed", async () => {
  const link = await mint("checkin", "Sam, front door");

  const resolved = await resolveDayOfLink(env.DB, link.token);
  expect(resolved?.id).toBe(link.id);
  expect(resolved?.event_id).toBe(EVENT_ID);
  expect(canMarkArrivals(resolved!)).toBe(true);

  // A token that was never minted, and a truncated one, both answer nothing —
  // the same answer a revoked link gets, which is the point.
  expect(await resolveDayOfLink(env.DB, "not-a-real-token")).toBeNull();
  expect(await resolveDayOfLink(env.DB, link.token.slice(0, -1))).toBeNull();
  expect(await resolveDayOfLink(env.DB, "")).toBeNull();

  const revoke = await call(`/api/v1/events/${EVENT_ID}/day-of/links/${link.id}`, { session: ORGANIZER_SESSION, method: "DELETE" });
  expect(revoke.status).toBe(200);
  const revokedAt = (await revoke.json() as { data: { revoked_at: number } }).data.revoked_at;
  expect(revokedAt).toBeGreaterThan(0);
  expect(await resolveDayOfLink(env.DB, link.token)).toBeNull();

  // Revoking twice re-dates nothing and records nothing: the credential died
  // once, and the log has to agree with that.
  const again = await call(`/api/v1/events/${EVENT_ID}/day-of/links/${link.id}`, { session: ORGANIZER_SESSION, method: "DELETE" });
  expect(again.status).toBe(200);
  expect((await again.json() as { data: { revoked_at: number } }).data.revoked_at).toBe(revokedAt);
  expect(await auditRows("day_of_link_revoked")).toHaveLength(1);

  // A revoked link stays listed — what happened to a credential is part of its
  // record — and the token itself is never readable again.
  const list = await call(`/api/v1/events/${EVENT_ID}/day-of/links`, { session: ORGANIZER_SESSION });
  const listed = (await list.json() as { data: { id: string; revoked_at: number | null }[] }).data;
  expect(listed.map((row) => row.id)).toContain(link.id);
  expect(JSON.stringify(listed)).not.toContain("token_hash");
});

test("CONTRACT · MRQ-285 — rotating the green-room link kills every copy of the previous URL", async () => {
  const first = await mint("green_room", "Green room");
  expect(await resolveDayOfLink(env.DB, first.token)).not.toBeNull();

  const second = await mint("green_room", "Green room");
  expect(await resolveDayOfLink(env.DB, first.token)).toBeNull();
  expect((await resolveDayOfLink(env.DB, second.token))?.id).toBe(second.id);

  // A volunteer's check-in link is not swept up by a green-room rotation:
  // rotation is per kind, or every phone in the building would go dark at once.
  const volunteer = await mint("checkin", "Sam, front door");
  await mint("green_room", "Green room");
  expect(await resolveDayOfLink(env.DB, volunteer.token)).not.toBeNull();

  expect(await auditRows("day_of_link_rotated")).toHaveLength(3);
});

test("CONTRACT · MRQ-285 — arrival is one speaker on one session, so a panel of four reads honestly", async () => {
  const link = await mint("checkin", "Sam, front door");

  const before = panel(await runOfShow());
  expect(before.speakers).toHaveLength(4);
  expect(before.arrived_count).toBe(0);

  const marked = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { key: link.token, body: { person_id: NINA } });
  expect(marked.status).toBe(200);
  const markedBody = await marked.json() as { data: { changed: boolean; arrived_at: number; marked_by_name: string } };
  expect(markedBody.data.changed).toBe(true);
  expect(markedBody.data.marked_by_name).toBe("Sam, front door");

  const after = panel(await runOfShow());
  expect(after.arrived_count).toBe(1);
  expect(after.speakers.filter((speaker) => speaker.arrived_at !== null).map((speaker) => speaker.person_id)).toEqual([NINA]);
  expect(after.speakers.find((speaker) => speaker.person_id === NINA)?.marked_by_name).toBe("Sam, front door");

  // Priya is on the panel AND on the 10:40 talk. Marking her into the panel
  // says nothing about the talk — "here today" is not a fact this product holds.
  await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { key: link.token, body: { person_id: PRIYA } });
  const snapshot = await runOfShow();
  expect(panel(snapshot).arrived_count).toBe(2);
  const talk = snapshot.rooms.find((room) => room.id === BROADWAY)!.sessions.find((session) => session.id === TALK_ITEM)!;
  expect(talk.arrived_count).toBe(0);
  expect(talk.speakers.find((speaker) => speaker.person_id === PRIYA)?.arrived_at).toBeNull();

  // A second tap on the volunteer's phone is the same fact, not a second one:
  // it succeeds, changes nothing, and — this is the part that matters — writes
  // no second audit row for an arrival that only happened once.
  const repeat = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { key: link.token, body: { person_id: NINA } });
  expect(repeat.status).toBe(200);
  expect((await repeat.json() as { data: { changed: boolean } }).data.changed).toBe(false);
  expect(panel(await runOfShow()).arrived_count).toBe(2);

  const cleared = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals/${NINA}`, { key: link.token, method: "DELETE" });
  expect(cleared.status).toBe(200);
  const settled = panel(await runOfShow());
  expect(settled.arrived_count).toBe(1);
  expect(settled.speakers.find((speaker) => speaker.person_id === NINA)?.arrived_at).toBeNull();

  // Every write is attributable: two arrivals, one removal, and the link's name
  // is on each of them even though no person was signed in.
  const arrivals = await auditRows("checked_in");
  expect(arrivals).toHaveLength(2);
  expect(arrivals.every((row) => row.actor_kind === "system")).toBe(true);
  expect(arrivals.every((row) => JSON.parse(row.after_json!).marked_by_name === "Sam, front door")).toBe(true);
  expect(arrivals.every((row) => JSON.parse(row.after_json!).link_id === link.id)).toBe(true);
  expect(await auditRows("checkin_removed")).toHaveLength(1);
});

test("CONTRACT · MRQ-285 — a speaker cannot be marked into a session they are not on", async () => {
  const link = await mint("checkin", "Sam, front door");
  // Marcus is on the panel, not on the 10:40 talk.
  const wrongSession = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${TALK_ITEM}/arrivals`, { key: link.token, body: { person_id: MARCUS } });
  expect(wrongSession.status).toBe(404);
  // A break owns no speakers at all.
  const breakItem = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${BREAK_ITEM}/arrivals`, { key: link.token, body: { person_id: MARCUS } });
  expect(breakItem.status).toBe(404);
  expect(await auditRows("checked_in")).toHaveLength(0);
});

test("CONTRACT · MRQ-285 — a check-in link reaches the arrival routes and nothing else", async () => {
  const checkin = await mint("checkin", "Sam, front door");
  const greenRoom = await mint("green_room", "Green room");

  // The whole safety argument for handing a URL to a volunteer with no account
  // is that the key is inert everywhere else. Asserted, not reasoned about.
  for (const path of [
    `/api/v1/events/${EVENT_ID}/run-of-show`,
    `/api/v1/events/${EVENT_ID}/slides-board`,
    `/api/v1/events/${EVENT_ID}/day-of/links`,
    `/api/v1/events/${EVENT_ID}/files`,
    `/api/v1/events/${EVENT_ID}/speakers`,
    `/api/v1/events/${EVENT_ID}/submissions`,
    `/api/v1/events/${EVENT_ID}/speaker-tasks`,
    `/api/v1/events/${EVENT_ID}/agenda`,
    `/api/v1/events/${EVENT_ID}/dashboard`,
    `/api/v1/events/${EVENT_ID}/outbox`,
  ]) {
    const response = await call(path, { key: checkin.token });
    expect([401, 403], `${path} accepted a day-of key (${response.status})`).toContain(response.status);
  }

  // Nor can it mint or revoke credentials of its own.
  const mintAttempt = await call(`/api/v1/events/${EVENT_ID}/day-of/links`, { key: checkin.token, body: { kind: "checkin", name: "self-issued" } });
  expect([401, 403]).toContain(mintAttempt.status);
  const revokeAttempt = await call(`/api/v1/events/${EVENT_ID}/day-of/links/${greenRoom.id}`, { key: checkin.token, method: "DELETE" });
  expect([401, 403]).toContain(revokeAttempt.status);

  // A green-room link only looks: on the write it is refused as not-found, the
  // same answer a wrong key gets, so its holder learns nothing about the ladder.
  const looking = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { key: greenRoom.token, body: { person_id: NINA } });
  expect(looking.status).toBe(404);

  // And a key scoped to another conference is refused on this one.
  const foreign = await call(`/api/v1/events/${OTHER_EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { key: checkin.token, body: { person_id: NINA } });
  expect(foreign.status).toBe(404);

  // No key at all, and no session: the arrival route is public in policy and
  // authorized in the handler, so this has to be the answer.
  const anonymous = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { body: { person_id: NINA } });
  expect(anonymous.status).toBe(401);

  // A speaker's own seat is not an ops seat.
  const speaker = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { session: SPEAKER_SESSION, body: { person_id: NINA } });
  expect(speaker.status).toBe(403);
  const speakerLinks = await call(`/api/v1/events/${EVENT_ID}/day-of/links`, { session: SPEAKER_SESSION });
  expect(speakerLinks.status).toBe(403);

  expect(await auditRows("checked_in")).toHaveLength(0);
});

test("CONTRACT · MRQ-285 — an organizer marks arrivals too, and the log says it was a person", async () => {
  const marked = await call(`/api/v1/events/${EVENT_ID}/agenda-items/${PANEL_ITEM}/arrivals`, { session: ORGANIZER_SESSION, body: { person_id: OMAR } });
  expect(marked.status).toBe(200);
  expect((await marked.json() as { data: { marked_by_name: string } }).data.marked_by_name).toBe("Jordan Alvarez");
  const rows = await auditRows("checked_in");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.actor_kind).toBe("user");
  expect(JSON.parse(rows[0]!.after_json!).link_id).toBeNull();
});

test("CONTRACT · MRQ-285 — the slides board counts what it filters, and a deck that is in is not chased", async () => {
  const board = async (query = "") => {
    const response = await call(`/api/v1/events/${EVENT_ID}/slides-board?day=${DAY_ONE}${query}`, { session: ORGANIZER_SESSION });
    expect(response.status).toBe(200);
    return (await response.json() as { data: { rows: { session_id: string; slides: { state: string } }[]; counts: Record<string, number> } }).data;
  };

  const all = await board();
  // The break is not a row: it owes nothing and nobody chases it.
  expect(all.rows.map((row) => row.session_id).sort()).toEqual([PANEL_ITEM, TALK_ITEM].sort());
  expect(all.counts.received).toBe(1);
  expect(all.counts.overdue).toBe(1);

  const overdue = await board("&state=overdue");
  expect(overdue.rows.map((row) => row.session_id)).toEqual([PANEL_ITEM]);
  // Counts are taken before the filter, so clicking a count always produces
  // exactly the set the count promised.
  expect(overdue.counts.received).toBe(all.counts.received);
  expect(overdue.rows).toHaveLength(overdue.counts.overdue);

  const received = await board("&state=received");
  expect(received.rows.map((row) => row.session_id)).toEqual([TALK_ITEM]);

  const otherRoom = await board(`&room_id=${MERCER}`);
  expect(otherRoom.rows).toHaveLength(0);
});

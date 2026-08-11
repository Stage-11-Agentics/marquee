import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import { cancelCalendarInvites, sendCalendarInvites } from "../../src/jobs/calendar/invites";
import { applyMigrations } from "./apply-migrations";

const EVENT_ID = "evt_calendar";
const SUBMISSION_ID = "submission_calendar";
const PERSON_ID = "person_calendar";
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_calendar", "Calendar Conference", "calendar", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)").bind(EVENT_ID, "org_calendar", "Calendar Conference", "calendar", "2026-09-09", "2026-09-10", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind(PERSON_ID, "org_calendar", "ada@example.com", "Ada Lovelace", NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, 12, ?, ?, ?)").bind("building_calendar", EVENT_ID, "Sheraton New York Times Square", "811 7th Ave", 40.7625, -73.9814, "Use the east entrance", NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 0, ?, ?, ?)").bind("room_calendar", EVENT_ID, "building_calendar", "Metropolitan Ballroom", "[\"Projector\"]", NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)").bind(SUBMISSION_ID, EVENT_ID, "Reliable multi-agent systems", PERSON_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)").bind("participation_calendar", SUBMISSION_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)").bind("agenda_calendar", EVENT_ID, SUBMISSION_ID, Date.parse("2026-09-09T19:00:00.000Z"), "room_calendar", NOW, NOW),
  ]);
});
test("AC-95, AC-96, AC-97, AC-124, AC-252, AC-262 · request update cancel keeps one UID sequence, escaped address, and GEO", async () => {
  const first = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW });
  const second = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 1_000 });
  const cancelled = await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 2_000 });

  expect(first).toMatchObject([{ method: "REQUEST", sequence: 0, uid: `${SUBMISSION_ID}.${PERSON_ID}@marquee.example` }]);
  expect(second).toMatchObject([{ method: "REQUEST", sequence: 1, uid: first[0]?.uid }]);
  expect(cancelled).toMatchObject([{ method: "CANCEL", sequence: 2, uid: first[0]?.uid }]);

  const rows = await env.DB.prepare("SELECT sequence, last_method, status, uid FROM calendar_invites WHERE submission_id = ?").bind(SUBMISSION_ID).all<{ sequence: number; last_method: string; status: string; uid: string }>();
  expect(rows.results).toEqual([{ sequence: 2, last_method: "CANCEL", status: "cancelled", uid: first[0]?.uid }]);

  const outbox = await env.DB.prepare("SELECT ics_uid, ics_body, entity_id, send_policy FROM outbox WHERE event_id = ? ORDER BY created_at ASC").bind(EVENT_ID).all<{ ics_uid: string; ics_body: string; entity_id: string; send_policy: string }>();
  expect(outbox.results).toHaveLength(3);
  expect(outbox.results.map((row) => row.ics_uid)).toEqual([first[0]?.uid, first[0]?.uid, first[0]?.uid]);
  expect(outbox.results.map((row) => row.ics_body.match(/SEQUENCE:(\d+)/)?.[1])).toEqual(["0", "1", "2"]);
  expect(outbox.results.map((row) => row.ics_body.match(/METHOD:(REQUEST|CANCEL)/)?.[1])).toEqual(["REQUEST", "REQUEST", "CANCEL"]);
  expect(outbox.results.every((row) => row.send_policy === "demo_safe")).toBe(true);
  expect(outbox.results[0]?.ics_body).toContain("LOCATION:Metropolitan Ballroom\\, Sheraton New York Times Square");
  expect(outbox.results[0]?.ics_body).toContain("GEO:40.7625;-73.9814");
  expect(outbox.results[0]?.ics_body).not.toContain("Use the east entrance");
  expect(outbox.results[0]?.ics_body).not.toContain("Projector");

  const publicResponse = await SELF.fetch(`https://marquee.example/i/${encodeURIComponent(first[0]!.uid)}.ics`);
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get("content-type")).toContain("text/calendar");
  expect(await publicResponse.text()).toBe(outbox.results[2]?.ics_body);
});

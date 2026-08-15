import { SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * The existing record-board suite asserts can_decide is FALSE for scheduled and
 * published records — the direction MRQ-76 tightened. Nothing asserted it TRUE
 * for anything, so when MRQ-76 moved the gate from the stored status onto the
 * derived stage, waitlisted/rejected/withdrawn silently lost their decision
 * buttons and every gate stayed green. This file pins the loosening direction.
 */

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SESSION_ID = "sess-mrq-83-admin";
const ORIGIN = "https://marquee.stage11.dev";
const ROOM_ID = "room-mrq-83";
const BUILDING_ID = "building-mrq-83";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${SESSION_ID}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function actionsFor(id: string): Promise<{ stage: string; actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean } }> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ stage: string; actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean } }>;
}

async function insertSubmission(id: string, status: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
     VALUES (?, ?, 'session', ?, ?, 'public', ?, ?, ?, ?, ?)`,
  ).bind(id, EVENT_ID, `MRQ-83 ${status}`, status, ORGANIZER_ID, now, now, now, now).run();
}

beforeAll(async () => {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
     VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)`,
  ).bind(SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now).run();
  await env.DB.prepare(
    `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
     VALUES (?, ?, 'MRQ-83 Hall', '1 Example Way', 0, NULL, NULL, 5, NULL, ?, ?)`,
  ).bind(BUILDING_ID, EVENT_ID, now, now).run();
  await env.DB.prepare(
    `INSERT INTO rooms (id, building_id, event_id, name, capacity, av_capabilities, notes, position, created_at, updated_at)
     VALUES (?, ?, ?, 'Room 83', 100, '[]', NULL, 0, ?, ?)`,
  ).bind(ROOM_ID, BUILDING_ID, EVENT_ID, now, now).run();

  for (const status of ["waitlisted", "rejected", "withdrawn"]) {
    await insertSubmission(`sub-mrq83-${status}`, status);
  }
  // A withdrawn record that still holds its agenda slot: reversing an
  // acceptance does not remove the agenda row, so this is the real post-
  // reversal shape rather than a contrived one.
  await insertSubmission("sub-mrq83-withdrawn-scheduled", "withdrawn");
  // clock-check: allow — agenda starts_at is an exact schedule instant, not an event-local calendar deadline
  await env.DB.prepare(
    `INSERT INTO agenda_items (id, event_id, submission_id, kind, room_id, track_id, starts_at, duration_min, is_published, created_at, updated_at)
     VALUES ('agenda-mrq83', ?, 'sub-mrq83-withdrawn-scheduled', 'session', ?, NULL, ?, 30, 0, ?, ?)`,
  ).bind(EVENT_ID, ROOM_ID, now + 86_400_000, now, now).run();
});

// Written out rather than table-driven: `test.each(...)` passes an array where
// trace:ac expects a literal title, so it reports a dynamic-title error.
async function expectDecidableDeadEndFree(id: string): Promise<void> {
  const record = await actionsFor(id);
  expect(record.stage).toBe("declined");
  // The whole defect: Maybe/Reject/Withdraw must not be a trap door.
  expect(record.actions.can_decide).toBe(true);
  // Declined is not accepted, so neither scheduling nor publishing is offered.
  expect(record.actions.can_schedule).toBe(false);
  expect(record.actions.can_publish).toBe(false);
}

test("CONTRACT · a waitlisted record keeps a way back to a decision", async () => {
  await expectDecidableDeadEndFree("sub-mrq83-waitlisted");
});

test("CONTRACT · a rejected record keeps a way back to a decision", async () => {
  await expectDecidableDeadEndFree("sub-mrq83-rejected");
});

test("CONTRACT · a withdrawn record keeps a way back to a decision", async () => {
  await expectDecidableDeadEndFree("sub-mrq83-withdrawn");
});

test("CONTRACT · a withdrawn record that still holds an agenda slot is never publishable", async () => {
  const record = await actionsFor("sub-mrq83-withdrawn-scheduled");
  // It derives to `scheduled`, because the stage arms key on the agenda row and
  // not on the status — which is exactly why can_publish cannot be stage-gated.
  expect(record.stage).toBe("scheduled");
  expect(record.actions.can_publish).toBe(false);
});

test("CONTRACT · the publish route refuses a record that is not accepted, not just the button", async () => {
  const response = await request(
    `/api/v1/events/${EVENT_ID}/submissions/sub-mrq83-withdrawn-scheduled/publish`,
    { method: "POST" },
  );
  // A UI-only gate is meaningless here: any program:write token can call this
  // directly, and publishing puts a withdrawn speaker on the public site.
  expect(response.status).toBe(409);
  const published = await env.DB.prepare(
    "SELECT is_published FROM agenda_items WHERE id = 'agenda-mrq83'",
  ).first<{ is_published: number }>();
  expect(published?.is_published).toBe(0);
});

import { env, SELF } from "cloudflare:test";
import type { Queue } from "@cloudflare/workers-types";
import { beforeEach, expect, test } from "vitest";

import {
  cancelCalendarInvites,
  drainCalendarCancellations,
  prepareCalendarCancellationBatch,
  sendCalendarInvites,
} from "../../src/jobs/calendar/invites";
import { processMailOutbox, type MailProvider } from "../../src/jobs/mail/consumer";
import { MAX_CALENDAR_CANCELLATION_ATTEMPTS } from "../../src/jobs/calendar/limits";
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
test("AC-95, AC-96, AC-97, AC-124, AC-252, AC-262, AC-319 · request update cancel keeps one UID sequence, escaped address, and GEO", async () => {
  const first = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW });
  const second = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 1_000 });
  const cancelled = await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 2_000 });

  expect(first).toMatchObject([{ method: "REQUEST", sequence: 0, uid: `${SUBMISSION_ID}.${PERSON_ID}@marquee.stage11.dev` }]);
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

  const publicResponse = await SELF.fetch(`https://marquee.stage11.dev/i/${encodeURIComponent(first[0]!.uid)}.ics`);
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get("content-type")).toContain("text/calendar");
  expect(await publicResponse.text()).toBe(outbox.results[2]?.ics_body);
});

test("AC-320 · an invite remains cancellable after its agenda row is unscheduled", async () => {
  await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  await env.DB.prepare("DELETE FROM agenda_items WHERE event_id = ? AND submission_id = ?").bind(EVENT_ID, SUBMISSION_ID).run();

  const cancelled = await cancelCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });

  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]).toMatchObject({ method: "CANCEL", sequence: 1 });
  const outbox = await env.DB
    .prepare("SELECT ics_body FROM outbox WHERE event_id = ? ORDER BY created_at ASC")
    .bind(EVENT_ID)
    .all<{ ics_body: string }>();
  expect(outbox.results.at(-1)?.ics_body).toContain("METHOD:CANCEL");
});

test("AC-321 · a missing snapshot fails one invite closed without aborting its batch", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person_calendar_legacy", "org_calendar", "legacy@example.com", "Legacy Invitee", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 1, ?, ?)").bind("participation_calendar_legacy", SUBMISSION_ID, "person_calendar_legacy", NOW, NOW),
  ]);
  const invites = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW });
  const valid = invites.find((invite) => invite.person_id === PERSON_ID)!;
  const legacy = invites.find((invite) => invite.person_id === "person_calendar_legacy")!;
  await env.DB.prepare("UPDATE calendar_invites SET request_snapshot = NULL WHERE uid = ?").bind(valid.uid).run();

  const deliveries = await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 1_000 });
  expect(deliveries).toMatchObject([{ method: "CANCEL", uid: legacy.uid }]);
  expect(deliveries).toHaveLength(1);
  const failed = await env.DB.prepare(
    "SELECT status, attempts, last_error FROM calendar_cancellations WHERE uid = ?",
  ).bind(valid.uid).first<{ status: string; attempts: number; last_error: string }>();
  expect(failed).toMatchObject({ status: "failed", last_error: "calendar cancellation snapshot unavailable for " + valid.uid });
  expect(failed?.attempts).toBeGreaterThanOrEqual(1);
  expect((await env.DB.prepare("SELECT status FROM calendar_invites WHERE uid = ?").bind(valid.uid).first<{ status: string }>())?.status).toBe("active");
  expect((await env.DB.prepare("SELECT status FROM calendar_invites WHERE uid = ?").bind(legacy.uid).first<{ status: string }>())?.status).toBe("cancelled");
});

test("AC-322 · a reversal drain returns only the cancellation intents it created", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person_calendar_other", "org_calendar", "other@example.com", "Other Invitee", NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)").bind("submission_calendar_other", EVENT_ID, "Other session", PERSON_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)").bind("participation_calendar_other", "submission_calendar_other", "person_calendar_other", NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)").bind("agenda_calendar_other", EVENT_ID, "submission_calendar_other", Date.parse("2026-09-09T20:00:00.000Z"), "room_calendar", NOW, NOW),
  ]);
  await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW });
  const other = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: "submission_calendar_other", now: NOW });
  const deliveries = await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 1_000 });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.uid).not.toBe(other[0]?.uid);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM calendar_cancellations WHERE uid = ?").bind(other[0]!.uid).first<{ count: number }>())?.count).toBe(0);
});

test("AC-323 · fail-closed cancellation rows abandon at the cap and cannot starve healthy rows", async () => {
  const first = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW });
  await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: SUBMISSION_ID, now: NOW + 1_000 });
  const poisoned = await env.DB.prepare("SELECT idempotency_key FROM calendar_cancellations WHERE uid = ?").bind(first[0]!.uid).first<{ idempotency_key: string }>();
  await env.DB.prepare("UPDATE calendar_cancellations SET status = 'failed', snapshot_json = '{}' WHERE uid = ?").bind(first[0]!.uid).run();
  for (let attempt = 0; attempt < MAX_CALENDAR_CANCELLATION_ATTEMPTS + 2; attempt += 1) {
    await drainCalendarCancellations({ db: env.DB, queue: env.MAIL_QUEUE, now: NOW + 2_000 + attempt, limit: 1, idempotencyKeys: [poisoned!.idempotency_key] });
  }
  const poisonedRow = await env.DB.prepare("SELECT status, attempts FROM calendar_cancellations WHERE uid = ?").bind(first[0]!.uid).first<{ status: string; attempts: number }>();
  expect(poisonedRow).toEqual({ status: "abandoned", attempts: MAX_CALENDAR_CANCELLATION_ATTEMPTS });

  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person_calendar_healthy", "org_calendar", "healthy@example.com", "Healthy Invitee", NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)").bind("submission_calendar_healthy", EVENT_ID, "Healthy session", PERSON_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)").bind("participation_calendar_healthy", "submission_calendar_healthy", "person_calendar_healthy", NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)").bind("agenda_calendar_healthy", EVENT_ID, "submission_calendar_healthy", Date.parse("2026-09-09T20:00:00.000Z"), "room_calendar", NOW, NOW),
  ]);
  const healthy = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: env.MAIL_QUEUE, submissionId: "submission_calendar_healthy", now: NOW });
  const batch = await prepareCalendarCancellationBatch({ db: env.DB, eventId: EVENT_ID, submissionId: "submission_calendar_healthy", now: NOW + 3_000 });
  await env.DB.batch(batch.statements);
  const healthyDelivery = await drainCalendarCancellations({ db: env.DB, queue: env.MAIL_QUEUE, now: NOW + 3_000, limit: 1 });
  expect(healthyDelivery).toMatchObject([{ method: "CANCEL", uid: healthy[0]!.uid }]);
});

test("AC-319 · cancellation material stays on the delivered snapshot after live rows change", async () => {
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  const request = await env.DB
    .prepare("SELECT ics_body FROM outbox WHERE event_id = ? AND entity_id = ?")
    .bind(EVENT_ID, `${first[0]!.uid}:0`)
    .first<{ ics_body: string }>();
  expect(request).not.toBeNull();

  await env.DB.batch([
    env.DB.prepare("UPDATE people SET email = ?, name = ? WHERE id = ?").bind("new@example.com", "Changed Name", PERSON_ID),
    env.DB.prepare("UPDATE submissions SET title = ?, abstract = ? WHERE id = ?").bind("Changed title", "Changed abstract", SUBMISSION_ID),
    env.DB.prepare("DELETE FROM agenda_items WHERE event_id = ? AND submission_id = ?").bind(EVENT_ID, SUBMISSION_ID),
  ]);

  await cancelCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });
  const cancellation = await env.DB
    .prepare("SELECT ics_body FROM outbox WHERE event_id = ? AND template_key = 'calendar_cancel'")
    .bind(EVENT_ID)
    .first<{ ics_body: string }>();
  expect(cancellation).not.toBeNull();
  const stableLines = (body: string) => body.split("\r\n").filter((line) => /^(UID:|DTSTART|DTEND|SUMMARY:|DESCRIPTION:|LOCATION:|GEO:|URL:|ORGANIZER;|ATTENDEE;)/.test(line));
  expect(stableLines(cancellation!.ics_body)).toEqual(stableLines(request!.ics_body));
  expect(cancellation!.ics_body).toContain("mailto:ada@example.com");
  expect(cancellation!.ics_body).not.toContain("mailto:new@example.com");
  expect(cancellation!.ics_body).toContain("SUMMARY:Reliable multi-agent systems");
  expect(cancellation!.ics_body).not.toContain("SUMMARY:Changed title");

  const intent = await env.DB
    .prepare("SELECT to_email, sequence, status, attempts, cancelled_at FROM calendar_cancellations WHERE uid = ?")
    .bind(first[0]!.uid)
    .first<{ to_email: string; sequence: number; status: string; attempts: number; cancelled_at: number }>();
  expect(intent).toMatchObject({ to_email: "ada@example.com", sequence: 1, status: "queued", attempts: 1, cancelled_at: NOW + 1_000 });
});

test("AC-324 · a failed CANCEL reopens at the same idempotency key and DTSTAMP", async () => {
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  await cancelCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });
  const before = await env.DB
    .prepare("SELECT id, idempotency_key, ics_body FROM outbox WHERE event_id = ? AND template_key = 'calendar_cancel'")
    .bind(EVENT_ID)
    .first<{ id: string; idempotency_key: string; ics_body: string }>();
  expect(before).not.toBeNull();

  const failingProvider: MailProvider = {
    sendBatch: async () => [],
    sendSingle: async () => { throw new Error("provider unavailable"); },
  };
  await processMailOutbox(env.DB, env, [before!.id], { provider: failingProvider, now: NOW + 2_000, sleep: async () => undefined });
  expect((await env.DB.prepare("SELECT status FROM outbox WHERE id = ?").bind(before!.id).first<{ status: string }>())?.status).toBe("failed");
  expect((await env.DB.prepare("SELECT status FROM calendar_cancellations WHERE uid = ?").bind(first[0]!.uid).first<{ status: string }>())?.status).toBe("failed");

  const retried = await drainCalendarCancellations({ db: env.DB, queue: env.MAIL_QUEUE, now: NOW + 3_000 });
  expect(retried).toMatchObject([{ method: "CANCEL", outbox_id: before!.id, sequence: 1, uid: first[0]!.uid }]);
  const reopened = await env.DB
    .prepare("SELECT id, idempotency_key, ics_body, status FROM outbox WHERE id = ?")
    .bind(before!.id)
    .first<{ id: string; idempotency_key: string; ics_body: string; status: string }>();
  const retriedIntent = await env.DB
    .prepare("SELECT status, attempts, cancelled_at FROM calendar_cancellations WHERE uid = ?")
    .bind(first[0]!.uid)
    .first<{ status: string; attempts: number; cancelled_at: number }>();
  expect(reopened).toMatchObject({ id: before!.id, idempotency_key: before!.idempotency_key, ics_body: before!.ics_body, status: "queued" });
  expect(retriedIntent).toMatchObject({ status: "queued", attempts: 2, cancelled_at: NOW + 1_000 });

  const successfulProvider: MailProvider = {
    sendBatch: async () => [],
    sendSingle: async () => "provider-cancel-1",
  };
  await processMailOutbox(env.DB, env, [before!.id], { provider: successfulProvider, now: NOW + 4_000, sleep: async () => undefined });
  expect((await env.DB.prepare("SELECT status FROM calendar_cancellations WHERE uid = ?").bind(first[0]!.uid).first<{ status: string }>())?.status).toBe("sent");
});

test("AC-325 · the UID floor survives invite deletion", async () => {
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  await env.DB.prepare("DELETE FROM calendar_invites WHERE submission_id = ? AND person_id = ?").bind(SUBMISSION_ID, PERSON_ID).run();
  await env.DB.prepare("DELETE FROM agenda_items WHERE event_id = ? AND submission_id = ?").bind(EVENT_ID, SUBMISSION_ID).run();
  const recreatedAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)",
  ).bind("agenda_calendar_recreated", EVENT_ID, SUBMISSION_ID, Date.parse("2026-09-09T19:00:00.000Z"), "room_calendar", recreatedAt, recreatedAt).run();

  const second = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 2_000,
  });
  expect(second).toMatchObject([{ uid: first[0]!.uid, sequence: 1 }]);
  expect((await env.DB.prepare("SELECT last_sequence FROM calendar_sequence_ledger WHERE uid = ?").bind(first[0]!.uid).first<{ last_sequence: number }>())?.last_sequence).toBe(1);
});

test("AC-326 · cancellation recipient and organizer mismatches fail closed", async () => {
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  await cancelCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });
  await env.DB.prepare("UPDATE calendar_cancellations SET to_email = ? WHERE uid = ?").bind("wrong@example.com", first[0]!.uid).run();
  expect(await drainCalendarCancellations({ db: env.DB, queue: env.MAIL_QUEUE, now: NOW + 2_000 })).toEqual([]);
  const intent = await env.DB.prepare("SELECT status, last_error FROM calendar_cancellations WHERE uid = ?").bind(first[0]!.uid).first<{ status: string; last_error: string }>();
  expect(intent).toMatchObject({ status: "failed", last_error: "calendar attendee does not match the outbox recipient" });
});

test("AC-327 · a resumed REQUEST requeues an admitted outbox row", async () => {
  const messages: unknown[] = [];
  const queue = { send: async (message: unknown) => { messages.push(message); } } as unknown as Queue<unknown>;
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM calendar_invites WHERE submission_id = ? AND person_id = ?").bind(SUBMISSION_ID, PERSON_ID),
    // The missing invite and floor model the pre-batch state after an
    // interrupted write; the existing outbox row is the durable half.
    env.DB.prepare("DELETE FROM calendar_sequence_ledger WHERE uid = ?").bind(first[0]!.uid),
  ]);
  messages.length = 0;

  const resumed = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });
  expect(resumed).toMatchObject([{ outbox_id: first[0]!.outbox_id, outbox_inserted: false, sequence: 0, uid: first[0]!.uid }]);
  expect(messages).toEqual([{ type: "mail_outbox", outbox_id: first[0]!.outbox_id }]);
});

test("AC-328 · removing the invited participant commits cancellation intent with participation removal", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person_calendar_submitter", "org_calendar", "submitter@example.com", "Calendar Submitter", NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'submitter', 1, ?, ?)").bind("participation_calendar_submitter", SUBMISSION_ID, "person_calendar_submitter", NOW, NOW),
  ]);
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
  });
  const submitterInvite = first.find((invite) => invite.person_id === "person_calendar_submitter")!;
  const batch = await prepareCalendarCancellationBatch({
    db: env.DB,
    eventId: EVENT_ID,
    personId: "person_calendar_submitter",
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
  });
  await env.DB.batch([
    ...batch.statements,
    env.DB.prepare("DELETE FROM participations WHERE submission_id = ? AND person_id = ? AND role = 'submitter'").bind(SUBMISSION_ID, "person_calendar_submitter"),
  ]);
  const deliveries = await drainCalendarCancellations({ db: env.DB, queue: env.MAIL_QUEUE, now: NOW + 1_000, idempotencyKeys: batch.idempotencyKeys });
  expect(deliveries).toMatchObject([{ method: "CANCEL", sequence: 1, uid: submitterInvite.uid }]);
  expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM participations WHERE submission_id = ? AND person_id = ? AND role = 'submitter'").bind(SUBMISSION_ID, "person_calendar_submitter").first<{ total: number }>())?.total).toBe(0);
  expect((await env.DB.prepare("SELECT status FROM calendar_cancellations WHERE uid = ?").bind(submitterInvite.uid).first<{ status: string }>())?.status).toBe("queued");
});

test("CONTRACT · MRQ-238 · only the explicit smoke harness opts calendar mail into always-live delivery", async () => {
  const first = await sendCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW,
    smokeHarness: true,
  });
  await cancelCalendarInvites({
    db: env.DB,
    eventId: EVENT_ID,
    queue: env.MAIL_QUEUE,
    submissionId: SUBMISSION_ID,
    now: NOW + 1_000,
    smokeHarness: true,
  });

  const outbox = await env.DB
    .prepare("SELECT send_policy FROM outbox WHERE event_id = ? ORDER BY created_at ASC")
    .bind(EVENT_ID)
    .all<{ send_policy: string }>();
  expect(first).toHaveLength(1);
  expect(outbox.results).toHaveLength(2);
  expect(outbox.results.every((row) => row.send_policy === "always_live")).toBe(true);
});

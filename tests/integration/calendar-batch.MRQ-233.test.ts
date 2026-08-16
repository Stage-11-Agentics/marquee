import { env, SELF } from "cloudflare:test";
import type { Queue } from "@cloudflare/workers-types";
import { beforeEach, expect, test } from "vitest";

import type { OutboxRow } from "../../src/db/schema";
import { calendarUid } from "../../src/jobs/calendar/ics";
import {
  CalendarBatchBlockedError,
  sendCalendarBatch,
} from "../../src/jobs/calendar/batch";
import {
  cancelCalendarInvites,
  sendCalendarInvites,
} from "../../src/jobs/calendar/invites";
import { claimCalendarSequence } from "../../src/jobs/calendar/sequence";
import { projectCalendarDebt } from "../../src/jobs/calendar/projection";
import { processMailOutbox, type MailProvider } from "../../src/jobs/mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../../src/jobs/mail/idempotency";
import { enqueueOutbox, buildIdempotencyKey } from "../../src/jobs/mail/outbox";
import { recordTimelinePage } from "../../src/lib/history";
import { applyMigrations, env as migrationEnv } from "./apply-migrations";

const EVENT_ID = "evt_calendar_batch";
const ORG_ID = "org_calendar_batch";
const SPEAKER_ID = "person_calendar_batch";
const BLOCKED_ID = "person_calendar_blocked";
const SUBMISSION_ONE = "submission_calendar_batch_one";
const SUBMISSION_TWO = "submission_calendar_batch_two";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const FIRST_START = Date.parse("2026-09-09T19:00:00.000Z");
const SECOND_START = Date.parse("2026-09-09T20:00:00.000Z");
const NOOP_QUEUE = { send: async (_message: unknown) => undefined } as unknown as Queue<unknown>;

interface CalendarAttachment {
  content: string;
  content_type: string;
  filename: string;
}

type CapturedDeliveryRow = OutboxRow & { calendar_parts?: readonly CalendarAttachment[] };

function provider(): MailProvider & { batches: OutboxRow[][]; singles: CapturedDeliveryRow[] } {
  const result = {
    batches: [] as OutboxRow[][],
    singles: [] as CapturedDeliveryRow[],
    async sendBatch(rows: readonly OutboxRow[]) {
      result.batches.push([...rows]);
      return rows.map((row) => `provider-${row.id}`);
    },
    async sendSingle(row: OutboxRow) {
      result.singles.push(row as CapturedDeliveryRow);
      return `provider-${row.id}`;
    },
  };
  return result;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await migrationEnv.DB.batch([
    migrationEnv.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(ORG_ID, "Calendar Batch Conference", "calendar-batch", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)",
    ).bind(EVENT_ID, ORG_ID, "Calendar Batch Conference", "calendar-batch", "2026-09-09", "2026-09-10", "America/New_York", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)",
    ).bind(SPEAKER_ID, ORG_ID, "speaker@example.com", "Batch Speaker", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, 12, ?, ?, ?)",
    ).bind("building_calendar_batch", EVENT_ID, "The Batch Hall", "1 Test Street", 40.7, -73.9, "Use the north entrance", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 0, ?, ?, ?)",
    ).bind("room_calendar_batch", EVENT_ID, "building_calendar_batch", "Room A", "[\"Projector\"]", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?), (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)",
    ).bind(
      SUBMISSION_ONE,
      EVENT_ID,
      "Opening session",
      SPEAKER_ID,
      NOW,
      NOW,
      SUBMISSION_TWO,
      EVENT_ID,
      "Closing session",
      SPEAKER_ID,
      NOW,
      NOW,
    ),
    migrationEnv.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?), (?, ?, ?, 'speaker', 0, ?, ?)",
    ).bind(
      "participation_calendar_batch_one",
      SUBMISSION_ONE,
      SPEAKER_ID,
      NOW,
      NOW,
      "participation_calendar_batch_two",
      SUBMISSION_TWO,
      SPEAKER_ID,
      NOW,
      NOW,
    ),
    migrationEnv.DB.prepare(
      "INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?), (?, ?, ?, 'session', ?, 30, ?, 0, ?, ?)",
    ).bind(
      "agenda_calendar_batch_one",
      EVENT_ID,
      SUBMISSION_ONE,
      FIRST_START,
      "room_calendar_batch",
      NOW,
      NOW,
      "agenda_calendar_batch_two",
      EVENT_ID,
      SUBMISSION_TWO,
      SECOND_START,
      "room_calendar_batch",
      NOW,
      NOW,
    ),
  ]);
}

async function addBlockedParticipation(): Promise<void> {
  await migrationEnv.DB.batch([
    migrationEnv.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)",
    ).bind(BLOCKED_ID, ORG_ID, "", "Address Missing", NOW, NOW),
    migrationEnv.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 1, ?, ?)",
    ).bind("participation_calendar_blocked", SUBMISSION_ONE, BLOCKED_ID, NOW, NOW),
  ]);
}

async function childRows(outboxId: string): Promise<Array<{ ics_body: string; ics_uid: string; part_index: number; sequence: number; submission_id: string }>> {
  const rows = await migrationEnv.DB.prepare(
    "SELECT submission_id, part_index, ics_uid, sequence, ics_body FROM outbox_calendar_parts WHERE outbox_id = ? ORDER BY part_index ASC",
  ).bind(outboxId).all<{ ics_body: string; ics_uid: string; part_index: number; sequence: number; submission_id: string }>();
  return rows.results;
}

async function getIcs(uid: string): Promise<{ body: string; response: Response }> {
  const response = await SELF.fetch(`https://marquee.stage11.dev/i/${encodeURIComponent(uid)}.ics`);
  return { body: await response.text(), response };
}

beforeEach(async () => {
  await seedFixture();
});

test("batch admission sends one provider email with one one-VEVENT REQUEST per session and audits every submission", async () => {
  const first = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  expect(first.deliveries).toHaveLength(1);
  expect(first.deliveries[0]?.parts).toHaveLength(2);
  expect(first.deliveries[0]?.sequence_set).toEqual([
    `${SUBMISSION_ONE}.${SPEAKER_ID}@marquee.stage11.dev:0`,
    `${SUBMISSION_TWO}.${SPEAKER_ID}@marquee.stage11.dev:0`,
  ]);

  const owner = await env.DB.prepare(
    "SELECT id, template_key, ics_uid, ics_body FROM outbox WHERE event_id = ? AND template_key = 'calendar_batch_request'",
  ).bind(EVENT_ID).first<{ ics_body: string | null; ics_uid: string | null; id: string; template_key: string }>();
  expect(owner).toMatchObject({ template_key: "calendar_batch_request", ics_uid: null, ics_body: null });
  const parts = await childRows(owner!.id);
  expect(parts).toHaveLength(2);
  expect(parts.every((part) => part.ics_body.match(/BEGIN:VEVENT/g)?.length === 1)).toBe(true);
  expect(parts.every((part) => part.ics_body.match(/METHOD:REQUEST/g)?.length === 1)).toBe(true);

  const fake = provider();
  const outcome = await processMailOutbox(env.DB, env, [owner!.id], { provider: fake, now: NOW + 1_000, sleep: async () => undefined });
  expect(outcome).toEqual({ sent: 1, suppressed: 0, failed: 0 });
  expect(fake.batches).toHaveLength(0);
  expect(fake.singles).toHaveLength(1);
  expect(fake.singles[0]?.calendar_parts).toHaveLength(2);
  expect(fake.singles[0]?.calendar_parts?.map((part) => part.filename)).toEqual([
    `${parts[0]?.ics_uid}.ics`,
    `${parts[1]?.ics_uid}.ics`,
  ]);
  expect(fake.singles[0]?.calendar_parts?.every((part) => part.content_type === "text/calendar; charset=utf-8; method=REQUEST")).toBe(true);

  const audits = await env.DB.prepare(
    "SELECT entity_id, after_json FROM audit_log WHERE event_id = ? AND action = 'submission.calendar_batch_sent' ORDER BY entity_id ASC",
  ).bind(EVENT_ID).all<{ after_json: string; entity_id: string }>();
  expect(audits.results.map((row) => row.entity_id)).toEqual([SUBMISSION_ONE, SUBMISSION_TWO]);
  expect(audits.results.every((row) => JSON.parse(row.after_json).batch_outbox_id === owner!.id)).toBe(true);
  const timeline = await recordTimelinePage(env.DB, EVENT_ID, SUBMISSION_ONE, { limit: 20, cursor: null });
  expect(timeline.entries.find((entry) => entry.action === "submission.calendar_batch_sent")).toMatchObject({
    action: "submission.calendar_batch_sent",
    summary: "Calendar batch sent",
  });
});

test("singular calendar delivery audits the real submission and appears in its timeline", async () => {
  const delivery = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW });
  const fake = provider();
  const outcome = await processMailOutbox(env.DB, env, [delivery[0]!.outbox_id], { provider: fake, now: NOW + 1_000, sleep: async () => undefined });
  expect(outcome).toEqual({ sent: 1, suppressed: 0, failed: 0 });

  const audit = await env.DB.prepare(`
    SELECT entity_type, entity_id, after_json
    FROM audit_log
    WHERE event_id = ? AND action = 'submission.calendar_sent'
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).bind(EVENT_ID).first<{ after_json: string; entity_id: string; entity_type: string }>();
  expect(audit?.entity_type).toBe("submission");
  expect(audit?.entity_id).toBe(SUBMISSION_ONE);
  expect(JSON.parse(audit!.after_json)).toMatchObject({
    outbox_id: delivery[0]!.outbox_id,
    method: "REQUEST",
    uid: delivery[0]!.uid,
    sequence: 0,
  });
  const timeline = await recordTimelinePage(env.DB, EVENT_ID, SUBMISSION_ONE, { limit: 20, cursor: null });
  expect(timeline.entries.find((entry) => entry.action === "submission.calendar_sent")).toMatchObject({
    action: "submission.calendar_sent",
    summary: "Calendar invitation sent",
    detail: "REQUEST",
  });
});

test("batch debt ignores non-slot snapshot changes, then a real agenda move creates one reschedule per speaker", async () => {
  const first = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  expect(first.no_op).toBe(false);

  const unchanged = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW + 1_000 });
  expect(unchanged.no_op).toBe(true);
  expect(unchanged.current_count).toBe(2);
  expect(unchanged.deliveries).toEqual([]);

  await env.DB.batch([
    env.DB.prepare("UPDATE submissions SET title = ?, abstract = ? WHERE event_id = ?").bind("Renamed session", "A changed abstract", EVENT_ID),
    env.DB.prepare("UPDATE people SET name = ? WHERE id = ?").bind("Renamed Speaker", SPEAKER_ID),
  ]);
  const nonSlotOnly = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW + 2_000 });
  expect(nonSlotOnly.no_op).toBe(true);
  expect(nonSlotOnly.current_count).toBe(2);

  await env.DB.prepare("UPDATE agenda_items SET starts_at = ?, updated_at = ? WHERE id = ?").bind(FIRST_START + 30 * 60_000, NOW + 3_000, "agenda_calendar_batch_one").run();
  const moved = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW + 3_000 });
  expect(moved.deliveries).toHaveLength(1);
  expect(moved.first_invite_count).toBe(0);
  expect(moved.unsent_update_count).toBe(1);
  expect(moved.deliveries[0]?.sequence_set).toEqual([
    `${SUBMISSION_ONE}.${SPEAKER_ID}@marquee.stage11.dev:1`,
  ]);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ? AND template_key = 'calendar_batch_request'").bind(EVENT_ID).first<{ count: number }>())?.count).toBe(2);
});

test("projection names invalid recipients before valid-email filtering and the batch fails closed when all debt is blocked", async () => {
  await addBlockedParticipation();
  const mixed = await projectCalendarDebt(env.DB, EVENT_ID);
  expect(mixed.sendable.map((item) => item.person_id)).toEqual([SPEAKER_ID, SPEAKER_ID]);
  expect(mixed.blocked).toEqual([{
    email: "",
    person_id: BLOCKED_ID,
    person_name: "Address Missing",
    reason: "missing email",
    submission_ids: [SUBMISSION_ONE],
  }]);

  await env.DB.prepare("UPDATE people SET email = ? WHERE id = ?").bind("not-an-email", SPEAKER_ID).run();
  try {
    await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
    throw new Error("expected blocked calendar batch to fail closed");
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarBatchBlockedError);
    expect((error as CalendarBatchBlockedError).blocked.map((recipient) => recipient.person_id).sort()).toEqual([BLOCKED_ID, SPEAKER_ID].sort());
  }
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ?").bind(EVENT_ID).first<{ count: number }>()).toEqual({ count: 0 });
});

test("CAS sequence claims reread a lost initialization and never double-claim the first revision", async () => {
  const uid = calendarUid(SUBMISSION_ONE, SPEAKER_ID);
  const claims = await Promise.all([
    claimCalendarSequence(env.DB, { currentSequence: null, now: NOW, uid }),
    claimCalendarSequence(env.DB, { currentSequence: null, now: NOW + 1, uid }),
  ]);
  expect(claims.map((claim) => claim.sequence).sort((left, right) => left - right)).toEqual([0, 1]);
  expect((await env.DB.prepare("SELECT last_sequence FROM calendar_sequence_ledger WHERE uid = ?").bind(uid).first<{ last_sequence: number }>())?.last_sequence).toBe(1);

  const legacyUid = "legacy-sequence@example.com";
  const legacyClaim = await claimCalendarSequence(env.DB, { currentSequence: 4, now: NOW + 2, uid: legacyUid });
  expect(legacyClaim).toEqual({ expectedPrior: 4, sequence: 5 });
});

test("a failed duplicate batch admission leaves the previously stamped snapshot untouched", async () => {
  const first = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const before = await env.DB.prepare(
    "SELECT sequence, request_snapshot FROM calendar_invites WHERE submission_id = ? AND person_id = ?",
  ).bind(SUBMISSION_ONE, SPEAKER_ID).first<{ request_snapshot: string; sequence: number }>();
  const firstParts = await childRows(first.deliveries[0]!.outbox_id);

  await env.DB.prepare("UPDATE agenda_items SET starts_at = ?, updated_at = ? WHERE id = ?").bind(FIRST_START + 30 * 60_000, NOW + 1_000, "agenda_calendar_batch_one").run();
  const movedPart = first.deliveries[0]!.parts.find((part) => part.submission_id === SUBMISSION_ONE)!;
  const nextRevisions = [{ sequence: movedPart.sequence + 1, uid: movedPart.uid }];
  const entityId = IDEMPOTENCY_REGISTRY.calendarBatch(SPEAKER_ID, nextRevisions);
  const corruptOwner = await enqueueOutbox({
    db: env.DB,
    eventId: EVENT_ID,
    templateKey: "calendar_batch_request",
    entityId,
    personId: SPEAKER_ID,
    toEmail: "speaker@example.com",
    subject: "Corrupt resumed batch",
    text: "Corrupt resumed batch",
    html: "<p>Corrupt resumed batch</p>",
    icsUid: null,
    icsBody: null,
    now: NOW + 1_000,
    idempotencyKey: await buildIdempotencyKey("calendar_batch_request", entityId, SPEAKER_ID),
  });
  await env.DB.batch(firstParts.filter((part) => part.submission_id === SUBMISSION_ONE).map((part, index) => env.DB.prepare(
    `INSERT INTO outbox_calendar_parts
      (id, outbox_id, submission_id, part_index, ics_uid, sequence, filename, ics_body, content_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `corrupt-calendar-part-${index}`,
    corruptOwner.id,
    part.submission_id,
    index,
    part.ics_uid,
    part.sequence,
    `${part.ics_uid}.ics`,
    part.ics_body,
    "text/calendar; charset=utf-8; method=REQUEST",
    NOW + 1_000,
    NOW + 1_000,
  )));

  await expect(sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW + 2_000 })).rejects.toThrow("calendar batch admission failed its storage invariant");
  const after = await env.DB.prepare(
    "SELECT sequence, request_snapshot FROM calendar_invites WHERE submission_id = ? AND person_id = ?",
  ).bind(SUBMISSION_ONE, SPEAKER_ID).first<{ request_snapshot: string; sequence: number }>();
  expect(after).toEqual(before);
  expect((await env.DB.prepare("SELECT last_sequence FROM calendar_sequence_ledger WHERE uid = ?").bind(firstParts[0]!.ics_uid).first<{ last_sequence: number }>())?.last_sequence).toBe(1);
});

test("GET /i/:uid.ics chooses the newest standalone REQUEST after a batch REQUEST", async () => {
  const batch = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const uid = batch.deliveries[0]!.parts[0]!.uid;
  const batchBody = (await childRows(batch.deliveries[0]!.outbox_id))[0]!.ics_body;
  expect((await getIcs(uid)).body).toBe(batchBody);

  const resend = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW + 1_000 });
  const standalone = await env.DB.prepare(
    "SELECT ics_body FROM outbox WHERE id = ?",
  ).bind(resend[0]!.outbox_id).first<{ ics_body: string }>();
  expect(resend[0]?.sequence).toBe(1);
  expect((await getIcs(uid)).body).toBe(standalone!.ics_body);
});

test("GET /i/:uid.ics chooses a newer CANCEL after a batch REQUEST", async () => {
  const batch = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const uid = batch.deliveries[0]!.parts[0]!.uid;
  await cancelCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW + 1_000 });
  const cancellation = await env.DB.prepare(
    "SELECT ics_body FROM outbox WHERE template_key = 'calendar_cancel' AND ics_uid = ?",
  ).bind(uid).first<{ ics_body: string }>();
  expect(cancellation?.ics_body).toContain("METHOD:CANCEL");
  expect((await getIcs(uid)).body).toBe(cancellation!.ics_body);
});

test("resolver ties same-timestamp owners by descending owner id and fails closed for mixed grains", async () => {
  const batch = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const uid = batch.deliveries[0]!.parts[0]!.uid;
  const batchPart = (await childRows(batch.deliveries[0]!.outbox_id))[0]!;
  const resend = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW });
  const standalone = await env.DB.prepare("SELECT id, ics_body FROM outbox WHERE id = ?").bind(resend[0]!.outbox_id).first<{ ics_body: string; id: string }>();
  const candidates = [
    { body: batchPart.ics_body, id: batch.deliveries[0]!.outbox_id },
    { body: standalone!.ics_body, id: standalone!.id },
  ].sort((left, right) => right.id.localeCompare(left.id));
  expect((await getIcs(uid)).body).toBe(candidates[0]!.body);

  await env.DB.prepare("UPDATE outbox SET ics_uid = ?, ics_body = ? WHERE id = ?").bind(uid, batchPart.ics_body, batch.deliveries[0]!.outbox_id).run();
  expect((await getIcs(uid)).response.status).toBe(404);
});

test("resolver rejects an unknown template grain instead of falling through to an older revision", async () => {
  const batch = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const uid = batch.deliveries[0]!.parts[0]!.uid;
  await env.DB.prepare("UPDATE outbox SET template_key = 'calendar_unknown' WHERE id = ?").bind(batch.deliveries[0]!.outbox_id).run();
  expect((await getIcs(uid)).response.status).toBe(404);
});

test("resolver fails closed for missing batch parts and corrupt standalone material", async () => {
  const batch = await sendCalendarBatch({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, now: NOW });
  const batchPart = (await childRows(batch.deliveries[0]!.outbox_id))[0]!;
  await env.DB.prepare("DELETE FROM outbox_calendar_parts WHERE outbox_id = ? AND ics_uid = ?")
    .bind(batch.deliveries[0]!.outbox_id, batchPart.ics_uid)
    .run();
  expect((await getIcs(batchPart.ics_uid)).response.status).toBe(404);

  const standalone = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW + 1_000 });
  const standaloneRow = await env.DB.prepare("SELECT id, ics_uid, ics_body FROM outbox WHERE id = ?")
    .bind(standalone[0]!.outbox_id)
    .first<{ ics_body: string; ics_uid: string; id: string }>();
  expect((await getIcs(standaloneRow!.ics_uid)).response.status).toBe(200);
  await env.DB.prepare("UPDATE outbox SET ics_body = NULL WHERE id = ?").bind(standaloneRow!.id).run();
  expect((await getIcs(standaloneRow!.ics_uid)).response.status).toBe(404);
});

test("resolver fails closed for same-owner grain mixing and template-method mismatch", async () => {
  const standalone = await sendCalendarInvites({ db: env.DB, eventId: EVENT_ID, queue: NOOP_QUEUE, submissionId: SUBMISSION_ONE, now: NOW });
  const standaloneRow = await env.DB.prepare("SELECT id, ics_uid, ics_body FROM outbox WHERE id = ?")
    .bind(standalone[0]!.outbox_id)
    .first<{ ics_body: string; ics_uid: string; id: string }>();
  await env.DB.prepare(`
    INSERT INTO outbox_calendar_parts
      (id, outbox_id, submission_id, part_index, ics_uid, sequence, filename, ics_body, content_type, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    "mixed-standalone-calendar-part",
    standaloneRow!.id,
    SUBMISSION_TWO,
    standaloneRow!.ics_uid,
    standalone[0]!.sequence,
    `${standaloneRow!.ics_uid}.ics`,
    standaloneRow!.ics_body,
    "text/calendar; charset=utf-8; method=REQUEST",
    NOW,
    NOW,
  ).run();
  expect((await getIcs(standaloneRow!.ics_uid)).response.status).toBe(404);

  await env.DB.prepare("DELETE FROM outbox_calendar_parts WHERE id = ?").bind("mixed-standalone-calendar-part").run();
  await env.DB.prepare("UPDATE outbox SET ics_body = REPLACE(ics_body, 'METHOD:REQUEST', 'METHOD:CANCEL') WHERE id = ?")
    .bind(standaloneRow!.id)
    .run();
  expect((await getIcs(standaloneRow!.ics_uid)).response.status).toBe(404);
});

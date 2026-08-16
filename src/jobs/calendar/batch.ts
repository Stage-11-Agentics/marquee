import type { D1Database, D1PreparedStatement, Queue } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { buildCalendarBatchMail, buildCalendarIcs, type CalendarBatchMailItem } from "./ics";
import { enqueueMailMessage } from "../mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../mail/idempotency";
import { buildIdempotencyKey, enqueueOutbox, enqueueSmokeHarnessMail } from "../mail/outbox";
import { CALENDAR_DEFAULT_ORIGIN, eventInputFromSnapshot, snapshotJson } from "./invites";
import { claimCalendarSequence } from "./sequence";
import {
  projectCalendarDebt,
  type CalendarDebtItem,
  type CalendarDebtProjection,
  type CalendarDebtSpeaker,
} from "./projection";

const BATCH_PART_CONTENT_TYPE = "text/calendar; charset=utf-8; method=REQUEST";
const MAX_D1_BATCH_STATEMENTS = 80;

export interface CalendarBatchPartResult {
  filename: string;
  sequence: number;
  submission_id: Id;
  uid: string;
}

export interface CalendarBatchDeliveryResult {
  first_invites: number;
  outbox_id: Id;
  outbox_inserted: boolean;
  parts: CalendarBatchPartResult[];
  person_id: Id;
  sequence_set: string[];
  speaker_name: string;
  update_count: number;
}

export interface CalendarBatchResult {
  blocked: CalendarDebtProjection["blocked"];
  blocked_only: boolean;
  current_count: number;
  deliveries: CalendarBatchDeliveryResult[];
  first_invite_count: number;
  no_op: boolean;
  unsent_update_count: number;
}

interface ClaimedItem {
  item: CalendarDebtItem;
  sequence: number;
}

interface ExistingBatchOwner {
  created_at: number;
  id: Id;
  person_id: Id;
  status: string;
  parts: ExistingBatchPart[];
}

interface ExistingBatchPart {
  content_type: string;
  filename: string;
  ics_body: string;
  ics_uid: string;
  outbox_id: Id;
  part_index: number;
  sequence: number;
  submission_id: Id;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push([...values.slice(index, index + size)]);
  return chunks;
}

async function runStatements(db: D1Database, statements: readonly D1PreparedStatement[]): Promise<void> {
  for (const group of chunk(statements, MAX_D1_BATCH_STATEMENTS)) {
    if (group.length > 0) await db.batch(group);
  }
}

async function readLedgerFloors(db: D1Database, items: readonly CalendarDebtItem[]): Promise<Map<string, number>> {
  const uids = [...new Set(items.map((item) => item.uid))];
  if (uids.length === 0) return new Map();
  const placeholders = uids.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT uid, last_sequence FROM calendar_sequence_ledger WHERE uid IN (${placeholders})`,
  ).bind(...uids).all<{ uid: string; last_sequence: number }>();
  return new Map(result.results.map((row) => [row.uid, row.last_sequence]));
}

async function readExistingBatchOwners(db: D1Database, eventId: Id, speakers: readonly CalendarDebtSpeaker[]): Promise<Map<Id, ExistingBatchOwner[]>> {
  const personIds = [...new Set(speakers.map((speaker) => speaker.person_id))];
  if (personIds.length === 0) return new Map();
  const personPlaceholders = personIds.map(() => "?").join(", ");
  const owners = await db.prepare(
    `SELECT id, person_id, status, created_at
     FROM outbox
     WHERE event_id = ? AND template_key = 'calendar_batch_request'
       AND person_id IN (${personPlaceholders})
       AND ics_uid IS NULL AND ics_body IS NULL
     ORDER BY created_at DESC, id DESC`,
  ).bind(eventId, ...personIds).all<{ created_at: number; id: Id; person_id: Id; status: string }>();
  if (owners.results.length === 0) return new Map();
  const ownerPlaceholders = owners.results.map(() => "?").join(", ");
  const parts = await db.prepare(
    `SELECT id, outbox_id, submission_id, part_index, ics_uid, sequence, filename, ics_body, content_type
     FROM outbox_calendar_parts
     WHERE outbox_id IN (${ownerPlaceholders})
     ORDER BY outbox_id ASC, part_index ASC`,
  ).bind(...owners.results.map((owner) => owner.id)).all<ExistingBatchPart>();
  const partsByOwner = new Map<Id, ExistingBatchPart[]>();
  for (const part of parts.results) partsByOwner.set(part.outbox_id, [...(partsByOwner.get(part.outbox_id) ?? []), part]);
  const byPerson = new Map<Id, ExistingBatchOwner[]>();
  for (const owner of owners.results) {
    const entry = { ...owner, parts: partsByOwner.get(owner.id) ?? [] };
    byPerson.set(owner.person_id, [...(byPerson.get(owner.person_id) ?? []), entry]);
  }
  return byPerson;
}

function exactExistingAdmission(
  owner: ExistingBatchOwner,
  speaker: CalendarDebtSpeaker,
): ClaimedItem[] | null {
  if (owner.parts.length !== speaker.items.length) return null;
  const claimed: ClaimedItem[] = [];
  for (const item of speaker.items) {
    const part = owner.parts.find((candidate) => candidate.submission_id === item.submission_id && candidate.ics_uid === item.uid);
    if (!part || part.content_type !== BATCH_PART_CONTENT_TYPE) return null;
    const body = buildCalendarIcs(eventInputFromSnapshot(item.snapshot, {
      dtstamp: owner.created_at,
      method: "REQUEST",
      sequence: part.sequence,
      uid: item.uid,
    }));
    if (body !== part.ics_body || part.filename !== `${item.uid}.ics`) return null;
    claimed.push({ item, sequence: part.sequence });
  }
  return claimed;
}

function batchMailItems(claimed: readonly ClaimedItem[]): CalendarBatchMailItem[] {
  return claimed.map(({ item, sequence }) => ({
    current: {
      durationMin: item.snapshot.duration_min,
      location: item.snapshot.location,
      startsAt: item.snapshot.starts_at,
      timezone: item.snapshot.timezone,
      title: item.snapshot.title,
      uid: item.uid,
    },
    previous: item.prior_snapshot
      ? { location: item.prior_snapshot.location, startsAt: item.prior_snapshot.starts_at }
      : null,
    sequence,
  }));
}

async function verifyBatchAdmission(db: D1Database, outboxId: Id, claimed: readonly ClaimedItem[]): Promise<boolean> {
  const owner = await db.prepare(
    `SELECT template_key, ics_uid, ics_body, created_at
     FROM outbox WHERE id = ?`,
  ).bind(outboxId).first<{ created_at: number; ics_body: string | null; ics_uid: string | null; template_key: string }>();
  if (!owner || owner.template_key !== "calendar_batch_request" || owner.ics_uid !== null || owner.ics_body !== null) return false;
  const rows = await db.prepare(
    `SELECT submission_id, ics_uid, sequence, filename, ics_body, content_type
     FROM outbox_calendar_parts WHERE outbox_id = ? ORDER BY part_index ASC`,
  ).bind(outboxId).all<ExistingBatchPart>();
  if (rows.results.length !== claimed.length) return false;
  return claimed.every(({ item, sequence }) => {
    const row = rows.results.find((candidate) => candidate.submission_id === item.submission_id);
    if (!row) return false;
    return row.ics_uid === item.uid
      && row.sequence === sequence
      && row.filename === `${item.uid}.ics`
      && row.content_type === BATCH_PART_CONTENT_TYPE
      && row.ics_body === buildCalendarIcs(eventInputFromSnapshot(item.snapshot, {
        dtstamp: owner.created_at,
        method: "REQUEST",
        sequence,
        uid: item.uid,
      }));
  });
}

async function stampInvites(db: D1Database, claimed: readonly ClaimedItem[], now: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const { item, sequence } of claimed) {
    const snapshot = snapshotJson(item.snapshot);
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO calendar_invites
          (id, submission_id, person_id, uid, sequence, last_method, last_sent_at, status,
           request_snapshot, organizer_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'REQUEST', ?, 'active', ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), item.submission_id, item.person_id, item.uid, sequence, now, snapshot, item.snapshot.organizer.email, now, now),
      db.prepare(
        `UPDATE calendar_invites
         SET sequence = ?, last_method = 'REQUEST', last_sent_at = ?, status = 'active',
             request_snapshot = ?, organizer_email = ?, updated_at = ?
         WHERE submission_id = ? AND person_id = ? AND uid = ? AND sequence <= ?`,
      ).bind(sequence, now, snapshot, item.snapshot.organizer.email, now, item.submission_id, item.person_id, item.uid, sequence),
    );
  }
  await runStatements(db, statements);
}

async function admitNewBatch(input: {
  db: D1Database;
  eventId: Id;
  now: number;
  queue: Queue<unknown>;
  speaker: CalendarDebtSpeaker;
  claimed: readonly ClaimedItem[];
  smokeHarness?: boolean;
}): Promise<CalendarBatchDeliveryResult> {
  const revisions = input.claimed.map(({ item, sequence }) => ({ uid: item.uid, sequence }));
  const entityId = IDEMPOTENCY_REGISTRY.calendarBatch(input.speaker.person_id, revisions);
  const idempotencyKey = await buildIdempotencyKey("calendar_batch_request", entityId, input.speaker.person_id);
  const first = input.claimed[0]!.item;
  const mail = buildCalendarBatchMail({
    eventName: first.session.event_name,
    eventTimezone: first.session.event_timezone,
    items: batchMailItems(input.claimed),
  });
  const enqueue = input.smokeHarness ? enqueueSmokeHarnessMail : enqueueOutbox;
  const outbox = await enqueue({
    db: input.db,
    eventId: input.eventId,
    templateKey: "calendar_batch_request",
    entityId,
    personId: input.speaker.person_id,
    toEmail: input.speaker.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    icsUid: null,
    icsBody: null,
    idempotencyKey,
    now: input.now,
  });
  const partStatements = input.claimed.map(({ item, sequence }, index) =>
    input.db.prepare(
      `INSERT OR IGNORE INTO outbox_calendar_parts
        (id, outbox_id, submission_id, part_index, ics_uid, sequence, filename, ics_body, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      outbox.id,
      item.submission_id,
      index,
      item.uid,
      sequence,
      `${item.uid}.ics`,
      buildCalendarIcs(eventInputFromSnapshot(item.snapshot, { dtstamp: input.now, method: "REQUEST", sequence, uid: item.uid })),
      BATCH_PART_CONTENT_TYPE,
      input.now,
      input.now,
    ),
  );
  await runStatements(input.db, partStatements);
  if (!(await verifyBatchAdmission(input.db, outbox.id, input.claimed))) {
    throw new Error("calendar batch admission failed its storage invariant");
  }
  await stampInvites(input.db, input.claimed, input.now);
  const status = await input.db.prepare("SELECT status FROM outbox WHERE id = ?").bind(outbox.id).first<{ status: string }>();
  if (status?.status === "failed") {
    await input.db.prepare("UPDATE outbox SET status = 'queued', error = NULL, suppressed_reason = NULL, updated_at = ? WHERE id = ? AND status = 'failed'").bind(input.now, outbox.id).run();
  }
  if (status?.status !== "sent" && status?.status !== "suppressed") await enqueueMailMessage(input.queue, outbox.id);
  return {
    first_invites: input.claimed.filter(({ item }) => item.kind === "first").length,
    outbox_id: outbox.id,
    outbox_inserted: outbox.inserted,
    parts: input.claimed.map(({ item, sequence }) => ({ filename: `${item.uid}.ics`, sequence, submission_id: item.submission_id, uid: item.uid })),
    person_id: input.speaker.person_id,
    sequence_set: revisions.map((revision) => `${revision.uid}:${revision.sequence}`),
    speaker_name: input.speaker.name,
    update_count: input.claimed.filter(({ item }) => item.kind === "update").length,
  };
}

async function admitExistingBatch(input: {
  db: D1Database;
  now: number;
  queue: Queue<unknown>;
  speaker: CalendarDebtSpeaker;
  owner: ExistingBatchOwner;
  claimed: readonly ClaimedItem[];
}): Promise<CalendarBatchDeliveryResult> {
  if (input.owner.status === "failed") {
    await input.db.prepare("UPDATE outbox SET status = 'queued', error = NULL, suppressed_reason = NULL, updated_at = ? WHERE id = ? AND status = 'failed'").bind(input.now, input.owner.id).run();
  }
  await stampInvites(input.db, input.claimed, input.now);
  const status = await input.db.prepare("SELECT status FROM outbox WHERE id = ?").bind(input.owner.id).first<{ status: string }>();
  if (status?.status !== "sent" && status?.status !== "suppressed") await enqueueMailMessage(input.queue, input.owner.id);
  return {
    first_invites: input.claimed.filter(({ item }) => item.kind === "first").length,
    outbox_id: input.owner.id,
    outbox_inserted: false,
    parts: input.claimed.map(({ item, sequence }) => ({ filename: `${item.uid}.ics`, sequence, submission_id: item.submission_id, uid: item.uid })),
    person_id: input.speaker.person_id,
    sequence_set: input.claimed.map(({ item, sequence }) => `${item.uid}:${sequence}`),
    speaker_name: input.speaker.name,
    update_count: input.claimed.filter(({ item }) => item.kind === "update").length,
  };
}

export class CalendarBatchBlockedError extends Error {
  constructor(public readonly blocked: CalendarDebtProjection["blocked"]) {
    super("calendar batch has no sendable recipients");
    this.name = "CalendarBatchBlockedError";
  }
}

export async function sendCalendarBatch(input: {
  db: D1Database;
  eventId: Id;
  queue: Queue<unknown>;
  now?: number;
  smokeHarness?: boolean;
}): Promise<CalendarBatchResult> {
  const now = input.now ?? Date.now();
  const projection = await projectCalendarDebt(input.db, input.eventId, CALENDAR_DEFAULT_ORIGIN);
  if (projection.sendable.length === 0) {
    if (projection.blocked.length > 0) throw new CalendarBatchBlockedError(projection.blocked);
    return {
      blocked: [],
      blocked_only: false,
      current_count: projection.current_count,
      deliveries: [],
      first_invite_count: projection.first_invite_count,
      no_op: true,
      unsent_update_count: projection.unsent_update_count,
    };
  }

  const ledgerFloors = await readLedgerFloors(input.db, projection.sendable);
  const existingOwners = await readExistingBatchOwners(input.db, input.eventId, projection.speakers);
  const deliveries: CalendarBatchDeliveryResult[] = [];
  for (const speaker of projection.speakers) {
    const existing = (existingOwners.get(speaker.person_id) ?? []).find((owner) => exactExistingAdmission(owner, speaker) !== null);
    const existingClaim = existing ? exactExistingAdmission(existing, speaker) : null;
    if (existing && existingClaim) {
      deliveries.push(await admitExistingBatch({ db: input.db, now, queue: input.queue, speaker, owner: existing, claimed: existingClaim }));
      continue;
    }
    const claimed: ClaimedItem[] = [];
    for (const item of speaker.items) {
      const claim = await claimCalendarSequence(input.db, {
        currentSequence: item.prior_sequence,
        knownLastSequence: ledgerFloors.get(item.uid) ?? null,
        now,
        uid: item.uid,
      });
      ledgerFloors.set(item.uid, claim.sequence);
      claimed.push({ item, sequence: claim.sequence });
    }
    deliveries.push(await admitNewBatch({
      db: input.db,
      eventId: input.eventId,
      now,
      queue: input.queue,
      speaker,
      claimed,
      smokeHarness: input.smokeHarness,
    }));
  }
  return {
    blocked: projection.blocked,
    blocked_only: false,
    current_count: projection.current_count,
    deliveries,
    first_invite_count: projection.first_invite_count,
    no_op: false,
    unsent_update_count: projection.unsent_update_count,
  };
}

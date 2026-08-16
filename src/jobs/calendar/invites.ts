import type { D1Database, D1PreparedStatement, Queue } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { buildingGeo, sessionLocation } from "../../lib/venue-geometry";
import { enqueueMailMessage } from "../mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../mail/idempotency";
import { enqueueOutbox, enqueueSmokeHarnessMail } from "../mail/outbox";
import { CALENDAR_PARTICIPATION_ROLES, roleInSql } from "../../lib/participants";
import { MAX_CALENDAR_CANCELLATION_ATTEMPTS } from "./limits";
import {
  buildCalendarMail,
  calendarUid,
  type CalendarEventInput,
  type CalendarMailMaterial,
} from "./ics";

const DEFAULT_ORIGIN = "https://marquee.stage11.dev";
const DEFAULT_ORGANIZER_EMAIL = "marquee@stage11.systems";
const DEFAULT_ORGANIZER_NAME = "Marquee";

interface CalendarSessionRow {
  abstract: string | null;
  building_name: string | null;
  duration_min: number;
  event_id: Id;
  event_name: string;
  event_slug: string;
  event_timezone: string;
  room_name: string;
  building_address: string | null;
  building_lat: number | null;
  building_lng: number | null;
  starts_at: number;
  submission_id: Id;
  title: string;
}

interface CalendarRecipientRow {
  email: string;
  name: string;
  person_id: Id;
}

interface CalendarInviteRow {
  id: Id;
  last_method: "REQUEST" | "CANCEL";
  organizer_email: string;
  person_id: Id;
  request_snapshot: string | null;
  sequence: number;
  status: "active" | "cancelled";
  uid: string;
}

interface CalendarSequenceLedgerRow {
  last_sequence: number;
}

interface CalendarCancellationRow {
  attempts: number;
  cancelled_at: number;
  event_id: Id;
  id: Id;
  idempotency_key: string;
  last_error: string | null;
  organizer_email: string;
  outbox_id: Id | null;
  person_id: Id | null;
  sequence: number;
  snapshot_json: string;
  status: "queued" | "sent" | "suppressed" | "failed" | "abandoned";
  to_email: string;
  uid: string;
  updated_at: number;
}

export interface CalendarRequestSnapshot {
  attendee: { email: string; name: string };
  description: string;
  duration_min: number;
  geo: { lat: number; lng: number } | null;
  location: string;
  organizer: { email: string; name: string };
  starts_at: number;
  timezone: string;
  title: string;
  url: string;
}

export interface CalendarDeliveryResult {
  method: "REQUEST" | "CANCEL";
  outbox_id: Id;
  outbox_inserted: boolean;
  person_id: Id | null;
  sequence: number;
  uid: string;
}

export interface CalendarInviteSummary {
  email: string;
  id: Id;
  last_method: "REQUEST" | "CANCEL";
  person_id: Id;
  sequence: number;
  status: string;
  uid: string;
}

interface CalendarCancellationIntent {
  eventId: Id;
  idempotencyKey: string;
  personId: Id;
  sequence: number;
  snapshot: CalendarRequestSnapshot;
  uid: string;
}

export interface CalendarCancellationBatch {
  /** Keys admitted by this caller, including per-invite failures. */
  idempotencyKeys: readonly string[];
  intents: readonly CalendarCancellationIntent[];
  statements: D1PreparedStatement[];
}

export interface CalendarCancellationGuard {
  agendaItemId?: Id;
  expectedUpdatedAt?: number;
}

function originFor(value: string | undefined): string {
  return (value ?? DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && !/[\r\n]/.test(value);
}

function validCalendarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGeo(value: unknown): { lat: number; lng: number } | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || typeof value.lat !== "number" || typeof value.lng !== "number") return undefined;
  if (!Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return undefined;
  return { lat: value.lat, lng: value.lng };
}

/** Parse and validate the immutable REQUEST material before it can drive a CANCEL. */
export function parseCalendarRequestSnapshot(value: string | null): CalendarRequestSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed)) return null;
    const attendee = parsed.attendee;
    const organizer = parsed.organizer;
    const geo = parseGeo(parsed.geo);
    if (
      !isObject(attendee)
      || !validEmail(attendee.email)
      || typeof attendee.name !== "string"
      || !isObject(organizer)
      || !validEmail(organizer.email)
      || typeof organizer.name !== "string"
      || typeof parsed.title !== "string"
      || typeof parsed.description !== "string"
      || typeof parsed.starts_at !== "number"
      || !Number.isInteger(parsed.starts_at)
      || typeof parsed.duration_min !== "number"
      || !Number.isInteger(parsed.duration_min)
      || parsed.duration_min <= 0
      || typeof parsed.timezone !== "string"
      || typeof parsed.location !== "string"
      || geo === undefined
      || !validCalendarUrl(parsed.url)
    ) return null;
    return {
      attendee: { email: attendee.email.trim(), name: attendee.name },
      description: parsed.description,
      duration_min: parsed.duration_min,
      geo,
      location: parsed.location,
      organizer: { email: organizer.email.trim(), name: organizer.name },
      starts_at: parsed.starts_at,
      timezone: parsed.timezone,
      title: parsed.title,
      url: parsed.url,
    };
  } catch {
    return null;
  }
}

function snapshotJson(snapshot: CalendarRequestSnapshot): string {
  // Keep this object literal ordered and stable: it is the byte source for
  // every retry and the next schedule-update ticket's staleness comparison.
  return JSON.stringify({
    attendee: snapshot.attendee,
    description: snapshot.description,
    duration_min: snapshot.duration_min,
    geo: snapshot.geo,
    location: snapshot.location,
    organizer: snapshot.organizer,
    starts_at: snapshot.starts_at,
    timezone: snapshot.timezone,
    title: snapshot.title,
    url: snapshot.url,
  });
}

async function sessionFor(db: D1Database, eventId: Id, submissionId: Id): Promise<CalendarSessionRow | null> {
  return db
    .prepare(
      `SELECT s.id AS submission_id, s.event_id, s.title, s.abstract,
              event.name AS event_name, event.slug AS event_slug,
              event.timezone AS event_timezone,
              agenda.starts_at, agenda.duration_min,
              room.name AS room_name, building.name AS building_name,
              building.address AS building_address, building.lat AS building_lat, building.lng AS building_lng
       FROM submissions s
       JOIN events event ON event.id = s.event_id
       JOIN agenda_items agenda
         ON agenda.submission_id = s.id AND agenda.kind = 'session'
       JOIN rooms room ON room.id = agenda.room_id
       LEFT JOIN buildings building ON building.id = room.building_id
       WHERE s.event_id = ? AND s.id = ?
       LIMIT 1`,
    )
    .bind(eventId, submissionId)
    .first<CalendarSessionRow>();
}

/**
 * Everyone this session's invite is addressed to.
 *
 * `CALENDAR_PARTICIPATION_ROLES` is the whole definition: every on-stage role
 * plus the submitter. Before it, the list read `(speaker, submitter)` and a
 * moderator standing on the published agenda received no invite at all.
 */
async function recipientsFor(db: D1Database, submissionId: Id): Promise<CalendarRecipientRow[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT person.id AS person_id, person.name, person.email
       FROM participations participation
       JOIN people person ON person.id = participation.person_id
       WHERE participation.submission_id = ?
         AND ${roleInSql("participation", CALENDAR_PARTICIPATION_ROLES)}
       ORDER BY participation.position ASC, person.id ASC`,
    )
    .bind(submissionId)
    .all<CalendarRecipientRow>();
  return rows.results.filter((row) => validEmail(row.email));
}

function snapshotFor(
  session: CalendarSessionRow,
  recipient: CalendarRecipientRow,
  origin: string,
): CalendarRequestSnapshot {
  const building = session.building_name === null
    ? null
    : { name: session.building_name, address: session.building_address ?? "" };
  return {
    attendee: { email: recipient.email.trim(), name: recipient.name },
    description: session.abstract ?? session.title,
    duration_min: session.duration_min,
    geo: buildingGeo({ lat: session.building_lat, lng: session.building_lng }),
    location: sessionLocation(session.room_name, building),
    organizer: { email: DEFAULT_ORGANIZER_EMAIL, name: DEFAULT_ORGANIZER_NAME },
    starts_at: session.starts_at,
    timezone: session.event_timezone,
    title: session.title,
    url: `${origin}/s/${encodeURIComponent(session.submission_id)}`,
  };
}

function eventInputFromSnapshot(
  snapshot: CalendarRequestSnapshot,
  input: {
    dtstamp: number;
    method: "REQUEST" | "CANCEL";
    sequence: number;
    uid: string;
  },
): CalendarEventInput & { origin: string } {
  return {
    attendeeEmail: snapshot.attendee.email,
    attendeeName: snapshot.attendee.name,
    description: snapshot.description,
    dtstamp: input.dtstamp,
    durationMin: snapshot.duration_min,
    geo: snapshot.geo,
    location: snapshot.location,
    method: input.method,
    organizerEmail: snapshot.organizer.email,
    organizerName: snapshot.organizer.name,
    sequence: input.sequence,
    startsAt: snapshot.starts_at,
    title: snapshot.title,
    timezone: snapshot.timezone,
    uid: input.uid,
    url: snapshot.url,
    origin: new URL(snapshot.url).origin,
  };
}

async function queueCalendarMaterial(input: {
  db: D1Database;
  dtstamp: number;
  eventId: Id;
  method: "REQUEST" | "CANCEL";
  personId: Id | null;
  queue: Queue<unknown>;
  sequence: number;
  snapshot: CalendarRequestSnapshot;
  smokeHarness?: boolean;
  uid: string;
  requeueExisting?: boolean;
  enqueueMessage?: boolean;
}): Promise<{ material: CalendarMailMaterial; outboxId: Id; inserted: boolean }> {
  const material = buildCalendarMail(eventInputFromSnapshot(input.snapshot, {
    dtstamp: input.dtstamp,
    method: input.method,
    sequence: input.sequence,
    uid: input.uid,
  }));
  const enqueue = input.smokeHarness ? enqueueSmokeHarnessMail : enqueueOutbox;
  const entityId = input.method === "CANCEL"
    ? IDEMPOTENCY_REGISTRY.calendarCancellation(input.uid, input.sequence)
    : IDEMPOTENCY_REGISTRY.calendarRequest(input.uid, input.sequence);
  const outbox = await enqueue({
    db: input.db,
    eventId: input.eventId,
    templateKey: `calendar_${input.method.toLowerCase()}`,
    entityId,
    personId: input.personId,
    toEmail: input.snapshot.attendee.email,
    subject: material.subject,
    text: material.text,
    html: material.html,
    icsUid: input.uid,
    icsBody: material.icsBody,
    now: input.dtstamp,
  });
  const existing = outbox.inserted
    ? null
    : await input.db.prepare("SELECT status FROM outbox WHERE id = ?").bind(outbox.id).first<{ status: string }>();
  // A request can be interrupted after the idempotent outbox INSERT and before
  // its queue send. Re-admit an existing queued row on the resumed run; the
  // outbox key keeps this a delivery retry, not a second calendar revision.
  if (input.enqueueMessage !== false && (outbox.inserted || input.requeueExisting || existing?.status === "queued")) {
    await enqueueMailMessage(input.queue, outbox.id);
  }
  return { material, outboxId: outbox.id, inserted: outbox.inserted };
}

async function ledgerFor(db: D1Database, uid: string): Promise<CalendarSequenceLedgerRow | null> {
  return db.prepare("SELECT last_sequence FROM calendar_sequence_ledger WHERE uid = ?").bind(uid).first<CalendarSequenceLedgerRow>();
}

function nextSequence(current: number | null, ledger: CalendarSequenceLedgerRow | null): number {
  return Math.max(current === null ? 0 : current + 1, ledger ? ledger.last_sequence + 1 : 0);
}

function ledgerStatement(db: D1Database, uid: string, sequence: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO calendar_sequence_ledger (uid, last_sequence, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       last_sequence = MAX(calendar_sequence_ledger.last_sequence, excluded.last_sequence),
       updated_at = excluded.updated_at`,
  ).bind(uid, sequence, now);
}

function ledgerStatements(
  db: D1Database,
  uid: string,
  sequence: number,
  now: number,
  guard: CalendarCancellationGuard | undefined,
  submissionId: Id,
): D1PreparedStatement[] {
  if (!guard?.agendaItemId || guard.expectedUpdatedAt === undefined) {
    return [ledgerStatement(db, uid, sequence, now)];
  }
  const guarded = guardExistsSql(guard);
  const existsBindings = guarded.bindings.map((binding, index) => index === 1 ? submissionId : binding);
  return [
    db.prepare(
      `INSERT OR IGNORE INTO calendar_sequence_ledger (uid, last_sequence, updated_at)
       SELECT ?, ?, ?
       WHERE 1 = 1${guarded.sql}`,
    ).bind(uid, sequence, now, ...existsBindings),
    db.prepare(
      `UPDATE calendar_sequence_ledger
       SET last_sequence = MAX(last_sequence, ?), updated_at = ?
       WHERE uid = ?${guarded.sql}`,
    ).bind(sequence, now, uid, ...existsBindings),
  ];
}

/** Update the invite and high-water in one D1 batch after the idempotent outbox admission. */
async function recordRequest(input: {
  current: CalendarInviteRow | null;
  db: D1Database;
  now: number;
  personId: Id;
  sequence: number;
  snapshot: CalendarRequestSnapshot;
  submissionId: Id;
  uid: string;
  organizerEmail: string;
}): Promise<void> {
  const inviteStatement = input.current
    ? input.db.prepare(
      `UPDATE calendar_invites
       SET sequence = ?, last_method = 'REQUEST', last_sent_at = ?, status = 'active',
           request_snapshot = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      input.sequence,
      input.now,
      snapshotJson(input.snapshot),
      input.now,
      input.current.id,
    )
    : input.db.prepare(
      `INSERT INTO calendar_invites
        (id, submission_id, person_id, uid, sequence, last_method, last_sent_at,
         status, request_snapshot, organizer_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'REQUEST', ?, 'active', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.submissionId,
      input.personId,
      input.uid,
      input.sequence,
      input.now,
      snapshotJson(input.snapshot),
      input.organizerEmail,
      input.now,
      input.now,
    );
  await input.db.batch([
    // The ledger and snapshot update share the same batch fence. A resumed
    // request can therefore never expose a newer sequence with old material.
    ledgerStatement(input.db, input.uid, input.sequence, input.now),
    inviteStatement,
  ]);
}

/**
 * Queue one REQUEST per calendar recipient, preserving one UID per recipient.
 *
 * There is intentionally no materiality comparison here: every explicit
 * re-POST is a new revision, as required by the current calendar contract.
 * A future schedule-update stream may add that policy without changing the
 * immutable snapshot or cancellation machinery below. Organizer identity also
 * remains the fixed Marquee identity until organization mail wiring is owned by
 * its contract; REQUEST and CANCEL already share the stamped value.
 */
export async function sendCalendarInvites(input: {
  db: D1Database;
  eventId: Id;
  origin?: string;
  queue: Queue<unknown>;
  submissionId: Id;
  now?: number;
  /** Only the explicit authenticated smoke route may use the live G3 policy. */
  smokeHarness?: boolean;
}): Promise<CalendarDeliveryResult[]> {
  const now = input.now ?? Date.now();
  const session = await sessionFor(input.db, input.eventId, input.submissionId);
  if (!session) throw new Error("submission has no scheduled session");
  const recipients = await recipientsFor(input.db, input.submissionId);
  const origin = originFor(input.origin);
  const result: CalendarDeliveryResult[] = [];

  for (const recipient of recipients) {
    const [current, ledger] = await Promise.all([
      input.db
        .prepare(
          `SELECT id, person_id, uid, sequence, last_method, status, request_snapshot, organizer_email
           FROM calendar_invites WHERE submission_id = ? AND person_id = ?`,
        )
        .bind(input.submissionId, recipient.person_id)
        .first<CalendarInviteRow>(),
      ledgerFor(input.db, calendarUid(input.submissionId, recipient.person_id)),
    ]);
    const uid = current?.uid ?? calendarUid(input.submissionId, recipient.person_id);
    const sequence = nextSequence(current?.sequence ?? null, ledger);
    const snapshot = snapshotFor(session, recipient, origin);
    const delivery = await queueCalendarMaterial({
      db: input.db,
      dtstamp: now,
      eventId: input.eventId,
      method: "REQUEST",
      personId: recipient.person_id,
      queue: input.queue,
      sequence,
      snapshot,
      smokeHarness: input.smokeHarness,
      uid,
    });
    await recordRequest({
      current: current ?? null,
      db: input.db,
      now,
      personId: recipient.person_id,
      sequence,
      snapshot,
      submissionId: input.submissionId,
      uid,
      organizerEmail: current?.organizer_email ?? snapshot.organizer.email,
    });
    result.push({
      method: "REQUEST",
      outbox_id: delivery.outboxId,
      outbox_inserted: delivery.inserted,
      person_id: recipient.person_id,
      sequence,
      uid,
    });
  }
  return result;
}

async function activeInvitesForCancellation(input: {
  db: D1Database;
  personId?: Id;
  submissionId: Id;
}): Promise<CalendarInviteRow[]> {
  const personFilter = input.personId === undefined ? "" : " AND invite.person_id = ?";
  const bindings = input.personId === undefined
    ? [input.submissionId]
    : [input.submissionId, input.personId];
  const rows = await input.db
    .prepare(
      `SELECT invite.id, invite.person_id, invite.uid, invite.sequence, invite.last_method,
              invite.status, invite.request_snapshot, invite.organizer_email
       FROM calendar_invites invite
       WHERE invite.submission_id = ? AND invite.status = 'active'${personFilter}
       ORDER BY invite.person_id ASC`,
    )
    .bind(...bindings)
    .all<CalendarInviteRow>();
  return rows.results;
}

function guardExistsSql(guard: CalendarCancellationGuard | undefined): { sql: string; bindings: (string | number)[] } {
  if (!guard?.agendaItemId || guard.expectedUpdatedAt === undefined) return { sql: "", bindings: [] };
  return {
    sql: " AND EXISTS (SELECT 1 FROM agenda_items WHERE id = ? AND event_id = (SELECT event_id FROM submissions WHERE id = ?) AND updated_at = ?)",
    bindings: [guard.agendaItemId, "", guard.expectedUpdatedAt],
  };
}

function cancellationFailureReason(
  invite: CalendarInviteRow,
  snapshot: CalendarRequestSnapshot | null,
): string | null {
  if (!snapshot) return "calendar cancellation snapshot unavailable";
  if (snapshot.organizer.email.trim().toLowerCase() !== invite.organizer_email.trim().toLowerCase()) {
    return "calendar cancellation organizer mismatch";
  }
  if (!validEmail(snapshot.attendee.email)) return "calendar cancellation attendee is invalid";
  return null;
}

function failedCancellationStatement(input: {
  db: D1Database;
  eventId: Id;
  idempotencyKey: string;
  invite: CalendarInviteRow;
  now: number;
  reason: string;
  sequence: number;
  guard?: CalendarCancellationGuard;
  submissionId: Id;
}): D1PreparedStatement {
  const guarded = guardExistsSql(input.guard);
  const existsBindings = guarded.bindings.map((binding, index) => index === 1 ? input.submissionId : binding);
  // A malformed or missing snapshot has no trustworthy recipient or calendar
  // material. Keep the failure durable with explicit sentinels, but do not
  // mutate the invite or ledger and never attempt to enqueue it.
  return input.db.prepare(
    `INSERT OR IGNORE INTO calendar_cancellations
      (id, idempotency_key, event_id, person_id, uid, sequence, to_email, organizer_email,
       snapshot_json, cancelled_at, status, attempts, outbox_id, last_error, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'failed', 1, NULL, ?, ?, ?
     WHERE 1 = 1${guarded.sql}`,
  ).bind(
    crypto.randomUUID(),
    input.idempotencyKey,
    input.eventId,
    input.invite.person_id,
    input.invite.uid,
    input.sequence,
    input.invite.organizer_email,
    input.invite.request_snapshot ?? "{}",
    input.now,
    input.reason,
    input.now,
    input.now,
    ...existsBindings,
  );
}

/**
 * Prepare cancellation intent + invite/ledger statements. Callers that delete
 * an agenda row append that DELETE to the same db.batch, making the intent
 * durable on the deletion fence rather than relying on a later best effort.
 */
export async function prepareCalendarCancellationBatch(input: {
  db: D1Database;
  eventId: Id;
  personId?: Id;
  submissionId: Id;
  now: number;
  guard?: CalendarCancellationGuard;
}): Promise<CalendarCancellationBatch> {
  const invites = await activeInvitesForCancellation(input);
  const idempotencyKeys: string[] = [];
  const intents: CalendarCancellationIntent[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const invite of invites) {
    // A cancellation is a correction to a previously delivered REQUEST. It
    // must never consult mutable session or person rows: those rows may have
    // been edited, removed, or reassigned since the calendar client received
    // the invitation. Legacy rows without a stamped REQUEST fail closed.
    const ledger = await ledgerFor(input.db, invite.uid);
    const sequence = nextSequence(invite.sequence, ledger);
    const idempotencyKey = String(IDEMPOTENCY_REGISTRY.calendarCancellation(invite.uid, sequence));
    idempotencyKeys.push(idempotencyKey);
    const snapshot = parseCalendarRequestSnapshot(invite.request_snapshot);
    const failure = cancellationFailureReason(invite, snapshot);
    if (failure) {
      statements.push(failedCancellationStatement({
        db: input.db,
        eventId: input.eventId,
        idempotencyKey,
        invite,
        now: input.now,
        reason: `${failure} for ${invite.uid}`,
        sequence,
        guard: input.guard,
        submissionId: input.submissionId,
      }));
      continue;
    }
    // cancellationFailureReason proves this is non-null, while keeping the
    // branch explicit for TypeScript and future validation changes.
    if (!snapshot) continue;
    const intent: CalendarCancellationIntent = {
      eventId: input.eventId,
      idempotencyKey,
      personId: invite.person_id,
      sequence,
      snapshot,
      uid: invite.uid,
    };
    intents.push(intent);
    const guard = guardExistsSql(input.guard);
    // The guard is intentionally checked in both the intent and the invite
    // update. A stale unschedule request therefore creates no durable job.
    const existsBindings = guard.bindings.map((binding, index) => index === 1 ? input.submissionId : binding);
    const existsClause = guard.sql;
    statements.push(
      input.db.prepare(
        `INSERT OR IGNORE INTO calendar_cancellations
          (id, idempotency_key, event_id, person_id, uid, sequence, to_email, organizer_email,
           snapshot_json, cancelled_at, status, attempts, outbox_id, last_error, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, ?, ?
         WHERE 1 = 1${existsClause}`,
      ).bind(
        crypto.randomUUID(),
        idempotencyKey,
        input.eventId,
        invite.person_id,
        invite.uid,
        sequence,
        snapshot.attendee.email,
        invite.organizer_email,
        snapshotJson(snapshot),
        input.now,
        input.now,
        input.now,
        ...existsBindings,
      ),
      ...ledgerStatements(input.db, invite.uid, sequence, input.now, input.guard, input.submissionId),
      input.db.prepare(
        `UPDATE calendar_invites
         SET sequence = ?, last_method = 'CANCEL', status = 'cancelled', updated_at = ?
         WHERE id = ? AND status = 'active'${existsClause}`,
      ).bind(sequence, input.now, invite.id, ...existsBindings),
    );
  }
  return { idempotencyKeys, intents, statements };
}

function cancellationResult(row: CalendarCancellationRow, inserted: boolean): CalendarDeliveryResult {
  return {
    method: "CANCEL",
    outbox_id: row.outbox_id ?? "",
    outbox_inserted: inserted,
    person_id: row.person_id,
    sequence: row.sequence,
    uid: row.uid,
  };
}

async function markCancellationFailed(
  db: D1Database,
  row: CalendarCancellationRow,
  now: number,
  error: string,
): Promise<void> {
  await db.prepare(
    `UPDATE calendar_cancellations
     SET status = CASE WHEN attempts + 1 >= ? THEN 'abandoned' ELSE 'failed' END,
         attempts = attempts + 1, last_error = ?, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'failed') AND attempts < ?`,
  ).bind(MAX_CALENDAR_CANCELLATION_ATTEMPTS, error, now, row.id, MAX_CALENDAR_CANCELLATION_ATTEMPTS).run();
}

/**
 * Admit queued/failed CANCELs to the normal mail outbox. Failed outbox rows
 * are reopened at the same idempotency key; the snapshot and cancelled_at are
 * never regenerated, so every retry is byte-identical.
 */
export async function drainCalendarCancellations(input: {
  db: D1Database;
  queue: Queue<unknown>;
  origin?: string;
  now?: number;
  smokeHarness?: boolean;
  limit?: number;
  /** Request paths pass only the intents they created; cron omits this. */
  idempotencyKeys?: readonly string[];
}): Promise<CalendarDeliveryResult[]> {
  const now = input.now ?? Date.now();
  if (input.idempotencyKeys?.length === 0) return [];
  const keyFilter = input.idempotencyKeys === undefined
    ? ""
    : " AND idempotency_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))";
  const bindings: (string | number)[] = [
    MAX_CALENDAR_CANCELLATION_ATTEMPTS,
    ...(input.idempotencyKeys === undefined ? [] : [JSON.stringify(input.idempotencyKeys)]),
    input.limit ?? 100,
  ];
  const rows = await input.db
    .prepare(
      `SELECT attempts, cancelled_at, event_id, id, idempotency_key, last_error,
              organizer_email, outbox_id, person_id, sequence, snapshot_json, status,
              to_email, uid, updated_at
       FROM calendar_cancellations
       WHERE status IN ('queued', 'failed') AND attempts < ?${keyFilter}
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<CalendarCancellationRow>();
  const result: CalendarDeliveryResult[] = [];
  for (const row of rows.results) {
    const event = await input.db.prepare("SELECT 1 AS present FROM events WHERE id = ?").bind(row.event_id).first<{ present: number }>();
    if (!event) {
      // Conference deletion is a deliberate no-CANCEL path. The FK-free job
      // remains inspectable, but it must not attempt to recreate an outbox row
      // whose event parent has already been removed.
      await input.db.prepare(
        "UPDATE calendar_cancellations SET status = 'suppressed', last_error = ?, updated_at = ? WHERE id = ?",
      ).bind("calendar event no longer exists", now, row.id).run();
      continue;
    }
    const snapshot = parseCalendarRequestSnapshot(row.snapshot_json);
    if (!snapshot) {
      await markCancellationFailed(input.db, row, now, row.last_error ?? "calendar cancellation snapshot is invalid");
      continue;
    }
    if (snapshot.attendee.email.trim().toLowerCase() !== row.to_email.trim().toLowerCase()) {
      await markCancellationFailed(input.db, row, now, "calendar attendee does not match the outbox recipient");
      continue;
    }
    if (snapshot.organizer.email.trim().toLowerCase() !== row.organizer_email.trim().toLowerCase()) {
      await markCancellationFailed(input.db, row, now, "calendar organizer does not match the REQUEST snapshot");
      continue;
    }

    const entityId = String(IDEMPOTENCY_REGISTRY.calendarCancellation(row.uid, row.sequence));
    let outbox = await input.db.prepare(
      `SELECT id, status FROM outbox
       WHERE event_id = ? AND template_key = 'calendar_cancel' AND entity_id = ?
       LIMIT 1`,
    ).bind(row.event_id, entityId).first<{ id: Id; status: string }>();
    let inserted = false;
    if (outbox?.status === "sent") {
      await input.db.prepare("UPDATE calendar_cancellations SET status = 'sent', updated_at = ? WHERE id = ?").bind(now, row.id).run();
      continue;
    }
    if (outbox?.status === "suppressed") {
      await input.db.prepare("UPDATE calendar_cancellations SET status = 'suppressed', updated_at = ? WHERE id = ?").bind(now, row.id).run();
      continue;
    }
    if (outbox?.status === "failed") {
      await input.db.prepare(
        "UPDATE outbox SET status = 'queued', error = NULL, suppressed_reason = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
      ).bind(now, outbox.id).run();
    }
    if (!outbox) {
      const delivery = await queueCalendarMaterial({
        db: input.db,
        dtstamp: row.cancelled_at,
        eventId: row.event_id,
        method: "CANCEL",
        personId: row.person_id,
        queue: input.queue,
        sequence: row.sequence,
        snapshot,
        smokeHarness: input.smokeHarness,
        uid: row.uid,
        enqueueMessage: false,
      });
      outbox = { id: delivery.outboxId, status: "queued" };
      inserted = delivery.inserted;
    }
    const admitted = await input.db.prepare(
      `UPDATE calendar_cancellations
       SET status = 'queued', attempts = attempts + 1, outbox_id = ?, last_error = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed') AND attempts < ?`,
    ).bind(outbox.id, now, row.id, MAX_CALENDAR_CANCELLATION_ATTEMPTS).run();
    if ((admitted.meta.changes ?? 0) !== 1) continue;
    // The cancellation row is queued before the message is admitted. A fast
    // consumer can therefore write sent/suppressed/failed without this route
    // clobbering that terminal result back to queued.
    await enqueueMailMessage(input.queue, outbox.id);
    result.push(cancellationResult({ ...row, outbox_id: outbox.id }, inserted));
  }
  return result;
}

/** Emit durable CANCEL intent for every active invite, even with no agenda row. */
export async function cancelCalendarInvites(input: {
  db: D1Database;
  eventId: Id;
  origin?: string;
  queue: Queue<unknown>;
  submissionId: Id;
  now?: number;
  personId?: Id;
  /** Only the explicit authenticated smoke route may use the live G3 policy. */
  smokeHarness?: boolean;
}): Promise<CalendarDeliveryResult[]> {
  const now = input.now ?? Date.now();
  const batch = await prepareCalendarCancellationBatch({
    db: input.db,
    eventId: input.eventId,
    personId: input.personId,
    submissionId: input.submissionId,
    now,
  });
  if (batch.statements.length > 0) await input.db.batch(batch.statements);
  return drainCalendarCancellations({
    db: input.db,
    now,
    origin: input.origin,
    queue: input.queue,
    smokeHarness: input.smokeHarness,
    idempotencyKeys: batch.idempotencyKeys,
  });
}

export async function calendarInvitesForSubmission(
  db: D1Database,
  eventId: Id,
  submissionId: Id,
): Promise<CalendarInviteSummary[]> {
  const rows = await db
    .prepare(
      `SELECT invite.id, invite.person_id, invite.uid, invite.sequence, invite.last_method,
              invite.status, invite.request_snapshot, person.email
       FROM calendar_invites invite
       LEFT JOIN people person ON person.id = invite.person_id
       WHERE invite.submission_id = ? AND EXISTS (
         SELECT 1 FROM submissions submission
         WHERE submission.id = invite.submission_id AND submission.event_id = ?
       )
       ORDER BY invite.person_id ASC`,
    )
    .bind(submissionId, eventId)
    .all<CalendarInviteSummary & { request_snapshot: string | null }>();
  return rows.results.map((row) => ({
    email: parseCalendarRequestSnapshot(row.request_snapshot)?.attendee.email ?? row.email,
    id: row.id,
    last_method: row.last_method,
    person_id: row.person_id,
    sequence: row.sequence,
    status: row.status,
    uid: row.uid,
  }));
}

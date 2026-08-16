import type { D1Database, Queue } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { buildingGeo, sessionLocation } from "../../lib/venue-geometry";
import { enqueueMailMessage } from "../mail/consumer";
import { enqueueOutbox, enqueueSmokeHarnessMail } from "../mail/outbox";
import {
  buildCalendarMail,
  calendarUid,
  type CalendarEventInput,
  type CalendarMailMaterial,
} from "./ics";

const DEFAULT_ORIGIN = "https://marquee.stage11.dev";

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
  person_id: Id;
  sequence: number;
  status: string;
  uid: string;
}

export interface CalendarDeliveryResult {
  method: "REQUEST" | "CANCEL";
  outbox_id: Id;
  outbox_inserted: boolean;
  person_id: Id;
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

function originFor(value: string | undefined): string {
  return (value ?? DEFAULT_ORIGIN).replace(/\/+$/, "");
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

async function recipientsFor(db: D1Database, submissionId: Id): Promise<CalendarRecipientRow[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT person.id AS person_id, person.name, person.email
       FROM participations participation
       JOIN people person ON person.id = participation.person_id
       WHERE participation.submission_id = ?
         AND participation.role IN ('speaker', 'submitter')
       ORDER BY participation.position ASC, person.id ASC`,
    )
    .bind(submissionId)
    .all<CalendarRecipientRow>();
  return rows.results.filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()));
}

function eventInput(
  session: CalendarSessionRow,
  recipient: CalendarRecipientRow,
  input: {
    dtstamp: number;
    method: "REQUEST" | "CANCEL";
    origin: string;
    sequence: number;
    uid: string;
  },
): CalendarEventInput & { origin: string } {
  const building = session.building_name === null
    ? null
    : { name: session.building_name, address: session.building_address ?? "" };
  return {
    attendeeEmail: recipient.email,
    attendeeName: recipient.name,
    description: session.abstract ?? session.title,
    dtstamp: input.dtstamp,
    durationMin: session.duration_min,
    geo: buildingGeo({ lat: session.building_lat, lng: session.building_lng }),
    location: sessionLocation(session.room_name, building),
    method: input.method,
    organizerEmail: "marquee@stage11.systems",
    organizerName: "Marquee",
    sequence: input.sequence,
    startsAt: session.starts_at,
    title: session.title,
    timezone: session.event_timezone,
    uid: input.uid,
    url: `${input.origin}/s/${encodeURIComponent(session.submission_id)}`,
    origin: input.origin,
  };
}

async function queueCalendarMaterial(
  db: D1Database,
  queue: Queue<unknown>,
  session: CalendarSessionRow,
  recipient: CalendarRecipientRow,
  input: {
    dtstamp: number;
    method: "REQUEST" | "CANCEL";
    origin: string;
    sequence: number;
    uid: string;
    smokeHarness?: boolean;
  },
): Promise<{ material: CalendarMailMaterial; outboxId: Id; inserted: boolean }> {
  const material = buildCalendarMail(eventInput(session, recipient, input));
  const enqueue = input.smokeHarness ? enqueueSmokeHarnessMail : enqueueOutbox;
  const outbox = await enqueue({
    db,
    eventId: session.event_id,
    templateKey: `calendar_${input.method.toLowerCase()}`,
    entityId: `${session.submission_id}:${recipient.person_id}:${input.sequence}:${input.method}`,
    personId: recipient.person_id,
    toEmail: recipient.email,
    subject: material.subject,
    text: material.text,
    html: material.html,
    icsUid: input.uid,
    icsBody: material.icsBody,
    now: input.dtstamp,
  });
  if (outbox.inserted) await enqueueMailMessage(queue, outbox.id);
  return { material, outboxId: outbox.id, inserted: outbox.inserted };
}

/**
 * Queue one request per speaker/submitter. The event id is kept separately
 * from the calendar material so the outbox remains event-scoped.
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
    const current = await input.db
      .prepare("SELECT id, person_id, uid, sequence, last_method, status FROM calendar_invites WHERE submission_id = ? AND person_id = ?")
      .bind(input.submissionId, recipient.person_id)
      .first<CalendarInviteRow>();
    const sequence = current ? current.sequence + 1 : 0;
    const uid = current?.uid ?? calendarUid(input.submissionId, recipient.person_id);
    const delivery = await queueCalendarMaterial(input.db, input.queue, session, recipient, {
      dtstamp: now,
      method: "REQUEST",
      origin,
      sequence,
      uid,
      smokeHarness: input.smokeHarness,
    });
    if (current) {
      await input.db
        .prepare(
          `UPDATE calendar_invites
           SET sequence = ?, last_method = 'REQUEST', last_sent_at = ?, status = 'active', updated_at = ?
           WHERE id = ?`,
        )
        .bind(sequence, now, now, current.id)
        .run();
    } else {
      await input.db
        .prepare(
          `INSERT INTO calendar_invites
            (id, submission_id, person_id, uid, sequence, last_method, last_sent_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'REQUEST', ?, 'active', ?, ?)`,
        )
        .bind(crypto.randomUUID(), input.submissionId, recipient.person_id, uid, now, now, now)
        .run();
    }
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

/** Emit METHOD:CANCEL for every prior invite while preserving UID and sequence. */
export async function cancelCalendarInvites(input: {
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
  if (!session) return [];
  const invites = await input.db
    .prepare(
      `SELECT invite.id, invite.person_id, invite.uid, invite.sequence, invite.last_method, invite.status,
              person.email, person.name
       FROM calendar_invites invite
       JOIN people person ON person.id = invite.person_id
       WHERE invite.submission_id = ?
         AND invite.status <> 'cancelled'
       ORDER BY invite.person_id ASC`,
    )
    .bind(input.submissionId)
    .all<CalendarInviteRow & { email: string; name: string }>();
  const origin = originFor(input.origin);
  const result: CalendarDeliveryResult[] = [];

  for (const invite of invites.results) {
    const sequence = invite.sequence + 1;
    const delivery = await queueCalendarMaterial(input.db, input.queue, session, {
      person_id: invite.person_id,
      email: invite.email,
      name: invite.name,
    }, {
      dtstamp: now,
      method: "CANCEL",
      origin,
      sequence,
      uid: invite.uid,
      smokeHarness: input.smokeHarness,
    });
    await input.db
      .prepare(
        `UPDATE calendar_invites
         SET sequence = ?, last_method = 'CANCEL', last_sent_at = ?, status = 'cancelled', updated_at = ?
         WHERE id = ? AND status <> 'cancelled'`,
      )
      .bind(sequence, now, now, invite.id)
      .run();
    result.push({
      method: "CANCEL",
      outbox_id: delivery.outboxId,
      outbox_inserted: delivery.inserted,
      person_id: invite.person_id,
      sequence,
      uid: invite.uid,
    });
  }
  return result;
}

export async function calendarInvitesForSubmission(
  db: D1Database,
  eventId: Id,
  submissionId: Id,
): Promise<CalendarInviteSummary[]> {
  const rows = await db
    .prepare(
      `SELECT invite.id, invite.person_id, invite.uid, invite.sequence, invite.last_method,
              invite.status, person.email
       FROM calendar_invites invite
       JOIN people person ON person.id = invite.person_id
       WHERE invite.submission_id = ? AND EXISTS (
         SELECT 1 FROM submissions submission
         WHERE submission.id = invite.submission_id AND submission.event_id = ?
       )
       ORDER BY invite.person_id ASC`,
    )
    .bind(submissionId, eventId)
    .all<CalendarInviteSummary>();
  return rows.results;
}

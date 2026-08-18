/**
 * Marking a speaker arrived, and taking the mark back.
 *
 * Two writes, both idempotent, both audited in the same `batch()` as the row
 * they describe — an arrival that lands without its audit row is a fact nobody
 * can attribute an hour later, when the question is not "is she here" but "who
 * said she was".
 *
 * The audit statement is composed BEFORE the row write in each batch, and is
 * conditional on the state that write is about to change. D1 runs a batch in
 * order inside one transaction, so a second tap on the volunteer's phone finds
 * the row already there, writes nothing, and — this is the point — records
 * nothing either. A retry that logs a second arrival is a log that disagrees
 * with reality.
 */
import { newUlid } from "../../api/ids";
import type { AuditActorKind, CheckinRow, Id } from "../../db/schema";
import { auditStatementFromSelect } from "../audit";
import { WORK_HOLDING_PARTICIPATION_ROLES, roleInSql } from "../participants";

export interface DayOfWriteActor {
  actorKind: AuditActorKind;
  /** Null for a link-held write: the credential names a post, not a person. */
  actorPersonId: Id | null;
  /** The link's name ("Sam, front door") or the organizer's. Copied onto the mark. */
  name: string;
  /** The day-of link that carried the write, when one did. */
  linkId: Id | null;
  requestId: string | null;
}

export interface ArrivalTarget {
  eventId: Id;
  agendaItemId: Id;
  personId: Id;
}

/**
 * Is this person on this session at this conference?
 *
 * The volunteer's page only ever offers names it drew, but the route behind it
 * takes two ids from the network, and the grain is only as honest as this
 * predicate: without it a well-formed request could record that a speaker
 * arrived for a talk they are not on — or for a talk at somebody else's
 * conference.
 */
export async function speaksAtSession(
  db: D1Database,
  target: ArrivalTarget,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok
         FROM agenda_items item
         JOIN participations participation ON participation.submission_id = item.submission_id
        WHERE item.id = ? AND item.event_id = ? AND item.kind = 'session'
          AND participation.person_id = ?
          AND ${roleInSql("participation", WORK_HOLDING_PARTICIPATION_ROLES)}
        LIMIT 1`,
    )
    .bind(target.agendaItemId, target.eventId, target.personId)
    .first<{ ok: number }>();
  return row !== null;
}

export interface ArrivalResult {
  /** False when the arrival was already recorded — the request still succeeded. */
  changed: boolean;
  checkin: CheckinRow | null;
}

export async function markArrival(
  db: D1Database,
  target: ArrivalTarget,
  actor: DayOfWriteActor,
  now: number,
): Promise<ArrivalResult> {
  const id = newUlid(now);
  const audit = auditStatementFromSelect(
    db,
    {
      eventId: target.eventId,
      actorKind: actor.actorKind,
      actorPersonId: actor.actorPersonId,
      action: "checked_in",
      entityType: "checkin",
      entityId: id,
      after: {
        agenda_item_id: target.agendaItemId,
        person_id: target.personId,
        marked_by_name: actor.name,
        link_id: actor.linkId,
      },
      now,
      requestId: actor.requestId,
    },
    `WHERE NOT EXISTS (SELECT 1 FROM checkins WHERE agenda_item_id = ? AND person_id = ?)`,
    target.agendaItemId,
    target.personId,
  );
  const insert = db
    .prepare(
      `INSERT OR IGNORE INTO checkins
        (id, event_id, agenda_item_id, person_id, link_id, marked_by_name, marked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, target.eventId, target.agendaItemId, target.personId, actor.linkId, actor.name, now, now, now);
  const results = await db.batch([audit, insert]);
  const changed = Number(results[1]?.meta?.changes ?? 0) === 1;
  const checkin = await readArrival(db, target);
  return { changed, checkin };
}

export async function unmarkArrival(
  db: D1Database,
  target: ArrivalTarget,
  actor: DayOfWriteActor,
  now: number,
): Promise<ArrivalResult> {
  const existing = await readArrival(db, target);
  if (existing === null) return { changed: false, checkin: null };
  const audit = auditStatementFromSelect(
    db,
    {
      eventId: target.eventId,
      actorKind: actor.actorKind,
      actorPersonId: actor.actorPersonId,
      action: "checkin_removed",
      entityType: "checkin",
      entityId: existing.id,
      before: {
        agenda_item_id: target.agendaItemId,
        person_id: target.personId,
        marked_by_name: existing.marked_by_name,
        marked_at: existing.marked_at,
      },
      after: { removed_by_name: actor.name, link_id: actor.linkId },
      now,
      requestId: actor.requestId,
    },
    `WHERE EXISTS (SELECT 1 FROM checkins WHERE id = ?)`,
    existing.id,
  );
  const remove = db.prepare("DELETE FROM checkins WHERE id = ? AND event_id = ?").bind(existing.id, target.eventId);
  const results = await db.batch([audit, remove]);
  return { changed: Number(results[1]?.meta?.changes ?? 0) === 1, checkin: null };
}

export async function readArrival(
  db: D1Database,
  target: ArrivalTarget,
): Promise<CheckinRow | null> {
  const row = await db
    .prepare("SELECT * FROM checkins WHERE agenda_item_id = ? AND person_id = ? AND event_id = ?")
    .bind(target.agendaItemId, target.personId, target.eventId)
    .first<CheckinRow>();
  return row ?? null;
}

export interface DayOfArrival {
  agenda_item_id: string;
  session_title: string;
  starts_at: number;
  room_name: string;
  marked_at: number;
  marked_by_name: string;
}

/**
 * Every arrival recorded for one person at one conference, in schedule order.
 *
 * The green room asks "who is here for this session"; the speaker's own record
 * asks the transpose — "where has this person been seen" — and both are the same
 * rows read from the other end. Ordering by the schedule rather than by when the
 * mark was made is what makes it read as an itinerary.
 */
export async function listArrivalsForPerson(
  db: D1Database,
  eventId: Id,
  personId: Id,
): Promise<DayOfArrival[]> {
  const rows = await db
    .prepare(
      `SELECT checkin.agenda_item_id, checkin.marked_at, checkin.marked_by_name,
              COALESCE(item.title, submission.title, 'Untitled session') AS session_title,
              item.starts_at, room.name AS room_name
         FROM checkins checkin
         JOIN agenda_items item ON item.id = checkin.agenda_item_id
         JOIN rooms room ON room.id = item.room_id
         LEFT JOIN submissions submission ON submission.id = item.submission_id
        WHERE checkin.event_id = ? AND checkin.person_id = ?
        ORDER BY item.starts_at ASC, item.id ASC`,
    )
    .bind(eventId, personId)
    .all<DayOfArrival>();
  return rows.results;
}

import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { CALENDAR_PARTICIPATION_ROLES, roleInSql } from "../../lib/participants";
import {
  CALENDAR_DEFAULT_ORIGIN,
  parseCalendarRequestSnapshot,
  snapshotFor,
  type CalendarRequestSnapshot,
  type CalendarSessionRow,
  validEmail,
} from "./invites";
import { calendarUid } from "./ics";

interface CalendarDebtQueryRow extends CalendarSessionRow {
  invite_uid: string | null;
  invite_last_method: "REQUEST" | "CANCEL" | null;
  invite_organizer_email: string | null;
  invite_request_snapshot: string | null;
  invite_sequence: number | null;
  invite_status: "active" | "cancelled" | null;
  person_email: string;
  person_id: Id;
  person_name: string;
}

export type CalendarDebtKind = "first" | "update";

export interface CalendarDebtItem {
  kind: CalendarDebtKind;
  person_email: string;
  person_id: Id;
  person_name: string;
  prior_sequence: number | null;
  prior_snapshot: CalendarRequestSnapshot | null;
  session: CalendarSessionRow;
  snapshot: CalendarRequestSnapshot;
  submission_id: Id;
  uid: string;
}

export interface CalendarBlockedRecipient {
  email: string;
  person_id: Id;
  person_name: string;
  reason: "missing email" | "invalid email";
  submission_ids: Id[];
}

export interface CalendarDebtSpeaker {
  email: string;
  items: CalendarDebtItem[];
  name: string;
  person_id: Id;
}

export interface CalendarDebtProjection {
  blocked: CalendarBlockedRecipient[];
  current_count: number;
  first_invite_count: number;
  no_op: boolean;
  sendable: CalendarDebtItem[];
  speakers: CalendarDebtSpeaker[];
  unsent_update_count: number;
}

export interface CalendarSlotMaterial {
  duration_min: number;
  location: string;
  starts_at: number;
  timezone: string;
}

/** The MRQ-233 allowlist: only slot truth can create batch debt. */
export function calendarSlotMaterial(snapshot: CalendarRequestSnapshot): CalendarSlotMaterial {
  return {
    duration_min: snapshot.duration_min,
    location: snapshot.location,
    starts_at: snapshot.starts_at,
    timezone: snapshot.timezone,
  };
}

export function calendarSlotMaterialEqual(left: CalendarRequestSnapshot, right: CalendarRequestSnapshot): boolean {
  return JSON.stringify(calendarSlotMaterial(left)) === JSON.stringify(calendarSlotMaterial(right));
}

function blockedReason(email: string): "missing email" | "invalid email" {
  return email.trim() === "" ? "missing email" : "invalid email";
}

function normalizedOrigin(origin: string): string {
  return origin.replace(/\/+$/, "") || CALENDAR_DEFAULT_ORIGIN;
}

/**
 * One bounded event query is the truth source for every agenda/dashboard/batch
 * consumer. It intentionally reads all participations before email filtering.
 */
export async function projectCalendarDebt(
  db: D1Database,
  eventId: Id,
  origin = CALENDAR_DEFAULT_ORIGIN,
): Promise<CalendarDebtProjection> {
  const result = await db.prepare(
    `SELECT DISTINCT
       s.id AS submission_id, s.event_id, s.title, s.abstract,
       event.name AS event_name, event.slug AS event_slug,
       event.timezone AS event_timezone,
       agenda.starts_at, agenda.duration_min,
       room.name AS room_name, building.name AS building_name,
       building.address AS building_address, building.lat AS building_lat, building.lng AS building_lng,
       person.id AS person_id, person.name AS person_name, person.email AS person_email,
       invite.uid AS invite_uid, invite.sequence AS invite_sequence,
       invite.last_method AS invite_last_method, invite.status AS invite_status,
       invite.request_snapshot AS invite_request_snapshot,
       invite.organizer_email AS invite_organizer_email
     FROM agenda_items agenda
     JOIN submissions s ON s.id = agenda.submission_id AND s.event_id = agenda.event_id
     JOIN events event ON event.id = agenda.event_id
     JOIN rooms room ON room.id = agenda.room_id AND room.event_id = agenda.event_id
     LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
     JOIN participations participation ON participation.submission_id = s.id
     JOIN people person ON person.id = participation.person_id
     LEFT JOIN calendar_invites invite
       ON invite.submission_id = s.id AND invite.person_id = person.id
     WHERE agenda.event_id = ?
       AND agenda.kind = 'session'
       AND agenda.starts_at IS NOT NULL
       AND s.status NOT IN ('rejected', 'withdrawn')
       AND ${roleInSql("participation", CALENDAR_PARTICIPATION_ROLES)}
     ORDER BY agenda.starts_at ASC, agenda.id ASC, participation.position ASC, person.id ASC`,
  ).bind(eventId).all<CalendarDebtQueryRow>();

  const sendable: CalendarDebtItem[] = [];
  const blockedByPerson = new Map<Id, CalendarBlockedRecipient>();
  let currentCount = 0;
  let firstInviteCount = 0;
  let unsentUpdateCount = 0;
  for (const row of result.results) {
    const session: CalendarSessionRow = {
      abstract: row.abstract,
      building_address: row.building_address,
      building_lat: row.building_lat,
      building_lng: row.building_lng,
      building_name: row.building_name,
      duration_min: row.duration_min,
      event_id: row.event_id,
      event_name: row.event_name,
      event_slug: row.event_slug,
      event_timezone: row.event_timezone,
      room_name: row.room_name,
      starts_at: row.starts_at,
      submission_id: row.submission_id,
      title: row.title,
    };
    const recipient = { email: row.person_email, name: row.person_name, person_id: row.person_id };
    const snapshot = snapshotFor(session, recipient, normalizedOrigin(origin));
    const priorSnapshot = parseCalendarRequestSnapshot(row.invite_request_snapshot);
    const hasDeliveredRequest = row.invite_uid !== null
      && row.invite_status === "active"
      && row.invite_last_method === "REQUEST"
      && priorSnapshot !== null;
    if (hasDeliveredRequest && calendarSlotMaterialEqual(priorSnapshot, snapshot)) {
      currentCount += 1;
      continue;
    }

    const kind: CalendarDebtKind = row.invite_uid === null ? "first" : "update";
    const uid = row.invite_uid ?? calendarUid(row.submission_id, row.person_id);
    const item: CalendarDebtItem = {
      kind,
      person_email: row.person_email,
      person_id: row.person_id,
      person_name: row.person_name,
      prior_sequence: row.invite_sequence,
      prior_snapshot: priorSnapshot,
      session,
      snapshot,
      submission_id: row.submission_id,
      uid,
    };
    if (kind === "first") firstInviteCount += 1;
    else unsentUpdateCount += 1;
    if (!validEmail(row.person_email)) {
      const existing = blockedByPerson.get(row.person_id);
      if (existing) {
        if (!existing.submission_ids.includes(row.submission_id)) existing.submission_ids.push(row.submission_id);
      } else {
        blockedByPerson.set(row.person_id, {
          email: row.person_email,
          person_id: row.person_id,
          person_name: row.person_name,
          reason: blockedReason(row.person_email),
          submission_ids: [row.submission_id],
        });
      }
      continue;
    }
    sendable.push(item);
  }

  const speakersByPerson = new Map<Id, CalendarDebtSpeaker>();
  for (const item of sendable) {
    const existing = speakersByPerson.get(item.person_id);
    if (existing) existing.items.push(item);
    else speakersByPerson.set(item.person_id, { email: item.person_email, items: [item], name: item.person_name, person_id: item.person_id });
  }
  return {
    blocked: [...blockedByPerson.values()],
    current_count: currentCount,
    first_invite_count: firstInviteCount,
    no_op: sendable.length === 0 && blockedByPerson.size === 0,
    sendable,
    speakers: [...speakersByPerson.values()],
    unsent_update_count: unsentUpdateCount,
  };
}

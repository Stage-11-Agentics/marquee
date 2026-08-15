/**
 * Attendees, the way this product holds them: an org-scoped `people` row plus
 * one event-scoped row saying they are coming to this conference.
 *
 * A separate attendee database was considered and ruled against (design §7,
 * R2-3). It re-creates the parallel-people-table anti-pattern and blinds the
 * CRM to the continuity that makes an attendee list worth keeping — this year's
 * attendee is next year's speaker prospect, and only one table can know that.
 *
 * So: human properties stay on `people`, this conference's facts live here, and
 * the 0012 annotations machinery (notes, tags, lists) works on attendees the
 * moment the row exists, with no new UI at all.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { newUlid } from "../api/ids";
import type { AttendanceSource, Id } from "../db/schema";

export interface AttendanceInput {
  eventId: Id;
  personId: Id;
  source: AttendanceSource;
  scheduleCode?: string | null;
  verifiedAt?: number | null;
  now: number;
}

/**
 * Idempotent by (person, event, source): re-running an export never writes a
 * second row, and an imported ticket-holder who later claims their own
 * schedule ends up holding one row of each rather than a duplicate of either.
 */
export async function upsertAttendance(database: D1Database, input: AttendanceInput): Promise<void> {
  await database
    .prepare(
      `INSERT INTO event_attendances
         (id, person_id, event_id, source, schedule_code, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, event_id, source) DO UPDATE SET
         schedule_code = excluded.schedule_code,
         verified_at = excluded.verified_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      newUlid(input.now),
      input.personId,
      input.eventId,
      input.source,
      input.source === "import" ? null : input.scheduleCode ?? null,
      input.verifiedAt ?? null,
      input.now,
      input.now,
    )
    .run();
}

/** Statement form, for an import that writes a batch. */
export function attendanceStatement(database: D1Database, input: AttendanceInput): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO event_attendances
         (id, person_id, event_id, source, schedule_code, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, event_id, source) DO UPDATE SET
         updated_at = excluded.updated_at`,
    )
    .bind(
      newUlid(input.now),
      input.personId,
      input.eventId,
      input.source,
      input.source === "import" ? null : input.scheduleCode ?? null,
      input.verifiedAt ?? null,
      input.now,
      input.now,
    );
}

/**
 * Resolve what a caller called the conference — an id or a slug — inside one
 * organization. An agent reading the site knows the slug; the admin UI knows
 * the id; neither should have to translate.
 */
export async function resolveEventForOrg(
  database: D1Database,
  orgId: string,
  eventRef: string,
): Promise<{ id: string; slug: string } | null> {
  return database
    .prepare("SELECT id, slug FROM events WHERE org_id = ? AND (id = ? OR slug = ?) LIMIT 1")
    .bind(orgId, eventRef, eventRef)
    .first<{ id: string; slug: string }>();
}

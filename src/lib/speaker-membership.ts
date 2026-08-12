/**
 * The runtime bridge from "this person speaks here" to `memberships`.
 *
 * `memberships(role='speaker')` had exactly one writer in this codebase — the
 * demo reseeder — and four readers that matter: the onboarding board's person
 * list, **speaker portal sign-in** (a runtime-created speaker could not reach
 * their own portal at all), headshot ownership on the upload read path, and the
 * bulk-comms speaker audience. A roster derived only from participations would
 * have papered over the gap and left the other three broken, so the row is
 * written where a person becomes a speaker of this conference:
 *
 *   - an organizer adding them to the roster (the only way a speaker with no
 *     session exists), and
 *   - the acceptance boundary, where the cascade already mints their tasks.
 *
 * The guard is `WHERE NOT EXISTS` rather than `INSERT OR IGNORE` because there
 * is no unique constraint on `(event_id, person_id, role)` and `ALTER TABLE`
 * cannot add one — an index added over existing data would fail the migration
 * on any duplicate already out there.
 */
import { newUlid } from "../api/ids";

export interface SpeakerMembershipInput {
  orgId: string;
  eventId: string;
  personId: string;
  now: number;
  /** Stamped when the organizer is inviting rather than merely recording. */
  invitedAt?: number | null;
}

export function speakerMembershipStatement(db: D1Database, input: SpeakerMembershipInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO memberships
         (id, org_id, event_id, person_id, role, confirmation_status, confirmed_at, invited_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'speaker', 'pending', NULL, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM memberships existing
         WHERE existing.event_id = ? AND existing.person_id = ? AND existing.role = 'speaker'
       )`,
    )
    .bind(
      newUlid(input.now),
      input.orgId,
      input.eventId,
      input.personId,
      input.invitedAt ?? null,
      input.now,
      input.now,
      input.eventId,
      input.personId,
    );
}

/**
 * Bridge every speaker and co-speaker of the given accepted submissions into
 * the event's membership list. Called from the acceptance cascade, where the
 * conference has just committed to these people.
 *
 * The person set is read first and the rows are then built through `newUlid`
 * rather than minted by an `INSERT … SELECT`: membership ids are ULIDs
 * everywhere else in this schema, and audit history that is read in write order
 * depends on that being true of every writer, not most of them.
 */
export async function acceptedSpeakerMembershipStatements(
  db: D1Database,
  eventId: string,
  submissionIds: readonly string[],
  now: number,
): Promise<D1PreparedStatement[]> {
  const ids = [...new Set(submissionIds)];
  if (ids.length === 0) return [];
  const event = await db.prepare("SELECT org_id FROM events WHERE id = ?").bind(eventId).first<{ org_id: string }>();
  if (!event) return [];
  const people = await db
    .prepare(
      `SELECT DISTINCT part.person_id
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
       WHERE submission.event_id = ?
         AND submission.status = 'accepted'
         AND part.role IN ('speaker', 'co_speaker')
         AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY part.person_id ASC`,
    )
    .bind(eventId, JSON.stringify(ids))
    .all<{ person_id: string }>();
  return people.results.map((row) =>
    speakerMembershipStatement(db, { orgId: event.org_id, eventId, personId: row.person_id, now }),
  );
}

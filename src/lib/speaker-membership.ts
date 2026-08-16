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
 *   - an organizer adding them to the roster,
 *   - the acceptance boundary, where the cascade already mints their tasks,
 *   - and the Sessionize speakers import, which reconciles every speaker row
 *     into the event even when the person's fields do not change.
 *
 * Duplicates are absorbed by the constraint, not by a read-then-write check:
 * `uq_memberships_event` already covers `(org_id, event_id, person_id, role)`
 * (`0001_init.sql:755`), so the conflict upsert is race-free where a
 * `WHERE NOT EXISTS` guard is not. That matters: a double-clicked "Add speaker"
 * racing the acceptance cascade must not raise UNIQUE inside the cascade's
 * batch and abort task minting for the whole acceptance. An explicit invitation
 * is the one meaningful update on conflict: a re-add can be the first place an
 * organizer records that they reached out, so an old pending membership must
 * gain its invitation timestamp without clearing confirmation or decline state.
 *
 * The bridge is deliberately one-way. Nothing here removes a membership when a
 * talk is withdrawn or an acceptance reversed: the person may still hold
 * another accepted session, the organizer may have added them by hand, and the
 * reversal dialog asks the organizer explicitly about tasks, mail, and calendar
 * without ever claiming to revoke portal access. Removing someone from the
 * roster is an organizer act and wants its own control.
 */
import { newUlid } from "../api/ids";
import { roleInSql, WORK_HOLDING_PARTICIPATION_ROLES } from "./participants";

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
       VALUES (?, ?, ?, ?, 'speaker', 'pending', NULL, ?, ?, ?)
       ON CONFLICT (org_id, event_id, person_id, role) WHERE event_id IS NOT NULL
       DO UPDATE SET
         invited_at = COALESCE(memberships.invited_at, excluded.invited_at),
         updated_at = CASE
           WHEN excluded.invited_at IS NULL THEN memberships.updated_at
           ELSE excluded.updated_at
         END`,
    )
    .bind(
      newUlid(input.now),
      input.orgId,
      input.eventId,
      input.personId,
      input.invitedAt ?? null,
      input.now,
      input.now,
    );
}

/**
 * Bridge every on-stage participant of the given accepted submissions into the
 * event's membership list. Called from the acceptance cascade, where the
 * conference has just committed to these people.
 *
 * The population is `WORK_HOLDING_PARTICIPATION_ROLES`, not a list spelled out
 * here: a moderator the conference has accepted needs the portal seat this row
 * gates exactly as much as a speaker does.
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
         AND ${roleInSql("part", WORK_HOLDING_PARTICIPATION_ROLES)}
         AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY part.person_id ASC`,
    )
    .bind(eventId, JSON.stringify(ids))
    .all<{ person_id: string }>();
  return people.results.map((row) =>
    speakerMembershipStatement(db, { orgId: event.org_id, eventId, personId: row.person_id, now }),
  );
}

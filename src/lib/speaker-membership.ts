/**
 * The runtime bridge from "this person speaks here" to `memberships`.
 *
 * `memberships(role='speaker')` is shared by three runtime writers and four
 * readers that matter: the onboarding board's person list, **speaker portal
 * sign-in** (a runtime-created speaker could not reach their own portal at all),
 * headshot ownership on the upload read path, and the bulk-comms speaker
 * audience. A roster derived only from participations would have papered over
 * the gap and left the other three broken, so the row is written where a person
 * becomes a speaker of this conference:
 *
 *   - an organizer adding them to the roster,
 *   - the acceptance boundary, where the cascade already mints their tasks,
 *   - and the Sessionize speakers import, which reconciles every speaker row
 *     into the event even when the person's fields do not change.
 *
 * The first two are claims on an imported seat and emit the
 * `speaker_roster_linked` audit ledger entry in the same batch as their
 * membership upsert. The import is deliberately the exception: its receipt
 * records the row it created, and it must not claim that it adopted its own
 * seat. Any fourth writer must use one of these two explicit paths; a raw
 * membership upsert without either its import receipt or claim ledger is an
 * incomplete writer, not a new provenance mechanism.
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
import { auditStatement } from "./audit";
import type { AuditActorKind } from "../db/schema";
import { roleInSql, WORK_HOLDING_PARTICIPATION_ROLES } from "./participants";
import { ON_STAGE_MEMBERSHIP_ROLES } from "./roster-source";

export interface SpeakerMembershipInput {
  orgId: string;
  eventId: string;
  personId: string;
  now: number;
  /**
   * The role the seat was earned in. Defaults to `speaker`, which is what every
   * organizer-facing writer means: "Add speaker", the Sessionize import, and
   * the roster status control are all declaring a speaker, and there is often
   * no participation to read a role from. Only the acceptance cascade passes
   * something else, because only it knows the participation the seat came from.
   */
  role?: MembershipSeatRole;
  /** Stamped when the organizer is inviting rather than merely recording. */
  invitedAt?: number | null;
  /**
   * The id to give the row IF this statement inserts one.
   *
   * A caller that has to reverse exactly its own writes — the people import's
   * undo — needs to know which seats it created, and the upsert below cannot
   * tell an insert from a match after the fact. Supplying the id means the
   * caller already holds it: if the insert lands, the id names the row it made;
   * if the seat already existed, the conflict keeps the ORIGINAL row's id and
   * the caller's id names nothing, so an id-scoped delete cannot reach a
   * different membership row. The id records which row the import created; it
   * does not make that row permanently owned by the import. A later organizer
   * claim can adopt the same row, so an undo must still check the row's current
   * intent before deleting it.
   */
  id?: string;
}

export interface SpeakerMembershipAuditActor {
  kind: AuditActorKind;
  personId: string | null;
  requestId: string | null;
}

/** The on-stage seat vocabulary `memberships.role` accepts (migration 0028). */
export type MembershipSeatRole = (typeof ON_STAGE_MEMBERSHIP_ROLES)[number];

export function speakerMembershipStatement(db: D1Database, input: SpeakerMembershipInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO memberships
         (id, org_id, event_id, person_id, role, confirmation_status, confirmed_at, invited_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)
       ON CONFLICT (org_id, event_id, person_id, role) WHERE event_id IS NOT NULL
       DO UPDATE SET
         invited_at = COALESCE(memberships.invited_at, excluded.invited_at),
         updated_at = CASE
           WHEN excluded.invited_at IS NULL THEN memberships.updated_at
           ELSE excluded.updated_at
         END`,
    )
    .bind(
      input.id ?? newUlid(input.now),
      input.orgId,
      input.eventId,
      input.personId,
      input.role ?? "speaker",
      input.invitedAt ?? null,
      input.now,
      input.now,
    );
}

function speakerRosterLinkedAuditStatement(
  db: D1Database,
  input: SpeakerMembershipInput,
  actor: SpeakerMembershipAuditActor | undefined,
): D1PreparedStatement {
  return auditStatement(db, {
    eventId: input.eventId,
    actorKind: actor?.kind ?? "system",
    actorPersonId: actor?.personId ?? null,
    action: "speaker_roster_linked",
    entityType: "person",
    entityId: input.personId,
    after: {
      source: "acceptance_cascade",
      role: input.role ?? "speaker",
    },
    now: input.now,
    requestId: actor?.requestId ?? null,
  });
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
  actor?: SpeakerMembershipAuditActor,
): Promise<D1PreparedStatement[]> {
  const ids = [...new Set(submissionIds)];
  if (ids.length === 0) return [];
  const event = await db.prepare("SELECT org_id FROM events WHERE id = ?").bind(eventId).first<{ org_id: string }>();
  if (!event) return [];
  // The seat carries the role it was earned in, and a person on two sessions
  // keeps the most speaking-forward of them: someone who speaks on one talk and
  // moderates another is a speaker of this conference, and a seat that recorded
  // `moderator` would take them off its roster. Declaration order in
  // `WORK_HOLDING_PARTICIPATION_ROLES` is that precedence.
  const rank = WORK_HOLDING_PARTICIPATION_ROLES
    .map((role, index) => `WHEN '${role}' THEN ${index}`)
    .join(" ");
  const people = await db
    .prepare(
      `SELECT part.person_id, part.role
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
       WHERE submission.event_id = ?
         AND submission.status = 'accepted'
         AND ${roleInSql("part", WORK_HOLDING_PARTICIPATION_ROLES)}
         AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         AND part.id = (
           SELECT ranked.id
           FROM participations ranked
           JOIN submissions ranked_submission ON ranked_submission.id = ranked.submission_id
           WHERE ranked.person_id = part.person_id
             AND ranked_submission.event_id = submission.event_id
             AND ranked_submission.status = 'accepted'
             AND ${roleInSql("ranked", WORK_HOLDING_PARTICIPATION_ROLES)}
           ORDER BY CASE ranked.role ${rank} ELSE ${WORK_HOLDING_PARTICIPATION_ROLES.length} END,
                    ranked.id ASC
           LIMIT 1
         )
       ORDER BY part.person_id ASC`,
    )
    .bind(eventId, JSON.stringify(ids))
    .all<{ person_id: string; role: MembershipSeatRole }>();
  return people.results.flatMap((row) => {
    const input = { orgId: event.org_id, eventId, personId: row.person_id, role: row.role, now };
    return [
      speakerMembershipStatement(db, input),
      speakerRosterLinkedAuditStatement(db, input, actor),
    ];
  });
}

/**
 * The on-stage role this person's seat at this event was earned in.
 *
 * Every organizer-facing write to a seat has to target the row that exists, not
 * the one it assumes. `memberships` is unique on `(org, event, person, role)`,
 * so writing `speaker` for someone the acceptance cascade seated as
 * `co_speaker` does not update their row — it mints a SECOND, phantom seat, and
 * every predicate keyed on the role then reads whichever one it happened to
 * name. A confirmation lands on the phantom while the real seat stays pending,
 * and nothing on any screen says which is which.
 *
 * `speaker` is the answer when there is no seat yet, because the only writer
 * that reaches this without one is an organizer declaring a speaker.
 */
export async function earnedSeatRole(
  db: D1Database,
  eventId: string,
  personId: string,
): Promise<MembershipSeatRole> {
  const row = await db
    .prepare(
      `SELECT role FROM memberships
       WHERE event_id = ? AND person_id = ?
         AND ${roleInSql("memberships", WORK_HOLDING_PARTICIPATION_ROLES)}
       ORDER BY CASE role ${WORK_HOLDING_PARTICIPATION_ROLES.map((role, index) => `WHEN '${role}' THEN ${index}`).join(" ")} ELSE ${WORK_HOLDING_PARTICIPATION_ROLES.length} END
       LIMIT 1`,
    )
    .bind(eventId, personId)
    .first<{ role: MembershipSeatRole }>();
  return row?.role ?? "speaker";
}

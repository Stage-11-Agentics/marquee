/**
 * The runtime bridge from "this person speaks here" to `memberships`.
 *
 * `memberships(role='speaker')` has five runtime write sites and four readers
 * that matter: the onboarding board's person list, **speaker portal sign-in**
 * (a runtime-created speaker could not reach their own portal at all), headshot
 * ownership on the upload read path, and the bulk-comms speaker audience. A
 * roster derived only from participations would have papered over the gap and
 * left the other three broken. The write sites are:
 *
 *   - an organizer adding the person to the roster,
 *   - the acceptance boundary, where the cascade already mints their tasks,
 *   - the people roster import, which owns its created-row receipt,
 *   - the Sessionize speakers import, which reconciles every speaker row even
 *     when the person's fields do not change, and
 *   - the organizer's confirmation-status patch, whose `invited_at` update is
 *     its retention signal.
 *
 * The membership writer below requires every caller to declare its intent.
 * Organizer and acceptance claims return the membership upsert and their
 * `speaker_roster_linked` audit row together, so the caller can put both in
 * one batch. The people and Sessionize imports are deliberately the exception:
 * their receipts own the rows they create, and an import must not claim that
 * it adopted its own seat. A confirmation-status writer declares the
 * `invited_at` signal it stamps in the same operation. A fourth writer cannot
 * add an unclassified raw upsert through this module; it must choose one of
 * these three semantics and make that choice reviewable at the call site.
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

type SpeakerMembershipLedger =
  | {
      kind: "import";
      source: "people_import" | "sessionize_import";
    }
  | {
      kind: "status";
      source: "organizer_status";
    }
  | {
      kind: "claim";
      source: "organizer_add" | "acceptance_cascade";
      action: "speaker_roster_linked" | "speaker_created";
      actor?: SpeakerMembershipAuditActor;
      before?: unknown;
      after?: unknown;
    };

/** The on-stage seat vocabulary `memberships.role` accepts (migration 0028). */
export type MembershipSeatRole = (typeof ON_STAGE_MEMBERSHIP_ROLES)[number];

function membershipUpsertStatement(db: D1Database, input: SpeakerMembershipInput): D1PreparedStatement {
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

/**
 * Build the membership write with an explicit ownership/claim decision.
 *
 * This is intentionally the only exported membership writer. Import paths
 * choose `kind: \"import\"` and rely on their own receipts; the organizer
 * Add speaker and acceptance paths choose `kind: \"claim\"` and receive the
 * adoption audit row beside the upsert; confirmation-status writes choose
 * `kind: \"status\"` because their `invited_at` update is the retention
 * signal. Keeping the choice in this function prevents a new caller from
 * copying the upsert and silently omitting the ledger.
 */
export function speakerMembershipStatements(
  db: D1Database,
  input: SpeakerMembershipInput,
  ledger: SpeakerMembershipLedger,
): D1PreparedStatement[] {
  const statements = [membershipUpsertStatement(db, input)];
  if (ledger.kind !== "claim") return statements;
  statements.push(
    auditStatement(db, {
      eventId: input.eventId,
      actorKind: ledger.actor?.kind ?? "system",
      actorPersonId: ledger.actor?.personId ?? null,
      action: ledger.action,
      entityType: "person",
      entityId: input.personId,
      before: ledger.before,
      after: {
        ...(ledger.after ?? {}),
        source: ledger.source,
        role: input.role ?? "speaker",
      },
      now: input.now,
      requestId: ledger.actor?.requestId ?? null,
    }),
  );
  return statements;
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
    return speakerMembershipStatements(db, input, {
      kind: "claim",
      source: "acceptance_cascade",
      action: "speaker_roster_linked",
      actor,
    });
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

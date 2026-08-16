/**
 * One person on a submission renders once, everywhere.
 *
 * `participations` records a person's *role*, not their identity, so the
 * ordinary public CFP submission — where the person who filled the form is
 * also the person who will speak — stores that person twice: once as
 * `submitter`, once as `speaker`. Every consumer that joined the table for a
 * speaker list inherited the duplicate, which is how the published conference
 * site came to print `Robin Alvarez · Robin Alvarez`.
 *
 * The list is built here rather than at each call site so a new consumer
 * inherits the dedupe instead of the bug. Two audiences:
 *
 *   - `public`  — the conference site, its embeds, its search. Speaking roles
 *     only: who submitted the abstract is not audience information.
 *   - `program` — organizer surfaces. Every participant is kept, because a
 *     record with only a submitter must not read as a session with nobody on
 *     it; the speaking roles simply sort first.
 */
import { PARTICIPATION_ROLES, type ParticipationRole } from "../db/schema";

/** The roles an audience recognises as "on stage". */
export const SPEAKING_PARTICIPATION_ROLES = [
  "speaker",
  "co_speaker",
  "moderator",
  "chairperson",
] as const satisfies readonly ParticipationRole[];

/**
 * Who the conference owes work to, and therefore chases.
 *
 * Three fan-outs used to carry their own literal role list and disagree:
 * task reconciliation and calendar invites read `(speaker, submitter)`, event
 * membership read `(speaker, co_speaker)`. A moderator satisfied none of the
 * three, which is how someone could stand on the published agenda with no
 * calendar invite, no membership row, and no way into their own portal — while
 * the agenda's conflict engine (AC-77) had been counting them as on stage all
 * along. Being on stage and being asked to do the work are the same population;
 * naming it once is what keeps that true.
 */
export const WORK_HOLDING_PARTICIPATION_ROLES = SPEAKING_PARTICIPATION_ROLES;

/**
 * Who receives the session's calendar invite.
 *
 * The submitter is here and nowhere else in the work fan-out: they are the
 * person fielding "when is this again?" even when someone else is on stage, and
 * AC-328 binds a calendar-recipient `submitter` by name — a cancellation has to
 * reach them when their participation is removed. Derived from the work-holding
 * set rather than typed out, so widening one widens both.
 */
export const CALENDAR_PARTICIPATION_ROLES = [
  ...WORK_HOLDING_PARTICIPATION_ROLES,
  "submitter",
] as const satisfies readonly ParticipationRole[];

/**
 * The order in which one participant stands for the whole submission when a
 * surface has room for exactly one name.
 *
 * Program surfaces answer "whose talk is this" and lead with the stage.
 */
export const PROGRAM_PRIMACY_ROLES = [
  ...WORK_HOLDING_PARTICIPATION_ROLES,
  "submitter",
] as const satisfies readonly ParticipationRole[];

/**
 * The order in which one participant receives the decision.
 *
 * This is the same ladder read the other way round, and the difference is the
 * product: a decision answers the person who submitted the abstract, not the
 * person who would deliver it (AC-223). Where those are the same person — the
 * ordinary CFP submission, which stores them as two rows — the two ladders
 * agree and nothing changes. Where a comms manager submitted for an executive,
 * the reply reaches the comms manager and the homework reaches the executive.
 */
export const DECISION_RECIPIENT_ROLES = [
  "submitter",
  ...WORK_HOLDING_PARTICIPATION_ROLES,
] as const satisfies readonly ParticipationRole[];

/**
 * The roles a task template is assigned to, read defensively.
 *
 * `task_templates.applies_to_roles` is stored JSON with no CHECK behind it
 * (SQLite cannot add one without rebuilding the table), so this is where the
 * shape is enforced. An absent, malformed, empty, or wholly unrecognised value
 * reads as the full on-stage set rather than as nobody: a template that
 * silently reaches no one is invisible on every organizer surface — the chase
 * board simply has one fewer row — while a template that reaches everyone is
 * the behaviour that predates the column, and is obvious the moment it is
 * wrong.
 */
export function readTaskAppliesToRoles(value: unknown): ParticipationRole[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) return [...WORK_HOLDING_PARTICIPATION_ROLES];
  const roles = WORK_HOLDING_PARTICIPATION_ROLES.filter((role) => parsed.includes(role));
  return roles.length > 0 ? [...roles] : [...WORK_HOLDING_PARTICIPATION_ROLES];
}

/** The stored form of a role selection: declaration order, never the caller's. */
export function writeTaskAppliesToRoles(value: unknown): string {
  return JSON.stringify(readTaskAppliesToRoles(value));
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function roleList(roles: readonly string[]): string {
  return roles.map((role) => `'${role}'`).join(", ");
}

const WORK_HOLDING_ROLE_SET: ReadonlySet<string> = new Set(WORK_HOLDING_PARTICIPATION_ROLES);

/**
 * Is this role an on-stage one?
 *
 * The TypeScript counterpart to `roleInSql`, for the predicates that are not
 * SQL. `memberships.role` is two vocabularies in one column, so "not a speaker"
 * stopped meaning "staff" the moment the on-stage half widened — and the place
 * that mattered most was an auth decision, where reading a moderator as an
 * organizer silently withdrew a token's documented fallback grants.
 */
export function isOnStageRole(role: string): boolean {
  return WORK_HOLDING_ROLE_SET.has(role);
}

/** `role IN (…)` over a named set. Never built from request input. */
export function roleInSql(alias: string, roles: readonly string[]): string {
  return `${alias}.role IN (${roleList(roles)})`;
}

/**
 * `role NOT IN (…)` over a named set.
 *
 * The complement needs its own helper because the sets it complements grow.
 * `memberships.role` is two vocabularies in one column, and every predicate
 * meaning "staff" was written as `role <> 'speaker'` — true for a moderator the
 * moment the on-stage vocabulary widened, which would have handed them a staff
 * seat. Spelling the complement out at each call site has the same failure
 * mode one widening later.
 */
export function roleNotInSql(alias: string, roles: readonly string[]): string {
  return `${alias}.role NOT IN (${roleList(roles)})`;
}

/**
 * One participant's column, chosen by an explicit role ladder, with a fallback
 * for the submission that has no participation rows at all.
 *
 * Five call sites used to spell this out by hand and had already drifted: each
 * carried its own two-branch `CASE` and its own idea of which roles qualified,
 * so widening the participant model meant finding all five. `order` is the
 * ladder; `fallback` is an expression in the caller's scope.
 */
export function primaryParticipantSql(options: {
  submissionId: string;
  column: string;
  order: readonly string[];
  fallback: string;
}): string {
  const rank = options.order
    .map((role, index) => `WHEN '${role}' THEN ${index}`)
    .join(" ");
  return `COALESCE((
                SELECT primary_person.${options.column}
                FROM participations primary_part
                JOIN people primary_person ON primary_person.id = primary_part.person_id
                WHERE primary_part.submission_id = ${options.submissionId}
                  AND ${roleInSql("primary_part", options.order)}
                ORDER BY CASE primary_part.role ${rank} ELSE ${options.order.length} END,
                         primary_part.position ASC, primary_part.id ASC
                LIMIT 1
              ), ${options.fallback})`;
}

/** Public surfaces name a missing on-stage participant instead of printing punctuation. */
export const PUBLIC_SPEAKER_EMPTY_LABEL = "Speaker to be announced";

export type ParticipantAudience = "public" | "program";

const SPEAKING_ROLE_SET: ReadonlySet<string> = new Set(SPEAKING_PARTICIPATION_ROLES);

/** Declaration order in `PARTICIPATION_ROLES` is the display order. */
function roleRankSql(alias: string): string {
  const branches = PARTICIPATION_ROLES.map((role, index) => `WHEN '${role}' THEN ${index}`).join(" ");
  return `CASE ${alias}.role ${branches} ELSE ${PARTICIPATION_ROLES.length} END`;
}

function roleFilterSql(alias: string, audience: ParticipantAudience): string {
  if (audience === "program") return "";
  const roles = SPEAKING_PARTICIPATION_ROLES.map((role) => `'${role}'`).join(", ");
  return ` AND ${alias}.role IN (${roles})`;
}

/**
 * A predicate for "this submission has a participant the given audience can
 * see" — the public site's name search must not match a person the page will
 * never print.
 */
export function participantAudienceFilterSql(alias: string, audience: ParticipantAudience): string {
  return roleFilterSql(alias, audience);
}

/** True when the audience prints someone holding this role. */
export function isVisibleToAudience(role: string, audience: ParticipantAudience): boolean {
  return audience === "program" || SPEAKING_ROLE_SET.has(role);
}

/**
 * A `json_group_array` of the people on one submission, each exactly once,
 * ordered by role then position. The winning row for a person held in two
 * roles is their most speaking-forward one, so a submitter-who-speaks reads as
 * a speaker.
 *
 * `fields` maps each JSON key to an expression over the `participation` and
 * `speaker` aliases bound inside the subquery. `submissionId` is an expression
 * in the *caller's* scope (`s.id`, `submission.id`, …) and so must not name
 * either of those aliases.
 */
export function participantListSql(options: {
  submissionId: string;
  audience: ParticipantAudience;
  fields: Readonly<Record<string, string>>;
}): string {
  const projected = Object.entries(options.fields);
  if (projected.length === 0) throw new Error("participantListSql requires at least one field");
  const objectArguments = projected.map(([key]) => `'${key}', ordered.${key}`).join(", ");
  const selected = projected.map(([key, expression]) => `${expression} AS ${key}`).join(", ");
  const visible = roleFilterSql("participation", options.audience);
  const visibleRanked = roleFilterSql("ranked", options.audience);
  return `COALESCE((
    SELECT json_group_array(json_object(${objectArguments}))
    FROM (
      SELECT ${selected}
      FROM participations participation
      JOIN people speaker ON speaker.id = participation.person_id
      WHERE participation.submission_id = ${options.submissionId}${visible}
        AND participation.id = (
          SELECT ranked.id
          FROM participations ranked
          WHERE ranked.submission_id = participation.submission_id
            AND ranked.person_id = participation.person_id${visibleRanked}
          ORDER BY ${roleRankSql("ranked")} ASC, ranked.position ASC, ranked.id ASC
          LIMIT 1
        )
      ORDER BY ${roleRankSql("participation")} ASC, participation.position ASC, participation.id ASC
    ) ordered
  ), '[]')`;
}

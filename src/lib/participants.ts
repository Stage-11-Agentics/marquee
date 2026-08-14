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

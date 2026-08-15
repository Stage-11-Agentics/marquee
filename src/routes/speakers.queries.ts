/**
 * The speaker roster, and the one definition of "who speaks at this event".
 *
 * The roster and the onboarding chase board are the same population asked two
 * different questions, so they read one source here rather than each carrying
 * its own join. The difference between them is named, not accidental:
 *
 *   - `SPEAKER_ROSTER_PERSON_SOURCE` — a `memberships(role='speaker')` row for
 *     the event, or a `speaker`/`co_speaker` participation on one of its
 *     submissions. Membership is the fact (see `lib/speaker-membership.ts`);
 *     the participation half is the guarantee that a speaker created by a path
 *     this module does not know about is still never invisible on the roster.
 *   - `ONBOARDING_PERSON_SOURCE` — that, plus anyone holding a `speaker_tasks`
 *     row for the event. The cascade mints tasks for `submitter` participants
 *     too, and the board is "everyone the conference owes work to", which is a
 *     superset of the roster. A program-committee submitter belongs on the
 *     chase board and does not belong on a speaker roster.
 *
 * Status precedence lives in `rollupSpeakerStatus` and nowhere else.
 */
import type { D1Database } from "@cloudflare/workers-types";

import type { ListEnvelope } from "../api/list";
import { executeListPage, parsePagination } from "../api/pagination";
import { parseCustomFields, parseSocialLinks } from "../lib/person-profile";
import { ONBOARDING_PERSON_SOURCE, ROSTER_SUBMISSION_STATUSES, SPEAKER_ROSTER_PERSON_SOURCE, speakerRosterPersonSource } from "../lib/roster-source";
import { buildPeopleQuery } from "./people.queries";

export const SPEAKER_STATUSES = ["pending", "invited", "confirmed", "declined"] as const;
export type SpeakerStatus = (typeof SPEAKER_STATUSES)[number];

export const SPEAKER_STATUS_LABELS: Record<SpeakerStatus, string> = {
  pending: "Pending",
  invited: "Invited",
  confirmed: "Confirmed",
  declined: "Declined",
};

// The population itself is defined in lib/roster-source.ts, because the one
// people query needs the same definition when it is narrowed by event_id.
// Re-exported here so this module stays the roster's single import surface.
export { ONBOARDING_PERSON_SOURCE, ROSTER_SUBMISSION_STATUSES, SPEAKER_ROSTER_PERSON_SOURCE };

const ROSTER_STATUS_LIST = ROSTER_SUBMISSION_STATUSES.map((status) => `'${status}'`).join(", ");

export interface SpeakerParticipationRow {
  id: string;
  submission_id: string;
  submission_title: string;
  submission_status: string;
  role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
  invited_at: number | null;
}

export interface SpeakerMembershipRow {
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
  invited_at: number | null;
}

/**
 * The roster badge, derived — never stored.
 *
 * A speaker with sessions is described by those sessions: one decline is the
 * headline, all-confirmed is the clear state, and anything else is outstanding.
 * Only a speaker with no sessions at all falls through to the membership row,
 * which is the sole thing the organizer override can be recorded against before
 * a session exists ("she confirmed on a call" happens well before scheduling).
 * The override writes both, in one batch, so the two can never disagree.
 */
export function rollupSpeakerStatus(
  participations: readonly Pick<SpeakerParticipationRow, "confirmation_status" | "invited_at">[],
  membership: SpeakerMembershipRow | null,
): SpeakerStatus {
  if (participations.length > 0) {
    if (participations.some((row) => row.confirmation_status === "declined")) return "declined";
    if (participations.every((row) => row.confirmation_status === "confirmed")) return "confirmed";
    return participations.some((row) => row.invited_at !== null) ? "invited" : "pending";
  }
  if (!membership) return "pending";
  if (membership.confirmation_status === "declined") return "declined";
  if (membership.confirmation_status === "confirmed") return "confirmed";
  return membership.invited_at === null ? "pending" : "invited";
}

export interface SpeakerTrack {
  id: string;
  name: string;
  color: string;
}

export interface SpeakerSessionSummary {
  submission_id: string;
  title: string;
  status: string;
  role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  participation_id: string;
}

export interface SpeakerRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  /**
   * Projected for MRQ-112, which owns the headshot serve path and the render.
   * The roster's avatar renders initials until that lands; the field being
   * present here is what lets it become an `<img>` without a schema change.
   */
  headshot_attachment_id: string | null;
  social_links: string[];
  custom_fields: Record<string, string>;
  status: SpeakerStatus;
  is_member: boolean;
  sessions: SpeakerSessionSummary[];
  tracks: SpeakerTrack[];
  task_total: number;
  task_done: number;
  created_at: number;
  updated_at: number;
}

export interface SpeakerRosterSnapshot extends ListEnvelope<SpeakerRow> {
  generated_at: number;
  counts: Record<SpeakerStatus | "all", number>;
  tracks: SpeakerTrack[];
}

export interface SpeakerFilters {
  search?: string;
  status?: SpeakerStatus | "all";
  track?: string;
  page?: number;
  perPage?: number;
}

interface PersonQueryRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshot_attachment_id: string | null;
  social_links: string | null;
  custom_fields: string | null;
  created_at: number;
  updated_at: number;
  membership_status: "pending" | "confirmed" | "declined" | null;
  membership_confirmed_at: number | null;
  membership_invited_at: number | null;
}

interface ParticipationQueryRow extends SpeakerParticipationRow {
  person_id: string;
}

interface TrackQueryRow {
  person_id: string;
  id: string;
  name: string;
  color: string;
}

interface TaskCountRow {
  person_id: string;
  total: number;
  done: number;
}

/**
 * The roster's person rows come from the ONE people query, narrowed by
 * `event_id` — `buildPeopleQuery` in `people.queries.ts`. The roster is not a
 * second list implementation; it is that query with the conference filter
 * applied, plus the three membership columns only a conference has. The
 * projection extension is what keeps it one query instead of two.
 */
const ROSTER_COLUMNS = `person.social_links, person.custom_fields,
       membership.confirmation_status AS membership_status,
       membership.confirmed_at AS membership_confirmed_at,
       membership.invited_at AS membership_invited_at`;

const ROSTER_JOIN = `LEFT JOIN memberships membership
       ON membership.person_id = person.id AND membership.event_id = ? AND membership.role = 'speaker'`;

async function rosterRows(db: D1Database, eventId: string): Promise<PersonQueryRow[]> {
  const built = rosterQuery(eventId);
  const result = await db.prepare(built.sql).bind(...built.bindings).all<PersonQueryRow>();
  return result.results;
}

function rosterQuery(eventId: string, personId?: string): { sql: string; bindings: (string | number)[] } {
  const built = buildPeopleQuery({
    eventId,
    ...(personId === undefined ? {} : { personId }),
    columns: ROSTER_COLUMNS,
    joins: ROSTER_JOIN,
    joinBindings: [eventId],
  });
  return { sql: built.dataSql, bindings: built.dataBindings };
}

/** One person or the whole event: the detail view must not scan the roster to draw one row. */
function personClause(personId: string | undefined, column: string): { clause: string; bindings: string[] } {
  return personId === undefined ? { clause: "", bindings: [] } : { clause: ` AND ${column} = ?`, bindings: [personId] };
}

async function listParticipations(db: D1Database, eventId: string, personId?: string): Promise<ParticipationQueryRow[]> {
  const scope = personClause(personId, "part.person_id");
  const result = await db
    .prepare(
      `SELECT part.id, part.person_id, part.submission_id, part.role, part.confirmation_status,
              part.confirmed_at, part.invited_at,
              submission.title AS submission_title, submission.status AS submission_status
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
       WHERE submission.event_id = ? AND part.role IN ('speaker', 'co_speaker')
         AND submission.status IN (${ROSTER_STATUS_LIST})${scope.clause}
       ORDER BY part.person_id ASC, submission.title COLLATE NOCASE ASC, part.id ASC`,
    )
    .bind(eventId, ...scope.bindings)
    .all<ParticipationQueryRow>();
  return result.results;
}

async function listTracks(db: D1Database, eventId: string, personId?: string): Promise<TrackQueryRow[]> {
  const scope = personClause(personId, "part.person_id");
  const result = await db
    .prepare(
      `SELECT DISTINCT part.person_id, track.id, track.name, track.color
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
       JOIN submission_tracks submission_track ON submission_track.submission_id = submission.id
       JOIN tracks track ON track.id = submission_track.track_id AND track.event_id = submission.event_id
       WHERE submission.event_id = ? AND part.role IN ('speaker', 'co_speaker')
         AND submission.status IN (${ROSTER_STATUS_LIST})${scope.clause}
       ORDER BY track.position ASC, track.id ASC`,
    )
    .bind(eventId, ...scope.bindings)
    .all<TrackQueryRow>();
  return result.results;
}

async function listTaskCounts(db: D1Database, eventId: string, personId?: string): Promise<TaskCountRow[]> {
  const scope = personClause(personId, "person_id");
  const result = await db
    .prepare(
      `SELECT person_id,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM speaker_tasks
       WHERE event_id = ? AND cancelled_at IS NULL${scope.clause}
       GROUP BY person_id`,
    )
    .bind(eventId, ...scope.bindings)
    .all<TaskCountRow>();
  return result.results;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(key(row));
    if (current) current.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

function buildRow(
  person: PersonQueryRow,
  participations: readonly ParticipationQueryRow[],
  tracks: readonly TrackQueryRow[],
  tasks: TaskCountRow | undefined,
): SpeakerRow {
  const membership: SpeakerMembershipRow | null = person.membership_status === null
    ? null
    : {
      confirmation_status: person.membership_status,
      confirmed_at: person.membership_confirmed_at,
      invited_at: person.membership_invited_at,
    };
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    title: person.title,
    company: person.company,
    bio: person.bio,
    headshot_attachment_id: person.headshot_attachment_id,
    social_links: parseSocialLinks(person.social_links),
    custom_fields: parseCustomFields(person.custom_fields),
    status: rollupSpeakerStatus(participations, membership),
    is_member: membership !== null,
    sessions: participations.map((row) => ({
      participation_id: row.id,
      submission_id: row.submission_id,
      title: row.submission_title,
      status: row.submission_status,
      role: row.role,
      confirmation_status: row.confirmation_status,
    })),
    tracks: tracks.map((row) => ({ id: row.id, name: row.name, color: row.color })),
    task_total: Number(tasks?.total ?? 0),
    task_done: Number(tasks?.done ?? 0),
    created_at: person.created_at,
    updated_at: person.updated_at,
  };
}

export function speakerMatchesFilters(row: SpeakerRow, filters: SpeakerFilters): boolean {
  if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.track && filters.track !== "all" && !row.tracks.some((track) => track.id === filters.track)) return false;
  const search = filters.search?.trim().toLocaleLowerCase();
  if (search) {
    const haystack = [
      row.name,
      row.email,
      row.title ?? "",
      row.company ?? "",
      row.id,
      ...row.sessions.map((session) => session.title),
    ].join(" ").toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

const SPEAKER_ROSTER_CTE = `
WITH event_scope AS (SELECT ? AS event_id),
participation_rollup AS (
  SELECT part.person_id,
         COUNT(*) AS participation_count,
         SUM(CASE WHEN part.confirmation_status = 'declined' THEN 1 ELSE 0 END) AS declined_count,
         SUM(CASE WHEN part.confirmation_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
         MAX(CASE WHEN part.invited_at IS NOT NULL THEN 1 ELSE 0 END) AS invited
    FROM participations part
    JOIN submissions submission ON submission.id = part.submission_id
    CROSS JOIN event_scope
   WHERE submission.event_id = event_scope.event_id
     AND part.role IN ('speaker', 'co_speaker')
     AND submission.status IN (${ROSTER_STATUS_LIST})
   GROUP BY part.person_id
),
roster_people AS (
  SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
         person.headshot_attachment_id, person.social_links, person.custom_fields,
         person.created_at, person.updated_at,
         membership.confirmation_status AS membership_status,
         membership.confirmed_at AS membership_confirmed_at,
         membership.invited_at AS membership_invited_at,
         event_scope.event_id,
         CASE
           WHEN COALESCE(rollup.participation_count, 0) > 0 AND rollup.declined_count > 0 THEN 'declined'
           WHEN COALESCE(rollup.participation_count, 0) > 0
             AND rollup.confirmed_count = rollup.participation_count THEN 'confirmed'
           WHEN COALESCE(rollup.participation_count, 0) > 0 AND rollup.invited = 1 THEN 'invited'
           WHEN COALESCE(rollup.participation_count, 0) = 0 AND membership.confirmation_status = 'declined' THEN 'declined'
           WHEN COALESCE(rollup.participation_count, 0) = 0 AND membership.confirmation_status = 'confirmed' THEN 'confirmed'
           WHEN COALESCE(rollup.participation_count, 0) = 0 AND membership.invited_at IS NOT NULL THEN 'invited'
           ELSE 'pending'
         END AS status
    FROM people person
    CROSS JOIN event_scope
    LEFT JOIN memberships membership
      ON membership.person_id = person.id
     AND membership.event_id = event_scope.event_id
     AND membership.role = 'speaker'
    LEFT JOIN participation_rollup rollup ON rollup.person_id = person.id
   WHERE person.id IN (${speakerRosterPersonSource("event_scope.event_id")})
)
`;

function speakerFilterWhere(filters: SpeakerFilters): { sql: string; bindings: (string | number)[] } {
  const where: string[] = [];
  const bindings: (string | number)[] = [];
  if (filters.status && filters.status !== "all") {
    where.push("roster.status = ?");
    bindings.push(filters.status);
  }
  if (filters.track && filters.track !== "all") {
    where.push(`EXISTS (
      SELECT 1
        FROM participations track_part
        JOIN submissions track_submission ON track_submission.id = track_part.submission_id
        JOIN submission_tracks track_link ON track_link.submission_id = track_submission.id
       WHERE track_part.person_id = roster.id
         AND track_submission.event_id = roster.event_id
         AND track_part.role IN ('speaker', 'co_speaker')
         AND track_submission.status IN (${ROSTER_STATUS_LIST})
         AND track_link.track_id = ?
    )`);
    bindings.push(filters.track);
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    where.push(`(
      roster.name LIKE ? COLLATE NOCASE
      OR roster.email LIKE ? COLLATE NOCASE
      OR IFNULL(roster.title, '') LIKE ? COLLATE NOCASE
      OR IFNULL(roster.company, '') LIKE ? COLLATE NOCASE
      OR roster.id LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1
          FROM participations search_part
          JOIN submissions search_submission ON search_submission.id = search_part.submission_id
         WHERE search_part.person_id = roster.id
           AND search_submission.event_id = roster.event_id
           AND search_part.role IN ('speaker', 'co_speaker')
           AND search_submission.status IN (${ROSTER_STATUS_LIST})
           AND search_submission.title LIKE ? COLLATE NOCASE
      )
    )`);
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", bindings };
}

function speakerPageQueries(eventId: string, filters: SpeakerFilters, page: ReturnType<typeof parsePagination>) {
  const scope = speakerFilterWhere(filters);
  const where = scope.sql;
  return {
    countSql: `${SPEAKER_ROSTER_CTE}SELECT COUNT(*) AS total FROM roster_people roster ${where}`,
    countBindings: [eventId, ...scope.bindings],
    dataSql: `${SPEAKER_ROSTER_CTE}SELECT roster.id, roster.name, roster.email, roster.title, roster.company, roster.bio,
         roster.headshot_attachment_id, roster.social_links, roster.custom_fields,
         roster.created_at, roster.updated_at,
         roster.membership_status, roster.membership_confirmed_at, roster.membership_invited_at
    FROM roster_people roster ${where}
    ORDER BY roster.name COLLATE NOCASE ASC, roster.id ASC
    LIMIT ? OFFSET ?`,
    dataBindings: [eventId, ...scope.bindings, page.limit, page.offset],
  };
}

async function speakerStatusCounts(db: D1Database, eventId: string): Promise<Record<SpeakerStatus | "all", number>> {
  const result = await db.prepare(
    `${SPEAKER_ROSTER_CTE}
     SELECT status, COUNT(*) AS count FROM roster_people GROUP BY status`,
  ).bind(eventId).all<{ status: SpeakerStatus; count: number }>();
  const counts: Record<SpeakerStatus | "all", number> = { all: 0, pending: 0, invited: 0, confirmed: 0, declined: 0 };
  for (const row of result.results) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

function personIdsScope(column: string, personIds: readonly string[]): { clause: string; bindings: string[] } {
  if (personIds.length === 0) return { clause: " AND 1 = 0", bindings: [] };
  return {
    clause: ` AND ${column} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    bindings: [JSON.stringify([...new Set(personIds)])],
  };
}

async function listParticipationsForPeople(db: D1Database, eventId: string, personIds: readonly string[]): Promise<ParticipationQueryRow[]> {
  const scope = personIdsScope("part.person_id", personIds);
  const result = await db.prepare(
    `SELECT part.id, part.person_id, part.submission_id, part.role, part.confirmation_status,
            part.confirmed_at, part.invited_at,
            submission.title AS submission_title, submission.status AS submission_status
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
      WHERE submission.event_id = ? AND part.role IN ('speaker', 'co_speaker')
        AND submission.status IN (${ROSTER_STATUS_LIST})${scope.clause}
      ORDER BY part.person_id ASC, submission.title COLLATE NOCASE ASC, part.id ASC`,
  ).bind(eventId, ...scope.bindings).all<ParticipationQueryRow>();
  return result.results;
}

async function listTracksForPeople(db: D1Database, eventId: string, personIds: readonly string[]): Promise<TrackQueryRow[]> {
  const scope = personIdsScope("part.person_id", personIds);
  const result = await db.prepare(
    `SELECT DISTINCT part.person_id, track.id, track.name, track.color
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
       JOIN submission_tracks submission_track ON submission_track.submission_id = submission.id
       JOIN tracks track ON track.id = submission_track.track_id AND track.event_id = submission.event_id
      WHERE submission.event_id = ? AND part.role IN ('speaker', 'co_speaker')
        AND submission.status IN (${ROSTER_STATUS_LIST})${scope.clause}
      ORDER BY track.position ASC, track.id ASC`,
  ).bind(eventId, ...scope.bindings).all<TrackQueryRow>();
  return result.results;
}

async function listTaskCountsForPeople(db: D1Database, eventId: string, personIds: readonly string[]): Promise<TaskCountRow[]> {
  const scope = personIdsScope("person_id", personIds);
  const result = await db.prepare(
    `SELECT person_id, COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM speaker_tasks
      WHERE event_id = ? AND cancelled_at IS NULL${scope.clause}
      GROUP BY person_id`,
  ).bind(eventId, ...scope.bindings).all<TaskCountRow>();
  return result.results;
}

export async function listSpeakers(
  db: D1Database,
  eventId: string,
  filters: SpeakerFilters = {},
  now = Date.now(),
): Promise<SpeakerRosterSnapshot> {
  const page = parsePagination({ page: filters.page, per_page: filters.perPage });
  const queries = speakerPageQueries(eventId, filters, page);
  const [envelope, counts, allTracks] = await Promise.all([
    executeListPage<PersonQueryRow>({
      count: db.prepare(queries.countSql).bind(...queries.countBindings),
      data: db.prepare(queries.dataSql).bind(...queries.dataBindings),
      page,
    }),
    speakerStatusCounts(db, eventId),
    listTracks(db, eventId),
  ]);
  const people = envelope.data;
  const personIds = people.map((person) => person.id);
  const [participations, tracks, tasks] = await Promise.all([
    listParticipationsForPeople(db, eventId, personIds),
    listTracksForPeople(db, eventId, personIds),
    listTaskCountsForPeople(db, eventId, personIds),
  ]);
  const participationsByPerson = groupBy(participations, (row) => row.person_id);
  const tracksByPerson = groupBy(tracks, (row) => row.person_id);
  const tasksByPerson = new Map(tasks.map((row) => [row.person_id, row]));
  const rows = people.map((person) =>
    buildRow(
      person,
      participationsByPerson.get(person.id) ?? [],
      tracksByPerson.get(person.id) ?? [],
      tasksByPerson.get(person.id),
    ),
  );
  const trackFacets = new Map<string, SpeakerTrack>();
  for (const track of allTracks) trackFacets.set(track.id, { id: track.id, name: track.name, color: track.color });
  return {
    generated_at: now,
    counts,
    tracks: [...trackFacets.values()],
    ...envelope,
    data: rows,
  };
}

export async function getSpeaker(db: D1Database, eventId: string, personId: string): Promise<SpeakerRow | null> {
  const scoped = rosterQuery(eventId, personId);
  const person = await db.prepare(scoped.sql).bind(...scoped.bindings).first<PersonQueryRow>();
  if (!person) return null;
  const [participations, tracks, tasks] = await Promise.all([
    listParticipations(db, eventId, personId),
    listTracks(db, eventId, personId),
    listTaskCounts(db, eventId, personId),
  ]);
  return buildRow(person, participations, tracks, tasks[0]);
}

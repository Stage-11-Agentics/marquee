import type { D1Database } from "@cloudflare/workers-types";

import type { ListEnvelope } from "../api/list";
import { executeListPage, parsePagination } from "../api/pagination";
import { localParts } from "../lib/event-time";
import { listVersionsFor, listVersionsForOwners, type FileVersionList } from "../lib/files/versions";
import { isTaskDueWithinDays, isTaskOverdue, taskDaysOverdue } from "../lib/task-due";
import { ONBOARDING_PERSON_SOURCE, ROSTER_PARTICIPATION_ROLES, onboardingPersonSource, portalInvitablePersonSource } from "../lib/roster-source";

export const ONBOARDING_FILTERS = ["all", "overdue", "incomplete", "risk"] as const;
export type OnboardingFilter = (typeof ONBOARDING_FILTERS)[number];

export const ONBOARDING_RISK_WINDOW_DAYS = 14;

export type OnboardingTaskState = "done" | "overdue" | "risk" | "upcoming" | "cancelled" | "unassigned";

export interface OnboardingTaskTemplate {
  id: string;
  name: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  position: number;
}

export interface OnboardingTrack {
  id: string;
  name: string;
  color: string;
  is_primary: boolean;
}

export interface OnboardingSession {
  id: string;
  title: string;
  kind: "abstract" | "session";
  wave: { id: string; name: string } | null;
  tracks: OnboardingTrack[];
  agenda: {
    id: string;
    starts_at: number;
    duration_min: number;
    room: string | null;
  } | null;
}

export interface OnboardingTaskCell {
  template_id: string;
  task_id: string | null;
  submission_id: string | null;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number | null;
  completed_at: number | null;
  state: OnboardingTaskState;
  glyph: "✓" | "!" | "×" | "·" | "–" | "—";
  owed: boolean;
}

export interface OnboardingRow {
  id: string;
  person: {
    id: string;
    name: string;
    email: string;
    title: string | null;
    company: string | null;
    bio: string | null;
    headshot_attachment_id: string | null;
  };
  wave: { id: string; name: string } | null;
  tracks: OnboardingTrack[];
  sessions: OnboardingSession[];
  submission_ids: string[];
  tasks: OnboardingTaskCell[];
  cells: Record<string, OnboardingTaskCell>;
  last_contact: number | null;
  /**
   * Whether a speaker-portal invitation can reach this person.
   *
   * The board chases everyone who holds a task, which includes a sponsor's
   * contact working through the sponsor portal. They have no speaker seat, so
   * the speaker-portal invitation is a control that cannot succeed for them —
   * and a control that cannot succeed must not look like one that can.
   */
  portal_invitable: boolean;
  owed_count: number;
  done_count: number;
  overdue_task_count: number;
  risk_task_count: number;
  /** Maximum whole days overdue among owed tasks; done/cancelled work is zero. */
  severity: number;
}

export interface OnboardingSnapshot extends ListEnvelope<OnboardingRow> {
  generated_at: number;
  risk_window_days: number;
  metrics: {
    accepted_speakers: number;
    overdue_tasks: number;
    at_risk: number;
    ready_to_schedule: number;
  };
  counts: {
    all: number;
    overdue: number;
    incomplete: number;
    risk: number;
  };
  facets: {
    task_types: Array<OnboardingTaskTemplate & { count: number }>;
    tracks: Array<{ id: string; name: string; color: string; count: number }>;
  };
  task_templates: OnboardingTaskTemplate[];
}

export interface OnboardingFilters {
  filter?: OnboardingFilter;
  taskType?: string;
  track?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

const DAY_MS = 86_400_000;
const ROSTER_ROLE_LIST = ROSTER_PARTICIPATION_ROLES.map((role) => `'${role}'`).join(", ");
const TASK_OWED_SQL = "task.status = 'open' AND task.cancelled_at IS NULL";
const TASK_FIXED_SQL = "template.due_at IS NOT NULL AND task.due_at = template.due_at";
const TASK_OVERDUE_SQL = `(
  (${TASK_FIXED_SQL} AND date(task.due_at / 1000, 'unixepoch') < runtime.local_day)
  OR ((template.due_at IS NULL OR task.due_at <> template.due_at) AND task.due_at < runtime.now_ms)
)`;
const TASK_RISK_SQL = `(
  (${TASK_FIXED_SQL} AND date(task.due_at / 1000, 'unixepoch') >= runtime.local_day
    AND date(task.due_at / 1000, 'unixepoch') <= runtime.risk_day)
  OR ((template.due_at IS NULL OR task.due_at <> template.due_at)
    AND task.due_at >= runtime.now_ms AND task.due_at <= runtime.now_ms + ${ONBOARDING_RISK_WINDOW_DAYS * DAY_MS})
)`;
const TASK_SEVERITY_SQL = `CASE
  WHEN ${TASK_FIXED_SQL}
    THEN MAX(1, CAST(julianday(runtime.local_day) - julianday(date(task.due_at / 1000, 'unixepoch')) AS INTEGER))
  ELSE MAX(1, CAST(((runtime.now_ms - task.due_at) + ${DAY_MS - 1}) / ${DAY_MS} AS INTEGER))
END`;

/** The board's list read pages person ids in SQL, then hydrates only that page. */
const ONBOARDING_PAGE_CTE = `
WITH runtime AS (
  SELECT ? AS now_ms, ? AS local_day, ? AS risk_day, ? AS event_id
),
task_rollup AS (
  SELECT task.person_id,
         SUM(CASE WHEN ${TASK_OWED_SQL} THEN 1 ELSE 0 END) AS owed_count,
         SUM(CASE WHEN ${TASK_OWED_SQL} AND ${TASK_OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue_task_count,
         SUM(CASE WHEN ${TASK_OWED_SQL} AND ${TASK_RISK_SQL} THEN 1 ELSE 0 END) AS risk_task_count,
         MAX(CASE WHEN ${TASK_OWED_SQL} AND ${TASK_OVERDUE_SQL} THEN ${TASK_SEVERITY_SQL} ELSE 0 END) AS severity
    FROM speaker_tasks task
    JOIN task_templates template
      ON template.id = task.template_id AND template.event_id = task.event_id
    CROSS JOIN runtime
   WHERE task.event_id = runtime.event_id
   GROUP BY task.person_id
),
-- Materialized once, then joined. As a correlated subquery in the SELECT list
-- this ran per person per group and cost the board about a second on the demo
-- conference, which R7 calls a defect rather than a cost to absorb. The event
-- id arrives as a scalar subquery because SQLite has no LATERAL, so the CTE
-- cannot see the runtime row through a join.
invitable_people AS (
  SELECT person_id FROM (${portalInvitablePersonSource("(SELECT event_id FROM runtime)")})
),
roster_people AS (
  SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
         person.headshot_attachment_id,
         MAX(outbox.created_at) AS last_contact,
         runtime.event_id,
         COALESCE(rollup.owed_count, 0) AS owed_count,
         COALESCE(rollup.overdue_task_count, 0) AS overdue_task_count,
         COALESCE(rollup.risk_task_count, 0) AS risk_task_count,
         COALESCE(rollup.severity, 0) AS severity,
         MAX(CASE WHEN invitable.person_id IS NOT NULL THEN 1 ELSE 0 END) AS portal_invitable
    FROM people person
    CROSS JOIN runtime
    LEFT JOIN outbox
      ON outbox.event_id = runtime.event_id AND outbox.person_id = person.id
    LEFT JOIN task_rollup rollup ON rollup.person_id = person.id
    -- portalInvitablePersonSource is a UNION, so this is one row per person at
    -- most and cannot multiply the group.
    LEFT JOIN invitable_people invitable ON invitable.person_id = person.id
   WHERE person.id IN (${onboardingPersonSource("runtime.event_id")})
   GROUP BY person.id, person.name, person.email, person.title, person.company, person.bio,
            person.headshot_attachment_id, runtime.event_id,
            rollup.owed_count, rollup.overdue_task_count, rollup.risk_task_count, rollup.severity
)
`;

function calendarDateAfter(day: string, days: number): string {
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

async function eventTimezone(db: D1Database, eventId: string): Promise<string> {
  const row = await db.prepare("SELECT timezone FROM events WHERE id = ?").bind(eventId).first<{ timezone: string | null }>();
  return row?.timezone ?? "UTC";
}

function onboardingFilterWhere(filters: OnboardingFilters): { sql: string; bindings: (string | number)[] } {
  const where: string[] = [];
  const bindings: (string | number)[] = [];
  const filter = filters.filter ?? "all";
  if (filter === "overdue") where.push("roster.overdue_task_count > 0");
  if (filter === "incomplete") where.push("roster.owed_count > 0");
  if (filter === "risk") where.push("roster.risk_task_count > 0");
  if (filters.taskType && filters.taskType !== "all") {
    where.push(`EXISTS (
      SELECT 1 FROM speaker_tasks task
      WHERE task.event_id = roster.event_id AND task.person_id = roster.id
        AND task.template_id = ? AND ${TASK_OWED_SQL}
    )`);
    bindings.push(filters.taskType);
  }
  if (filters.track && filters.track !== "all") {
    where.push(`EXISTS (
      SELECT 1
        FROM participations track_part
        JOIN submissions track_submission ON track_submission.id = track_part.submission_id
        JOIN submission_tracks track_link ON track_link.submission_id = track_submission.id
       WHERE track_part.person_id = roster.id
         AND track_submission.event_id = roster.event_id
         AND track_submission.status = 'accepted'
         AND track_link.track_id = ?
    )`);
    bindings.push(filters.track);
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    where.push(`(
      roster.name LIKE ? COLLATE NOCASE
      OR roster.company LIKE ? COLLATE NOCASE
      OR roster.email LIKE ? COLLATE NOCASE
      OR roster.id LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1
          FROM participations search_part
          JOIN submissions search_submission ON search_submission.id = search_part.submission_id
         WHERE search_part.person_id = roster.id
           AND search_submission.event_id = roster.event_id
           AND search_submission.status = 'accepted'
           AND search_submission.title LIKE ? COLLATE NOCASE
      )
    )`);
    bindings.push(pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", bindings };
}

function onboardingPageQueries(
  eventId: string,
  filters: OnboardingFilters,
  page: ReturnType<typeof parsePagination>,
  now: number,
  localDay: string,
  riskDay: string,
) {
  const scope = onboardingFilterWhere(filters);
  const runtimeBindings = [now, localDay, riskDay, eventId];
  const where = scope.sql;
  return {
    countSql: `${ONBOARDING_PAGE_CTE}SELECT COUNT(*) AS total FROM roster_people roster ${where}`,
    countBindings: [...runtimeBindings, ...scope.bindings],
    dataSql: `${ONBOARDING_PAGE_CTE}SELECT roster.id, roster.name, roster.email, roster.title, roster.company, roster.bio,
         roster.headshot_attachment_id, roster.last_contact, roster.portal_invitable
    FROM roster_people roster ${where}
    ORDER BY roster.severity DESC, roster.risk_task_count DESC, roster.name COLLATE NOCASE ASC, roster.id ASC
    LIMIT ? OFFSET ?`,
    dataBindings: [...runtimeBindings, ...scope.bindings, page.limit, page.offset],
  };
}

interface SpeakerBaseRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshot_attachment_id: string | null;
  last_contact: number | null;
  portal_invitable: number;
}

interface TaskQueryRow {
  id: string;
  person_id: string;
  submission_id: string | null;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  template_due_at: number | null;
  timezone: string;
  status: "open" | "done";
  completed_at: number | null;
  cancelled_at: number | null;
}

interface SessionQueryRow {
  person_id: string;
  id: string;
  title: string;
  kind: "abstract" | "session";
  wave_id: string | null;
  wave_name: string | null;
  track_id: string | null;
  track_name: string | null;
  track_color: string | null;
  track_is_primary: number | null;
  agenda_id: string | null;
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
}

interface TemplateQueryRow {
  id: string;
  name: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  position: number;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const UTF8_ENCODER = new TextEncoder();

/** SQLite NOCASE folds ASCII letters only, then compares UTF-8 bytes. */
function compareSqlNoCase(left: string, right: string): number {
  const foldAscii = (value: string) => value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
  const leftBytes = UTF8_ENCODER.encode(foldAscii(left));
  const rightBytes = UTF8_ENCODER.encode(foldAscii(right));
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}

function compareSqlBinary(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}

export function isOwedTask(task: { status: "open" | "done"; cancelled_at: number | null }): boolean {
  return task.status === "open" && task.cancelled_at === null;
}

export function deriveTaskState(
  task: { status: "open" | "done"; cancelled_at: number | null; due_at: number; template_due_at?: number | null; timezone?: string | null },
  now: number,
  riskWindowDays = ONBOARDING_RISK_WINDOW_DAYS,
): OnboardingTaskState {
  if (task.status === "done") return "done";
  if (task.cancelled_at !== null) return "cancelled";
  if (isTaskOverdue({ dueAt: task.due_at, templateDueAt: task.template_due_at, timezone: task.timezone }, now)) return "overdue";
  if (isTaskDueWithinDays({ dueAt: task.due_at, templateDueAt: task.template_due_at, timezone: task.timezone }, now, riskWindowDays)) return "risk";
  return "upcoming";
}

export function taskGlyph(state: OnboardingTaskState): OnboardingTaskCell["glyph"] {
  if (state === "done") return "✓";
  if (state === "overdue") return "!";
  if (state === "risk") return "×";
  if (state === "cancelled") return "–";
  if (state === "unassigned") return "—";
  return "·";
}

function stateWeight(state: OnboardingTaskState): number {
  if (state === "overdue") return 5;
  if (state === "risk") return 4;
  if (state === "upcoming") return 2;
  if (state === "done") return 1;
  return 0;
}

function compareTaskRows(left: TaskQueryRow, right: TaskQueryRow, now: number): number {
  const stateDifference = stateWeight(deriveTaskState(left, now)) - stateWeight(deriveTaskState(right, now));
  if (stateDifference !== 0) return stateDifference;
  // When two submissions share a template, retain the more urgent task: an
  // earlier due date wins for overdue, risk, and upcoming work alike.
  if (left.due_at !== right.due_at) return right.due_at - left.due_at;
  return left.id.localeCompare(right.id);
}

function cellFromTask(template: OnboardingTaskTemplate, task: TaskQueryRow | undefined, now: number): OnboardingTaskCell {
  if (!task) {
    return {
      template_id: template.id,
      task_id: null,
      submission_id: null,
      title: template.name,
      kind: template.kind,
      description: template.description,
      due_at: null,
      completed_at: null,
      state: "unassigned",
      glyph: "—",
      owed: false,
    };
  }
  const state = deriveTaskState(task, now);
  return {
    template_id: template.id,
    task_id: task.id,
    submission_id: task.submission_id,
    title: task.title,
    kind: task.kind,
    description: task.description,
    due_at: task.due_at,
    completed_at: task.completed_at,
    state,
    glyph: taskGlyph(state),
    owed: isOwedTask(task),
  };
}

function groupSessions(rows: readonly SessionQueryRow[]): Map<string, OnboardingSession[]> {
  const byPerson = new Map<string, Map<string, OnboardingSession>>();
  for (const row of rows) {
    let sessions = byPerson.get(row.person_id);
    if (!sessions) {
      sessions = new Map();
      byPerson.set(row.person_id, sessions);
    }
    let session = sessions.get(row.id);
    if (!session) {
      session = {
        id: row.id,
        title: row.title,
        kind: row.kind,
        wave: row.wave_id && row.wave_name ? { id: row.wave_id, name: row.wave_name } : null,
        tracks: [],
        agenda: row.agenda_id && row.starts_at !== null && row.duration_min !== null
          ? { id: row.agenda_id, starts_at: row.starts_at, duration_min: row.duration_min, room: row.room }
          : null,
      };
      sessions.set(row.id, session);
    }
    if (row.track_id && row.track_name && row.track_color && !session.tracks.some((track) => track.id === row.track_id)) {
      session.tracks.push({
        id: row.track_id,
        name: row.track_name,
        color: row.track_color,
        is_primary: row.track_is_primary === 1,
      });
    }
  }
  return new Map([...byPerson].map(([personId, sessions]) => [
    personId,
    [...sessions.values()].map((session) => ({
      ...session,
      tracks: [...session.tracks].sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.name.localeCompare(right.name)),
    })).sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id)),
  ]));
}

function buildRows(
  people: readonly SpeakerBaseRow[],
  taskRows: readonly TaskQueryRow[],
  templates: readonly OnboardingTaskTemplate[],
  sessions: Map<string, OnboardingSession[]>,
  now: number,
): OnboardingRow[] {
  const tasksByPerson = new Map<string, TaskQueryRow[]>();
  for (const task of taskRows) {
    const current = tasksByPerson.get(task.person_id) ?? [];
    current.push(task);
    tasksByPerson.set(task.person_id, current);
  }

  const rows: OnboardingRow[] = [];
  for (const person of people) {
    const personTasks = tasksByPerson.get(person.id) ?? [];
    const chosenTasks = new Map<string, TaskQueryRow>();
    for (const task of personTasks) {
      const current = chosenTasks.get(task.template_id);
      if (!current || compareTaskRows(task, current, now) > 0) chosenTasks.set(task.template_id, task);
    }
    const tasks = templates.map((template) => cellFromTask(template, chosenTasks.get(template.id), now));
    const owedCount = personTasks.filter((task) => isOwedTask(task)).length;
    // A speaker who has finished everything used to vanish from the only screen
    // that claimed to list speakers. The board keeps its chase semantics through
    // the `incomplete` filter instead; "All" now genuinely means all.
    const personSessions = sessions.get(person.id) ?? [];
    const tracks = personSessions
      .flatMap((session) => session.tracks)
      .filter((track, index, all) => all.findIndex((candidate) => candidate.id === track.id) === index)
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.name.localeCompare(right.name));
    const stateTasks = tasks.filter((task) => task.state !== "unassigned");
    const overdueTaskCount = personTasks.filter((task) => isOwedTask(task) && isTaskOverdue({
      dueAt: task.due_at,
      templateDueAt: task.template_due_at,
      timezone: task.timezone,
    }, now)).length;
    const maxDaysOverdue = personTasks.reduce((maximum, task) => {
      if (!isOwedTask(task)) return maximum;
      return Math.max(maximum, taskDaysOverdue({
        dueAt: task.due_at,
        templateDueAt: task.template_due_at,
        timezone: task.timezone,
      }, now));
    }, 0);
    const riskTaskCount = personTasks.filter((task) => {
      return isOwedTask(task) && isTaskDueWithinDays({
        dueAt: task.due_at,
        templateDueAt: task.template_due_at,
        timezone: task.timezone,
      }, now, ONBOARDING_RISK_WINDOW_DAYS);
    }).length;
    const cells = Object.fromEntries(tasks.map((task) => [task.template_id, task]));
    rows.push({
      id: person.id,
      person: {
        id: person.id,
        name: person.name,
        email: person.email,
        title: person.title,
        company: person.company,
        bio: person.bio,
        headshot_attachment_id: person.headshot_attachment_id,
      },
      wave: personSessions[0]?.wave ?? null,
      tracks,
      sessions: personSessions,
      submission_ids: unique(personSessions.map((session) => session.id)),
      tasks,
      cells,
      last_contact: person.last_contact,
      portal_invitable: person.portal_invitable === 1,
      owed_count: owedCount,
      done_count: stateTasks.filter((task) => task.state === "done").length,
      overdue_task_count: overdueTaskCount,
      risk_task_count: riskTaskCount,
      severity: maxDaysOverdue,
    });
  }
  return rows.sort(compareOnboardingRows);
}

export function compareOnboardingRows(
  left: Pick<OnboardingRow, "severity" | "risk_task_count" | "person">,
  right: Pick<OnboardingRow, "severity" | "risk_task_count" | "person">,
): number {
  return right.severity - left.severity
    || right.risk_task_count - left.risk_task_count
    || compareSqlNoCase(left.person.name, right.person.name)
    || compareSqlBinary(left.person.id, right.person.id);
}

function queryJsonIds(ids: readonly string[]): string {
  return JSON.stringify(unique(ids));
}

async function listTemplates(db: D1Database, eventId: string): Promise<OnboardingTaskTemplate[]> {
  const result = await db.prepare(
    `SELECT id, name, kind, description, position
     FROM task_templates WHERE event_id = ? ORDER BY position ASC, id ASC`,
  ).bind(eventId).all<TemplateQueryRow>();
  return result.results.map((row) => ({ ...row }));
}

async function listTasks(db: D1Database, eventId: string, personIds: readonly string[]): Promise<TaskQueryRow[]> {
  if (personIds.length === 0) return [];
  const result = await db.prepare(
    `SELECT task.id, task.person_id, task.submission_id, task.template_id, task.title,
            task.kind, task.description, task.due_at, template.due_at AS template_due_at,
            event.timezone, task.status, task.completed_at,
            task.cancelled_at
     FROM speaker_tasks task
     JOIN task_templates template
       ON template.id = task.template_id AND template.event_id = task.event_id
     JOIN events event ON event.id = task.event_id
     WHERE task.event_id = ?
       AND task.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
     ORDER BY task.person_id ASC, task.due_at ASC, task.id ASC`,
  ).bind(eventId, queryJsonIds(personIds)).all<TaskQueryRow>();
  return result.results;
}

async function listSessions(db: D1Database, eventId: string, personIds: readonly string[]): Promise<Map<string, OnboardingSession[]>> {
  if (personIds.length === 0) return new Map();
  const result = await db.prepare(
    `SELECT part.person_id, submission.id, submission.title, submission.kind,
            wave.id AS wave_id, wave.name AS wave_name,
            track.id AS track_id, track.name AS track_name, track.color AS track_color,
            submission_track.is_primary AS track_is_primary,
            agenda.id AS agenda_id, agenda.starts_at, agenda.duration_min, room.name AS room
     FROM participations part
     JOIN submissions submission ON submission.id = part.submission_id
     LEFT JOIN waves wave ON wave.id = submission.wave_id AND wave.event_id = submission.event_id
     LEFT JOIN submission_tracks submission_track ON submission_track.submission_id = submission.id
     LEFT JOIN tracks track ON track.id = submission_track.track_id AND track.event_id = submission.event_id
     LEFT JOIN agenda_items agenda ON agenda.id = (
       SELECT selected_agenda.id FROM agenda_items selected_agenda
       WHERE selected_agenda.event_id = submission.event_id
         AND selected_agenda.submission_id = submission.id
         AND selected_agenda.kind = 'session'
       ORDER BY selected_agenda.starts_at ASC, selected_agenda.id ASC
       LIMIT 1
     )
     LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = submission.event_id
     WHERE submission.event_id = ? AND submission.status = 'accepted'
       AND part.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
     ORDER BY part.person_id ASC, submission.title COLLATE NOCASE, track.position ASC, track.id ASC`,
  ).bind(eventId, queryJsonIds(personIds)).all<SessionQueryRow>();
  return groupSessions(result.results);
}

async function acceptedSpeakerCount(db: D1Database, eventId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT part.person_id) AS count
     FROM participations part
     JOIN submissions submission ON submission.id = part.submission_id
     WHERE submission.event_id = ?
       AND submission.status = 'accepted'
       AND part.role IN (${ROSTER_ROLE_LIST})`,
  ).bind(eventId).first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

async function readyToScheduleCount(db: D1Database, eventId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM submissions submission
     WHERE submission.event_id = ? AND submission.status = 'accepted'
       AND NOT EXISTS (
         SELECT 1 FROM agenda_items agenda
         WHERE agenda.event_id = submission.event_id
           AND agenda.submission_id = submission.id AND agenda.kind = 'session'
       )`,
  ).bind(eventId).first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

interface OnboardingAggregate {
  all_count: number;
  overdue: number;
  incomplete: number;
  risk: number;
  overdue_tasks: number;
  at_risk: number;
}

async function onboardingMetadata(
  db: D1Database,
  eventId: string,
  templates: readonly OnboardingTaskTemplate[],
  now: number,
  timezone: string,
): Promise<{
  counts: OnboardingSnapshot["counts"];
  metrics: Pick<OnboardingSnapshot["metrics"], "accepted_speakers" | "overdue_tasks" | "at_risk" | "ready_to_schedule">;
  taskTypes: Array<OnboardingTaskTemplate & { count: number }>;
  tracks: Array<{ id: string; name: string; color: string; count: number }>;
}> {
  const localDay = localParts(now, timezone).day;
  const riskDay = calendarDateAfter(localDay, ONBOARDING_RISK_WINDOW_DAYS);
  const runtimeBindings = [now, localDay, riskDay, eventId];
  const [aggregate, acceptedSpeakers, readyToSchedule, taskCounts, trackRows] = await Promise.all([
    db.prepare(
      `${ONBOARDING_PAGE_CTE}
       SELECT COUNT(*) AS all_count,
              SUM(CASE WHEN overdue_task_count > 0 THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN owed_count > 0 THEN 1 ELSE 0 END) AS incomplete,
              SUM(CASE WHEN risk_task_count > 0 THEN 1 ELSE 0 END) AS risk,
              SUM(overdue_task_count) AS overdue_tasks,
              SUM(CASE WHEN risk_task_count > 0 THEN 1 ELSE 0 END) AS at_risk
          FROM roster_people`,
    ).bind(...runtimeBindings).first<OnboardingAggregate>(),
    acceptedSpeakerCount(db, eventId),
    readyToScheduleCount(db, eventId),
    db.prepare(
      `SELECT task.template_id, COUNT(DISTINCT task.person_id) AS count
         FROM speaker_tasks task
        WHERE task.event_id = ? AND task.status = 'open' AND task.cancelled_at IS NULL
        GROUP BY task.template_id`,
    ).bind(eventId).all<{ template_id: string; count: number }>(),
    db.prepare(
      `SELECT track.id, track.name, track.color, COUNT(DISTINCT part.person_id) AS count
         FROM participations part
         JOIN submissions submission ON submission.id = part.submission_id
         JOIN submission_tracks submission_track ON submission_track.submission_id = submission.id
         JOIN tracks track ON track.id = submission_track.track_id AND track.event_id = submission.event_id
        WHERE submission.event_id = ? AND submission.status = 'accepted'
          AND part.role IN ('speaker', 'co_speaker')
        GROUP BY track.id, track.name, track.color
        ORDER BY track.name COLLATE NOCASE ASC, track.id ASC`,
    ).bind(eventId).all<{ id: string; name: string; color: string; count: number }>(),
  ]);
  const summary = aggregate ?? { all_count: 0, overdue: 0, incomplete: 0, risk: 0, overdue_tasks: 0, at_risk: 0 };
  const counts = {
    all: Number(summary.all_count ?? 0),
    overdue: Number(summary.overdue ?? 0),
    incomplete: Number(summary.incomplete ?? 0),
    risk: Number(summary.risk ?? 0),
  };
  const taskCountById = new Map(taskCounts.results.map((row) => [row.template_id, Number(row.count)]));
  return {
    counts,
    metrics: {
      accepted_speakers: acceptedSpeakers,
      overdue_tasks: Number(summary.overdue_tasks ?? 0),
      at_risk: Number(summary.at_risk ?? 0),
      ready_to_schedule: readyToSchedule,
    },
    taskTypes: templates.map((template) => ({ ...template, count: taskCountById.get(template.id) ?? 0 })),
    tracks: trackRows.results.map((row) => ({ ...row, count: Number(row.count) })),
  };
}

export async function listOnboarding(
  db: D1Database,
  eventId: string,
  filters: OnboardingFilters = {},
  now = Date.now(),
): Promise<OnboardingSnapshot> {
  const [templates, timezone] = await Promise.all([listTemplates(db, eventId), eventTimezone(db, eventId)]);
  const page = parsePagination({ page: filters.page, per_page: filters.perPage });
  const localDay = localParts(now, timezone).day;
  const riskDay = calendarDateAfter(localDay, ONBOARDING_RISK_WINDOW_DAYS);
  const queries = onboardingPageQueries(eventId, filters, page, now, localDay, riskDay);
  const [envelope, metadata] = await Promise.all([
    executeListPage<SpeakerBaseRow>({
      count: db.prepare(queries.countSql).bind(...queries.countBindings),
      data: db.prepare(queries.dataSql).bind(...queries.dataBindings),
      page,
    }),
    onboardingMetadata(db, eventId, templates, now, timezone),
  ]);
  const people = envelope.data;
  const personIds = people.map((person) => person.id);
  const [taskRows, sessions] = await Promise.all([
    listTasks(db, eventId, personIds),
    listSessions(db, eventId, personIds),
  ]);
  const rows = buildRows(people, taskRows, templates, sessions, now);
  return {
    generated_at: now,
    risk_window_days: ONBOARDING_RISK_WINDOW_DAYS,
    metrics: metadata.metrics,
    counts: metadata.counts,
    facets: { task_types: metadata.taskTypes, tracks: metadata.tracks },
    task_templates: templates,
    ...envelope,
    data: rows,
  };
}

export interface OnboardingSpeakerDetail {
  person: OnboardingRow["person"];
  sessions: OnboardingSession[];
  tasks: OnboardingTaskCell[];
  last_contact: number | null;
  /** See `OnboardingRow.portal_invitable`. */
  portal_invitable: boolean;
  messages: Array<{
    id: string;
    template_key: string;
    entity_id: string | null;
    to_email: string;
    subject: string;
    text: string;
    status: string;
    send_policy: string;
    suppressed_reason: string | null;
    created_at: number;
    sent_at: number | null;
  }>;
  files: {
    profile: FileVersionList;
    tasks: Array<{ task_id: string; title: string; list: FileVersionList }>;
  };
}

export async function getOnboardingSpeaker(
  db: D1Database,
  eventId: string,
  personId: string,
  now = Date.now(),
  mediaPublicOrigin = "",
  mediaSigningSecret: string,
): Promise<OnboardingSpeakerDetail | null> {
  const person = await db.prepare(
    `SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
            person.headshot_attachment_id,
            MAX(outbox.created_at) AS last_contact,
            MAX(CASE WHEN person.id IN (${portalInvitablePersonSource()}) THEN 1 ELSE 0 END) AS portal_invitable
     FROM people person
     LEFT JOIN outbox ON outbox.event_id = ? AND outbox.person_id = person.id
     WHERE person.id = ? AND person.id IN (${ONBOARDING_PERSON_SOURCE})
     GROUP BY person.id, person.name, person.email, person.title, person.company, person.bio,
              person.headshot_attachment_id`,
  ).bind(eventId, eventId, eventId, personId, eventId, eventId, eventId).first<SpeakerBaseRow>();
  if (!person) return null;
  const [templates, taskRows, sessions, profileFiles] = await Promise.all([
    listTemplates(db, eventId),
    listTasks(db, eventId, [personId]),
    listSessions(db, eventId, [personId]),
    listVersionsFor(db, "person_headshot", personId, mediaPublicOrigin, mediaSigningSecret, now),
  ]);
  const taskFileLists = await listVersionsForOwners(
    db,
    "task_upload",
    taskRows.filter((task) => task.kind === "file").map((task) => task.id),
    mediaPublicOrigin,
    mediaSigningSecret,
    now,
  );
  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const assignedTemplateIds = new Set(taskRows.map((task) => task.template_id));
  const tasks = [
    ...[...taskRows]
      .sort((left, right) => compareTaskRows(right, left, now))
      .map((task) => cellFromTask(templatesById.get(task.template_id)!, task, now)),
    ...templates
      .filter((template) => !assignedTemplateIds.has(template.id))
      .map((template) => cellFromTask(template, undefined, now)),
  ];
  const messages = await db.prepare(
    `SELECT id, template_key, entity_id, to_email, subject, text, status, send_policy,
            suppressed_reason, created_at, sent_at
     FROM outbox WHERE event_id = ? AND person_id = ? ORDER BY created_at DESC, id DESC`,
  ).bind(eventId, personId).all<OnboardingSpeakerDetail["messages"][number]>();
  return {
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      company: person.company,
      bio: person.bio,
      headshot_attachment_id: person.headshot_attachment_id,
    },
    sessions: sessions.get(personId) ?? [],
    tasks,
    last_contact: person.last_contact === null ? null : Number(person.last_contact),
    portal_invitable: person.portal_invitable === 1,
    messages: messages.results,
    files: {
      profile: profileFiles,
      tasks: taskRows
        .filter((task) => task.kind === "file")
        .map((task) => ({ task_id: task.id, title: task.title, list: taskFileLists.get(task.id)! })),
    },
  };
}

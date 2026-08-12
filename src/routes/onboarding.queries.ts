import type { D1Database } from "@cloudflare/workers-types";

import { ONBOARDING_PERSON_SOURCE } from "./speakers.queries";

export const ONBOARDING_FILTERS = ["all", "overdue", "incomplete", "risk"] as const;
export type OnboardingFilter = (typeof ONBOARDING_FILTERS)[number];

export const ONBOARDING_RISK_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

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
  };
  wave: { id: string; name: string } | null;
  tracks: OnboardingTrack[];
  sessions: OnboardingSession[];
  submission_ids: string[];
  tasks: OnboardingTaskCell[];
  cells: Record<string, OnboardingTaskCell>;
  last_contact: number | null;
  owed_count: number;
  done_count: number;
  overdue_task_count: number;
  risk_task_count: number;
  /** Maximum whole days overdue among owed tasks; done/cancelled work is zero. */
  severity: number;
}

export interface OnboardingSnapshot {
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
  rows: OnboardingRow[];
}

export interface OnboardingFilters {
  filter?: OnboardingFilter;
  taskType?: string;
  track?: string;
  search?: string;
}

interface SpeakerBaseRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  last_contact: number | null;
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

export function isOwedTask(task: { status: "open" | "done"; cancelled_at: number | null }): boolean {
  return task.status === "open" && task.cancelled_at === null;
}

export function deriveTaskState(
  task: { status: "open" | "done"; cancelled_at: number | null; due_at: number },
  now: number,
  riskWindowDays = ONBOARDING_RISK_WINDOW_DAYS,
): OnboardingTaskState {
  if (task.status === "done") return "done";
  if (task.cancelled_at !== null) return "cancelled";
  if (task.due_at < now) return "overdue";
  if (task.due_at <= now + riskWindowDays * DAY_MS) return "risk";
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
    const overdueTaskCount = personTasks.filter((task) => isOwedTask(task) && task.due_at < now).length;
    const maxDaysOverdue = personTasks.reduce((maximum, task) => {
      if (!isOwedTask(task) || task.due_at >= now) return maximum;
      return Math.max(maximum, Math.ceil((now - task.due_at) / DAY_MS));
    }, 0);
    const riskTaskCount = personTasks.filter((task) => {
      return isOwedTask(task) && task.due_at >= now && task.due_at <= now + ONBOARDING_RISK_WINDOW_DAYS * DAY_MS;
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
      },
      wave: personSessions[0]?.wave ?? null,
      tracks,
      sessions: personSessions,
      submission_ids: unique(personSessions.map((session) => session.id)),
      tasks,
      cells,
      last_contact: person.last_contact,
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
    || left.person.name.localeCompare(right.person.name)
    || left.person.id.localeCompare(right.person.id);
}

export function rowMatchesOnboardingFilters(row: OnboardingRow, filters: OnboardingFilters): boolean {
  const filter = filters.filter ?? "all";
  if (filter === "overdue" && row.overdue_task_count === 0) return false;
  if (filter === "risk" && row.risk_task_count === 0) return false;
  if (filter === "incomplete" && row.owed_count === 0) return false;
  if (filters.taskType && filters.taskType !== "all" && !row.tasks.some((task) => task.template_id === filters.taskType && task.owed)) return false;
  if (filters.track && filters.track !== "all" && !row.tracks.some((track) => track.id === filters.track)) return false;
  const search = filters.search?.trim().toLocaleLowerCase();
  if (search) {
    const haystack = [
      row.person.name,
      row.person.company ?? "",
      row.person.email,
      row.person.id,
      ...row.sessions.map((session) => session.title),
    ].join(" ").toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

function countByFilter(rows: readonly OnboardingRow[], filter: OnboardingFilter): number {
  return rows.filter((row) => rowMatchesOnboardingFilters(row, { filter })).length;
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

async function listPeople(db: D1Database, eventId: string): Promise<SpeakerBaseRow[]> {
  const result = await db.prepare(
    `SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
            MAX(outbox.created_at) AS last_contact
     FROM people person
     LEFT JOIN outbox ON outbox.event_id = ? AND outbox.person_id = person.id
     WHERE person.id IN (${ONBOARDING_PERSON_SOURCE})
     GROUP BY person.id, person.name, person.email, person.title, person.company, person.bio
     ORDER BY person.name COLLATE NOCASE, person.id ASC`,
  ).bind(eventId, eventId, eventId, eventId).all<SpeakerBaseRow>();
  return result.results.map((row) => ({ ...row, last_contact: row.last_contact === null ? null : Number(row.last_contact) }));
}

async function listTasks(db: D1Database, eventId: string, personIds: readonly string[]): Promise<TaskQueryRow[]> {
  if (personIds.length === 0) return [];
  const result = await db.prepare(
    `SELECT task.id, task.person_id, task.submission_id, task.template_id, task.title,
            task.kind, task.description, task.due_at, task.status, task.completed_at,
            task.cancelled_at
     FROM speaker_tasks task
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
    `SELECT COUNT(DISTINCT person_id) AS count
     FROM speaker_tasks
     WHERE event_id = ? AND status = 'open' AND cancelled_at IS NULL`,
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

function taskTypeFacets(rows: readonly OnboardingRow[], templates: readonly OnboardingTaskTemplate[]): Array<OnboardingTaskTemplate & { count: number }> {
  return templates.map((template) => ({
    ...template,
    count: rows.reduce((count, row) => count + (row.cells[template.id]?.owed ? 1 : 0), 0),
  }));
}

function trackFacets(rows: readonly OnboardingRow[]): Array<{ id: string; name: string; color: string; count: number }> {
  const counts = new Map<string, { id: string; name: string; color: string; count: number }>();
  for (const row of rows) {
    for (const track of row.tracks) {
      const existing = counts.get(track.id);
      if (existing) existing.count += 1;
      else counts.set(track.id, { id: track.id, name: track.name, color: track.color, count: 1 });
    }
  }
  return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export async function listOnboarding(
  db: D1Database,
  eventId: string,
  filters: OnboardingFilters = {},
  now = Date.now(),
): Promise<OnboardingSnapshot> {
  const [templates, people, acceptedSpeakers, readyToSchedule] = await Promise.all([
    listTemplates(db, eventId),
    listPeople(db, eventId),
    acceptedSpeakerCount(db, eventId),
    readyToScheduleCount(db, eventId),
  ]);
  const personIds = people.map((person) => person.id);
  const [taskRows, sessions] = await Promise.all([
    listTasks(db, eventId, personIds),
    listSessions(db, eventId, personIds),
  ]);
  const rows = buildRows(people, taskRows, templates, sessions, now);
  const overdueTasks = taskRows.filter((task) => isOwedTask(task) && task.due_at < now).length;
  const filteredRows = rows.filter((row) => rowMatchesOnboardingFilters(row, filters)).sort(compareOnboardingRows);
  return {
    generated_at: now,
    risk_window_days: ONBOARDING_RISK_WINDOW_DAYS,
    metrics: {
      accepted_speakers: acceptedSpeakers,
      overdue_tasks: overdueTasks,
      at_risk: rows.filter((row) => row.risk_task_count > 0).length,
      ready_to_schedule: readyToSchedule,
    },
    counts: {
      all: countByFilter(rows, "all"),
      overdue: countByFilter(rows, "overdue"),
      incomplete: countByFilter(rows, "incomplete"),
      risk: countByFilter(rows, "risk"),
    },
    facets: { task_types: taskTypeFacets(rows, templates), tracks: trackFacets(rows) },
    task_templates: templates,
    rows: filteredRows,
  };
}

export interface OnboardingSpeakerDetail {
  person: OnboardingRow["person"];
  sessions: OnboardingSession[];
  tasks: OnboardingTaskCell[];
  last_contact: number | null;
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
}

export async function getOnboardingSpeaker(
  db: D1Database,
  eventId: string,
  personId: string,
  now = Date.now(),
): Promise<OnboardingSpeakerDetail | null> {
  const person = await db.prepare(
    `SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
            MAX(outbox.created_at) AS last_contact
     FROM people person
     LEFT JOIN outbox ON outbox.event_id = ? AND outbox.person_id = person.id
     WHERE person.id = ? AND person.id IN (${ONBOARDING_PERSON_SOURCE})
     GROUP BY person.id, person.name, person.email, person.title, person.company, person.bio`,
  ).bind(eventId, personId, eventId, eventId, eventId).first<SpeakerBaseRow>();
  if (!person) return null;
  const [templates, taskRows, sessions] = await Promise.all([
    listTemplates(db, eventId),
    listTasks(db, eventId, [personId]),
    listSessions(db, eventId, [personId]),
  ]);
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
    },
    sessions: sessions.get(personId) ?? [],
    tasks,
    last_contact: person.last_contact === null ? null : Number(person.last_contact),
    messages: messages.results,
  };
}

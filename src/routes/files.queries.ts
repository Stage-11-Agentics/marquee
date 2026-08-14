/**
 * The files library projection.
 *
 * The row set is the *expected* deliverable, not the attachment: one row per
 * file-request task, filled or empty. A library built from attachments alone
 * can only show what already arrived, which is exactly the half an AV lead
 * does not need — they need to know whose deck is still missing, three days
 * out, with a name to chase. Listing both makes the library and the chase
 * board two views of one truth instead of two systems that disagree.
 *
 * Version history comes from `lib/files/versions`, which derives "current"
 * from the owner pointer. This module never reads `attachments` itself.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { listVersionsForOwners, type FileVersion } from "../lib/files/versions";
import { MEDIA_LINK_POLICY } from "../lib/r2/media-links";
import { isTaskOverdue } from "../lib/task-due";

export const FILE_STATES = ["all", "uploaded", "missing", "overdue"] as const;
export type FileStateFilter = (typeof FILE_STATES)[number];

/** What the row's deliverable slot is doing right now. */
export type FileRowState = "uploaded" | "missing" | "overdue" | "cancelled";

export interface FilesSession {
  id: string;
  title: string;
}

export interface FilesRow {
  /** The deliverable slot — the speaker task id. Comments and exports anchor here, not on an attachment. */
  id: string;
  state: FileRowState;
  task: {
    id: string;
    title: string;
    template_id: string;
    template_name: string;
    due_at: number;
    status: "open" | "done";
    cancelled_at: number | null;
  };
  person: { id: string; name: string; email: string };
  session: FilesSession | null;
  /** Accepted sessions to choose from when no unambiguous fallback exists. */
  session_candidates: FilesSession[];
  latest: FileVersion | null;
  version_count: number;
  versions: FileVersion[];
  /** Passed through from the version derivation so no surface has to guess how "current" was decided. */
  latest_source: "pointer" | "recency";
}

export interface FilesSnapshot {
  rows: FilesRow[];
  counts: Record<FileStateFilter, number>;
  facets: { task_types: { id: string; name: string; count: number }[] };
  metrics: { expected: number; received: number; missing: number; overdue: number };
  /** Named so a caller can see the expiry and revocation boundary of these URLs. */
  link_policy: typeof MEDIA_LINK_POLICY;
}

export interface FilesQuery {
  state?: FileStateFilter;
  taskType?: string;
  search?: string;
}

interface TaskRow {
  id: string;
  title: string;
  template_id: string;
  template_name: string;
  due_at: number;
  template_due_at: number | null;
  timezone: string;
  status: "open" | "done";
  cancelled_at: number | null;
  person_id: string;
  person_name: string;
  person_email: string;
  submission_id: string | null;
  submission_title: string | null;
}

interface AcceptedSessionRow {
  person_id: string;
  submission_id: string;
  title: string;
}

function stateFor(row: TaskRow, versionCount: number, now: number): FileRowState {
  if (row.cancelled_at !== null) return "cancelled";
  if (versionCount > 0) return "uploaded";
  return isTaskOverdue({ dueAt: row.due_at, templateDueAt: row.template_due_at, timezone: row.timezone }, now) ? "overdue" : "missing";
}

function matchesSearch(row: FilesRow, needle: string): boolean {
  const haystack = [
    row.person.name,
    row.person.email,
    row.session?.title ?? "",
    row.task.title,
    row.task.template_name,
    ...row.session_candidates.map((session) => session.title),
    ...row.versions.map((version) => version.filename),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Existing deliverable tasks can predate the per-person session assignment
 * write path. Read the accepted sessions here so that a legacy NULL link does
 * not erase a relationship the organizer already holds elsewhere. Rejected
 * and withdrawn talks are deliberately excluded: they are not valid places
 * for a current deliverable to land.
 */
async function acceptedSessionsFor(
  db: D1Database,
  eventId: string,
  personIds: readonly string[],
): Promise<Map<string, FilesSession[]>> {
  if (personIds.length === 0) return new Map();
  const rows = await db.prepare(
    `SELECT DISTINCT part.person_id, submission.id AS submission_id, submission.title
       FROM participations part
       JOIN submissions submission ON submission.id = part.submission_id
      WHERE submission.event_id = ?
        AND submission.status = 'accepted'
        AND part.role IN ('speaker', 'co_speaker', 'submitter')
        AND part.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      ORDER BY part.person_id ASC, submission.title COLLATE NOCASE ASC, submission.id ASC`,
  ).bind(eventId, JSON.stringify([...new Set(personIds)])).all<AcceptedSessionRow>();

  const sessions = new Map<string, FilesSession[]>();
  for (const row of rows.results) {
    const list = sessions.get(row.person_id) ?? [];
    list.push({ id: row.submission_id, title: row.title });
    sessions.set(row.person_id, list);
  }
  return sessions;
}

/**
 * Rows sort as a library first and a chase second: what exists is on top,
 * newest upload leading, then what is still owed by due date, then work the
 * conference cancelled. Cancelled rows stay visible — a file uploaded before a
 * talk was withdrawn is still a file, and dropping it would read as data loss.
 */
function compareRows(left: FilesRow, right: FilesRow): number {
  const rank = (row: FilesRow): number => (row.state === "cancelled" ? 2 : row.state === "uploaded" ? 0 : 1);
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  if (rank(left) === 0) {
    const byUpload = (right.latest?.uploaded_at ?? 0) - (left.latest?.uploaded_at ?? 0);
    if (byUpload !== 0) return byUpload;
  } else {
    const byDue = left.task.due_at - right.task.due_at;
    if (byDue !== 0) return byDue;
  }
  return left.person.name.localeCompare(right.person.name) || left.task.title.localeCompare(right.task.title);
}

export async function listFiles(
  db: D1Database,
  eventId: string,
  mediaPublicOrigin: string,
  mediaSigningSecret: string,
  query: FilesQuery = {},
  now: number = Date.now(),
): Promise<FilesSnapshot> {
  const tasks = await db
    .prepare(
      `SELECT task.id, task.title, task.template_id, template.name AS template_name,
              task.due_at, template.due_at AS template_due_at, event.timezone,
              task.status, task.cancelled_at,
              person.id AS person_id, person.name AS person_name, person.email AS person_email,
              submission.id AS submission_id, submission.title AS submission_title
       FROM speaker_tasks task
       JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
       JOIN events event ON event.id = task.event_id
       JOIN people person ON person.id = task.person_id
       LEFT JOIN submissions submission ON submission.id = task.submission_id AND submission.event_id = task.event_id
       WHERE task.event_id = ? AND task.kind = 'file'`,
    )
    .bind(eventId)
    .all<TaskRow>();

  const personIds = [...new Set(tasks.results.map((task) => task.person_id))];
  const [versionsByTask, acceptedSessionsByPerson] = await Promise.all([
    listVersionsForOwners(
      db,
      "task_upload",
      tasks.results.map((task) => task.id),
      mediaPublicOrigin,
      mediaSigningSecret,
      now,
    ),
    acceptedSessionsFor(db, eventId, personIds),
  ]);

  const all: FilesRow[] = tasks.results.map((task) => {
    const list = versionsByTask.get(task.id);
    const versions = list?.versions ?? [];
    const explicitSession = task.submission_id === null
      ? null
      : { id: task.submission_id, title: task.submission_title ?? "Untitled session" };
    const acceptedSessions = acceptedSessionsByPerson.get(task.person_id) ?? [];
    const session = explicitSession ?? (acceptedSessions.length === 1 ? acceptedSessions[0] : null);
    return {
      id: task.id,
      state: stateFor(task, versions.length, now),
      task: {
        id: task.id,
        title: task.title,
        template_id: task.template_id,
        template_name: task.template_name,
        due_at: task.due_at,
        status: task.status,
        cancelled_at: task.cancelled_at,
      },
      person: { id: task.person_id, name: task.person_name, email: task.person_email },
      session,
      session_candidates: session === null ? acceptedSessions : [],
      latest: list?.latest ?? null,
      version_count: list?.version_count ?? 0,
      versions,
      latest_source: list?.latest_source ?? "pointer",
    };
  });

  // Facets describe the whole library; the state chips and the search box then
  // narrow it. Counts are taken after the non-state filters so a chip's number
  // always matches the set clicking it produces.
  const taskTypes = new Map<string, { id: string; name: string; count: number }>();
  for (const row of all) {
    const facet = taskTypes.get(row.task.template_id) ?? { id: row.task.template_id, name: row.task.template_name, count: 0 };
    facet.count += 1;
    taskTypes.set(row.task.template_id, facet);
  }

  const needle = query.search?.trim().toLowerCase() ?? "";
  const scoped = all.filter((row) => {
    if (query.taskType && row.task.template_id !== query.taskType) return false;
    if (needle && !matchesSearch(row, needle)) return false;
    return true;
  });

  const counts: Record<FileStateFilter, number> = {
    all: scoped.length,
    uploaded: scoped.filter((row) => row.state === "uploaded").length,
    missing: scoped.filter((row) => row.state === "missing" || row.state === "overdue").length,
    overdue: scoped.filter((row) => row.state === "overdue").length,
  };

  const state = query.state ?? "all";
  const rows = scoped
    .filter((row) => {
      if (state === "uploaded") return row.state === "uploaded";
      if (state === "missing") return row.state === "missing" || row.state === "overdue";
      if (state === "overdue") return row.state === "overdue";
      return true;
    })
    .sort(compareRows);

  const live = all.filter((row) => row.state !== "cancelled");
  return {
    rows,
    counts,
    facets: { task_types: [...taskTypes.values()].sort((left, right) => left.name.localeCompare(right.name)) },
    metrics: {
      expected: live.length,
      received: live.filter((row) => row.state === "uploaded").length,
      missing: live.filter((row) => row.state !== "uploaded").length,
      overdue: live.filter((row) => row.state === "overdue").length,
    },
    link_policy: MEDIA_LINK_POLICY,
  };
}

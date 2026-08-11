import type { D1Database } from "@cloudflare/workers-types";

import type { ListEnvelope } from "../../api/list";
import { parsePagination, totalPages } from "../../api/pagination";
import type { Id } from "../../db/schema";
import {
  selectSubmissionIds,
  type SubmissionFilter,
  hasSpeakerTaskCancellationColumn,
} from "../../routes/submissions.queries";

/**
 * The raw, per-person audience row. This is deliberately not a rendered mail
 * object: the eventual MRQ-24 send adapter owns template/render integration.
 */
export interface CommsRecipientRow {
  person_id: Id;
  submission_id: Id;
  email: string;
  name: string;
  role: string;
  submission_title: string;
  format: string | null;
  room: string | null;
  starts_at: number | null;
  task_title: string | null;
  task_due_at: number | null;
}

export const AUDIENCE_SORTS = {
  name: "p.name COLLATE NOCASE ASC, p.id ASC, s.id ASC",
  title: "s.title COLLATE NOCASE ASC, s.id ASC, p.name COLLATE NOCASE ASC, p.id ASC",
} as const;

export type AudienceSort = keyof typeof AUDIENCE_SORTS;

export interface CommsAudienceFilters extends SubmissionFilter {
  eventId: Id;
  page?: number;
  per_page?: number;
  sort?: AudienceSort;
  task_state?: "open" | "done";
}

interface AudienceQueryOptions {
  page?: number;
  per_page?: number;
  sort?: AudienceSort;
  task_state?: "open" | "done";
}

function normalizeIds(ids: readonly Id[]): Id[] {
  return [...new Set(ids)];
}

function audienceCte(): string {
  return `
    WITH selected_submissions AS (
      SELECT CAST(value AS TEXT) AS submission_id FROM json_each(?)
    ), recipient_pairs AS (
      SELECT DISTINCT part.person_id, s.id AS submission_id
      FROM submissions s
      JOIN selected_submissions selected ON selected.submission_id = s.id
      JOIN participations part ON part.submission_id = s.id
      WHERE s.event_id = ?
    )`;
}

function audienceFrom(includeCancelledAt: boolean, taskState?: "open" | "done"): string {
  const cancelledPredicate = includeCancelledAt && taskState !== "done" ? "AND candidate.cancelled_at IS NULL" : "";
  const statusPredicate = taskState === undefined ? "AND candidate.status = 'open'" : `AND candidate.status = '${taskState}'`;
  const taskStateFilter = taskState === undefined
    ? ""
    : `
    WHERE EXISTS (
      SELECT 1
      FROM speaker_tasks filtered_task
      WHERE filtered_task.event_id = s.event_id
        AND filtered_task.submission_id = s.id
        AND filtered_task.person_id = p.id
        AND filtered_task.status = '${taskState}'
        ${includeCancelledAt && taskState === "open" ? "AND filtered_task.cancelled_at IS NULL" : ""}
    )`;
  return `
    FROM recipient_pairs pair
    JOIN submissions s ON s.id = pair.submission_id AND s.event_id = ?
    JOIN people p ON p.id = pair.person_id
    LEFT JOIN formats fmt ON fmt.id = s.format_id
    LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
    LEFT JOIN rooms room ON room.id = ai.room_id
    LEFT JOIN speaker_tasks task ON task.id = (
      SELECT candidate.id
      FROM speaker_tasks candidate
      WHERE candidate.submission_id = s.id
        AND candidate.person_id = p.id
        ${statusPredicate}
        ${cancelledPredicate}
      ORDER BY candidate.due_at IS NULL ASC, candidate.due_at ASC, candidate.id ASC
      LIMIT 1
    )${taskStateFilter}`;
}

function audienceSelect(): string {
  return `
    SELECT
      p.id AS person_id,
      s.id AS submission_id,
      p.email,
      p.name,
      COALESCE((
        SELECT role_part.role
        FROM participations role_part
        WHERE role_part.person_id = p.id AND role_part.submission_id = s.id
        ORDER BY CASE role_part.role
          WHEN 'speaker' THEN 0
          WHEN 'co_speaker' THEN 1
          WHEN 'submitter' THEN 2
          WHEN 'moderator' THEN 3
          WHEN 'chairperson' THEN 4
          ELSE 5
        END, role_part.position ASC, role_part.id ASC
        LIMIT 1
      ), 'speaker') AS role,
      s.title AS submission_title,
      fmt.name AS format,
      room.name AS room,
      ai.starts_at,
      task.title AS task_title,
      task.due_at AS task_due_at`;
}

/** Resolve the MRQ-8 filter arm without applying a page or client-side subset. */
export async function selectCommsAudienceSubmissionIds(
  db: D1Database,
  filters: SubmissionFilter & { eventId: Id },
): Promise<Id[]> {
  return selectSubmissionIds(db, filters);
}

/**
 * Resolve explicit submission IDs into one stable row per person/submission.
 * The JSON set is the same bounded-ID transport used by MRQ-8's bulk writer;
 * no interpolated placeholder list or per-row SQL is created.
 */
export async function listCommsRecipientsForSubmissionIds(
  db: D1Database,
  eventId: Id,
  ids: readonly Id[],
  options: AudienceQueryOptions = {},
): Promise<ListEnvelope<CommsRecipientRow>> {
  const normalizedIds = normalizeIds(ids);
  const page = parsePagination(options);
  if (normalizedIds.length === 0) {
    return { data: [], page: page.page, per_page: page.perPage, total: 0, total_pages: 0 };
  }

  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(db);
  const cte = audienceCte();
  const from = audienceFrom(includeCancelledAt, options.task_state);
  const sort = AUDIENCE_SORTS[options.sort ?? "name"];
  const idsJson = JSON.stringify(normalizedIds);
  const count = await db
    .prepare(`${cte}
      SELECT COUNT(*) AS total
      FROM (
        SELECT pair.person_id, pair.submission_id
        ${from}
        GROUP BY pair.person_id, pair.submission_id
      ) audience`)
    .bind(idsJson, eventId, eventId)
    .first<{ total: number }>();
  const total = Number(count?.total ?? 0);
  const rows = await db
    .prepare(`${cte}
      ${audienceSelect()}
      ${from}
      ORDER BY ${sort}
      LIMIT ? OFFSET ?`)
    .bind(idsJson, eventId, eventId, page.limit, page.offset)
    .all<CommsRecipientRow>();
  return {
    data: rows.results,
    page: page.page,
    per_page: page.perPage,
    total,
    total_pages: totalPages(total, page.perPage),
  };
}

/** Resolve the canonical MRQ-8 filter arm and return its audience page. */
export async function listCommsAudience(
  db: D1Database,
  filters: CommsAudienceFilters,
): Promise<ListEnvelope<CommsRecipientRow>> {
  const { task_state: taskState, ...submissionFilters } = filters;
  const ids = await selectCommsAudienceSubmissionIds(db, submissionFilters);
  return listCommsRecipientsForSubmissionIds(db, filters.eventId, ids, {
    page: filters.page,
    per_page: filters.per_page,
    sort: filters.sort,
    task_state: taskState,
  });
}

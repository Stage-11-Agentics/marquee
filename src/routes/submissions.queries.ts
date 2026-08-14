import { z } from "@hono/zod-openapi";
import type { D1Database } from "@cloudflare/workers-types";

import type { ListEnvelope } from "../api/list";
import type {
  SubmissionAgentReview,
  SubmissionListItem,
  SubmissionNotificationState,
  SubmissionSpeakerListItem,
  SubmissionTrackListItem,
} from "../api/submissions";
import { isFieldApplicable, type FormFieldConditionInput } from "../lib/form-conditions";
import { localParts } from "../lib/event-time";
import { participantListSql } from "../lib/participants";
import { reviewAggregateColumns } from "../lib/review-aggregate";
import { showsBuildingComparisonCount } from "../lib/venue-disclosure";
import {
  executeListPage,
  orderClause,
  parsePagination,
  resolveSort,
  type SortRegistry,
} from "../api/pagination";

export const SUBMISSION_SORTS = {
  newest: { column: "s.submitted_at", direction: "desc" },
  updated: { column: "s.updated_at", direction: "desc" },
  title: { column: "s.title COLLATE NOCASE", direction: "asc" },
  score: { column: "score", direction: "desc", nullsLast: true },
  score_asc: { column: "score", direction: "asc", nullsLast: true },
} as const satisfies SortRegistry;

export const SUBMISSION_STATUS_FILTERS = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  // Persisted in saved-view configs and URLs; means the stored acceptance fact.
  "accepted_any",
  "waitlisted",
  "rejected",
  "withdrawn",
  "waved",
  "unreviewed",
  "onboarding",
  "scheduled",
  "published",
  "not_notified",
] as const;

/** The filter-only arm shared by list reads and server-side bulk selection. */
export const submissionFilterSchema = z.object({
  kind: z.enum(["abstract", "session"]).optional(),
  status: z.enum(SUBMISSION_STATUS_FILTERS).optional(),
  track: z.string().min(1).max(100).optional(),
  format: z.string().min(1).max(100).optional(),
  wave: z.string().min(1).max(100).optional(),
  task: z.enum(["overdue"]).optional(),
  placement: z.enum(["unplaced"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export type SubmissionFilter = z.infer<typeof submissionFilterSchema>;

export type SubmissionStatusFilter = (typeof SUBMISSION_STATUS_FILTERS)[number];
export type SubmissionTaskFilter = "overdue";
export type SubmissionPlacementFilter = "unplaced";
export type SubmissionStatusSemantics = "derived" | "stored";

export function submissionTaskPredicate(
  task: "open" | SubmissionTaskFilter,
  submission = "s",
  includeCancelledAt = false,
  includeTemplateProvenance = false,
): string {
  const utcDayEnd = "(strftime('%s', date(filtered_task.due_at / 1000, 'unixepoch', '+1 day')) * 1000 - 1)";
  const overduePredicate = includeTemplateProvenance
    ? `
        (
          filtered_template.due_at IS NOT NULL
          AND filtered_template.due_at = filtered_task.due_at
          AND date(filtered_task.due_at / 1000, 'unixepoch') < ?
        )
        OR (
          (filtered_template.due_at IS NULL OR filtered_template.due_at <> filtered_task.due_at)
          AND filtered_task.due_at < ?
        )`
    : `
        (filtered_task.due_at = ${utcDayEnd} AND date(filtered_task.due_at / 1000, 'unixepoch') < ?)
        OR (filtered_task.due_at <> ${utcDayEnd} AND filtered_task.due_at < ?)`;
  return `EXISTS (
    SELECT 1 FROM speaker_tasks filtered_task
    ${includeTemplateProvenance ? `LEFT JOIN task_templates filtered_template
      ON filtered_template.id = filtered_task.template_id
      AND filtered_template.event_id = filtered_task.event_id` : ""}
    WHERE filtered_task.event_id = ${submission}.event_id
      AND filtered_task.submission_id = ${submission}.id
      AND filtered_task.status = 'open'
      ${includeCancelledAt ? "AND filtered_task.cancelled_at IS NULL" : ""}
      ${task === "overdue" ? `AND (${overduePredicate})` : ""}
  )`;
}

async function eventLocalDay(database: D1Database, eventId: string, now: number): Promise<string> {
  const event = await database.prepare("SELECT timezone FROM events WHERE id = ?").bind(eventId).first<{ timezone: string }>();
  return localParts(now, event?.timezone ?? "UTC").day;
}

export async function hasSpeakerTaskCancellationColumn(database: D1Database): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS present FROM pragma_table_info('speaker_tasks') WHERE name = 'cancelled_at'")
    .first<{ present: number }>();
  return row?.present === 1;
}

/** Full task rows carry the template's fixed-date provenance; old sparse fixtures do not. */
export async function hasSpeakerTaskTemplateProvenance(database: D1Database): Promise<boolean> {
  return (await hasColumns(database, "speaker_tasks", ["template_id"]))
    && hasColumns(database, "task_templates", ["id", "event_id", "due_at"]);
}

function pendingWavePredicate(submission: string): string {
  return `${submission}.wave_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM waves stage_wave
    WHERE stage_wave.id = ${submission}.wave_id
      AND stage_wave.event_id = ${submission}.event_id
      AND stage_wave.sent_at IS NULL
  )`;
}

function onboardingStagePredicate(
  submission: string,
  agenda: string,
  includeCancelledAt: boolean,
): string {
  return `${submission}.status = 'accepted'
    AND ${agenda}.id IS NULL
    AND NOT (${pendingWavePredicate(submission)})
    AND ${submissionTaskPredicate("open", submission, includeCancelledAt)}`;
}

function acceptedStagePredicate(
  submission: string,
  agenda: string,
  includeCancelledAt: boolean,
): string {
  return `${submission}.status = 'accepted'
    AND ${agenda}.id IS NULL
    AND NOT (${onboardingStagePredicate(submission, agenda, includeCancelledAt)})
    AND NOT (${pendingWavePredicate(submission)})`;
}

/**
 * One status vocabulary powers list filtering and dashboard instruments. A
 * dashboard tile therefore cannot count a different set than its destination.
 */
export function submissionStatusPredicate(
  status: SubmissionStatusFilter,
  aliases: { submission?: string; agenda?: string; includeCancelledAt?: boolean } = {},
): string {
  const submission = aliases.submission ?? "s";
  const agenda = aliases.agenda ?? "ai";
  const includeCancelledAt = aliases.includeCancelledAt ?? false;
  if (status === "scheduled") return `${agenda}.id IS NOT NULL AND ${agenda}.is_published = 0`;
  if (status === "published") return `${agenda}.id IS NOT NULL AND ${agenda}.is_published = 1`;
  if (status === "waved") return `${submission}.status = 'accepted'
    AND ${agenda}.id IS NULL
    AND ${pendingWavePredicate(submission)}`;
  if (status === "unreviewed") return `${submission}.status IN ('submitted', 'in_review')`;
  if (status === "onboarding") return onboardingStagePredicate(submission, agenda, includeCancelledAt);
  if (status === "accepted_any") return `${submission}.status = 'accepted'`;
  if (status === "accepted") return acceptedStagePredicate(submission, agenda, includeCancelledAt);
  return `${submission}.status = '${status}'`;
}

export interface SubmissionListFilters {
  eventId: string;
  page?: number;
  per_page?: number;
  q?: string;
  sort?: keyof typeof SUBMISSION_SORTS;
  kind?: "abstract" | "session";
  status?: SubmissionStatusFilter;
  track?: string;
  format?: string;
  wave?: string;
  task?: SubmissionTaskFilter;
  placement?: SubmissionPlacementFilter;
}

interface SubmissionQueryRow {
  id: string;
  kind: "abstract" | "session";
  title: string;
  stored_status: Exclude<SubmissionListItem["status"], "scheduled" | "published">;
  format_id: string | null;
  format: string | null;
  speakers_json: string;
  tracks_json: string;
  score: number | null;
  review_count: number | null;
  score_is_weighted: number | null;
  agent_reviews_json: string;
  submitted_at: number | null;
  updated_at: number;
  origin: SubmissionListItem["origin"];
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
  building: string | null;
  timezone: string;
  agenda_published: number | null;
  pinned_building_count: number | null;
  form_id?: string | null;
  last_saved_at?: number | null;
  submitter_id?: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
  notification_state?: SubmissionNotificationState | null;
  notification_outbox_status?: "queued" | "sent" | "suppressed" | "failed" | null;
  notification_outbox_reason?: string | null;
  notification_outbox_error?: string | null;
  notification_sent_at?: number | null;
}

interface DraftFieldRow extends FormFieldConditionInput {
  form_id: string;
  key: string;
  label: string;
  required: number;
}

interface DraftAnswerRow {
  submission_id: string;
  key: string;
  value_text: string | null;
  value_json: string | null;
}

interface QueryParts {
  where: string;
  bindings: unknown[];
}

function filterParts(
  filters: SubmissionListFilters,
  includeCancelledAt = false,
  statusSemantics: SubmissionStatusSemantics = "derived",
  overdueDay?: string,
  includeTemplateProvenance = false,
): QueryParts {
  const clauses = ["s.event_id = ?"];
  const bindings: unknown[] = [filters.eventId];

  if (filters.kind) {
    clauses.push("s.kind = ?");
    bindings.push(filters.kind);
  }
  if (filters.status === "not_notified") clauses.push(NOTIFICATION_GAP_PREDICATE);
  else if (filters.status) {
    if (statusSemantics === "stored") {
      clauses.push("s.status = ?");
      bindings.push(filters.status === "accepted_any" ? "accepted" : filters.status);
    } else {
      clauses.push(submissionStatusPredicate(filters.status, { includeCancelledAt }));
    }
  }
  if (filters.track) {
    clauses.push(`EXISTS (
      SELECT 1 FROM submission_tracks filter_st
      WHERE filter_st.submission_id = s.id AND filter_st.track_id = ?
    )`);
    bindings.push(filters.track);
  }
  if (filters.format) {
    clauses.push("s.format_id = ?");
    bindings.push(filters.format);
  }
  if (filters.wave) {
    clauses.push("s.wave_id = ?");
    bindings.push(filters.wave);
  }
  if (filters.task) {
    clauses.push(submissionTaskPredicate(filters.task, "s", includeCancelledAt, includeTemplateProvenance));
    if (filters.task === "overdue") bindings.push(overdueDay ?? "1970-01-01", Date.now());
  }
  if (filters.placement === "unplaced") clauses.push("ai.id IS NULL");
  if (filters.q) {
    const query = `%${filters.q.toLocaleLowerCase()}%`;
    clauses.push(`(
      lower(s.id) LIKE ? OR lower(s.title) LIKE ? OR lower(s.search_blob) LIKE ?
      OR EXISTS (
        SELECT 1 FROM participations search_par
        JOIN people search_person ON search_person.id = search_par.person_id
        WHERE search_par.submission_id = s.id
          AND (lower(search_person.name) LIKE ? OR lower(coalesce(search_person.company, '')) LIKE ?)
      )
      OR EXISTS (
        SELECT 1 FROM submission_tracks search_st
        JOIN tracks search_track ON search_track.id = search_st.track_id
        WHERE search_st.submission_id = s.id AND lower(search_track.name) LIKE ?
      )
    )`);
    bindings.push(query, query, query, query, query, query);
  }
  return { where: clauses.join(" AND "), bindings };
}

const FROM = `FROM submissions s
JOIN events event ON event.id = s.event_id
LEFT JOIN formats format ON format.id = s.format_id
LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
LEFT JOIN rooms room ON room.id = ai.room_id
LEFT JOIN buildings building ON building.id = room.building_id`;

/**
 * The notification view is deliberately a read-time join. The latest
 * decision owns the state, while a retry is attached to that decision through
 * outbox.entity_id. A sent retry wins over an older queued row, and a
 * demo-mode suppression is settled by design, so the view closes when the
 * decision has reached a terminal notification outcome.
 */
const NOTIFICATION_FROM = `${FROM}
LEFT JOIN submission_decisions latest_decision
  ON latest_decision.id = (
    SELECT candidate.id
    FROM submission_decisions candidate
    WHERE candidate.event_id = s.event_id
      AND candidate.submission_id = s.id
    ORDER BY candidate.decided_at DESC, candidate.id DESC
    LIMIT 1
  )
LEFT JOIN outbox notification_outbox
  ON notification_outbox.id = (
    SELECT candidate.id
    FROM outbox candidate
    WHERE candidate.event_id = s.event_id
      AND (candidate.id = latest_decision.outbox_id OR candidate.entity_id = latest_decision.id)
    ORDER BY CASE WHEN candidate.status = 'sent' THEN 0 ELSE 1 END,
             candidate.created_at DESC,
             candidate.id DESC
    LIMIT 1
  )`;

const NOTIFICATION_ADDRESS_SQL = `COALESCE((
  SELECT speaker.email
  FROM participations speaker_part
  JOIN people speaker ON speaker.id = speaker_part.person_id
  WHERE speaker_part.submission_id = s.id
    AND speaker_part.role IN ('speaker', 'submitter')
  ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
           speaker_part.position ASC,
           speaker_part.id ASC
  LIMIT 1
), (
  SELECT submitter.email FROM people submitter WHERE submitter.id = s.submitter_person_id
))`;

const NOTIFICATION_STATE_SQL = `CASE
  WHEN latest_decision.id IS NULL THEN NULL
  WHEN notification_outbox.status = 'sent' THEN 'sent'
  WHEN notification_outbox.id IS NOT NULL THEN 'not_delivered'
  WHEN s.last_write_source = 'airtable' THEN 'changed_in_airtable'
  WHEN trim(${NOTIFICATION_ADDRESS_SQL}) <> '' AND ${NOTIFICATION_ADDRESS_SQL} LIKE '%@%.%' THEN 'not_delivered'
  ELSE 'no_valid_address'
END`;

const NOTIFICATION_GAP_PREDICATE = `latest_decision.id IS NOT NULL
  AND latest_decision.resulting_status IN ('accepted', 'rejected')
  AND NOT (
    COALESCE(notification_outbox.status, '') = 'sent'
    OR (
      COALESCE(notification_outbox.status, '') = 'suppressed'
      AND notification_outbox.suppressed_reason = 'demo_mode_not_allowlisted'
      AND event.demo_mode = 1
    )
  )`;

const NOTIFICATION_SELECT = `
  ${NOTIFICATION_STATE_SQL} AS notification_state,
  notification_outbox.status AS notification_outbox_status,
  notification_outbox.suppressed_reason AS notification_outbox_reason,
  notification_outbox.error AS notification_outbox_error,
  notification_outbox.sent_at AS notification_sent_at`;

function parseJsonArray<T>(value: string): T[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function toItem(row: SubmissionQueryRow): SubmissionListItem {
  const status = row.starts_at === null
    ? row.stored_status
    : row.agenda_published === 1
      ? "published"
      : "scheduled";
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status,
    format_id: row.format_id,
    format: row.format,
    speakers: parseJsonArray<SubmissionSpeakerListItem>(row.speakers_json),
    tracks: parseJsonArray<SubmissionTrackListItem>(row.tracks_json).map((track) => ({
      ...track,
      is_primary: Boolean(track.is_primary),
    })),
    score: row.score === null ? null : Number(row.score),
    review_count: Number(row.review_count ?? 0),
    score_is_weighted: Number(row.score_is_weighted ?? 0) === 1,
    agent_reviews: parseJsonArray<SubmissionAgentReview>(row.agent_reviews_json).map((review) => ({
      id: review.id,
      name: review.name,
      score: review.score === null ? null : Number(review.score),
      override_score: review.override_score === null || review.override_score === undefined ? null : Number(review.override_score),
      recommendation: review.recommendation ?? null,
      comment: review.comment ?? null,
    })),
    submitted_at: row.submitted_at,
    last_saved_at: row.last_saved_at ?? null,
    updated_at: row.updated_at,
    origin: row.origin,
    missing_fields: [],
    submitter: row.submitter_id && row.submitter_name && row.submitter_email
      ? { id: row.submitter_id, name: row.submitter_name, email: row.submitter_email }
      : null,
    slot: row.starts_at === null || row.duration_min === null || row.room === null || row.building === null
      ? null
      : {
          starts_at: row.starts_at,
          duration_min: row.duration_min,
          room: row.room,
          building: row.building,
          timezone: row.timezone,
          is_published: row.agenda_published === 1,
          show_building: showsBuildingComparisonCount(row.pinned_building_count),
        },
    notified: row.notification_state ? notificationForRow(row) : null,
  };
}

function notificationForRow(row: SubmissionQueryRow): NonNullable<SubmissionListItem["notified"]> {
  switch (row.notification_state) {
    case "changed_in_airtable":
      return {
        state: "changed_in_airtable",
        label: "Changed in Airtable",
        detail: "The Airtable mirror is currently cut; this is a theoretical legacy path. It deliberately did not run the acceptance cascade.",
        sent_at: null,
        outbox_status: null,
      };
    case "not_delivered": {
      const status = row.notification_outbox_status;
      const reason = row.notification_outbox_reason ?? row.notification_outbox_error;
      return {
        state: "not_delivered",
        label: "Not delivered",
        detail: reason
          ? `The mail outbox is ${status ?? "unresolved"}: ${reason}.`
          : status
            ? `The mail outbox is ${status}.`
            : "No delivered message is present in the mail outbox.",
        sent_at: row.notification_sent_at ?? null,
        outbox_status: row.notification_outbox_status ?? null,
      };
    }
    case "no_valid_address":
      return {
        state: "no_valid_address",
        label: "No valid address",
        detail: "No usable speaker address was available, so no message could be queued.",
        sent_at: null,
        outbox_status: null,
      };
    case "sent":
      return {
        state: "sent",
        label: "Sent",
        detail: "The decision message was sent to the speaker.",
        sent_at: row.notification_sent_at ?? null,
        outbox_status: "sent",
      };
    default:
      return {
        state: "no_valid_address",
        label: "No valid address",
        detail: "No usable speaker address was available, so no message could be queued.",
        sent_at: null,
        outbox_status: null,
      };
  }
}

/**
 * The agent line carries the chair's override when there is one, so the number
 * on the results list is the number on the record. `score` stays the agent's
 * own: the list says what the agent scored and what governs instead.
 */
function agentReviewsSelect(includeOverrides: boolean): string {
  return `
  COALESCE((
    SELECT json_group_array(json_object(
      'id', evaluation.id,
      'name', reviewer.name,
      'score', evaluation.score,
      'override_score', ${includeOverrides ? "evaluation.override_score" : "NULL"},
      'recommendation', evaluation.recommendation,
      'comment', evaluation.comment
    ))
    FROM evaluations evaluation
    JOIN people reviewer
      ON reviewer.id = evaluation.reviewer_person_id
     AND reviewer.kind = 'agent'
    JOIN evaluation_rounds evaluation_round ON evaluation_round.id = evaluation.round_id
    WHERE evaluation.submission_id = s.id
      AND evaluation.abstained = 0
      AND evaluation_round.mode = 'scorecard'
  ), '[]') AS agent_reviews_json`;
}

interface ReviewQueryCapabilities {
  includeReviewerIdentity: boolean;
  includeAgentReviews: boolean;
  includeOverrides: boolean;
}

async function reviewQueryCapabilities(database: D1Database): Promise<ReviewQueryCapabilities> {
  const [hasReviewerIdentity, hasPeopleKind, hasAgentEvaluationFields, hasEvaluationRound, hasOverrides] = await Promise.all([
    hasColumns(database, "evaluations", ["reviewer_person_id"]),
    hasColumns(database, "people", ["kind"]),
    hasColumns(database, "evaluations", [
      "id",
      "submission_id",
      "reviewer_person_id",
      "round_id",
      "score",
      "recommendation",
      "comment",
      "abstained",
    ]),
    hasColumns(database, "evaluation_rounds", ["id", "mode"]),
    hasColumns(database, "evaluations", ["override_score"]),
  ]);
  const includeReviewerIdentity = hasReviewerIdentity && hasPeopleKind;
  return {
    includeReviewerIdentity,
    includeAgentReviews: includeReviewerIdentity && hasAgentEvaluationFields && hasEvaluationRound,
    includeOverrides: hasOverrides,
  };
}

function itemSelect(
  includeVenueDisclosure: boolean,
  reviewCapabilities: ReviewQueryCapabilities,
): string {
  const agentReviews = reviewCapabilities.includeAgentReviews
    ? agentReviewsSelect(reviewCapabilities.includeOverrides)
    : "'[]' AS agent_reviews_json";
  return `
  s.id,
  s.kind,
  s.title,
  s.status AS stored_status,
  s.format_id,
  format.name AS format,
  ${participantListSql({
    submissionId: "s.id",
    audience: "program",
    // The role travels with the name: the results table's "+1" has to be able
    // to say who the other person is and what they are doing on the session.
    fields: { id: "speaker.id", name: "speaker.name", company: "speaker.company", role: "participation.role" },
  })} AS speakers_json,
  COALESCE((
    SELECT json_group_array(json_object(
      'id', ordered.id,
      'name', ordered.name,
      'color', ordered.color,
      'is_primary', ordered.is_primary
    ))
    FROM (
      SELECT carried.id, carried.name, carried.color, st.is_primary
      FROM submission_tracks st
      JOIN tracks carried ON carried.id = st.track_id
      WHERE st.submission_id = s.id
      ORDER BY st.is_primary DESC, carried.position ASC, carried.id ASC
    ) ordered
  ), '[]') AS tracks_json,
  ${reviewAggregateColumns("s.id", reviewCapabilities.includeReviewerIdentity, reviewCapabilities.includeOverrides)},
  ${agentReviews},
  s.submitted_at,
  s.updated_at,
  s.origin,
  ai.starts_at,
  ai.duration_min,
  room.name AS room,
  building.name AS building,
  event.timezone,
  ai.is_published AS agenda_published, ${includeVenueDisclosure ? `(SELECT COUNT(DISTINCT pinned_building.id)
    FROM buildings pinned_building
    WHERE pinned_building.event_id = event.id
      AND pinned_building.lat IS NOT NULL
      AND pinned_building.lng IS NOT NULL)` : "0"} AS pinned_building_count`;
}

async function hasColumns(database: D1Database, table: string, required: readonly string[]): Promise<boolean> {
  const result = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const columns = new Set(result.results.map((column) => column.name));
  return required.every((column) => columns.has(column));
}

function answerValue(row: DraftAnswerRow): unknown {
  if (row.value_json !== null) {
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return row.value_text;
    }
  }
  return row.value_text;
}

function answerPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Derive the attention fields for drafts from the form schema and answers.
 * Applicability is intentionally delegated to the one shared evaluator; the
 * queue must never turn every required field into a missing field.
 */
async function addDraftMetadata(
  database: D1Database,
  rows: SubmissionQueryRow[],
): Promise<SubmissionListItem[]> {
  const items = rows.map(toItem);
  const draftRows = rows.filter((row) => row.form_id);
  if (draftRows.length === 0) return items;

  const formIds = [...new Set(draftRows.map((row) => row.form_id).filter((id): id is string => Boolean(id)))];
  const submissionIds = draftRows.map((row) => row.id);
  const formPlaceholders = formIds.map(() => "?").join(",");
  const submissionPlaceholders = submissionIds.map(() => "?").join(",");
  const [fields, answers] = await Promise.all([
    database.prepare(`
      SELECT form_id, key, label, required, condition
      FROM form_fields
      WHERE form_id IN (${formPlaceholders})
      ORDER BY position ASC, id ASC
    `).bind(...formIds).all<DraftFieldRow>(),
    database.prepare(`
      SELECT answer.submission_id, field.key, answer.value_text, answer.value_json
      FROM submission_answers answer
      JOIN form_fields field ON field.id = answer.field_id
      WHERE answer.submission_id IN (${submissionPlaceholders})
      ORDER BY answer.updated_at ASC, answer.id ASC
    `).bind(...submissionIds).all<DraftAnswerRow>(),
  ]);
  const fieldsByForm = new Map<string, DraftFieldRow[]>();
  for (const field of fields.results) {
    const current = fieldsByForm.get(field.form_id) ?? [];
    current.push(field);
    fieldsByForm.set(field.form_id, current);
  }
  const answersBySubmission = new Map<string, Record<string, unknown>>();
  for (const answer of answers.results) {
    const current = answersBySubmission.get(answer.submission_id) ?? {};
    current[answer.key] = answerValue(answer);
    answersBySubmission.set(answer.submission_id, current);
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const row of draftRows) {
    const item = itemById.get(row.id);
    if (!item || !row.form_id) continue;
    const answerMap = answersBySubmission.get(row.id) ?? {};
    const missing = (fieldsByForm.get(row.form_id) ?? [])
      .filter((field) => field.required === 1 && isFieldApplicable(field, answerMap) && !answerPresent(answerMap[field.key]))
      .map((field) => field.label);
    item.missing_fields = missing;
    item.last_saved_at = row.last_saved_at ?? null;
    item.submitter = row.submitter_id && row.submitter_name && row.submitter_email
      ? { id: row.submitter_id, name: row.submitter_name, email: row.submitter_email }
      : null;
  }
  return items;
}

async function listDraftsNeedingAttention(
  database: D1Database,
  filters: SubmissionListFilters,
  includeCancelledAt = false,
): Promise<ListEnvelope<SubmissionListItem>> {
  const page = parsePagination(filters);
  const sort = resolveSort(SUBMISSION_SORTS, filters.sort, "updated");
  const stableOrder = orderClause(sort).replace(/, id ASC$/, ", s.id ASC");
  const overdueDay = filters.task === "overdue" ? await eventLocalDay(database, filters.eventId, Date.now()) : undefined;
  const includeTemplateProvenance = filters.task === "overdue" && await hasSpeakerTaskTemplateProvenance(database);
  const { where, bindings } = filterParts(filters, includeCancelledAt, "derived", overdueDay, includeTemplateProvenance);
  const includeVenueDisclosure = await hasColumns(database, "buildings", ["event_id", "lat", "lng"]);
  const reviewCapabilities = await reviewQueryCapabilities(database);
  const rows = await database.prepare(`
    SELECT ${itemSelect(includeVenueDisclosure, reviewCapabilities)},
      s.form_id,
      s.last_saved_at,
      submitter.id AS submitter_id,
      submitter.name AS submitter_name,
      submitter.email AS submitter_email
    ${FROM}
    JOIN people submitter ON submitter.id = s.submitter_person_id
    WHERE ${where}
    ORDER BY ${stableOrder}
  `).bind(...bindings).all<SubmissionQueryRow>();
  const items = (await addDraftMetadata(database, rows.results)).filter((item) => item.missing_fields.length > 0);
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / page.perPage);
  return {
    data: items.slice(page.offset, page.offset + page.limit),
    page: page.page,
    per_page: page.perPage,
    total,
    total_pages: totalPages,
  };
}

export async function listSubmissions(
  database: D1Database,
  filters: SubmissionListFilters,
): Promise<ListEnvelope<SubmissionListItem>> {
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(database);
  if (filters.status === "not_notified") return listNotNotifiedSubmissions(database, filters);
  if (filters.status === "draft" && await hasColumns(database, "submissions", ["form_id", "last_saved_at", "submitter_person_id"])) {
    return listDraftsNeedingAttention(database, filters, includeCancelledAt);
  }
  const page = parsePagination(filters);
  const sort = resolveSort(SUBMISSION_SORTS, filters.sort, "newest");
  // The shared helper deliberately emits the canonical `id ASC` tie-break.
  // This query joins several id-bearing tables, so qualify that fixed suffix.
  const stableOrder = orderClause(sort).replace(/, id ASC$/, ", s.id ASC");
  const overdueDay = filters.task === "overdue" ? await eventLocalDay(database, filters.eventId, Date.now()) : undefined;
  const includeTemplateProvenance = filters.task === "overdue" && await hasSpeakerTaskTemplateProvenance(database);
  const { where, bindings } = filterParts(filters, includeCancelledAt, "derived", overdueDay, includeTemplateProvenance);
  const includeVenueDisclosure = await hasColumns(database, "buildings", ["event_id", "lat", "lng"]);
  const reviewCapabilities = await reviewQueryCapabilities(database);
  const count = database.prepare(`SELECT COUNT(DISTINCT s.id) AS total ${FROM} WHERE ${where}`).bind(...bindings);
  const data = database.prepare(`
    SELECT ${itemSelect(includeVenueDisclosure, reviewCapabilities)}
    ${FROM}
    WHERE ${where}
    ORDER BY ${stableOrder}
    LIMIT ? OFFSET ?
  `).bind(...bindings, page.limit, page.offset);
  const envelope = await executeListPage<SubmissionQueryRow>({ count, data, page });
  return { ...envelope, data: envelope.data.map(toItem) };
}

async function listNotNotifiedSubmissions(
  database: D1Database,
  filters: SubmissionListFilters,
): Promise<ListEnvelope<SubmissionListItem>> {
  const page = parsePagination(filters);
  const sort = resolveSort(SUBMISSION_SORTS, filters.sort, "newest");
  const stableOrder = orderClause(sort).replace(/, id ASC$/, ", s.id ASC");
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(database);
  const overdueDay = filters.task === "overdue" ? await eventLocalDay(database, filters.eventId, Date.now()) : undefined;
  const includeTemplateProvenance = filters.task === "overdue" && await hasSpeakerTaskTemplateProvenance(database);
  const { where, bindings } = filterParts(filters, includeCancelledAt, "derived", overdueDay, includeTemplateProvenance);
  const includeVenueDisclosure = await hasColumns(database, "buildings", ["event_id", "lat", "lng"]);
  const reviewCapabilities = await reviewQueryCapabilities(database);
  const count = database
    .prepare(`SELECT COUNT(DISTINCT s.id) AS total ${NOTIFICATION_FROM} WHERE ${where}`)
    .bind(...bindings);
  const data = database
    .prepare(`
      SELECT ${itemSelect(includeVenueDisclosure, reviewCapabilities)}, ${NOTIFICATION_SELECT}
      ${NOTIFICATION_FROM}
      WHERE ${where}
      ORDER BY ${stableOrder}
      LIMIT ? OFFSET ?
    `)
    .bind(...bindings, page.limit, page.offset);
  const envelope = await executeListPage<SubmissionQueryRow>({ count, data, page });
  return { ...envelope, data: envelope.data.map(toItem) };
}

export interface NotifiedSummary {
  total: number;
  sendable: number;
  no_valid_address: number;
}

function emptyNotifiedSummary(): NotifiedSummary {
  return { total: 0, sendable: 0, no_valid_address: 0 };
}

/** Dashboard counts are intentionally the actionable subset; no-address rows stay visible in the view. */
export async function summarizeNotNotifiedSubmissions(
  database: D1Database,
  eventId: string,
): Promise<NotifiedSummary> {
  try {
    const row = await database
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN notification_state <> 'no_valid_address' THEN 1 END) AS sendable,
          COUNT(CASE WHEN notification_state = 'no_valid_address' THEN 1 END) AS no_valid_address
        FROM (
          SELECT ${NOTIFICATION_STATE_SQL} AS notification_state
          ${NOTIFICATION_FROM}
          WHERE s.event_id = ? AND ${NOTIFICATION_GAP_PREDICATE}
        ) notification_summary
      `)
      .bind(eventId)
      .first<{ total: number | null; sendable: number | null; no_valid_address: number | null }>();
    return {
      total: countValue(row?.total),
      sendable: countValue(row?.sendable),
      no_valid_address: countValue(row?.no_valid_address),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (?:table|column)/i.test(message)) return emptyNotifiedSummary();
    throw error;
  }
}

function countValue(value: unknown): number {
  return Number(value ?? 0);
}

/** Resolve a filter-wide selector without applying the list page or sort. */
export async function selectSubmissionIds(
  database: D1Database,
  filters: SubmissionFilter & { eventId: string },
  options: { statusSemantics?: SubmissionStatusSemantics } = {},
): Promise<string[]> {
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(database);
  const overdueDay = filters.task === "overdue" ? await eventLocalDay(database, filters.eventId, Date.now()) : undefined;
  const includeTemplateProvenance = filters.task === "overdue" && await hasSpeakerTaskTemplateProvenance(database);
  const { where, bindings } = filterParts(
    filters,
    includeCancelledAt,
    options.statusSemantics,
    overdueDay,
    includeTemplateProvenance,
  );
  const source = filters.status === "not_notified" ? NOTIFICATION_FROM : FROM;
  const result = await database
    .prepare(`SELECT DISTINCT s.id ${source} WHERE ${where} ORDER BY s.updated_at DESC, s.id ASC`)
    .bind(...bindings)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

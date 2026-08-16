import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { formatEventDateTime } from "../../lib/event-time";
import { formatDueDate, isTaskOverdue } from "../../lib/task-due";
import { hasSpeakerTaskCancellationColumn, missingFieldsForDrafts } from "../../routes/submissions.queries";
import type { TriggerKey } from "./triggers";
import { mergeDataForRecipient } from "./merge-data";
import type { MergeData } from "./render";

/** The Worker cron that evaluates pre-close and overdue mail schedules. */
export const MAIL_SCHEDULE_CRON = "0 * * * *" as const;

export interface MailScheduleCandidate {
  eventId: Id;
  templateKey: TriggerKey;
  entityId: Id;
  personId: Id;
  toEmail: string;
  data: MergeData;
}

export interface DraftCloseReminderCandidate extends MailScheduleCandidate {
  templateKey: "draft_close_reminder";
  submissionId: Id;
  formId: Id;
  formSlug: string;
  closesAt: number;
  timezone: string;
  missingFields: string[];
}

function taskDueLabel(row: { due_at: number; template_due_at: number | null; timezone: string }): string {
  // Fixed calendar-day templates keep their UTC-encoded date contract. Relative
  // and explicitly overridden deadlines are instants, so speakers read them
  // in the conference clock instead of receiving a machine timestamp.
  return row.template_due_at !== null && row.template_due_at === row.due_at
    ? formatDueDate(row.due_at)
    : formatEventDateTime(row.due_at, row.timezone);
}

/**
 * Read the configurable form offset without queueing or rendering anything.
 * The existing enqueue adapter can consume these candidates after the shared
 * templated-send seam is available.
 */
export async function selectPreCloseReminderCandidates(
  db: D1Database,
  now = Date.now(),
): Promise<MailScheduleCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT f.id AS entity_id, f.event_id, f.closes_at, event.timezone,
              p.id AS person_id, p.email, p.name,
              MIN(s.title) AS submission_title
       FROM forms f
       JOIN events event ON event.id = f.event_id
       JOIN submissions s ON s.form_id = f.id
       JOIN participations part
         ON part.submission_id = s.id
        AND part.role IN ('speaker', 'submitter')
       JOIN people p ON p.id = part.person_id
       WHERE f.status = 'open'
         AND NOT EXISTS (
           SELECT 1 FROM submissions draft
           WHERE draft.form_id = f.id
             AND draft.status = 'draft'
             AND draft.submitter_person_id = p.id
         )
         AND f.reminder_offset_hours IS NOT NULL
         AND f.closes_at IS NOT NULL
         AND ? >= (f.closes_at - f.reminder_offset_hours * 3600000)
         AND ? < f.closes_at
       GROUP BY f.id, f.event_id, f.closes_at, event.timezone, p.id, p.email, p.name
       ORDER BY f.id ASC, p.id ASC`,
    )
    .bind(now, now)
    .all<{
      entity_id: Id;
      event_id: Id;
      closes_at: number;
      timezone: string;
      person_id: Id;
      email: string;
      name: string;
      submission_title: string | null;
    }>();
  return rows.results.map((row) => ({
    eventId: row.event_id,
    templateKey: "form_closing_reminder",
    entityId: row.entity_id,
    personId: row.person_id,
    toEmail: row.email,
    data: {
      ...mergeDataForRecipient({ name: row.name, email: row.email, submissionTitle: row.submission_title }),
      "form.closes_at": formatEventDateTime(row.closes_at, row.timezone),
    },
  }));
}

/**
 * Select every qualifying draft, including complete drafts. Missing fields are
 * descriptive metadata, never an eligibility gate; the Drafts attention queue
 * intentionally has the narrower population.
 */
export async function selectDraftCloseReminderCandidates(
  db: D1Database,
  now = Date.now(),
): Promise<DraftCloseReminderCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT s.id AS submission_id, s.form_id, s.event_id, s.title AS submission_title,
              f.slug AS form_slug, f.closes_at, event.timezone,
              p.id AS person_id, p.email, p.name
       FROM submissions s
       JOIN forms f ON f.id = s.form_id AND f.event_id = s.event_id
       JOIN events event ON event.id = s.event_id
       JOIN people p ON p.id = s.submitter_person_id
       WHERE s.status = 'draft'
         AND f.status = 'open'
         AND (f.opens_at IS NULL OR ? >= f.opens_at)
         AND f.reminder_offset_hours IS NOT NULL
         AND f.closes_at IS NOT NULL
         AND ? >= (f.closes_at - f.reminder_offset_hours * 3600000)
         AND ? < f.closes_at
       ORDER BY s.id ASC`,
    )
    .bind(now, now, now)
    .all<{
      submission_id: Id;
      form_id: Id;
      event_id: Id;
      submission_title: string;
      form_slug: string;
      closes_at: number;
      timezone: string;
      person_id: Id;
      email: string;
      name: string;
    }>();
  const missingBySubmission = await missingFieldsForDrafts(db, rows.results.map((row) => ({ id: row.submission_id, form_id: row.form_id })));
  return rows.results.map((row) => {
    const missingFields = missingBySubmission.get(row.submission_id) ?? [];
    return {
      eventId: row.event_id,
      templateKey: "draft_close_reminder",
      entityId: row.submission_id,
      submissionId: row.submission_id,
      formId: row.form_id,
      formSlug: row.form_slug,
      personId: row.person_id,
      toEmail: row.email,
      closesAt: row.closes_at,
      timezone: row.timezone,
      missingFields,
      data: {
        ...mergeDataForRecipient({ name: row.name, email: row.email, submissionTitle: row.submission_title || "Untitled abstract" }),
        "form.closes_at": formatEventDateTime(row.closes_at, row.timezone),
        "draft.missing_fields": missingFields.length > 0
          ? missingFields.join(", ")
          : "nothing — all required fields are complete",
      },
    } satisfies DraftCloseReminderCandidate;
  });
}

/** Read overdue, still-owed tasks for the task_overdue trigger family. */
export async function selectOverdueTaskCandidates(
  db: D1Database,
  now = Date.now(),
): Promise<MailScheduleCandidate[]> {
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(db);
  const rows = await db
    .prepare(
      `SELECT task.id AS entity_id, task.event_id, task.person_id, p.email, p.name,
              task.title AS task_title, task.due_at, template.due_at AS template_due_at,
              s.title AS submission_title, event.timezone
       FROM speaker_tasks task
       JOIN task_templates template
         ON template.id = task.template_id AND template.event_id = task.event_id
       JOIN events event ON event.id = task.event_id
       JOIN people p ON p.id = task.person_id
       LEFT JOIN submissions s ON s.id = task.submission_id
       WHERE task.status = 'open'
         AND task.due_at IS NOT NULL
         ${includeCancelledAt ? "AND task.cancelled_at IS NULL" : ""}
       ORDER BY task.due_at ASC, task.id ASC`,
    )
    .all<{
      entity_id: Id;
      event_id: Id;
      person_id: Id;
      email: string;
      name: string;
      task_title: string;
      due_at: number;
      template_due_at: number | null;
      submission_title: string | null;
      timezone: string;
    }>();
  return rows.results.filter((row) => isTaskOverdue({
    dueAt: row.due_at,
    templateDueAt: row.template_due_at,
    timezone: row.timezone,
  }, now)).map((row) => ({
    eventId: row.event_id,
    templateKey: "task_overdue",
    entityId: row.entity_id,
    personId: row.person_id,
    toEmail: row.email,
    data: {
      ...mergeDataForRecipient({ name: row.name, email: row.email, submissionTitle: row.submission_title, taskTitle: row.task_title, taskDueAt: row.due_at, taskTemplateDueAt: row.template_due_at, timezone: row.timezone }),
      "task.title": row.task_title,
      "task.due_date": taskDueLabel(row),
    },
  }));
}

export function isMailScheduleCron(value: string): value is typeof MAIL_SCHEDULE_CRON {
  return value === MAIL_SCHEDULE_CRON;
}

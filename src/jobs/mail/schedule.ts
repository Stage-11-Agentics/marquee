import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { hasSpeakerTaskCancellationColumn } from "../../routes/submissions.queries";
import type { TriggerKey } from "./triggers";

/** The Worker cron that evaluates pre-close and overdue mail schedules. */
export const MAIL_SCHEDULE_CRON = "0 * * * *" as const;

export interface MailScheduleCandidate {
  eventId: Id;
  templateKey: TriggerKey;
  entityId: Id;
  personId: Id;
  toEmail: string;
  data: Record<string, string>;
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
      `SELECT f.id AS entity_id, f.event_id, f.closes_at,
              p.id AS person_id, p.email, p.name,
              MIN(s.title) AS submission_title
       FROM forms f
       JOIN submissions s ON s.form_id = f.id
       JOIN participations part
         ON part.submission_id = s.id
        AND part.role IN ('speaker', 'submitter')
       JOIN people p ON p.id = part.person_id
       WHERE f.status = 'open'
         AND f.reminder_offset_hours IS NOT NULL
         AND f.closes_at IS NOT NULL
         AND ? >= (f.closes_at - f.reminder_offset_hours * 3600000)
         AND ? < f.closes_at
       GROUP BY f.id, f.event_id, f.closes_at, p.id, p.email, p.name
       ORDER BY f.id ASC, p.id ASC`,
    )
    .bind(now, now)
    .all<{
      entity_id: Id;
      event_id: Id;
      closes_at: number;
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
      "speaker.first_name": row.name.trim().split(/\s+/)[0] ?? row.name,
      "speaker.name": row.name,
      "speaker.email": row.email,
      "submission.title": row.submission_title ?? "—",
      "form.closes_at": new Date(row.closes_at).toISOString(),
    },
  }));
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
              task.title AS task_title, task.due_at, s.title AS submission_title
       FROM speaker_tasks task
       JOIN people p ON p.id = task.person_id
       LEFT JOIN submissions s ON s.id = task.submission_id
       WHERE task.status = 'open'
         AND task.due_at IS NOT NULL
         AND task.due_at < ?
         ${includeCancelledAt ? "AND task.cancelled_at IS NULL" : ""}
       ORDER BY task.due_at ASC, task.id ASC`,
    )
    .bind(now)
    .all<{
      entity_id: Id;
      event_id: Id;
      person_id: Id;
      email: string;
      name: string;
      task_title: string;
      due_at: number;
      submission_title: string | null;
    }>();
  return rows.results.map((row) => ({
    eventId: row.event_id,
    templateKey: "task_overdue",
    entityId: row.entity_id,
    personId: row.person_id,
    toEmail: row.email,
    data: {
      "speaker.first_name": row.name.trim().split(/\s+/)[0] ?? row.name,
      "speaker.name": row.name,
      "speaker.email": row.email,
      "submission.title": row.submission_title ?? "—",
      "task.title": row.task_title,
      "task.due_date": new Date(row.due_at).toISOString(),
    },
  }));
}

export function isMailScheduleCron(value: string): value is typeof MAIL_SCHEDULE_CRON {
  return value === MAIL_SCHEDULE_CRON;
}

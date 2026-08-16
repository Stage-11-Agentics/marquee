import type { MergeData } from "./render";
import { formatEventDateTime, formatEventTime } from "../../lib/event-time";
import { formatDueDate, isFixedCalendarDayDue } from "../../lib/task-due";

export interface RecipientMergeContext {
  name: string;
  email: string;
  /** A public speaker permalink; absent context deliberately stays visible as a token. */
  publicLink?: string | null;
  submissionTitle?: string | null;
  room?: string | null;
  building?: string | null;
  address?: string | null;
  accessNote?: string | null;
  leaveBy?: number | null;
  timezone?: string | null;
  startsAt?: number | null;
  taskTitle?: string | null;
  taskDueAt?: number | null;
  /** The fixed calendar-day template due_at, or null for a relative template. */
  taskTemplateDueAt?: number | null;
}

export interface ReviewerReminderMergeContext {
  email: string;
  name: string;
  outstanding: number;
  roundName: string;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function mergeTime(value: number | null | undefined, timezone: string | null | undefined): string {
  if (value === null || value === undefined || !timezone) return "—";
  return formatEventTime(value, timezone);
}

function mergeTaskDue(
  value: number | null | undefined,
  templateDueAt: number | null | undefined,
  timezone: string | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  if (isFixedCalendarDayDue(value, templateDueAt) || !timezone) return formatDueDate(value);
  return formatEventDateTime(value, timezone);
}

/**
 * Canonical speaker/session/task merge data. Preview, reminders, and future
 * trigger consumers all use this vocabulary before calling renderMail or
 * renderAdHocMail; no route owns a private merge-field renderer.
 */
export function mergeDataForRecipient(recipient: RecipientMergeContext): MergeData {
  const submissionTitle = recipient.submissionTitle ?? "—";
  const room = recipient.room ?? "—";
  const startsAt = recipient.startsAt === null || recipient.startsAt === undefined
    ? "—"
    : recipient.timezone ? formatEventDateTime(recipient.startsAt, recipient.timezone) : "—";
  const taskDueAt = mergeTaskDue(recipient.taskDueAt, recipient.taskTemplateDueAt, recipient.timezone);
  return {
    "speaker.first_name": firstName(recipient.name),
    "speaker.name": recipient.name,
    "speaker.email": recipient.email,
    "speaker.public_link": recipient.publicLink,
    "submission.title": submissionTitle,
    "session.title": submissionTitle,
    "room.name": room,
    "session.room": room,
    "session.time": startsAt,
    "session.building": recipient.building ?? "—",
    "session.address": recipient.address ?? "—",
    "session.accessNote": recipient.accessNote ?? "—",
    "session.leaveBy": mergeTime(recipient.leaveBy, recipient.timezone),
    "task.title": recipient.taskTitle ?? "—",
    "task.due_date": taskDueAt,
  };
}

export function mergeDataForReviewerReminder(reviewer: ReviewerReminderMergeContext): MergeData {
  return {
    "reviewer.first_name": firstName(reviewer.name),
    "reviewer.name": reviewer.name,
    "reviewer.email": reviewer.email,
    "review.outstanding": reviewer.outstanding,
    "round.name": reviewer.roundName,
  };
}

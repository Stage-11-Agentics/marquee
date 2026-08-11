import type { MergeData } from "./render";

export interface RecipientMergeContext {
  name: string;
  email: string;
  submissionTitle?: string | null;
  room?: string | null;
  startsAt?: number | null;
  taskTitle?: string | null;
  taskDueAt?: number | null;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
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
    : new Date(recipient.startsAt).toISOString();
  const taskDueAt = recipient.taskDueAt === null || recipient.taskDueAt === undefined
    ? "—"
    : new Date(recipient.taskDueAt).toISOString();
  return {
    "speaker.first_name": firstName(recipient.name),
    "speaker.name": recipient.name,
    "speaker.email": recipient.email,
    "submission.title": submissionTitle,
    "session.title": submissionTitle,
    "room.name": room,
    "session.room": room,
    "session.time": startsAt,
    "task.title": recipient.taskTitle ?? "—",
    "task.due_date": taskDueAt,
  };
}

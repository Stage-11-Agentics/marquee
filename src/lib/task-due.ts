import { localParts } from "./event-time";

/**
 * Task due dates are *days*, not instants.
 *
 * An organizer types "2027-05-01" and expects to read "2027-05-01" back from
 * any desk. Because the field has no clock, the day is encoded at UTC rather
 * than interpreted through the reader's zone; every reader therefore sees the
 * same calendar day.
 *
 * The instant stored is the *end* of the named UTC-encoded day
 * (23:59:59.999 UTC), because "due 2027-05-01" means the speaker has that
 * whole calendar day, not that they were already late when it began. Runtime
 * enforcement interprets that day in the conference timezone.
 */

const MS_PER_DAY = 86_400_000;
const END_OF_DAY_MS = MS_PER_DAY - 1;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface TaskDueRuntime {
  dueAt: number;
  /** Non-null means the task came from a fixed calendar-day template. */
  templateDueAt?: number | null;
  timezone?: string | null;
}

function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / MS_PER_DAY;
}

function isUtcDaySentinel(value: number): boolean {
  const date = dateInputFromDueAt(value);
  return dueAtFromDateInput(date) === value;
}

function isCalendarDayTask(task: TaskDueRuntime): task is TaskDueRuntime & { timezone: string } {
  const fixedTemplate = task.templateDueAt === undefined
    ? isUtcDaySentinel(task.dueAt)
    : task.templateDueAt !== null && task.templateDueAt === task.dueAt;
  return fixedTemplate && Boolean(task.timezone);
}

/** Apply the event-local boundary to fixed calendar-day tasks, preserving exact instants for offsets. */
export function isTaskOverdue(task: TaskDueRuntime, now: number): boolean {
  if (!isCalendarDayTask(task)) return task.dueAt < now;
  return localParts(now, task.timezone).day > dateInputFromDueAt(task.dueAt);
}

/** Whether an owed task falls within the event-local risk window. */
export function isTaskDueWithinDays(task: TaskDueRuntime, now: number, days: number): boolean {
  if (isTaskOverdue(task, now)) return false;
  if (!isCalendarDayTask(task)) return task.dueAt >= now && task.dueAt <= now + days * MS_PER_DAY;
  const today = dayNumber(localParts(now, task.timezone).day);
  const dueDay = dayNumber(dateInputFromDueAt(task.dueAt));
  return dueDay >= today && dueDay <= today + days;
}

/** Whole-day severity for overdue task readers, using the same event-local calendar. */
export function taskDaysOverdue(task: TaskDueRuntime, now: number): number {
  if (!isTaskOverdue(task, now)) return 0;
  if (isCalendarDayTask(task)) {
    return Math.max(1, dayNumber(localParts(now, task.timezone).day) - dayNumber(dateInputFromDueAt(task.dueAt)));
  }
  return Math.max(1, Math.ceil((now - task.dueAt) / MS_PER_DAY));
}

/** Parse `YYYY-MM-DD` to the last millisecond of that UTC day, or null if malformed. */
export function dueAtFromDateInput(value: string): number | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(parsed)) return null;
  // Date.UTC rolls overflow forward (month 13 becomes January), so a round trip
  // through the formatter is the cheapest way to reject 2027-02-30 outright.
  if (dateInputFromDueAt(parsed) !== `${year}-${month}-${day}`) return null;
  return parsed + END_OF_DAY_MS;
}

/** Format an epoch-ms due date back to the `YYYY-MM-DD` the operator typed. */
export function dateInputFromDueAt(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Human-facing due date, stable across timezones because it reads UTC. */
export function formatDueDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

/**
 * Resolve a template's deadline for one assignment.
 *
 * A template carries exactly one of the two (the table's CHECK enforces it):
 * a fixed `due_at`, or an offset counted from the moment the task is assigned —
 * the same arithmetic the acceptance cascade uses when it mints tasks.
 */
export function resolveTaskDueAt(
  template: { due_at: number | null; due_offset_days: number | null },
  now: number,
): number {
  if (template.due_at !== null) return template.due_at;
  return now + (template.due_offset_days ?? 0) * MS_PER_DAY;
}

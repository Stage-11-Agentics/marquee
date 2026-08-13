/**
 * Task due dates are *days*, not instants.
 *
 * An organizer types "2027-05-01" and expects to read "2027-05-01" back, from
 * any desk in any timezone. Parsing that string to local midnight breaks the
 * promise west of Greenwich — `new Date("2027-05-01")` is UTC midnight, which
 * renders as Apr 30 in New York — so both ends of the round trip pin to UTC.
 *
 * The instant stored is the *end* of the named day (23:59:59.999 UTC), because
 * "due 2027-05-01" means the speaker has that whole day, not that they were
 * already late when it began.
 */

const MS_PER_DAY = 86_400_000;
const END_OF_DAY_MS = MS_PER_DAY - 1;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

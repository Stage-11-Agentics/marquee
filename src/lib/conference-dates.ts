export interface ConferenceDay {
  id: string;
  label: string;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function conferenceDayLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDate(value));
}

/**
 * Conference dates are calendar dates, not instants. Keep their iteration in
 * UTC so a browser or Worker timezone cannot move a tab to its neighbor.
 */
export function conferenceDays(startsOn: string, endsOn: string): ConferenceDay[] {
  const start = parseDate(startsOn);
  const end = parseDate(endsOn);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const days: ConferenceDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const id = cursor.toISOString().slice(0, 10);
    days.push({ id, label: conferenceDayLabel(id) });
  }
  return days;
}

export function calendarDateInTimezone(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function countOutsideConferenceWindow(
  timestamps: readonly number[],
  startsOn: string,
  endsOn: string,
  timezone: string,
): number {
  return timestamps.filter((timestamp) => {
    const date = calendarDateInTimezone(timestamp, timezone);
    return date < startsOn || date > endsOn;
  }).length;
}

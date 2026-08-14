/**
 * The event's timezone is the clock for every organizer-set or
 * conference-scheduled wall-clock value. Epoch milliseconds remain instants;
 * these helpers are the only seam that interprets a wall clock for an event.
 */

export const EVENT_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

export interface LocalDateTimeParts {
  day: string;
  time: string;
}

/** Render an instant as the event-local calendar day and wall-clock minute. */
export function localParts(timestamp: number, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    time: `${values.get("hour")}:${values.get("minute")}`,
  };
}

/** Convert an event-local wall-clock value into an instant without using the runtime's zone. */
export function zonedStart(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year!, month! - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = localParts(candidate, timezone);
    const renderedTarget = Date.UTC(
      Number(rendered.day.slice(0, 4)),
      Number(rendered.day.slice(5, 7)) - 1,
      Number(rendered.day.slice(8, 10)),
      Number(rendered.time.slice(0, 2)),
      Number(rendered.time.slice(3, 5)),
    );
    candidate += target - renderedTarget;
  }
  return candidate;
}

function validCalendarDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite) || month! < 1 || month! > 12 || day! < 1 || day! > 31) return false;
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month! - 1 && candidate.getUTCDate() === day;
}

const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Convert a `datetime-local` value interpreted in the event's timezone to epoch milliseconds. */
export function localDateTimeToInstant(value: string, timezone: string): number | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [, date, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!validCalendarDate(date!) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return zonedStart(date!, `${hourText}:${minuteText}`, timezone);
}

/** Render an instant into the event-local value expected by a `datetime-local` control. */
export function instantToLocalDateTime(timestamp: number | null, timezone: string): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "";
  const rendered = localParts(timestamp, timezone);
  return `${rendered.day}T${rendered.time}`;
}

/** Return the locale's short, DST-aware name for the event's timezone at an instant. */
export function timeZoneLabel(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(timestamp));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/** Render a human-facing event-local date and time with its DST-aware short zone label. */
export function formatEventDateTime(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
}).format(new Date(timestamp));
}

/** Render an event-local clock time with its DST-aware short zone label. */
export function formatEventTime(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

/** Return the named zone for labels whose control has room for the unambiguous IANA name. */
export function eventTimeLabel(timezone: string | null | undefined): string {
  return timezone ? `(${timezone})` : "";
}

import type { CalendarMethod, Id } from "../../db/schema";

const CRLF = "\r\n";
const ICS_ORIGIN = "https://marquee.stage11.dev";
const ORGANIZER_EMAIL = "marquee@stage11.systems";

export interface CalendarEventInput {
  attendeeEmail: string;
  attendeeName: string;
  description?: string;
  dtstamp: number | Date;
  durationMin: number;
  location: string;
  method: CalendarMethod;
  organizerEmail?: string;
  organizerName?: string;
  sequence: number;
  startsAt: number;
  title: string;
  timezone: string;
  uid: string;
  url: string;
}

export interface CalendarLinks {
  google: string;
  outlook: string;
  stable: string;
}

export interface CalendarMailMaterial {
  html: string;
  icsBody: string;
  links: CalendarLinks;
  mime: string;
  subject: string;
  text: string;
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function assertSafeEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
    throw new Error("calendar attendee and organizer addresses must be valid email values");
  }
  return email;
}

/** RFC 5545 TEXT escaping, including the literal newline escape. */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function quoteParameter(value: string): string {
  if (/^[A-Za-z0-9 _-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Fold one content line at the RFC 5545 limit. The continuation space is part
 * of the folded line, so every emitted physical line is at most 75 octets.
 */
export function foldIcsLine(line: string): string {
  const encoder = textEncoder();
  const pieces: string[] = [];
  let current = "";

  for (const character of line) {
    if (current.length > 0 && encoder.encode(`${current}${character}`).byteLength > 75) {
      pieces.push(current);
      current = ` ${character}`;
      continue;
    }
    current += character;
  }
  if (current.length > 0) pieces.push(current);
  return pieces.join(CRLF);
}

function utcStamp(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("calendar DTSTAMP must be a valid instant");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function utcDateTime(value: number): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function localDateTime(value: number, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("calendar event time must be a valid instant");
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
  } catch {
    throw new Error(`calendar timezone is not supported: ${timezone}`);
  }
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function vtimezone(timezone: string): string[] {
  if (timezone === "America/New_York") {
    return [
      "BEGIN:VTIMEZONE",
      "TZID:America/New_York",
      "X-LIC-LOCATION:America/New_York",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "TZNAME:EDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "TZNAME:EST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }

  if (timezone === "America/Los_Angeles") {
    return [
      "BEGIN:VTIMEZONE",
      "TZID:America/Los_Angeles",
      "X-LIC-LOCATION:America/Los_Angeles",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0800",
      "TZOFFSETTO:-0700",
      "TZNAME:PDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0800",
      "TZNAME:PST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }

  if (timezone === "Europe/London") {
    return [
      "BEGIN:VTIMEZONE",
      "TZID:Europe/London",
      "X-LIC-LOCATION:Europe/London",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:+0000",
      "TZOFFSETTO:+0100",
      "TZNAME:BST",
      "DTSTART:19700329T010000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0000",
      "TZNAME:GMT",
      "DTSTART:19701025T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }

  if (timezone === "UTC" || timezone === "Etc/UTC") {
    return [
      "BEGIN:VTIMEZONE",
      `TZID:${timezone}`,
      `X-LIC-LOCATION:${timezone}`,
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0000",
      "TZOFFSETTO:+0000",
      "TZNAME:UTC",
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }

  // The event settings UI currently offers the zones above. Keep a valid
  // fixed-offset component for an imported IANA zone rather than emitting a
  // TZID with no matching VTIMEZONE at all.
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${escapeIcsText(timezone)}`,
    `X-LIC-LOCATION:${escapeIcsText(timezone)}`,
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0000",
    "TZOFFSETTO:+0000",
    "TZNAME:UTC",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

export function calendarUid(submissionId: Id, personId: Id): string {
  return `${submissionId}.${personId}@marquee.stage11.dev`;
}

export function buildCalendarIcs(input: CalendarEventInput): string {
  if (!Number.isInteger(input.sequence) || input.sequence < 0) throw new Error("calendar sequence must be a non-negative integer");
  if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) throw new Error("calendar duration must be a positive integer");
  const attendeeEmail = assertSafeEmail(input.attendeeEmail);
  const organizerEmail = assertSafeEmail(input.organizerEmail ?? ORGANIZER_EMAIL);
  const status = input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const end = input.startsAt + input.durationMin * 60_000;
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Stage 11//Marquee//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    ...vtimezone(input.timezone),
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${utcStamp(input.dtstamp)}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTART;TZID=${input.timezone}:${localDateTime(input.startsAt, input.timezone)}`,
    `DTEND;TZID=${input.timezone}:${localDateTime(end, input.timezone)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description ?? input.title)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
    `URL:${input.url}`,
    `ORGANIZER;CN=${quoteParameter(input.organizerName ?? "Marquee")}:mailto:${organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${quoteParameter(input.attendeeName)}:mailto:${attendeeEmail}`,
    `STATUS:${status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

export function buildCalendarLinks(input: {
  description?: string;
  durationMin: number;
  location: string;
  origin?: string;
  startsAt: number;
  timezone: string;
  title: string;
  uid: string;
}): CalendarLinks {
  const end = input.startsAt + input.durationMin * 60_000;
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", input.title);
  google.searchParams.set("dates", `${utcDateTime(input.startsAt)}/${utcDateTime(end)}`);
  google.searchParams.set("details", input.description ?? input.title);
  google.searchParams.set("location", input.location);
  google.searchParams.set("ctz", input.timezone);

  const outlook = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", input.title);
  outlook.searchParams.set("startdt", new Date(input.startsAt).toISOString());
  outlook.searchParams.set("enddt", new Date(end).toISOString());
  outlook.searchParams.set("body", input.description ?? input.title);
  outlook.searchParams.set("location", input.location);

  const origin = (input.origin ?? ICS_ORIGIN).replace(/\/+$/, "");
  return {
    google: google.toString(),
    outlook: outlook.toString(),
    stable: `${origin}/i/${encodeURIComponent(input.uid)}.ics`,
  };
}

function normalizeMimeBody(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", CRLF);
}

/** Build the RFC 6047-style alternative used by the SMTP oracle and fixtures. */
export function buildMultipartAlternative(input: {
  html: string;
  icsBody: string;
  method: CalendarMethod;
  plain: string;
  uid: string;
}): string {
  const boundary = `marquee-calendar-${input.method.toLowerCase()}-${input.uid.replaceAll(/[^A-Za-z0-9]/g, "-")}`;
  const part = (headers: string[], body: string): string => `${headers.join(CRLF)}${CRLF}${CRLF}${normalizeMimeBody(body)}`;
  return [
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    part(["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit"], input.plain),
    `--${boundary}`,
    part(["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit"], input.html),
    `--${boundary}`,
    part([
      `Content-Type: text/calendar; charset=utf-8; method=${input.method}; name="invite.ics"`,
      "Content-Transfer-Encoding: 8bit",
      'Content-Disposition: inline; filename="invite.ics"',
    ], input.icsBody),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function buildCalendarMail(input: CalendarEventInput & { origin?: string }): CalendarMailMaterial {
  const links = buildCalendarLinks({
    description: input.description,
    durationMin: input.durationMin,
    location: input.location,
    origin: input.origin,
    startsAt: input.startsAt,
    timezone: input.timezone,
    title: input.title,
    uid: input.uid,
  });
  const action = input.method === "CANCEL"
    ? "This calendar invitation has been cancelled."
    : input.sequence === 0
      ? "You are invited to this session."
      : "This calendar invitation has been updated.";
  const subject = input.method === "CANCEL"
    ? `Cancelled: ${input.title}`
    : input.sequence === 0
      ? `Calendar invitation: ${input.title}`
      : `Updated calendar invitation: ${input.title}`;
  const text = [
    action,
    input.title,
    `Location: ${input.location}`,
    `Add to Google Calendar: ${links.google}`,
    `Add to Outlook: ${links.outlook}`,
    `Calendar file: ${links.stable}`,
  ].join("\n\n");
  const html = `<p>${escapeHtml(action)}</p><p><strong>${escapeHtml(input.title)}</strong><br>${escapeHtml(input.location)}</p><p><a href="${escapeHtml(links.google)}">Add to Google Calendar</a><br><a href="${escapeHtml(links.outlook)}">Add to Outlook</a><br><a href="${escapeHtml(links.stable)}">Download calendar file</a></p>`;
  const icsBody = buildCalendarIcs(input);
  return {
    html,
    icsBody,
    links,
    mime: buildMultipartAlternative({ html, icsBody, method: input.method, plain: text, uid: input.uid }),
    subject,
    text,
  };
}

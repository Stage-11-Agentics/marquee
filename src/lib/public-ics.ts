import type { PublicEmbedData } from "./public-site";
import { escapeIcsText, foldIcsLine } from "../jobs/calendar/ics";

const CRLF = "\r\n";

function utcDateTime(value: number): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Build a read-only PUBLISH feed from the same published rows as the embed. */
export function buildPublicCalendarFeed(data: PublicEmbedData, origin: string, now = Date.now()): string {
  const base = origin.replace(/\/+$/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Stage 11//Marquee Public Embed//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(data.event.name)}`,
    `X-WR-TIMEZONE:${escapeIcsText(data.event.timezone)}`,
  ];

  for (const session of data.sessions) {
    const end = session.startsAt + session.durationMin * 60_000;
    const sessionUrl = `${base}/s/${encodeURIComponent(session.slug)}?event=${encodeURIComponent(data.event.slug)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${session.id}@marquee.stage11.dev`)}`,
      `DTSTAMP:${utcDateTime(now)}`,
      `DTSTART:${utcDateTime(session.startsAt)}`,
      `DTEND:${utcDateTime(end)}`,
      `SUMMARY:${escapeIcsText(session.title)}`,
      `DESCRIPTION:${escapeIcsText(session.abstract ?? session.title)}`,
      `LOCATION:${escapeIcsText(session.roomLabel)}`,
      `URL:${sessionUrl}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

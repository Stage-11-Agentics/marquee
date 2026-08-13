/**
 * The calendar face of the public program: one place that turns published
 * sessions into calendar artifacts, so a single-session download, a starred
 * set's `.ics`, and the live webcal feed can never describe the same session
 * differently.
 */
import { buildCalendarLinks, buildPublishedCalendar, type CalendarLinks } from "../jobs/calendar/ics";
import type { PublicEvent, PublicSession } from "./public-site";

const CALENDAR_DESCRIPTION_CHARS = 600;

/** `Room · Building, Address` — as much of the venue as the event actually knows. */
export function sessionLocation(session: PublicSession): string {
  return [
    session.building ? `${session.room} · ${session.building}` : session.room,
    session.buildingAddress,
  ].filter(Boolean).join(", ");
}

/** Stable across every artifact: re-downloading updates the event rather than duplicating it. */
export function sessionCalendarUid(session: PublicSession): string {
  return `${session.id}@marquee.stage11.dev`;
}

export function sessionCalendarUrl(session: PublicSession, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${encodeURIComponent(session.slug)}`;
}

/**
 * What a calendar client shows in the event body: who is speaking, then as much
 * abstract as belongs in a calendar entry. The full text lives at the URL the
 * VEVENT carries — an unbounded abstract in a calendar description is a wall of
 * text on a phone's lock screen.
 */
export function sessionCalendarDescription(session: PublicSession): string {
  const speakers = session.speakers.map((speaker) => speaker.name).join(", ");
  // Paragraph breaks survive — a calendar client renders a multi-line body, and
  // an abstract flattened to one paragraph reads worse for no gain.
  const abstract = (session.abstract ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[^\S\n]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  const trimmed = abstract.length > CALENDAR_DESCRIPTION_CHARS
    ? `${abstract.slice(0, CALENDAR_DESCRIPTION_CHARS).replace(/\s+\S*$/, "")}…`
    : abstract;
  return [speakers ? `With ${speakers}.` : "", trimmed].filter(Boolean).join("\n\n") || session.title;
}

export function publicSessionCalendar(input: {
  calendarName: string;
  event: PublicEvent;
  now: number | Date;
  origin: string;
  sessions: readonly PublicSession[];
}): string {
  return buildPublishedCalendar({
    calendarName: input.calendarName,
    dtstamp: input.now,
    timezone: input.event.timezone,
    events: input.sessions.map((session) => ({
      description: sessionCalendarDescription(session),
      durationMin: session.durationMin,
      location: sessionLocation(session),
      startsAt: session.startsAt,
      title: session.title,
      uid: sessionCalendarUid(session),
      url: sessionCalendarUrl(session, input.origin),
    })),
  });
}

/** Google and Outlook "add this one event" links, built server-side into the SSR page. */
export function sessionCalendarLinks(session: PublicSession, event: PublicEvent, origin: string): CalendarLinks {
  return buildCalendarLinks({
    description: sessionCalendarDescription(session),
    durationMin: session.durationMin,
    location: sessionLocation(session),
    origin,
    startsAt: session.startsAt,
    timezone: event.timezone,
    title: session.title,
    uid: sessionCalendarUid(session),
  });
}

/**
 * "Getting there" as a thing an attendee can act on: the building's own
 * address as a directions destination, not a line of text to retype into Maps.
 */
export function sessionDirectionsUrl(session: PublicSession): string | null {
  const destination = [session.building, session.buildingAddress].filter(Boolean).join(", ");
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

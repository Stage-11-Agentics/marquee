/**
 * The speaker cross-over: if the address someone verified belongs to a speaker
 * at this conference, their own sessions pin into their schedule.
 *
 * There is no login here and no portal dependency. The CRM already knows —
 * attendees and speakers are the same `people` table, which is the whole
 * argument for attendees-in-the-CRM made visible to the attendee themselves —
 * so a verified email is the entire rail.
 *
 * Two rules keep this honest, both ruled in round 4:
 *
 *   - **Derived, never stored.** A pin is computed at render from the person
 *     match. It never enters the code's `session_ids`, so unstarring cannot
 *     touch it, a stale pin cannot outlive a programme change, and nobody's
 *     picks silently grow a session they did not choose.
 *   - **Absent from the shared link.** A friend importing your picks must not
 *     inherit "you're speaking". The read-only view of a code has no write key,
 *     and pins are only ever derived for a caller who presents one.
 *
 * A public session already carries its speakers' person ids, so this is a
 * filter over the agenda the caller has loaded — not a second query.
 */
import type { PublicSession } from "./public-site";

export function speakingSessionIds(
  sessions: readonly PublicSession[],
  personId: string | null | undefined,
): string[] {
  if (!personId) return [];
  return sessions
    .filter((session) => session.speakers.some((speaker) => speaker.id === personId))
    .sort((left, right) => left.startsAt - right.startsAt || left.id.localeCompare(right.id))
    .map((session) => session.id);
}

export function speakingSessions(
  sessions: readonly PublicSession[],
  personId: string | null | undefined,
): PublicSession[] {
  const pinned = new Set(speakingSessionIds(sessions, personId));
  return sessions.filter((session) => pinned.has(session.id));
}

/**
 * The starred set plus the pins, in conference order and without duplicates —
 * what an itinerary, a calendar feed, and an agent briefing each need, derived
 * the same way in all three so they cannot disagree about what a day holds.
 */
export function withSpeakingPins(
  starred: readonly PublicSession[],
  sessions: readonly PublicSession[],
  personId: string | null | undefined,
): PublicSession[] {
  const pins = speakingSessions(sessions, personId);
  if (pins.length === 0) return [...starred];
  const merged = new Map<string, PublicSession>();
  for (const session of [...starred, ...pins]) merged.set(session.id, session);
  return [...merged.values()].sort((left, right) => left.startsAt - right.startsAt || left.id.localeCompare(right.id));
}

/**
 * "An organizer is deliberately opening this speaker's portal."
 *
 * The exchange refuses any live magic link presented by a browser already
 * signed in as somebody else — the protection that stops a stray link silently
 * swapping who you are. An organizer clicking "Open portal as this speaker →"
 * trips it, because that navigation is same-origin and carries their own
 * session. The result was a tab that opened and then landed on
 * `/signin?reason=already_signed_in`: still a dead end, one step further along.
 *
 * So the exchange needs to tell the two apart. The distinction is carried on
 * the **link row's server-minted redirect**, not on the URL the caller
 * presents. That is the whole security argument: a preview link is marked
 * preview at mint time, by a route that already checked the caller is an
 * organizer of that conference, and no amount of editing the address bar can
 * turn an ordinary invitation into one. Reading the marker back is still only
 * half of it — the exchange re-checks the live session's authority over the
 * named event before honouring it, so a leaked preview URL is worth nothing to
 * a browser that could not have minted it.
 *
 * (A dedicated magic-link `purpose` would be the more obvious home for this.
 * `magic_links.purpose` carries a CHECK constraint enumerating the four
 * purposes, so a new one is a migration — out of scope for a defect fix, and
 * flagged rather than taken.)
 */

import type { Id } from "../../db/schema";

/**
 * Where a preview lands. `viewing_as=speaker` is what raises the portal's
 * "Viewing as speaker · organizer preview" banner; `eventId` names the
 * conference whose organizers may spend the link, and is the value the portal
 * already reads to scope its snapshot.
 */
export function portalPreviewRedirect(eventId: Id): string {
  return `/portal?viewing_as=speaker&eventId=${encodeURIComponent(eventId)}`;
}

/**
 * The event a preview link was minted for, or null when the redirect is not a
 * preview at all — which is every ordinary invitation, sign-in and task link.
 */
export function portalPreviewEventId(redirectTo: string): Id | null {
  // A relative path by construction (`isSafeRedirectTarget` enforces it at
  // mint time); the base only satisfies the URL parser.
  let parsed: URL;
  try {
    parsed = new URL(redirectTo, "https://marquee.invalid");
  } catch {
    return null;
  }
  if (parsed.pathname !== "/portal") return null;
  if (parsed.searchParams.get("viewing_as") !== "speaker") return null;
  const eventId = parsed.searchParams.get("eventId");
  return eventId && eventId.length > 0 ? eventId : null;
}

/**
 * The organizer's own session id, parked on the preview session so they have a
 * way back to their seat.
 *
 * One browser holds one `mq_session` cookie, so arriving as the speaker
 * necessarily displaces the organizer from every tab they had open. Their
 * session is not revoked, only unseated, and this is the note that says which
 * one to put back. `role_hint` already carries exactly this kind of marker for
 * co-speaker links, and nothing outside `cospeaker_profile:` reads it.
 */
export const PORTAL_PREVIEW_HINT_PREFIX = "portal_preview:";

export function portalPreviewHint(returningSessionId: string): string {
  return `${PORTAL_PREVIEW_HINT_PREFIX}${returningSessionId}`;
}

export function portalPreviewReturnSessionId(roleHint: string | null): string | null {
  if (!roleHint?.startsWith(PORTAL_PREVIEW_HINT_PREFIX)) return null;
  const sessionId = roleHint.slice(PORTAL_PREVIEW_HINT_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(sessionId) ? sessionId : null;
}

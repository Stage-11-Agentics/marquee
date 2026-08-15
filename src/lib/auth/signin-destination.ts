import type { Id, MembershipRole } from "../../db/schema";
import { isSafeRedirectTarget } from "./magic-links";
import { ROLE_HOME } from "./role-home";
export { ROLE_HOME } from "./role-home";

/**
 * Where a sign-in lands, and which conference the mail is attributed to.
 *
 * All three decisions here are pure so they can be tested as the arithmetic
 * they are. Each one is a place where getting it wrong is silent: a magic link
 * that lands a reviewer on an organizer dashboard, an open redirect wearing a
 * `?next=`, or an outbox row filed against the wrong conference.
 *
 * `roleHome` is the only answer to "where does this seat land", and every door
 * reads it — the magic-link exchange, the demo seat, and the landing page's own
 * demo buttons. A door with its own opinion is how the organizer ended up in two
 * different places depending on which one they used.
 */

/** SPEC §4.1's program-staff roles — the seats whose home is the organization. */
const PROGRAM_STAFF_ROLES: readonly string[] = ["owner", "program_lead", "ops"];

/**
 * Seats that are not membership roles at all.
 *
 * A sponsorship contact holds no `memberships` row — they are a `people` row
 * joined to a deal (`sponsorship_contacts`), which is exactly the doctrine that
 * keeps workflow state off `people`. So the fact has to arrive beside the roles
 * rather than inside them.
 */
export interface NonMembershipSeats {
  sponsorContact?: boolean;
}

/**
 * The seat's own home, resolved at mint time from the roles it actually holds.
 * A person with no membership at all is a speaker as far as this is concerned —
 * the portal is the surface that explains itself to someone who has none.
 *
 * The sponsor portal sits below every membership role deliberately. Somebody who
 * is both a speaker and a sponsor contact still lands on `/portal`: that is the
 * surface where the conference is asking things OF them, and it is the one they
 * would be surprised not to see. Their sponsorship is one link away from there.
 */
export function roleHome(roles: readonly string[], seats: NonMembershipSeats = {}): string {
  if (roles.some((role) => PROGRAM_STAFF_ROLES.includes(role))) return ROLE_HOME.staff;
  if (roles.includes("reviewer")) return ROLE_HOME.reviewer;
  if (roles.includes("speaker")) return ROLE_HOME.speaker;
  if (seats.sponsorContact === true) return ROLE_HOME.sponsor;
  return ROLE_HOME.speaker;
}

/**
 * A `?next=` is attacker-supplied until proven otherwise. Same-origin paths
 * only: `//evil.com`, `http://evil.com` and `https://…` all fail the leading
 * `/` test, and `/\evil.com` is rejected too because a backslash is a path
 * separator to enough browsers to make it protocol-relative in practice.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  if (!isSafeRedirectTarget(next)) return null;
  if (next.startsWith("/\\")) return null;
  return stripReservedParams(next);
}

/**
 * Parameters a caller may never set, because the server reads them back as an
 * assertion about who authorised the link.
 *
 * `viewing_as` + `eventId` together are the organizer-preview marker (SPK-07).
 * The exchange reads them off the STORED `redirect_to` and, on the strength of
 * them, lets a signed-in organizer past the already-signed-in guard. The read
 * side is careful — it never consults the URL — but `POST /api/v1/auth/magic-link`
 * is public and writes a caller-supplied redirect verbatim onto the same field.
 * So the marker was forgeable by anyone with an address in the system: request
 * your own login link carrying the marker, forward the mail to an organizer of
 * that conference, and their click unseats them into your session.
 *
 * Proving the read path is safe says nothing about who can WRITE the field.
 * This is the write half.
 */
const RESERVED_REDIRECT_PARAMS: readonly string[] = ["viewing_as"];

/**
 * Drop the reserved parameters from a caller-supplied path, keeping everything
 * else. Lossless for every legitimate caller: a login link has no business
 * carrying a preview marker, and no product surface asks one to.
 *
 * `eventId` is deliberately NOT reserved. The portal reads it to scope itself
 * and the product's own server-minted links carry it (`public-form.routes.ts`
 * mints `/portal?eventId=…`), so reserving it would break real links. Only the
 * PAIR is the marker, and removing either half unmakes it.
 */
function stripReservedParams(next: string): string {
  // A relative path by construction; the base only satisfies the parser.
  let parsed: URL;
  try {
    parsed = new URL(next, "https://marquee.invalid");
  } catch {
    return next;
  }
  let removed = false;
  for (const name of RESERVED_REDIRECT_PARAMS) {
    if (parsed.searchParams.has(name)) {
      parsed.searchParams.delete(name);
      removed = true;
    }
  }
  if (!removed) return next;
  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;
}

/** Where a magic link should land: the caller's safe `?next=`, else the seat's home. */
export function signinRedirect(
  next: string | null | undefined,
  roles: readonly string[],
  seats: NonMembershipSeats = {},
): string {
  return safeNext(next) ?? roleHome(roles, seats);
}

export interface MembershipEventCandidate {
  event_id: Id | null;
  created_at: number;
}

export interface OrgEventCandidate {
  id: Id;
  created_at: number;
}

/**
 * Which conference an org-level sign-in mail is filed against.
 *
 * `outbox.event_id` is NOT NULL and stays that way, so a person-scoped mail
 * still needs an event. The person's most recent membership event is the
 * truthful answer; the org's newest event is the honest fallback for someone
 * who holds no event-scoped seat yet. When the org has no event at all there is
 * no answer, and the caller must mint nothing rather than invent one.
 */
export function pickOutboxEventId(
  membershipEvents: readonly MembershipEventCandidate[],
  orgEvents: readonly OrgEventCandidate[],
): Id | null {
  const membership = [...membershipEvents]
    .filter((row): row is MembershipEventCandidate & { event_id: Id } => row.event_id !== null)
    .sort((left, right) => right.created_at - left.created_at)[0];
  if (membership) return membership.event_id;
  const event = [...orgEvents].sort((left, right) => right.created_at - left.created_at)[0];
  return event?.id ?? null;
}

/** Roles as the membership rows carry them, narrowed for `roleHome`. */
export function rolesOf(memberships: readonly { role: MembershipRole }[]): string[] {
  return memberships.map((membership) => membership.role);
}

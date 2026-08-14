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
 */

/** SPEC §4.1's program-staff roles — the seats whose home is the organizer dashboard. */
const PROGRAM_STAFF_ROLES: readonly string[] = ["owner", "program_lead", "ops"];

/**
 * The seat's own home, resolved at mint time from the roles it actually holds.
 * A person with no membership at all is a speaker as far as this is concerned —
 * the portal is the surface that explains itself to someone who has none.
 */
export function roleHome(roles: readonly string[]): string {
  if (roles.some((role) => PROGRAM_STAFF_ROLES.includes(role))) return ROLE_HOME.staff;
  if (roles.includes("reviewer")) return ROLE_HOME.reviewer;
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
  return next;
}

/** Where a magic link should land: the caller's safe `?next=`, else the seat's home. */
export function signinRedirect(next: string | null | undefined, roles: readonly string[]): string {
  return safeNext(next) ?? roleHome(roles);
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

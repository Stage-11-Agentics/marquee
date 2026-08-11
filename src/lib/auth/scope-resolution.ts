import type { Id, MembershipRole, MembershipRow } from "../../db/schema";
import type { Principal } from "../../api/runtime";
import type { ApiGrant } from "../../api/grants";

/** SPEC §4.1: public < speaker < reviewer < ops < program_lead < owner. */
const ROLE_RANK: Record<MembershipRole, number> = {
  speaker: 1,
  reviewer: 2,
  ops: 3,
  program_lead: 4,
  owner: 5,
};

export function roleRank(role: MembershipRole): number {
  return ROLE_RANK[role];
}

/**
 * Principal is the one canonical authenticated identity shape for both the
 * API pipeline and the legacy Hono auth routes. Keeping this alias here lets
 * MRQ-3's callers retain the AuthContext name without maintaining a second,
 * incompatible union.
 */
export type AuthContext = Exclude<Principal, { kind: "anonymous" }>;
export type SessionAuth = Extract<AuthContext, { kind: "session" }>;
export type ApiTokenAuth = Extract<AuthContext, { kind: "token" }>;

/**
 * Scope resolves from `memberships` only. Reviewer memberships always carry a
 * non-null event_id (schema CHECK), so a reviewer of event A resolves to no
 * role at all on event B — cross-event reviewer access is not inherited
 * (AC-214). Org-wide roles (owner, program_lead, ops) apply to every event in
 * the org.
 */
export function roleForEvent(
  memberships: readonly MembershipRow[],
  eventId: Id,
): MembershipRole | null {
  let best: MembershipRole | null = null;
  for (const membership of memberships) {
    if (membership.event_id !== null && membership.event_id !== eventId) continue;
    if (membership.role === "reviewer" && membership.event_id !== eventId) continue;
    if (best === null || ROLE_RANK[membership.role] > ROLE_RANK[best]) {
      best = membership.role;
    }
  }
  return best;
}

export function authHasRole(
  auth: AuthContext,
  required: MembershipRole,
  eventId: Id,
): boolean {
  if (auth.kind === "session") {
    const role = roleForEvent(auth.memberships, eventId);
    return role !== null && ROLE_RANK[role] >= ROLE_RANK[required];
  }
  const eventGranted =
    auth.eventId === null
      ? auth.eventIds.length === 0 || auth.eventIds.includes(eventId)
      : auth.eventId === eventId;
  if (!eventGranted) return false;
  const minimumGrantByRole: Record<MembershipRole, ApiGrant> = {
    speaker: "speaker:write",
    reviewer: "review:write",
    ops: "program:read",
    program_lead: "program:write",
    owner: "program:write",
  };
  const rolePermission = auth.permissions.find(
    (permission): permission is MembershipRole => permission in ROLE_RANK,
  );
  return (
    (rolePermission !== undefined && ROLE_RANK[rolePermission] >= ROLE_RANK[required]) ||
    auth.grants.includes(minimumGrantByRole[required])
  );
}

export async function loadMemberships(
  db: D1Database,
  personId: Id,
): Promise<MembershipRow[]> {
  const result = await db
    .prepare("SELECT * FROM memberships WHERE person_id = ?")
    .bind(personId)
    .all<MembershipRow>();
  return result.results;
}

import type { ApiTokenRow, ApiTokenScopes, Id, MembershipRole, MembershipRow } from "../../db/schema";

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

export interface SessionAuth {
  kind: "session";
  sessionId: Id;
  personId: Id;
  orgId: Id;
  memberships: MembershipRow[];
}

export interface ApiTokenAuth {
  kind: "api_token";
  token: ApiTokenRow;
  scopes: ApiTokenScopes;
}

export type AuthContext = SessionAuth | ApiTokenAuth;

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
  const { token, scopes } = auth;
  if (token.revoked_at !== null) return false;
  const eventGranted =
    token.event_id === null
      ? scopes.event_ids.length === 0 || scopes.event_ids.includes(eventId)
      : token.event_id === eventId;
  if (!eventGranted) return false;
  return scopes.permissions.some(
    (permission) =>
      permission in ROLE_RANK &&
      ROLE_RANK[permission as MembershipRole] >= ROLE_RANK[required],
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

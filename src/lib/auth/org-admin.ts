import type { Context } from "hono";

import { ApiError } from "../../api/errors";
import type { ApiGrant } from "../../api/grants";
import type { ApiEnv } from "../../api/runtime";
import { getAuth } from "./auth-middleware";
import { roleRank, type AuthContext } from "./scope-resolution";

/**
 * Authorization for the routes that belong to the INSTANCE rather than to one
 * conference: creating a conference, inviting an organizer, reading instance
 * status, removing the demo.
 *
 * The pipeline's `grants` policy resolves authority against an `{eventId}` path
 * parameter, which these routes do not have — so they declare `authenticated`
 * and answer the org-level question here, the same way token administration
 * already does. Authority is an organization-wide membership of at least
 * program lead; a bearer token additionally needs the matching grant, so a
 * scoped token cannot exceed the person who issued it.
 */
export function requireOrgAdmin(
  context: Context<ApiEnv>,
  grant: ApiGrant = "program:write",
): AuthContext {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "token" && !auth.grants.includes(grant)) {
    throw ApiError.forbidden(`this credential lacks the required grant: ${grant}`);
  }
  const hasOrgWideAdmin = auth.memberships.some(
    (membership) =>
      membership.org_id === auth.orgId &&
      membership.event_id === null &&
      roleRank(membership.role) >= roleRank("program_lead"),
  );
  if (!hasOrgWideAdmin) {
    throw ApiError.forbidden("this action requires an organization owner or program lead");
  }
  return auth;
}

/** Owner-only actions: organizer removal and demo removal are not delegable downward. */
export function requireOrgOwner(context: Context<ApiEnv>): AuthContext {
  const auth = requireOrgAdmin(context);
  const isOwner = auth.memberships.some(
    (membership) =>
      membership.org_id === auth.orgId &&
      membership.event_id === null &&
      membership.role === "owner",
  );
  if (!isOwner) throw ApiError.forbidden("this action requires an organization owner");
  return auth;
}

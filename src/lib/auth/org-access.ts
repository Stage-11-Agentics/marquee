/**
 * Access to the organization-level surfaces (People, Lists, the sourcing
 * pipeline).
 *
 * These are not nested inside one conference, so they cannot be authorized by
 * one conference's membership. The rule is the org equivalent of the event
 * rule: an organizer holding `ops` or better anywhere in this organization —
 * whether org-wide or on a single conference — is organizer staff of this
 * organization and sees its people. A reviewer or a speaker is not.
 */
import type { Context } from "hono";

import { ApiError } from "../../api/errors";
import type { ApiEnv } from "../../api/runtime";
import { getAuth } from "./auth-middleware";
import { roleRank, type AuthContext } from "./scope-resolution";

export interface OrgAccess {
  orgId: string;
  /** The acting person, when the credential is a session. */
  personId: string | null;
  kind: AuthContext["kind"];
}

function staffOfOrg(auth: AuthContext, orgId: string): boolean {
  return auth.memberships.some(
    (membership) => membership.org_id === orgId && roleRank(membership.role) >= roleRank("ops"),
  );
}

export function requireOrgAccess(context: Context<ApiEnv>, write = false): OrgAccess {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const orgId = auth.orgId;
  if (!orgId) throw ApiError.forbidden("this credential is not scoped to an organization");
  if (auth.kind === "token" && !auth.grants.includes(write ? "program:write" : "program:read")) {
    throw ApiError.forbidden(`this token lacks the ${write ? "program:write" : "program:read"} grant`);
  }
  if (!staffOfOrg(auth, orgId)) {
    throw ApiError.forbidden("People is limited to this organization's program staff");
  }
  return { orgId, personId: auth.kind === "session" ? auth.personId : null, kind: auth.kind };
}

/**
 * The event id an org-level write is attributed to.
 *
 * `imports`, `outbox`, `audit_log`, and `attachments` all declare
 * `event_id TEXT NOT NULL`. Relaxing that across the schema is a table rebuild
 * in D1 and touches most of the app's queries; while this product is genuinely
 * single-conference-per-org the honest-enough answer is to attribute an
 * org-level action to the organization's existing conference. This is a
 * deliberate, documented shortcut (MRQ-131 boundary), not an oversight — it is
 * the one place that decides it, so the migration has one call site to fix.
 */
export async function orgAttributionEventId(db: D1Database, orgId: string): Promise<string> {
  const row = await db
    .prepare("SELECT id FROM events WHERE org_id = ? ORDER BY starts_on ASC, id ASC LIMIT 1")
    .bind(orgId)
    .first<{ id: string }>();
  if (!row) throw ApiError.unprocessable("this organization has no conference to attribute the action to");
  return row.id;
}

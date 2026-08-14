import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME } from "../cookies";
import { API_GRANTS, type ApiGrant } from "../../api/grants";
import type { ApiTokenRow, ApiTokenScopes, MembershipRole, PersonRow } from "../../db/schema";
import { resolveSession } from "./auth-sessions";
import { constantTimeEqualHex, sha256Hex } from "./random-token";
import { loadMembershipsForOrg, type AuthContext } from "./scope-resolution";

/**
 * One resolver for both credentials (SPEC §4.1): the `mq_session` cookie and
 * `Authorization: Bearer mq_…`. Bearer works with no cookie present (AC-107);
 * revocation of either is immediate because both are row lookups in D1.
 * Populates the `auth` context variable; never rejects on its own — routes
 * decide what requires auth via `requireAuth` / `authHasRole`.
 */
export async function authMiddleware(context: Context, next: Next): Promise<void> {
  const auth = await resolveAuth(context);
  if (auth) context.set("auth", auth);
  await next();
}

export async function resolveAuth(context: Context): Promise<AuthContext | null> {
  const db = context.env.DB as D1Database;

  const authorization = context.req.header("authorization");
  if (authorization !== undefined) {
    const bearer = parseBearerToken(authorization);
    if (!bearer) return null;
    const tokenHash = await sha256Hex(bearer);
    const token = await db
      .prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(tokenHash)
      .first<ApiTokenRow>();
    if (!token) return null;
    const scopes = JSON.parse(token.scopes as string) as ApiTokenScopes;
    // A few pre-MRQ-30 isolated route fixtures define only the old token
    // columns, without created_by. The deployed 0001 schema always has that
    // NOT NULL column; keep the fixture adapter explicit. An unbound token
    // whose human issuer has no organizer seat is the other deliberate
    // exception: organizer removal may explicitly keep it for an integration,
    // so its own stored grants remain live after the issuer's human authority
    // is gone. The default removal revokes the row before this fallback can
    // apply.
    const createdBy = (token as unknown as { created_by?: string }).created_by;
    const actingPersonId = (token as unknown as { acts_as_person_id?: string | null }).acts_as_person_id ?? null;
    let effectivePersonId = createdBy;
    if (actingPersonId !== null) {
      const actingPerson = await db
        .prepare("SELECT id FROM people WHERE id = ? AND org_id = ? AND kind = 'agent'")
        .bind(actingPersonId, token.org_id)
        .first<{ id: string }>();
      if (!actingPerson) return null;
      effectivePersonId = actingPersonId;
    }
    const loadedMemberships = effectivePersonId === undefined ? [] : await loadMembershipsForOrg(db, effectivePersonId, token.org_id);
    const issuerHasOrganizerSeat = loadedMemberships.some((membership) => membership.role !== "speaker");
    const detachedIssuer = createdBy !== undefined && actingPersonId === null && !issuerHasOrganizerSeat;
    const memberships = detachedIssuer ? [] : loadedMemberships;
    await db
      .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
      .bind(Date.now(), token.id)
      .run();
    return {
      kind: "token",
      tokenId: token.id,
      orgId: token.org_id,
      eventId: token.event_id,
      permissions: scopes.permissions,
      grants: scopes.permissions.filter((permission): permission is ApiGrant =>
        (API_GRANTS as readonly string[]).includes(permission),
      ),
      eventIds: scopes.event_ids,
      ...(createdBy === undefined ? {} : { organizationEventIds: await loadOrganizationEventIds(db, token.org_id) }),
      actingPersonId,
      memberships,
      ...(createdBy === undefined || detachedIssuer ? { legacyRole: roleForLegacyPermissions(scopes.permissions) } : {}),
    };
  }

  const sessionId = getCookie(context)[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = await resolveSession(db, sessionId);
  if (!session) return null;
  const person = await db
    .prepare("SELECT * FROM people WHERE id = ?")
    .bind(session.person_id)
    .first<PersonRow>();
  if (!person) return null;
  return {
    kind: "session",
    sessionId: session.id,
    personId: person.id,
    orgId: person.org_id,
    roleHint: session.role_hint,
    memberships: await loadMembershipsForOrg(db, person.id, person.org_id),
  };
}

function roleForLegacyPermissions(permissions: readonly string[]): MembershipRole {
  if (permissions.includes("owner") || permissions.includes("mirror:write")) return "owner";
  if (permissions.includes("program:write")) return "program_lead";
  if (permissions.includes("program:read") || permissions.includes("comms:send")) return "ops";
  if (permissions.includes("review:write")) return "reviewer";
  return "speaker";
}

async function loadOrganizationEventIds(db: D1Database, orgId: string): Promise<string[]> {
  const result = await db.prepare("SELECT id FROM events WHERE org_id = ?").bind(orgId).all<{ id: string }>();
  return result.results.map((row) => row.id);
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.startsWith("mq_") && token.length > 3 ? token : null;
}

export function getAuth(context: Context): AuthContext | null {
  return (context.get("auth") as AuthContext | undefined) ?? null;
}

export function unauthorized(context: Context) {
  return context.json(
    { error: { code: "unauthenticated", message: "Authentication required" } },
    401,
  );
}

export function forbidden(context: Context, message = "Insufficient scope for this event") {
  return context.json({ error: { code: "forbidden", message } }, 403);
}

/** Exported for tests and for A-5's constant-time-compare enumeration. */
export { constantTimeEqualHex };

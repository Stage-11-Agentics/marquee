import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

import { SESSION_COOKIE_NAME } from "../cookies";
import type { ApiTokenScopes, PersonRow } from "../../db/schema";
import { resolveSession } from "./auth-sessions";
import { constantTimeEqualHex, sha256Hex } from "./random-token";
import { loadMemberships, type AuthContext } from "./scope-resolution";

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

  const bearer = parseBearerToken(context.req.header("authorization"));
  if (bearer) {
    const tokenHash = await sha256Hex(bearer);
    const token = await db
      .prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(tokenHash)
      .first();
    if (!token) return null;
    const scopes = JSON.parse(token.scopes as string) as ApiTokenScopes;
    await db
      .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
      .bind(Date.now(), token.id)
      .run();
    return { kind: "api_token", token: token as never, scopes };
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
    memberships: await loadMemberships(db, person.id),
  };
}

function parseBearerToken(header: string | undefined): string | null {
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

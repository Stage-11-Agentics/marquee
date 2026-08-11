import type { AuthSessionRow, Id } from "../../db/schema";
import { mintToken, sha256Hex } from "./random-token";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days.

/**
 * The session id itself is the bearer credential (256-bit random), so it is
 * minted with the same entropy as magic-link tokens. Sessions live in D1 —
 * not KV — so revocation is instant (SPEC §3).
 */
export async function createSession(
  db: D1Database,
  input: { personId: Id; roleHint?: string; userAgent: string; now?: number },
): Promise<AuthSessionRow> {
  const now = input.now ?? Date.now();
  const session: AuthSessionRow = {
    id: mintToken(),
    person_id: input.personId,
    role_hint: input.roleHint ?? null,
    expires_at: now + SESSION_TTL_MS,
    user_agent_hash: await sha256Hex(input.userAgent),
    revoked_at: null,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      `INSERT INTO auth_sessions
        (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      session.id,
      session.person_id,
      session.role_hint,
      session.expires_at,
      session.user_agent_hash,
      session.created_at,
      session.updated_at,
    )
    .run();
  return session;
}

export async function resolveSession(
  db: D1Database,
  sessionId: string,
  now = Date.now(),
): Promise<AuthSessionRow | null> {
  const session = await db
    .prepare(
      `SELECT * FROM auth_sessions
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(sessionId, now)
    .first<AuthSessionRow>();
  return session ?? null;
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, sessionId)
    .run();
}

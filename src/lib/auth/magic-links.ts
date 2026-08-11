import type { Id, MagicLinkPurpose, MagicLinkRow } from "../../db/schema";
import { mintToken, sha256Hex } from "./random-token";

/** SPEC §3: 15 minutes for login; 30 days for draft resume. */
const TTL_BY_PURPOSE: Record<MagicLinkPurpose, number> = {
  login: 15 * 60_000,
  draft_resume: 30 * 24 * 60 * 60_000,
  cospeaker_profile: 30 * 24 * 60 * 60_000,
  task_link: 30 * 24 * 60 * 60_000,
};

export interface MintedMagicLink {
  id: Id;
  /** The raw token. It is returned to the caller exactly once and never stored or logged. */
  token: string;
  redirectTo: string;
}

/**
 * Same-origin paths only: a magic link must never redirect the browser to an
 * attacker-supplied origin.
 */
export function isSafeRedirectTarget(redirectTo: string): boolean {
  return redirectTo.startsWith("/") && !redirectTo.startsWith("//");
}

export async function mintMagicLink(
  db: D1Database,
  input: {
    personId: Id;
    purpose: MagicLinkPurpose;
    redirectTo?: string;
    now?: number;
  },
): Promise<MintedMagicLink> {
  const now = input.now ?? Date.now();
  const redirectTo = input.redirectTo ?? "/";
  if (!isSafeRedirectTarget(redirectTo)) {
    throw new Error(`magic link redirect must be a same-origin path: ${redirectTo}`);
  }
  const id = crypto.randomUUID();
  const token = mintToken();
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO magic_links
        (id, token_hash, person_id, purpose, redirect_to, expires_at, used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      tokenHash,
      input.personId,
      input.purpose,
      redirectTo,
      now + TTL_BY_PURPOSE[input.purpose],
      now,
      now,
    )
    .run();
  return { id, token, redirectTo };
}

/**
 * Single-use and expiring, enforced atomically: the UPDATE only lands when the
 * link is still unused and unexpired, so a raced second exchange gets
 * `changes = 0` and fails. Lookup is by token hash (unique index); the raw
 * token never touches the database or the logs.
 */
export async function consumeMagicLink(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<MagicLinkRow | null> {
  const tokenHash = await sha256Hex(token);
  const link = await db
    .prepare("SELECT * FROM magic_links WHERE token_hash = ?")
    .bind(tokenHash)
    .first<MagicLinkRow>();
  if (!link) return null;
  const consumed = await db
    .prepare(
      `UPDATE magic_links SET used_at = ?, updated_at = ?
       WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(now, now, link.id, now)
    .run();
  if ((consumed.meta.changes ?? 0) !== 1) return null;
  return { ...link, used_at: now, updated_at: now };
}

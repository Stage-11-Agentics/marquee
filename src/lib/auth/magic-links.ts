import {
  PERSONLESS_MAGIC_LINK_PURPOSES,
  type Id,
  type MagicLinkPurpose,
  type MagicLinkRow,
} from "../../db/schema";
import { mintToken, sha256Hex } from "./random-token";

export const PORTAL_INVITE_TTL_MS = 15 * 24 * 60 * 60_000;

/** SPEC §3: 15 minutes for login; portal invitations are reusable for 15 days. */
const TTL_BY_PURPOSE: Record<MagicLinkPurpose, number> = {
  login: 15 * 60_000,
  draft_resume: 30 * 24 * 60 * 60_000,
  cospeaker_profile: 30 * 24 * 60 * 60_000,
  task_link: 30 * 24 * 60 * 60_000,
  claim: 24 * 60 * 60_000,
  org_invite: 7 * 24 * 60 * 60_000,
  portal_invite: PORTAL_INVITE_TTL_MS,
};

/** Purposes whose token is minted before its person exists (SPEC Amendment 19 §3.2). */
export function isPersonlessPurpose(purpose: MagicLinkPurpose): boolean {
  return (PERSONLESS_MAGIC_LINK_PURPOSES as readonly string[]).includes(purpose);
}

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

type MintMagicLinkInput = {
  /** Null exactly for the personless purposes; the schema enforces the pairing. */
  personId: Id | null;
  /** Event-owned credentials carry the conference they grant access to. */
  eventId?: Id | null;
  purpose: MagicLinkPurpose;
  redirectTo?: string;
  now?: number;
};

/**
 * The portal's invitations always know whose they are, so they keep the
 * narrower shape: only the two personless purposes may pass a null, and no
 * speaker-facing caller should be able to reach that door by accident.
 */
type PortalMagicLinkInput = Omit<MintMagicLinkInput, "personId" | "purpose"> & {
  eventId: Id;
  personId: Id;
  /** Organizer previews retain ordinary login's one-time behavior. */
  purpose?: "login" | "portal_invite";
};

async function mintLink(
  db: D1Database,
  input: MintMagicLinkInput,
): Promise<MintedMagicLink> {
  const now = input.now ?? Date.now();
  const redirectTo = input.redirectTo ?? "/";
  if (!isSafeRedirectTarget(redirectTo)) {
    throw new Error(`magic link redirect must be a same-origin path: ${redirectTo}`);
  }
  if (isPersonlessPurpose(input.purpose) !== (input.personId === null)) {
    throw new Error(
      `magic link purpose ${input.purpose} and person binding disagree; the schema CHECK would reject this row`,
    );
  }
  const id = crypto.randomUUID();
  const token = mintToken();
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO magic_links
        (id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      tokenHash,
      input.personId,
      input.eventId ?? null,
      input.purpose,
      redirectTo,
      now + TTL_BY_PURPOSE[input.purpose],
      now,
      now,
    )
    .run();
  return { id, token, redirectTo };
}

export function mintMagicLink(db: D1Database, input: MintMagicLinkInput): Promise<MintedMagicLink> {
  return mintLink(db, input);
}

/** Organizer-only speaker invitations share the auth token writer without adding another route-local writer. */
export function mintPortalMagicLink(db: D1Database, input: PortalMagicLinkInput): Promise<MintedMagicLink> {
  return mintLink(db, { ...input, purpose: input.purpose ?? "portal_invite" });
}

type MagicLinkOptions = {
  purposes?: readonly MagicLinkPurpose[];
  /** Invitations are credentials that may be reopened until they expire. */
  reusablePurposes?: readonly MagicLinkPurpose[];
};

export type MagicLinkState =
  | { status: "live"; link: MagicLinkRow }
  | { status: "expired" | "used" | "invalid"; link: MagicLinkRow | null };

/**
 * Read a token without spending it. Callers that need to show a recovery path
 * must inspect the credential before consuming it; otherwise a refusal can
 * burn the only usable link and leave the person with no way through the door.
 * Purpose mismatches stay deliberately indistinguishable from unknown tokens.
 */
export async function readMagicLink(
  db: D1Database,
  token: string,
  now = Date.now(),
  options: MagicLinkOptions = {},
): Promise<MagicLinkState> {
  const tokenHash = await sha256Hex(token);
  const link = await db
    .prepare("SELECT * FROM magic_links WHERE token_hash = ?")
    .bind(tokenHash)
    .first<MagicLinkRow>();
  if (!link || (options.purposes && !options.purposes.includes(link.purpose))) {
    return { status: "invalid", link: null };
  }
  if (link.used_at !== null) return { status: "used", link };
  if (link.expires_at <= now) return { status: "expired", link };
  return { status: "live", link };
}

export type MagicLinkConsumption =
  | { status: "consumed"; link: MagicLinkRow }
  | { status: "expired" | "used" | "invalid"; link: MagicLinkRow | null };

/**
 * Expiring links are single-use by default, enforced atomically: the UPDATE
 * only lands when the link is still unused and unexpired, so a raced second
 * exchange gets `changes = 0` and fails. Reusable invitation purposes are the
 * deliberate exception and do not write `used_at`. Lookup is by token hash
 * (unique index); the raw token never touches the database or the logs.
 */
async function consumeMagicLinkState(
  db: D1Database,
  token: string,
  now = Date.now(),
  options: MagicLinkOptions = {},
): Promise<MagicLinkConsumption> {
  const state = await readMagicLink(db, token, now, options);
  if (state.status !== "live") return state;
  const link = state.link;
  if (options.reusablePurposes?.includes(link.purpose)) {
    return { status: "consumed", link };
  }
  const consumed = await db
    .prepare(
      `UPDATE magic_links SET used_at = ?, updated_at = ?
       WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(now, now, link.id, now)
    .run();
  if ((consumed.meta.changes ?? 0) === 1) {
    return { status: "consumed", link: { ...link, used_at: now, updated_at: now } };
  }
  // A raced exchange can only have made this row used or expired. Re-read it
  // so the losing browser receives the truthful state instead of a generic
  // expiry message.
  const afterRace = await readMagicLink(db, token, now, options);
  return afterRace.status === "live"
    ? { status: "invalid", link: null }
    : afterRace;
}

export async function consumeMagicLinkWithStatus(
  db: D1Database,
  token: string,
  now = Date.now(),
  options: MagicLinkOptions = {},
): Promise<MagicLinkConsumption> {
  return consumeMagicLinkState(db, token, now, options);
}

export async function consumeMagicLink(
  db: D1Database,
  token: string,
  now = Date.now(),
  options: MagicLinkOptions = {},
): Promise<MagicLinkRow | null> {
  const result = await consumeMagicLinkState(db, token, now, options);
  return result.status === "consumed" ? result.link : null;
}

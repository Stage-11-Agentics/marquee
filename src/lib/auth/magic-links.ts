import {
  PERSONLESS_MAGIC_LINK_PURPOSES,
  type Id,
  type MagicLinkPurpose,
  type MagicLinkRow,
  type MembershipRole,
} from "../../db/schema";
import { mintToken, sha256Hex } from "./random-token";
import { shortCodeHash } from "./short-code";

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
 * Optional single-statement admission for a credential mint.
 *
 * The caller's quota belongs in the INSERT ... SELECT, not in a preceding
 * COUNT query: D1 serializes the write statement, so two requests cannot both
 * pass the same count and then mint over the cap. The admission count is scoped
 * to the person, event, purpose, and redirect target on the row being minted,
 * so a route-specific door does not consume another login route's allowance.
 */
export type MagicLinkAdmission = {
  maxRows: number;
  createdAfter: number;
};

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
  /** The seat an `org_invite` mints. Decided at mint by the inviter, never by the recipient. */
  invite?: { role: MembershipRole; eventId: Id | null; orgId: Id };
  /** The speakable second credential (ruling O4). Stored hashed; the raw value is the caller's to return once. */
  shortCode?: string;
};

/** An atomic quota is a distinct input shape because it can return no row. */
type AdmittedMintMagicLinkInput = MintMagicLinkInput & {
  eventId: Id;
  admission: MagicLinkAdmission;
};

/**
 * The portal's invitations always know whose they are, so they keep the
 * narrower shape: only the two personless purposes may pass a null, and no
 * speaker-facing caller should be able to reach that door by accident.
 */
type PortalMagicLinkInput = Omit<
  MintMagicLinkInput,
  "personId" | "purpose" | "invite" | "shortCode"
> & {
  eventId: Id;
  personId: Id;
  /** Organizer previews retain ordinary login's one-time behavior. */
  purpose?: "login" | "portal_invite";
};

async function mintLink(
  db: D1Database,
  input: MintMagicLinkInput,
): Promise<MintedMagicLink> {
  const minted = await mintLinkWithAdmission(db, input);
  if (!minted) throw new Error("magic link admission denied");
  return minted;
}

async function mintLinkWithAdmission(
  db: D1Database,
  input: MintMagicLinkInput | AdmittedMintMagicLinkInput,
): Promise<MintedMagicLink | null> {
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
  // A malformed short code must never reach the column: the door resolves rows
  // by this hash, and a row carrying a hash of something unspeakable is a live
  // credential nobody can present and nobody can revoke by hand.
  const codeHash = input.shortCode === undefined ? null : await shortCodeHash(input.shortCode);
  if (input.shortCode !== undefined && codeHash === null) {
    throw new Error("magic link short code is not a well-formed code");
  }
  const admittedInput = "admission" in input ? input : null;
  const insert = admittedInput
    ? db
      .prepare(
        `INSERT INTO magic_links
          (id, token_hash, short_code_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at,
           invite_role, invite_event_id, invite_org_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
         WHERE (
           SELECT COUNT(*) FROM magic_links
           WHERE person_id = ? AND event_id = ? AND purpose = ? AND redirect_to = ? AND created_at > ?
         ) < ?`,
      )
      .bind(
        id,
        tokenHash,
        codeHash,
        input.personId,
        input.eventId ?? null,
        input.purpose,
        redirectTo,
        now + TTL_BY_PURPOSE[input.purpose],
        input.invite?.role ?? null,
        input.invite?.eventId ?? null,
        input.invite?.orgId ?? null,
        now,
        now,
        input.personId,
        admittedInput.eventId,
        input.purpose,
        redirectTo,
        admittedInput.admission.createdAfter,
        admittedInput.admission.maxRows,
      )
    : db
      .prepare(
        `INSERT INTO magic_links
          (id, token_hash, short_code_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at,
           invite_role, invite_event_id, invite_org_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        tokenHash,
        codeHash,
        input.personId,
        input.eventId ?? null,
        input.purpose,
        redirectTo,
        now + TTL_BY_PURPOSE[input.purpose],
        input.invite?.role ?? null,
        input.invite?.eventId ?? null,
        input.invite?.orgId ?? null,
        now,
        now,
      );
  const result = await insert.run();
  if (admittedInput) {
    const changes = result.meta.changes;
    if (changes === undefined || changes === null) {
      throw new Error("magic link quota admission did not report inserted row count");
    }
    if (Number(changes) !== 1) return null;
  }
  return { id, token, redirectTo };
}

/** The ordinary mint is non-null; an admitted mint returns null when its quota is full. */
export function mintMagicLink(
  db: D1Database,
  input: AdmittedMintMagicLinkInput,
): Promise<MintedMagicLink | null>;
export function mintMagicLink(db: D1Database, input: MintMagicLinkInput): Promise<MintedMagicLink>;
export function mintMagicLink(
  db: D1Database,
  input: MintMagicLinkInput | AdmittedMintMagicLinkInput,
): Promise<MintedMagicLink | null> {
  return "admission" in input ? mintLinkWithAdmission(db, input) : mintLink(db, input);
}

/** Organizer-only speaker invitations share the auth token writer without adding another route-local writer. */
export function mintPortalMagicLink(db: D1Database, input: PortalMagicLinkInput): Promise<MintedMagicLink> {
  return mintLink(db, { ...input, purpose: input.purpose ?? "portal_invite" });
}

/**
 * A draft reminder becomes the canonical long-lived resume capability only
 * after the holder submits through it. The same row remains reusable and
 * revocable; promotion never changes its token hash or `used_at` state.
 */
export async function promoteMagicLinkToResumeCapability(
  db: D1Database,
  linkId: Id,
  now = Date.now(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE magic_links
       SET expires_at = ?, updated_at = ?
       WHERE id = ? AND purpose = 'draft_resume' AND used_at IS NULL`,
    )
    .bind(Number.MAX_SAFE_INTEGER, now, linkId)
    .run();
  return (result.meta.changes ?? 0) === 1;
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
 * One credential string, two possible forms, one row.
 *
 * The long token is tried first because it is what every purpose has and what
 * every automated caller presents. The short code is tried only when the string
 * actually parses as one (`normalizeShortCode` refuses anything else), so a
 * mistyped token costs one lookup rather than two and no arbitrary string ever
 * reaches the second index. Both columns hold a SHA-256 hex digest of the
 * credential and nothing else; the raw values live only in the response that
 * minted them.
 */
async function findLink(db: D1Database, credential: string): Promise<MagicLinkRow | null> {
  const byToken = await db
    .prepare("SELECT * FROM magic_links WHERE token_hash = ?")
    .bind(await sha256Hex(credential))
    .first<MagicLinkRow>();
  if (byToken) return byToken;
  const codeHash = await shortCodeHash(credential);
  if (codeHash === null) return null;
  return db
    .prepare("SELECT * FROM magic_links WHERE short_code_hash = ?")
    .bind(codeHash)
    .first<MagicLinkRow>();
}

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
  const link = await findLink(db, token);
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

/**
 * The day-of credentials: named, event-scoped, held by nobody.
 *
 * Everything else this product mints names a person — a sign-in link, a portal
 * invitation, an API token acting as a seat. These name a *post*: "Sam, front
 * door", "the crew". The holder is whoever has the phone, which is the point on
 * a show day, and it is also why the only safety this design has is revocation:
 * the link cannot be taken back from an individual, so it has to be killable as
 * a whole, instantly, from a list an organizer can read.
 *
 * Two kinds, one table, one door (migration 0039). `green_room` reads the run
 * of show. `checkin` reads it and may mark a speaker arrived — nothing else,
 * ever: authority here is a ladder of exactly two rungs, and no route outside
 * `day-of.routes.ts` accepts one of these tokens at all.
 */
import { newUlid } from "../../api/ids";
import type { DayOfLinkKind, DayOfLinkRow, Id } from "../../db/schema";
import { mintToken, sha256Hex } from "../auth/random-token";

export interface MintedDayOfLink {
  id: Id;
  /** Returned to the caller exactly once. Never stored, never logged. */
  token: string;
  row: DayOfLinkRow;
}

export interface MintDayOfLinkInput {
  eventId: Id;
  kind: DayOfLinkKind;
  name: string;
  createdByPersonId: Id | null;
  now: number;
}

/** The path a holder opens. One shape for both kinds — the row decides authority. */
export function dayOfLinkPath(token: string): string {
  return `/green-room/k/${token}`;
}

export async function mintDayOfLink(
  db: D1Database,
  input: MintDayOfLinkInput,
): Promise<MintedDayOfLink> {
  const id = newUlid(input.now);
  const token = mintToken();
  const row: DayOfLinkRow = {
    id,
    event_id: input.eventId,
    kind: input.kind,
    name: input.name,
    token_hash: await sha256Hex(token),
    created_by_person_id: input.createdByPersonId,
    last_used_at: null,
    revoked_at: null,
    created_at: input.now,
    updated_at: input.now,
  };
  await db
    .prepare(
      `INSERT INTO day_of_links
        (id, event_id, kind, name, token_hash, created_by_person_id, last_used_at, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(id, input.eventId, input.kind, input.name, row.token_hash, input.createdByPersonId, input.now, input.now)
    .run();
  return { id, token, row };
}

/**
 * Resolve a presented token to a live link, or to nothing.
 *
 * "Nothing" covers a token that never existed, one that was revoked, and one
 * whose conference was deleted — deliberately indistinguishable, because the
 * page above this answers all three with the ordinary not-found. A crew member
 * holding a killed link learns that it does not work, and learns nothing about
 * whether it ever did.
 */
export async function resolveDayOfLink(
  db: D1Database,
  token: string,
): Promise<DayOfLinkRow | null> {
  if (token.length === 0 || token.length > 200) return null;
  const row = await db
    .prepare("SELECT * FROM day_of_links WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(token))
    .first<DayOfLinkRow>();
  return row ?? null;
}

/** A `checkin` link may mark; a `green_room` link may only look. */
export function canMarkArrivals(link: DayOfLinkRow): boolean {
  return link.kind === "checkin";
}

/**
 * How recently a link was used, without paying for a write on every page load.
 *
 * The organizer's list is the only reader, and it wants "used this morning"
 * rather than a millisecond. A five-minute floor makes a crew refreshing the
 * green room every thirty seconds cost one write an hour instead of a hundred.
 */
export const LINK_USE_STAMP_INTERVAL_MS = 5 * 60_000;

export function touchDayOfLinkStatement(
  db: D1Database,
  link: DayOfLinkRow,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE day_of_links SET last_used_at = ?, updated_at = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
    )
    .bind(now, now, link.id, now - LINK_USE_STAMP_INTERVAL_MS);
}

/**
 * End one link.
 *
 * A statement rather than a call, because revocation is written beside its own
 * audit row in a single `batch()` — a credential that dies without a record of
 * who killed it is the half of the story an incident actually needs.
 * `COALESCE` keeps a retried revoke idempotent instead of re-dating history.
 */
export function revokeDayOfLinkStatement(
  db: D1Database,
  input: { linkId: Id; eventId: Id; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE day_of_links SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE id = ? AND event_id = ? AND revoked_at IS NULL`,
    )
    .bind(input.now, input.now, input.linkId, input.eventId);
}

/**
 * End every live share link of one kind for a conference.
 *
 * This is what "rotate" means and why rotation is not simply "mint another":
 * the whole promise of the share link is that one act kills every copy of the
 * URL that is loose in the world — in a group chat, on a printed sheet, in a
 * volunteer's browser history — and a mint that leaves its predecessor alive
 * has revoked nothing.
 */
export function revokeAllDayOfLinksStatement(
  db: D1Database,
  input: { eventId: Id; kind: DayOfLinkKind; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE day_of_links SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE event_id = ? AND kind = ? AND revoked_at IS NULL`,
    )
    .bind(input.now, input.now, input.eventId, input.kind);
}

export async function listDayOfLinks(db: D1Database, eventId: Id): Promise<DayOfLinkRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM day_of_links
        WHERE event_id = ?
        ORDER BY revoked_at IS NOT NULL ASC, created_at DESC, id DESC`,
    )
    .bind(eventId)
    .all<DayOfLinkRow>();
  return rows.results;
}

/** Metadata only — the token hash never leaves this module. */
export interface DayOfLinkSummary {
  id: string;
  kind: DayOfLinkKind;
  name: string;
  created_at: number;
  created_by_person_id: string | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export function summarizeDayOfLink(row: DayOfLinkRow): DayOfLinkSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    created_at: row.created_at,
    created_by_person_id: row.created_by_person_id,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

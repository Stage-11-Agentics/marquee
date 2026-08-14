/**
 * "Get it by email" — the opt-in claim.
 *
 * It is not an account, and it is not a login. It attaches an email address to
 * a schedule code so the code can be recovered on a device that has never seen
 * it, and — because the organizer's CRM is the same `people` table their
 * speakers live in — it is how an attendee enters that record at all.
 *
 * The shape is request → verify, and the reason is impersonation. Typing an
 * address must not be enough: the speaker cross-over means a claim on a
 * speaker's address would otherwise conjure that speaker's sessions into a
 * stranger's schedule and attribute a stranger's picks to them. So pressing
 * Send only sends mail. Opening the mailed link is what writes a person, an
 * attendance row, and the identity the page then shows — proof of the address,
 * bought with a click the attendee was going to make anyway, because the mail
 * carries the link they asked for.
 *
 * Unlinking is the same promise read backwards, and it is deliberately narrow:
 * it removes what the claim created and only that. An organizer's imported
 * ticket-holder is not the attendee's to delete.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { newUlid } from "../api/ids";
import { constantTimeEqualHex, mintToken, sha256Hex } from "./auth/random-token";
import type { Id, ScheduleClaimRow } from "../db/schema";
import { upsertAttendance } from "./event-attendances";
import { personReferences } from "./person-references";

/** 32 bytes, hashed at rest; the raw value exists only in the mail. */
export function newClaimToken(): string {
  return mintToken();
}

export const hashClaimToken = sha256Hex;

/**
 * `m…a@example.com`. The domain stays whole — it is what tells someone which of
 * their addresses they used, which is the entire question the identity line
 * answers — and the local part keeps only its ends.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const masked = local.length > 2 ? `${local[0]}…${local[local.length - 1]}` : local;
  return `${masked}@${domain}`;
}

export function normalizeClaimEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** A deliberately plain shape: this crosses to the browser on every itinerary render. */
export interface ClaimState {
  status: "pending" | "verified";
  maskedEmail: string;
  requestedAt: number;
  verifiedAt: number | null;
}

export function claimState(row: ScheduleClaimRow): ClaimState {
  return {
    status: row.verified_at === null ? "pending" : "verified",
    maskedEmail: maskEmail(row.email),
    requestedAt: row.requested_at,
    verifiedAt: row.verified_at,
  };
}

export async function readClaim(database: D1Database, code: string): Promise<ScheduleClaimRow | null> {
  return database
    .prepare(
      `SELECT code, event_id, email, token_hash, person_id, minted_person,
              requested_at, verified_at, created_at, updated_at
         FROM schedule_claims WHERE code = ? LIMIT 1`,
    )
    .bind(code)
    .first<ScheduleClaimRow>();
}

export type ClaimRequestOutcome =
  | { ok: true; token: string; row: ScheduleClaimRow }
  | { ok: false; reason: "already_linked"; maskedEmail: string };

/**
 * Mint a token and record the request. **No CRM write happens here** — that is
 * the whole point of the two-step, and it is worth restating at the one place
 * someone might be tempted to add one.
 *
 * Re-requesting is how "email me my link again" works, so an existing row is
 * re-tokened rather than duplicated, and a verified claim stays verified: the
 * attendee asking for their link again has not stopped being who they were.
 * Changing the address on a verified claim is refused instead of silently
 * re-pointing an identity — unlink first, which says out loud what it removes.
 */
export async function requestClaim(
  database: D1Database,
  input: { code: string; eventId: Id; email: string; now: number },
): Promise<ClaimRequestOutcome> {
  const email = normalizeClaimEmail(input.email);
  const token = newClaimToken();
  const tokenHash = await hashClaimToken(token);
  const existing = await readClaim(database, input.code);
  if (existing && existing.verified_at !== null && normalizeClaimEmail(existing.email) !== email) {
    return { ok: false, reason: "already_linked", maskedEmail: maskEmail(existing.email) };
  }
  // A pending row whose address changed is simply a corrected typo: replace it.
  const keepsVerification = existing !== null
    && existing.verified_at !== null
    && normalizeClaimEmail(existing.email) === email;
  await database
    .prepare(
      `INSERT INTO schedule_claims
         (code, event_id, email, token_hash, person_id, minted_person, requested_at, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         email = excluded.email,
         token_hash = excluded.token_hash,
         requested_at = excluded.requested_at,
         person_id = CASE WHEN ? THEN schedule_claims.person_id ELSE NULL END,
         minted_person = CASE WHEN ? THEN schedule_claims.minted_person ELSE 0 END,
         verified_at = CASE WHEN ? THEN schedule_claims.verified_at ELSE NULL END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.code, input.eventId, email, tokenHash, input.now, input.now, input.now,
      keepsVerification ? 1 : 0, keepsVerification ? 1 : 0, keepsVerification ? 1 : 0,
    )
    .run();
  const row = await readClaim(database, input.code);
  if (!row) throw new Error("claim row vanished immediately after it was written");
  return { ok: true, token, row };
}

export type ClaimVerifyOutcome =
  | { ok: true; row: ScheduleClaimRow; personId: Id; alreadyVerified: boolean }
  | { ok: false; reason: "unknown" | "bad_token" };

/**
 * The moment identity exists. Upsert the person by email inside the event's
 * organization — a returning speaker is matched, never duplicated, which is
 * exactly the continuity attendees-in-the-CRM exists for — then write the
 * attendance row that says they are coming to this conference.
 *
 * Opening the same link twice is not an error. The mail is the only copy of
 * the token and people open mail more than once; the second open answers with
 * the state the first one created.
 */
export async function verifyClaim(
  database: D1Database,
  input: { code: string; token: string; now: number },
): Promise<ClaimVerifyOutcome> {
  const row = await readClaim(database, input.code);
  if (!row) return { ok: false, reason: "unknown" };
  const presented = await hashClaimToken(input.token);
  if (!constantTimeEqualHex(presented, row.token_hash)) return { ok: false, reason: "bad_token" };
  if (row.verified_at !== null && row.person_id) {
    return { ok: true, row, personId: row.person_id, alreadyVerified: true };
  }

  const event = await database
    .prepare("SELECT org_id FROM events WHERE id = ? LIMIT 1")
    .bind(row.event_id)
    .first<{ org_id: string }>();
  if (!event) return { ok: false, reason: "unknown" };

  const existingPerson = await database
    .prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = ? LIMIT 1")
    .bind(event.org_id, normalizeClaimEmail(row.email))
    .first<{ id: string }>();
  const personId = existingPerson?.id ?? newUlid(input.now);
  const mintedPerson = existingPerson ? 0 : 1;
  if (!existingPerson) {
    // The name is the address until the person tells us otherwise. Inventing a
    // display name from the local part would put a guess in the organizer's
    // record and make it look like something the attendee typed.
    await database
      .prepare(
        `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, ?, ?)`,
      )
      .bind(personId, event.org_id, row.email, row.email, input.now, input.now)
      .run();
  }

  await upsertAttendance(database, {
    eventId: row.event_id,
    personId,
    source: "claim",
    scheduleCode: row.code,
    verifiedAt: input.now,
    now: input.now,
  });

  await database
    .prepare(
      `UPDATE schedule_claims
          SET person_id = ?, minted_person = ?, verified_at = ?, updated_at = ?
        WHERE code = ?`,
    )
    .bind(personId, mintedPerson, input.now, input.now, row.code)
    .run();

  const verified = await readClaim(database, row.code);
  return { ok: true, row: verified ?? row, personId, alreadyVerified: false };
}

export interface UnlinkOutcome {
  unlinked: boolean;
  attendanceRemoved: boolean;
  personRemoved: boolean;
}

/**
 * Three deletions, each with its own condition, in the order the conditions
 * depend on:
 *
 *   1. the email↔code linkage, always — it is what the attendee attached;
 *   2. the claim-sourced attendance row, always — an import-sourced row for the
 *      same person and conference is a different row and is never touched;
 *   3. the person, only if this claim minted them and nothing else now points
 *      at them. Someone the organizer imported, or who spoke last year, or who
 *      is attending a second conference, stays.
 *
 * The attendance row goes before the reference check on purpose: attendances
 * are themselves a reference, so checking first would always answer "something
 * still points at this person" and rule 3 would never fire.
 */
export async function unlinkClaim(
  database: D1Database,
  input: { code: string },
): Promise<UnlinkOutcome> {
  const row = await readClaim(database, input.code);
  if (!row) return { unlinked: false, attendanceRemoved: false, personRemoved: false };

  await database.prepare("DELETE FROM schedule_claims WHERE code = ?").bind(row.code).run();

  let attendanceRemoved = false;
  let personRemoved = false;
  if (row.person_id) {
    const removal = await database
      .prepare("DELETE FROM event_attendances WHERE person_id = ? AND event_id = ? AND source = 'claim'")
      .bind(row.person_id, row.event_id)
      .run();
    attendanceRemoved = (removal.meta?.changes ?? 0) > 0;

    if (row.minted_person === 1) {
      const references = await personReferences(database, row.person_id);
      if (references.length === 0) {
        await database.prepare("DELETE FROM people WHERE id = ?").bind(row.person_id).run();
        personRemoved = true;
      }
    }
  }
  return { unlinked: true, attendanceRemoved, personRemoved };
}

/** Exactly the sentence the attendee is owed, and no softer. */
export const UNLINK_CONFIRMATION = "Unlinked — your email and picks are removed from the organizers' records.";

/**
 * Short-lived, signed capability URLs for the separate media origin.
 *
 * The URL is still intentionally unauthenticated at fetch time: a browser
 * needs to be able to download a speaker's file without carrying the app's
 * session cookie across origins. The signature makes the capability bounded,
 * while the media route re-checks the attachment's current ownership before
 * it serves any bytes.
 *
 * Revocation, not expiry, is what closes the defect: `mediaAttachmentIsActive`
 * runs on every fetch, so a link dies the moment the speaker leaves regardless
 * of how much of its lifetime is left. The TTL is therefore set long enough
 * that it never expires under an organizer who is simply reading the page —
 * the URL is baked into the download anchor when the snapshot renders and
 * nothing refetches it, so a minutes-long TTL turns an open tab into a dead
 * download button.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { roleInSql, WORK_HOLDING_PARTICIPATION_ROLES } from "../participants";

export const MEDIA_LINK_TTL_MS = 24 * 60 * 60_000;
const MEDIA_LINK_CLOCK_SKEW_MS = 60_000;

export const MEDIA_LINK_POLICY = "short-lived-revocable-capability-url" as const;

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("UPLOAD_TOKEN_SECRET is not configured");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function messageFor(key: string, expiresAt: number): string {
  return `media:${key}:${expiresAt}`;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes.buffer as ArrayBuffer;
}

/** Mint one bounded URL for a ready attachment. */
export async function publicMediaUrl(
  mediaPublicOrigin: string,
  attachment: { status: "ready"; r2_key: string },
  signingSecret: string,
  nowMs = Date.now(),
): Promise<string> {
  if (attachment.status !== "ready") throw new Error("only ready attachments can receive media links");
  const expiresAt = nowMs + MEDIA_LINK_TTL_MS;
  const signature = hex(await crypto.subtle.sign("HMAC", await hmacKey(signingSecret), encoder.encode(messageFor(attachment.r2_key, expiresAt))));
  const origin = mediaPublicOrigin.replace(/\/+$/, "");
  const encodedKey = attachment.r2_key.split("/").map(encodeURIComponent).join("/");
  return `https://${origin}/api/v1/media/${encodedKey}?expires=${expiresAt}&signature=${signature}`;
}

/** Verify the expiry and signature before a media request reaches R2. */
export async function verifyMediaUrl(
  key: string,
  url: URL,
  signingSecret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const expiresAt = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  const signatureBytes = bytesFromHex(signature);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs || expiresAt > nowMs + MEDIA_LINK_TTL_MS + MEDIA_LINK_CLOCK_SKEW_MS || !signatureBytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(signingSecret),
    signatureBytes,
    encoder.encode(messageFor(key, expiresAt)),
  );
}

export interface MediaAttachmentForAccess {
  event_id: string;
  owner_type: "person_headshot" | "task_upload" | "event_logo" | "import_file" | "draft_file" | "submission_file";
  owner_id: string;
}

/**
 * A valid signature is not enough: the owning conference relationship is
 * checked again so a deleted attachment or revoked speaker role cuts a link
 * immediately, even before its normal expiry.
 */
export async function mediaAttachmentIsActive(db: D1Database, attachment: MediaAttachmentForAccess): Promise<boolean> {
  if (attachment.owner_type === "task_upload") {
    const task = await db.prepare(
      `SELECT submission_id, person_id, cancelled_at
         FROM speaker_tasks
        WHERE id = ? AND event_id = ? AND kind = 'file'`,
    ).bind(attachment.owner_id, attachment.event_id).first<{ submission_id: string | null; person_id: string; cancelled_at: number | null }>();
    if (!task || task.cancelled_at !== null) return false;
    if (!task.submission_id) return true;
    const participation = await db.prepare(
      `SELECT 1 AS active
         FROM participations
        WHERE submission_id = ? AND person_id = ?
          AND ${roleInSql("participations", WORK_HOLDING_PARTICIPATION_ROLES)}
          AND confirmation_status <> 'declined'
        LIMIT 1`,
    ).bind(task.submission_id, task.person_id).first<{ active: number }>();
    return Boolean(participation);
  }

  if (attachment.owner_type === "person_headshot") {
    const participation = await db.prepare(
      `SELECT
         EXISTS (
           SELECT 1 FROM participations part
           JOIN submissions submission ON submission.id = part.submission_id
          WHERE submission.event_id = ? AND part.person_id = ?
            AND part.role IN ('speaker', 'co_speaker')
            AND part.confirmation_status <> 'declined'
         ) AS active,
         EXISTS (
           SELECT 1 FROM participations part
           JOIN submissions submission ON submission.id = part.submission_id
          WHERE submission.event_id = ? AND part.person_id = ?
            AND part.role IN ('speaker', 'co_speaker')
         ) AS has_participation`,
    ).bind(attachment.event_id, attachment.owner_id, attachment.event_id, attachment.owner_id).first<{ active: number; has_participation: number }>();
    if (participation?.active) return true;
    if (participation?.has_participation) return false;
    const membership = await db.prepare(
      `SELECT 1 AS active
         FROM memberships
        WHERE event_id = ? AND person_id = ? AND ${roleInSql("memberships", WORK_HOLDING_PARTICIPATION_ROLES)}
          AND confirmation_status <> 'declined'
        LIMIT 1`,
    ).bind(attachment.event_id, attachment.owner_id).first<{ active: number }>();
    return Boolean(membership);
  }

  if (attachment.owner_type === "submission_file") {
    const submission = await db.prepare(
      `SELECT status FROM submissions WHERE id = ? AND event_id = ?`,
    ).bind(attachment.owner_id, attachment.event_id).first<{ status: string }>();
    return Boolean(submission && submission.status !== "withdrawn" && submission.status !== "rejected");
  }

  if (attachment.owner_type === "draft_file") {
    const draft = await db.prepare(
      `SELECT status FROM submissions WHERE id = ? AND event_id = ?`,
    ).bind(attachment.owner_id, attachment.event_id).first<{ status: string }>();
    return draft?.status === "draft";
  }

  // Event logos and import manifests do not belong to a speaker role. Their
  // attachment row, status, ETag and URL expiry are the revocation boundary.
  return true;
}

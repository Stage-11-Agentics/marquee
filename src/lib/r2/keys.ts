/**
 * Opaque, non-user-controlled object keys and stable public URLs. Keys carry
 * event/attachment partitioning plus fresh random entropy; a raw filename
 * never chooses a path (traversal/collision safety by construction).
 */

import type { UploadOwnerType } from "./protocol";

export function randomKeySuffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** `uploads/{eventId}/{ownerType}/{attachmentId}-{entropy}.{ext}` */
export function objectKeyFor(params: {
  eventId: string;
  ownerType: UploadOwnerType;
  attachmentId: string;
  extension: string;
}): string {
  const ext = params.extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `uploads/${params.eventId}/${params.ownerType}/${params.attachmentId}-${randomKeySuffix()}${ext ? `.${ext}` : ""}`;
}

/**
 * Stable separate-origin media URL for a `ready` attachment. Never returns
 * an Airtable URL or the app host (trap 10) — this is the only outbound
 * representation of a stored object.
 */
export function publicMediaUrl(mediaPublicOrigin: string, attachment: {
  status: "ready";
  r2_key: string;
}): string {
  const origin = mediaPublicOrigin.replace(/\/+$/, "");
  const encodedKey = attachment.r2_key.split("/").map(encodeURIComponent).join("/");
  return `https://${origin}/api/v1/media/${encodedKey}`;
}

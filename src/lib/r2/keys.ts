/**
 * Opaque, non-user-controlled object keys. Keys carry
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

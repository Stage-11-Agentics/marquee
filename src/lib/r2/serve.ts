/**
 * Host-gated ready-object streaming from `MEDIA`. Only the configured
 * separate media origin serves bytes; the app host must 404 the same path.
 * Every response forces `Content-Disposition: attachment` and
 * `X-Content-Type-Options: nosniff` — never inline rendering of user bytes.
 */

import { sanitizeFilename } from "./policy";

export function isMediaHost(requestHostname: string, mediaPublicOrigin: string): boolean {
  return requestHostname.toLowerCase() === mediaPublicOrigin.toLowerCase();
}

export interface ReadyAttachmentForServing {
  status: "ready" | "pending";
  r2_etag: string | null;
  content_type: string;
  filename: string;
}

export async function serveMediaObject(
  media: R2Bucket,
  key: string,
  row: ReadyAttachmentForServing | null,
): Promise<Response> {
  if (!row || row.status !== "ready" || !row.r2_etag) {
    return new Response("Not found", { status: 404 });
  }

  const object = await media.get(key);
  if (!object || object.etag !== row.r2_etag) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", row.content_type);
  headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(row.filename)}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("ETag", object.etag);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { status: 200, headers });
}

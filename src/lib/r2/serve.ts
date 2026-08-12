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

/**
 * The single exception to attachment-only serving, and it is narrow on
 * purpose. An organizer looking at a submission record needs to see the
 * headshot they asked the speaker for, so those bytes render inline on the
 * application origin — but only after the caller has already been authorized
 * to read the record, and only for a raster image type the caller's
 * `contentTypeAllowed` predicate has admitted.
 *
 * The isolation that `Content-Disposition: attachment` buys is replaced here,
 * not dropped: `nosniff` pins the declared type, and `default-src 'none';
 * sandbox` means the response cannot execute, frame, or fetch anything even if
 * the type declaration were ever wrong.
 */
export async function serveInlineImageObject(
  media: R2Bucket,
  key: string,
  row: ReadyAttachmentForServing | null,
  contentTypeAllowed: (contentType: string) => boolean,
): Promise<Response | null> {
  if (!row || row.status !== "ready" || !row.r2_etag || !contentTypeAllowed(row.content_type)) return null;

  const object = await media.get(key);
  if (!object || object.etag !== row.r2_etag) return null;

  const headers = new Headers();
  headers.set("Content-Type", row.content_type);
  headers.set("Content-Disposition", `inline; filename="${sanitizeFilename(row.filename)}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("ETag", object.etag);
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { status: 200, headers });
}

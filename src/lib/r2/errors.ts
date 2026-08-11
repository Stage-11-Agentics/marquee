/**
 * Local error envelope for the upload routes, shaped to match SPEC §4.2's
 * pinned `{error:{code,message}, request_id}` contract. Scoped to this
 * module until M-07's route factory (MRQ-8, unmerged as of this ticket)
 * lands a shared helper — deviate-with-flag, not a new competing standard.
 */

import type { Context } from "hono";

export type UploadErrorCode =
  | "turnstile_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "conflict";

const STATUS_BY_CODE: Record<UploadErrorCode, number> = {
  turnstile_failed: 403,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  conflict: 409,
};

export function uploadError(
  context: Context,
  code: UploadErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) context.header(name, value);
  }
  return context.json(
    { error: { code, message }, request_id: crypto.randomUUID() },
    STATUS_BY_CODE[code] as 400 | 401 | 403 | 404 | 409 | 429,
  );
}

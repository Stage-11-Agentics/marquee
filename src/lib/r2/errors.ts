/**
 * Upload-specific error envelope, shaped to match SPEC §4.2's pinned
 * `{error:{code,message}, request_id}` contract. The handlers retain their
 * stable guardrail codes while using the shared request id when they run
 * through the generated API router. The fallback id keeps direct unit probes
 * equivalent to Worker requests.
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
  const requestId = context.get("requestId") as string | undefined;
  return context.json(
    { error: { code, message }, request_id: requestId ?? crypto.randomUUID() },
    STATUS_BY_CODE[code] as 400 | 401 | 403 | 404 | 409 | 429,
  );
}

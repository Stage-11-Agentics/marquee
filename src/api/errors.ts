/**
 * The one API error envelope (Amendment 7). Every API failure response with a
 * body uses this shape; handlers throw `ApiError` (or return one through the
 * shared helpers) instead of inventing local JSON shapes.
 */
import { z } from "@hono/zod-openapi";

export const apiErrorObjectSchema = z
  .object({
    code: z.string().openapi({ example: "not_found" }),
    message: z.string().openapi({ example: "submission not found" }),
    field: z.string().optional().openapi({ example: "per_page" }),
    details: z.unknown().optional(),
  })
  .openapi("ApiError");

export const apiErrorEnvelopeSchema = z
  .object({
    error: apiErrorObjectSchema,
    request_id: z
      .string()
      .openapi({ example: "3d6a2d90-5f0b-4b1e-9d2a-9b1d2f0a1c2d" }),
  })
  .openapi("ApiErrorEnvelope");

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

/** Pinned Amendment 7 status map: status -> stable error code. */
export const ERROR_STATUS_CODES = {
  malformed_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  service_unavailable: 503,
  internal_error: 500,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS_CODES;
export type ApiErrorStatus = (typeof ERROR_STATUS_CODES)[ApiErrorCode];

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;
  readonly field?: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      field?: string;
      details?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS_CODES[code];
    this.field = options.field;
    this.details = options.details;
    this.headers = options.headers;
  }

  toEnvelope(requestId: string): ApiErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field === undefined ? {} : { field: this.field }),
        ...(this.details === undefined ? {} : { details: this.details }),
      },
      request_id: requestId,
    };
  }

  static badRequest(message: string, field?: string, details?: unknown): ApiError {
    return new ApiError("malformed_request", message, { field, details });
  }

  static unauthenticated(message = "missing or invalid credential"): ApiError {
    return new ApiError("unauthenticated", message);
  }

  static forbidden(message = "authenticated principal lacks the required grant"): ApiError {
    return new ApiError("forbidden", message);
  }

  /** 404 doubles as intentional concealment: never distinguish "absent" from "hidden". */
  static notFound(message = "resource not found"): ApiError {
    return new ApiError("not_found", message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError("conflict", message, { details });
  }

  static unprocessable(message: string, field?: string, details?: unknown): ApiError {
    return new ApiError("unprocessable", message, { field, details });
  }

  static rateLimited(retryAfterSeconds: number): ApiError {
    return new ApiError("rate_limited", "rate limit exceeded", {
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    });
  }

  static serviceUnavailable(message: string, details?: unknown): ApiError {
    return new ApiError("service_unavailable", message, {
      details,
      headers: { "Retry-After": "60" },
    });
  }
}

export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Correlation id: the trusted edge-supplied `cf-ray` when present, otherwise
 * one id generated per request. Never trust a client-supplied request id.
 */
export function resolveRequestId(request: Request): string {
  const ray = request.headers.get("cf-ray");
  if (ray && /^[0-9a-f]{8,32}(?:-[A-Z]{2,4})?$/i.test(ray)) return ray;
  return crypto.randomUUID();
}

/** Zod issue -> the safe dotted field path used in the envelope's `field`. */
export function issueField(issue: z.core.$ZodIssue): string {
  return issue.path.map((segment: PropertyKey) => String(segment)).join(".");
}

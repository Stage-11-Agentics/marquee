/**
 * Upload routes: public (Turnstile-gated) and authenticated presign/complete,
 * plus host-gated media serving. Every operation is registered through the
 * generated route manifest so the served OpenAPI document cannot omit an
 * upload path.
 *
 * The authenticated branch keeps MRQ-14's route-local session and ownership
 * lookup as a second, route-specific guardrail after the shared API credential
 * policy has admitted the request.
 */

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import type { ApiEnv } from "../api/runtime";
import { defineApiRoute, jsonResponse } from "../api/route";
import { SESSION_COOKIE_NAME } from "../lib/cookies";
import { uploadError } from "../lib/r2/errors";
import { objectKeyFor, publicMediaUrl } from "../lib/r2/keys";
import { extensionOf, policyFor, sanitizeFilename, validateDeclared } from "../lib/r2/policy";
import { presignPut, type R2SigningConfig } from "../lib/r2/presign";
import { checkUploadRateLimits, rateLimitHeaders } from "../lib/r2/rate-limit";
import { isMediaHost, serveMediaObject } from "../lib/r2/serve";
import { verifyTurnstile } from "../lib/r2/turnstile";
import { verifyAndComplete } from "../lib/r2/complete";

export interface UploadsEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  CACHE: KVNamespace;
  TURNSTILE_SECRET_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  MEDIA_PUBLIC_ORIGIN: string;
  UPLOAD_TOKEN_SECRET: string;
  UPLOAD_RATE_LIMIT_SECRET: string;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signingConfig(env: UploadsEnv): R2SigningConfig {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

interface PendingInsert {
  id: string;
  eventId: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  nowMs: number;
}

async function insertPendingAttachment(db: D1Database, row: PendingInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO attachments
        (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9)`,
    )
    .bind(
      row.id,
      row.eventId,
      row.ownerType,
      row.ownerId,
      row.r2Key,
      row.filename,
      row.contentType,
      row.sizeBytes,
      row.nowMs,
    )
    .run();
}

function uploadsEnv(context: Context<ApiEnv>): UploadsEnv {
  return context.env as unknown as UploadsEnv;
}

/**
 * Public presign: a stranger can originate this write, so every side effect
 * (row insert, signer call, KV consumption) sits behind Turnstile and scope
 * verification — AC-231's core guardrail.
 */
async function handlePublicSign(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const body = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return uploadError(context, "invalid_request", "malformed JSON body");
  }

  const { draftId, resumeToken, fieldKey, turnstileToken, filename, contentType, sizeBytes } = body as Record<
    string,
    unknown
  >;
  if (
    typeof draftId !== "string" ||
    typeof resumeToken !== "string" ||
    typeof fieldKey !== "string" ||
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof sizeBytes !== "number"
  ) {
    return uploadError(context, "invalid_request", "missing required fields");
  }

  const turnstile = await verifyTurnstile({
    secretKey: env.TURNSTILE_SECRET_KEY,
    token: typeof turnstileToken === "string" ? turnstileToken : null,
    remoteIp: context.req.header("cf-connecting-ip") ?? undefined,
  });
  if (!turnstile.ok) {
    return uploadError(context, "turnstile_failed", "Turnstile verification failed");
  }

  const draft = await env.DB.prepare(
    `SELECT id, event_id, status, resume_token_hash FROM submissions WHERE id = ?1`,
  )
    .bind(draftId)
    .first<{ id: string; event_id: string; status: string; resume_token_hash: string | null }>();

  if (!draft || draft.status !== "draft" || !draft.resume_token_hash) {
    return uploadError(context, "not_found", "draft not found");
  }
  const suppliedHash = await sha256Hex(resumeToken);
  if (suppliedHash !== draft.resume_token_hash) {
    return uploadError(context, "forbidden", "resume token does not match draft");
  }

  const clientIp = context.req.header("cf-connecting-ip") ?? "unknown";
  const limits = await checkUploadRateLimits({
    cache: env.CACHE,
    hmacSecret: env.UPLOAD_RATE_LIMIT_SECRET,
    ip: clientIp,
    submissionOrDraftId: draftId,
    nowMs: Date.now(),
  });
  if (!limits.ip.allowed) {
    return uploadError(context, "rate_limited", "per-IP upload cap exceeded", rateLimitHeaders(limits.ip));
  }
  if (!limits.submission.allowed) {
    return uploadError(context, "rate_limited", "per-submission upload cap exceeded", rateLimitHeaders(limits.submission));
  }

  const policy = policyFor("draft_file");
  if (!policy) return uploadError(context, "invalid_request", "owner type not presignable");
  const decision = validateDeclared(policy, { filename, contentType, sizeBytes });
  if (!decision.ok) {
    return uploadError(context, "invalid_request", `rejected: ${decision.violation}`);
  }

  const attachmentId = crypto.randomUUID();
  const nowMs = Date.now();
  const r2Key = objectKeyFor({
    eventId: draft.event_id,
    ownerType: "draft_file",
    attachmentId,
    extension: extensionOf(filename),
  });

  await insertPendingAttachment(env.DB, {
    id: attachmentId,
    eventId: draft.event_id,
    ownerType: "draft_file",
    ownerId: draftId,
    filename: sanitizeFilename(filename),
    contentType,
    sizeBytes,
    r2Key,
    nowMs,
  });

  try {
    const presigned = await presignPut(signingConfig(env), { key: r2Key, contentType, nowMs });
    const completionToken = await hmacHex(env.UPLOAD_TOKEN_SECRET, `${attachmentId}:draft_file:${draftId}`);
    return context.json({
      attachmentId,
      putUrl: presigned.url,
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: presigned.expiresAt,
      completionToken,
      maxBytes: policy.maxBytes,
    });
  } catch (error) {
    await env.DB.prepare(`DELETE FROM attachments WHERE id = ?1`).bind(attachmentId).run();
    return uploadError(context, "invalid_request", `signing failed: ${(error as Error).message}`);
  }
}

/**
 * Authenticated (speaker) presign for a self-owned task upload. Minimal
 * local session check — no Turnstile (resolution 3), fails closed on a
 * missing/expired session or a task that does not belong to the caller.
 */
async function handleAuthenticatedSign(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const sessionId = getCookie(context, SESSION_COOKIE_NAME);
  if (!sessionId) return uploadError(context, "unauthorized", "no session");

  const session = await env.DB.prepare(
    `SELECT person_id, expires_at, revoked_at FROM auth_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{ person_id: string; expires_at: number; revoked_at: number | null }>();
  if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    return uploadError(context, "unauthorized", "session invalid or expired");
  }

  const body = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return uploadError(context, "invalid_request", "malformed JSON body");
  }
  const { ownerType, ownerId, filename, contentType, sizeBytes } = body as Record<string, unknown>;
  if (
    ownerType !== "task_upload" ||
    typeof ownerId !== "string" ||
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof sizeBytes !== "number"
  ) {
    return uploadError(context, "invalid_request", "only task_upload is supported on this route in this window");
  }

  const task = await env.DB.prepare(
    `SELECT id, event_id, person_id FROM speaker_tasks WHERE id = ?1`,
  )
    .bind(ownerId)
    .first<{ id: string; event_id: string; person_id: string }>();
  if (!task || task.person_id !== session.person_id) {
    return uploadError(context, "forbidden", "task does not belong to the authenticated principal");
  }

  const policy = policyFor("task_upload");
  if (!policy) return uploadError(context, "invalid_request", "owner type not presignable");
  const decision = validateDeclared(policy, { filename, contentType, sizeBytes });
  if (!decision.ok) return uploadError(context, "invalid_request", `rejected: ${decision.violation}`);

  const attachmentId = crypto.randomUUID();
  const nowMs = Date.now();
  const r2Key = objectKeyFor({ eventId: task.event_id, ownerType: "task_upload", attachmentId, extension: extensionOf(filename) });

  await insertPendingAttachment(env.DB, {
    id: attachmentId,
    eventId: task.event_id,
    ownerType: "task_upload",
    ownerId,
    filename: sanitizeFilename(filename),
    contentType,
    sizeBytes,
    r2Key,
    nowMs,
  });

  try {
    const presigned = await presignPut(signingConfig(env), { key: r2Key, contentType, nowMs });
    const completionToken = await hmacHex(env.UPLOAD_TOKEN_SECRET, `${attachmentId}:task_upload:${ownerId}`);
    return context.json({
      attachmentId,
      putUrl: presigned.url,
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: presigned.expiresAt,
      completionToken,
      maxBytes: policy.maxBytes,
    });
  } catch (error) {
    await env.DB.prepare(`DELETE FROM attachments WHERE id = ?1`).bind(attachmentId).run();
    return uploadError(context, "invalid_request", `signing failed: ${(error as Error).message}`);
  }
}

async function handleComplete(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const attachmentId = context.req.param("id");
  const body = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
  const completionToken = typeof body.completionToken === "string" ? body.completionToken : undefined;
  if (!completionToken) return uploadError(context, "invalid_request", "completionToken required");

  const row = await env.DB.prepare(
    `SELECT id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status
       FROM attachments WHERE id = ?1`,
  )
    .bind(attachmentId)
    .first<{
      id: string;
      event_id: string;
      owner_type: string;
      owner_id: string;
      r2_key: string;
      filename: string;
      content_type: string;
      size_bytes: number;
      status: "pending" | "ready";
    }>();
  if (!row) return uploadError(context, "not_found", "attachment not found");

  const expectedToken = await hmacHex(env.UPLOAD_TOKEN_SECRET, `${row.id}:${row.owner_type}:${row.owner_id}`);
  if (expectedToken !== completionToken) {
    return uploadError(context, "forbidden", "completion token does not match this attachment");
  }

  const outcome = await verifyAndComplete(env.MEDIA, row);
  if (!outcome.ok) {
    return uploadError(context, "conflict", `completion failed: ${outcome.reason}`);
  }

  if (row.status !== "ready") {
    await env.DB.prepare(
      `UPDATE attachments SET status = 'ready', r2_etag = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'pending'`,
    )
      .bind(row.id, outcome.r2Etag, Date.now())
      .run();
  }

  return context.json({
    attachmentId: row.id,
    status: "ready",
    url: publicMediaUrl(env.MEDIA_PUBLIC_ORIGIN, { status: "ready", r2_key: row.r2_key }),
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
  });
}

/**
 * Media GET is accepted only on `MEDIA_PUBLIC_ORIGIN` (origin isolation);
 * the same path on the app host must 404, never fall through to SPA assets.
 */
async function handleMedia(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const url = new URL(context.req.url);
  if (!isMediaHost(url.hostname, env.MEDIA_PUBLIC_ORIGIN)) {
    return context.notFound();
  }

  const key = decodeURIComponent(url.pathname.replace(/^\/api\/v1\/media\//, ""));
  const row = await env.DB.prepare(
    `SELECT status, r2_etag, content_type, filename FROM attachments WHERE r2_key = ?1`,
  )
    .bind(key)
    .first<{ status: "pending" | "ready"; r2_etag: string | null; content_type: string; filename: string }>();

  return serveMediaObject(env.MEDIA, key, row);
}

const uploadErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum([
        "turnstile_failed",
        "unauthorized",
        "forbidden",
        "not_found",
        "invalid_request",
        "rate_limited",
        "conflict",
      ]),
      message: z.string(),
    }),
    request_id: z.string(),
  })
  .openapi("UploadErrorEnvelope");

const uploadErrorResponses = {
  400: jsonResponse(uploadErrorEnvelopeSchema, "Malformed upload request."),
  401: jsonResponse(uploadErrorEnvelopeSchema, "Missing or invalid session."),
  403: jsonResponse(uploadErrorEnvelopeSchema, "Upload authorization failed."),
  404: jsonResponse(uploadErrorEnvelopeSchema, "Upload attachment or draft not found."),
  409: jsonResponse(uploadErrorEnvelopeSchema, "Uploaded bytes failed verification."),
  429: jsonResponse(uploadErrorEnvelopeSchema, "Upload rate limit exceeded."),
};

const publicSignRequestSchema = z
  .object({
    draftId: z.string(),
    resumeToken: z.string(),
    fieldKey: z.string(),
    turnstileToken: z.string().optional(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .openapi("PublicUploadSignRequest");

const taskSignRequestSchema = z
  .object({
    ownerType: z.literal("task_upload"),
    ownerId: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .openapi("TaskUploadSignRequest");

const completeRequestSchema = z
  .object({ completionToken: z.string() })
  .openapi("UploadCompleteRequest");

const uploadPresignResponseSchema = z
  .object({
    attachmentId: z.string(),
    putUrl: z.string(),
    requiredHeaders: z.record(z.string(), z.string()),
    expiresAt: z.number(),
    completionToken: z.string(),
    maxBytes: z.number(),
  })
  .openapi("UploadPresignResponse");

const uploadCompleteResponseSchema = z
  .object({
    attachmentId: z.string(),
    status: z.literal("ready"),
    url: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .openapi("UploadCompleteResponse");

const idParamsSchema = z.object({ id: z.string() });
const mediaParamsSchema = z.object({ key: z.string() });

const signPublicUpload = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/uploads/sign",
    operationId: "signPublicUpload",
    summary: "Create a public upload presign",
    description:
      "Validates the draft resume token and Turnstile authorization before creating a pending attachment and presigned R2 PUT.",
    tags: ["Uploads"],
    request: {
      body: { content: { "application/json": { schema: publicSignRequestSchema } } },
    },
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write", keying: "ip_submission" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(uploadPresignResponseSchema, "A presigned R2 PUT and completion token."),
      ...uploadErrorResponses,
    },
  },
  handlePublicSign as never,
);

const signTaskUpload = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/uploads/sign",
    operationId: "signTaskUpload",
    summary: "Create an authenticated task-upload presign",
    description:
      "Creates a presigned R2 PUT only for a task owned by the authenticated speaker session.",
    tags: ["Uploads"],
    request: {
      body: { content: { "application/json": { schema: taskSignRequestSchema } } },
    },
    policy: {
      auth: { kind: "authenticated" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(uploadPresignResponseSchema, "A presigned R2 PUT and completion token."),
      ...uploadErrorResponses,
    },
  },
  handleAuthenticatedSign as never,
);

const completePublicUpload = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/uploads/{id}/complete",
    operationId: "completePublicUpload",
    summary: "Verify and complete a public upload",
    description:
      "HEAD-verifies the uploaded R2 object, checks its size and magic bytes, deletes contradictory bytes, and marks the attachment ready.",
    tags: ["Uploads"],
    request: {
      params: idParamsSchema,
      body: { content: { "application/json": { schema: completeRequestSchema } } },
    },
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(uploadCompleteResponseSchema, "The verified ready attachment."),
      ...uploadErrorResponses,
    },
  },
  handleComplete as never,
);

const completeTaskUpload = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/uploads/{id}/complete",
    operationId: "completeTaskUpload",
    summary: "Verify and complete an authenticated task upload",
    description:
      "HEAD-verifies and completes an authenticated task attachment using its completion token.",
    tags: ["Uploads"],
    request: {
      params: idParamsSchema,
      body: { content: { "application/json": { schema: completeRequestSchema } } },
    },
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(uploadCompleteResponseSchema, "The verified ready attachment."),
      ...uploadErrorResponses,
    },
  },
  handleComplete as never,
);

const serveMedia = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/media/{key}",
    runtimePath: "/api/v1/media/*",
    operationId: "serveMedia",
    summary: "Serve a verified upload",
    description:
      "Serves a ready upload only from the configured separate media origin, as an attachment with nosniff protection.",
    tags: ["Uploads"],
    request: { params: mediaParamsSchema },
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "application/octet-stream": { schema: z.any() } },
        description: "The verified upload bytes.",
      },
      404: {
        content: { "text/plain": { schema: z.string() } },
        description: "The origin, attachment, or object is not available.",
      },
    },
  },
  handleMedia as never,
);

export const apiRoutes = [
  signPublicUpload,
  signTaskUpload,
  completePublicUpload,
  completeTaskUpload,
  serveMedia,
];

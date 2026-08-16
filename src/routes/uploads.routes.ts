/**
 * Upload routes: public (Turnstile-gated) and authenticated presign/complete,
 * plus host-gated media serving. Every operation is registered through the
 * generated route manifest so the served OpenAPI document cannot omit an
 * upload path.
 *
 * The authenticated branch keeps MRQ-14's route-local session and ownership
 * lookup as a second, route-specific guardrail after the shared API credential
 * policy has admitted the request. MRQ-16 adds person_headshot to this same
 * path; it does not create a second upload lifecycle.
 */

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { ApiError } from "../api/errors";
import type { ApiEnv } from "../api/runtime";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { getAuth } from "../lib/auth/auth-middleware";
import { requireDraftRead, requireSubmissionRead } from "../lib/auth/program-access";
import { authHasRole } from "../lib/auth/scope-resolution";
import { SESSION_COOKIE_NAME } from "../lib/cookies";
import { isPreviewableImage } from "../lib/file-answers";
import { uploadError } from "../lib/r2/errors";
import { objectKeyFor } from "../lib/r2/keys";
import { mediaAttachmentIsActive, publicMediaUrl, verifyMediaUrl } from "../lib/r2/media-links";
import { extensionOf, parseUploadOwnerConfig, policyFor, sanitizeFilename, validateDeclared } from "../lib/r2/policy";
import { presignPut, type R2SigningConfig } from "../lib/r2/presign";
import { sponsorContactTaskAccess } from "../lib/sponsors/task-access";
import type { UploadOwnerConfig } from "../lib/r2/protocol";
import { checkUploadRateLimits, rateLimitHeaders } from "../lib/r2/rate-limit";
import { isMediaHost, serveInlineImageObject, serveMediaObject } from "../lib/r2/serve";
import { verifyTurnstile } from "../lib/r2/turnstile";
import { verifyAndComplete } from "../lib/r2/complete";
import { publicFormIsClosed, publicTurnstileExempt, resolvePublicFormResume } from "./public-form.shared";
import { roleInSql, WORK_HOLDING_PARTICIPATION_ROLES } from "../lib/participants";

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
  LOCAL_UPLOAD_SHIM?: string;
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

/**
 * Turnstile tokens are single-use credentials. Keep a short-lived local
 * consumption marker as defense in depth so a verified token cannot mint a
 * second public presign when verification is stubbed or retried upstream.
 */
async function consumePublicTurnstileToken(cache: KVNamespace, token: string): Promise<boolean> {
  const tokenKey = `public-upload:turnstile:${await sha256Hex(token)}`;
  if (await cache.get(tokenKey)) return false;
  await cache.put(tokenKey, "1", { expirationTtl: 300 });
  return true;
}

/**
 * A public form field carries its own accepted types and size ceiling, and
 * they are read here from the form the draft belongs to rather than from the
 * request — a stranger names the field, never the policy that governs it.
 * Returns null when the key names no file field on that form, which is itself
 * a rejection: an anonymous caller cannot invent an upload slot.
 */
async function draftFieldConfig(
  db: D1Database,
  draftId: string,
  fieldKey: string,
): Promise<UploadOwnerConfig | null> {
  const field = await db
    .prepare(
      `SELECT field.config
         FROM form_fields field
         JOIN forms form ON form.id = field.form_id
         JOIN submissions draft
           ON draft.form_id = form.id AND draft.event_id = form.event_id
        WHERE draft.id = ?1 AND field.key = ?2 AND field.type = 'file'`,
    )
    .bind(draftId, fieldKey)
    .first<{ config: string | null }>();
  if (!field) return null;
  return parseUploadOwnerConfig(field.config);
}

/**
 * A presigned PUT addresses the account's own S3 endpoint, so a local checkout
 * with no R2 account has nowhere to send the bytes and every upload dies at the
 * PUT — the public form's required headshot included. With this flag the bytes
 * go to the Worker's own MEDIA binding instead, through the route below, so a
 * local operator exercises the real form path rather than a dead end.
 *
 * Explicit, and off unless the operator's own `wrangler dev` line says
 * otherwise (`--var LOCAL_UPLOAD_SHIM:1`), for the same reason
 * `INSECURE_LOCAL_COOKIES` is: `wrangler dev` rewrites URL, Host and Origin to
 * the deployed route, so the Worker has no observable signal that it is local
 * and no configuration value it can infer one from. Never set on a deployed
 * Worker; wrangler.jsonc pins the deployed default off.
 */
function localUploadShimEnabled(env: UploadsEnv): boolean {
  return env.LOCAL_UPLOAD_SHIM === "1";
}

function acceptedTaskTypes(config: UploadOwnerConfig | undefined, policy: ReturnType<typeof policyFor>): string[] {
  const values = config?.accept && config.accept.length > 0
    ? config.accept
    : policy?.rules.map((rule) => rule.extension) ?? [];
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
    .map((value) => value.includes("/") || value.startsWith(".") ? value : `.${value}`);
}

function taskUploadRejection(violation: string, config: UploadOwnerConfig | undefined, policy: ReturnType<typeof policyFor>): string {
  if (violation !== "extension") return `rejected: ${violation}`;
  const accepted = acceptedTaskTypes(config, policy);
  if (accepted.length === 0) return "That file type is not accepted.";
  if (accepted.length === 1) return `That file type is not accepted. Choose a ${accepted[0]} file.`;
  return `That file type is not accepted. Choose one of ${accepted.slice(0, -1).join(", ")}, or ${accepted[accepted.length - 1]}.`;
}

const LOCAL_PUT_TTL_MS = 600_000;

async function localPutToken(env: UploadsEnv, attachmentId: string, r2Key: string, expiresAt: number): Promise<string> {
  return hmacHex(env.UPLOAD_TOKEN_SECRET, `local-put:${attachmentId}:${r2Key}:${expiresAt}`);
}

async function signUpload(
  env: UploadsEnv,
  params: { attachmentId: string; key: string; contentType: string; nowMs: number },
): Promise<{ url: string; requiredHeaders: Record<string, string>; expiresAt: number }> {
  if (!localUploadShimEnabled(env)) {
    const presigned = await presignPut(signingConfig(env), { key: params.key, contentType: params.contentType, nowMs: params.nowMs });
    return { url: presigned.url, requiredHeaders: presigned.requiredHeaders, expiresAt: presigned.expiresAt };
  }
  const expiresAt = params.nowMs + LOCAL_PUT_TTL_MS;
  const token = await localPutToken(env, params.attachmentId, params.key, expiresAt);
  return {
    url: `/api/v1/uploads/local/${encodeURIComponent(params.attachmentId)}?expires=${expiresAt}&token=${token}`,
    requiredHeaders: { "content-type": params.contentType },
    expiresAt,
  };
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
 * Public presign: a stranger can originate this write, so row insertion and
 * signing sit behind Turnstile, one-use-token consumption, and scope
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

  const draft = await env.DB.prepare(
    `SELECT draft.id, draft.event_id, draft.form_id, draft.status, draft.resume_token_hash,
            form.slug AS form_slug, form.status AS form_status, form.opens_at, form.closes_at
       FROM submissions draft
       JOIN forms form ON form.id = draft.form_id AND form.event_id = draft.event_id
      WHERE draft.id = ?1`,
  )
    .bind(draftId)
    .first<{
      id: string;
      event_id: string;
      form_id: string;
      status: string;
      resume_token_hash: string | null;
      form_slug: string;
      form_status: "open" | "closed";
      opens_at: number | null;
      closes_at: number | null;
    }>();

  if (!draft) {
    return uploadError(context, "not_found", "draft not found");
  }
  const resolution = await resolvePublicFormResume(
    env.DB,
    { id: draft.form_id, event_id: draft.event_id },
    draft.form_slug,
    resumeToken,
  );
  if (!resolution.submission || resolution.submission.id !== draft.id) {
    return uploadError(context, "forbidden", "resume token does not match draft");
  }
  if (publicFormIsClosed({ status: draft.form_status, opens_at: draft.opens_at, closes_at: draft.closes_at })) {
    return uploadError(context, "forbidden", "This call is closed and files can no longer be changed.");
  }
  if (draft.status !== "draft") {
    return uploadError(context, "forbidden", "This draft is no longer editable.");
  }

  /**
   * The draft and its resume token are resolved before the bot gate so a
   * demo-mode conference can be recognised at all; every caller reaching this
   * line has already proved possession of the resume token for this draft.
   * See publicTurnstileExempt for why demo conferences skip the challenge.
   */
  if (!(await publicTurnstileExempt(env.DB, draft.event_id))) {
    const turnstile = await verifyTurnstile({
      secretKey: env.TURNSTILE_SECRET_KEY,
      token: typeof turnstileToken === "string" ? turnstileToken : null,
      remoteIp: context.req.header("cf-connecting-ip") ?? undefined,
    });
    if (!turnstile.ok) {
      return uploadError(context, "turnstile_failed", "Turnstile verification failed");
    }
    if (typeof turnstileToken !== "string" || !(await consumePublicTurnstileToken(env.CACHE, turnstileToken))) {
      return uploadError(context, "turnstile_failed", "Turnstile token has already been used");
    }
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

  const fieldConfig = await draftFieldConfig(env.DB, draftId, fieldKey);
  if (!fieldConfig) return uploadError(context, "not_found", "form field not found");
  const policy = policyFor("draft_file", fieldConfig);
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
    const presigned = await signUpload(env, { attachmentId, key: r2Key, contentType, nowMs });
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
 * Authenticated presign for a self-owned task or profile upload. Minimal
 * local session check — no Turnstile (resolution 3), fails closed on a
 * missing/expired session or a task that does not belong to the caller.
 */
async function handleAuthenticatedSign(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const sessionId = getCookie(context, SESSION_COOKIE_NAME);
  if (!sessionId) return uploadError(context, "unauthorized", "no session");

  const session = await env.DB.prepare(
    `SELECT person_id, role_hint, expires_at, revoked_at FROM auth_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{ person_id: string; role_hint: string | null; expires_at: number; revoked_at: number | null }>();
  if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    return uploadError(context, "unauthorized", "session invalid or expired");
  }

  const body = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return uploadError(context, "invalid_request", "malformed JSON body");
  }
  const { ownerType, ownerId, filename, contentType, sizeBytes } = body as Record<string, unknown>;
  if (
    (ownerType !== "task_upload" && ownerType !== "person_headshot") ||
    typeof ownerId !== "string" ||
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof sizeBytes !== "number"
  ) {
    return uploadError(context, "invalid_request", "only task_upload and person_headshot are supported on this route");
  }
  if (session.role_hint?.startsWith("cospeaker_profile:") && ownerType === "task_upload") {
    return uploadError(context, "forbidden", "this co-speaker link can upload only its profile headshot");
  }

  let eventId: string | null = null;
  let ownerConfig: UploadOwnerConfig | undefined;
  if (ownerType === "task_upload") {
    const task = await env.DB.prepare(
      `SELECT task.id, task.event_id, task.person_id, template.file_config
        FROM speaker_tasks task
         JOIN task_templates template
           ON template.id = task.template_id AND template.event_id = task.event_id
        WHERE task.id = ?1 AND template.kind = 'file' AND task.cancelled_at IS NULL`,
    )
      .bind(ownerId)
      .first<{ id: string; event_id: string; person_id: string; file_config: string | null }>();
    // A sponsorship contact may upload for a deliverable assigned to a
    // colleague — the same predicate the completion route uses, so a file task
    // can never validate on one route and fail at the PUT on the other.
    const ownedByCaller = task !== null && task.person_id === session.person_id;
    const sponsorSeat = task !== null && !ownedByCaller
      ? await sponsorContactTaskAccess(env.DB, session.person_id, ownerId)
      : null;
    if (!task || (!ownedByCaller && !sponsorSeat)) {
      return uploadError(context, "forbidden", "task does not belong to the authenticated principal");
    }
    eventId = task.event_id;
    ownerConfig = parseUploadOwnerConfig(task.file_config);
  } else {
    if (ownerId !== session.person_id) {
      return uploadError(context, "forbidden", "headshot does not belong to the authenticated principal");
    }
    const scopedParticipationId = session.role_hint?.startsWith("cospeaker_profile:")
      ? session.role_hint.slice("cospeaker_profile:".length)
      : null;
    if (scopedParticipationId && !/^[A-Za-z0-9_-]+$/.test(scopedParticipationId)) {
      return uploadError(context, "forbidden", "the profile link is not valid for a headshot upload");
    }
    if (scopedParticipationId) {
      const participation = await env.DB.prepare(
        `SELECT submission.event_id
         FROM participations participation
         JOIN submissions submission ON submission.id = participation.submission_id
         JOIN events conference ON conference.id = submission.event_id
         JOIN people person ON person.id = participation.person_id AND person.org_id = conference.org_id
         WHERE participation.id = ? AND participation.person_id = ? AND participation.role = 'co_speaker'`,
      ).bind(scopedParticipationId, session.person_id).first<{ event_id: string }>();
      if (!participation) return uploadError(context, "forbidden", "the profile link is not valid for a headshot upload");
      eventId = participation.event_id;
    } else {
      const membership = await env.DB.prepare(
        `SELECT membership.event_id
         FROM memberships membership
         JOIN people person ON person.id = membership.person_id AND person.org_id = membership.org_id
         WHERE membership.person_id = ? AND (${roleInSql("membership", WORK_HOLDING_PARTICIPATION_ROLES)} OR membership.role = 'reviewer') AND membership.event_id IS NOT NULL
         ORDER BY membership.event_id LIMIT 1`,
      ).bind(session.person_id).first<{ event_id: string }>();
      if (!membership) return uploadError(context, "forbidden", "a speaker or reviewer membership is required for a headshot upload");
      eventId = membership.event_id;
    }
  }

  const policy = policyFor(ownerType, ownerConfig);
  if (!policy) return uploadError(context, "invalid_request", "owner type not presignable");
  const decision = validateDeclared(policy, { filename, contentType, sizeBytes });
  if (!decision.ok) return uploadError(
    context,
    "invalid_request",
    ownerType === "task_upload" ? taskUploadRejection(decision.violation, ownerConfig, policy) : `rejected: ${decision.violation}`,
  );

  const attachmentId = crypto.randomUUID();
  const nowMs = Date.now();
  const r2Key = objectKeyFor({ eventId, ownerType, attachmentId, extension: extensionOf(filename) });

  await insertPendingAttachment(env.DB, {
    id: attachmentId,
    eventId,
    ownerType,
    ownerId,
    filename: sanitizeFilename(filename),
    contentType,
    sizeBytes,
    r2Key,
    nowMs,
  });

  try {
    const presigned = await signUpload(env, { attachmentId, key: r2Key, contentType, nowMs });
    const completionToken = await hmacHex(env.UPLOAD_TOKEN_SECRET, `${attachmentId}:${ownerType}:${ownerId}`);
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
 * The local stand-in for a presigned R2 PUT. Refused outright unless the
 * operator started this Worker with the shim on, and then still only for an
 * attachment this Worker itself signed: the query token is an HMAC over the
 * attachment id, its object key and the expiry, so the URL grants exactly one
 * object for ten minutes and nothing else. It writes bytes; it decides
 * nothing. The declared size and the magic bytes are still adjudicated by the
 * ordinary completion path, which deletes the object on any contradiction.
 */
async function handleLocalPut(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  if (!localUploadShimEnabled(env)) return uploadError(context, "not_found", "local upload shim is disabled");

  const attachmentId = context.req.param("id");
  const expiresAt = Number(context.req.query("expires"));
  const token = context.req.query("token") ?? "";
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return uploadError(context, "forbidden", "local upload URL has expired");
  }

  const row = await env.DB.prepare(
    `SELECT id, r2_key, content_type, status FROM attachments WHERE id = ?1`,
  )
    .bind(attachmentId)
    .first<{ id: string; r2_key: string; content_type: string; status: "pending" | "ready" }>();
  if (!row) return uploadError(context, "not_found", "attachment not found");

  const expected = await localPutToken(env, row.id, row.r2_key, expiresAt);
  if (expected !== token) return uploadError(context, "forbidden", "local upload token does not match this attachment");

  await env.MEDIA.put(row.r2_key, context.req.raw.body, {
    httpMetadata: { contentType: row.content_type },
  });
  return context.json({ ok: true as const });
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

  let ownerConfig: UploadOwnerConfig | undefined;
  if (row.owner_type === "task_upload") {
    const task = await env.DB.prepare(
      `SELECT template.file_config
        FROM speaker_tasks task
         JOIN task_templates template
           ON template.id = task.template_id AND template.event_id = task.event_id
        WHERE task.id = ?1 AND task.event_id = ?2 AND template.kind = 'file' AND task.cancelled_at IS NULL`,
    )
      .bind(row.owner_id, row.event_id)
      .first<{ file_config: string | null }>();
    if (!task) return uploadError(context, "forbidden", "task template is no longer available");
    ownerConfig = parseUploadOwnerConfig(task.file_config);
  }

  const outcome = await verifyAndComplete(env.MEDIA, row, ownerConfig);
  if (!outcome.ok) {
    const message = row.owner_type === "task_upload" && outcome.reason === "type_mismatch"
      ? `completion failed: ${taskUploadRejection("extension", ownerConfig, policyFor("task_upload", ownerConfig))}`
      : `completion failed: ${outcome.reason}`;
    return uploadError(context, "conflict", message);
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
    url: await publicMediaUrl(env.MEDIA_PUBLIC_ORIGIN, { status: "ready", r2_key: row.r2_key }, env.UPLOAD_TOKEN_SECRET),
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
  if (!(await verifyMediaUrl(key, url, env.UPLOAD_TOKEN_SECRET))) {
    return context.notFound();
  }

  const row = await env.DB.prepare(
    `SELECT id, event_id, owner_type, owner_id, status, r2_etag, content_type, filename
       FROM attachments
      WHERE r2_key = ?1`,
  )
    .bind(key)
    .first<{
      id: string;
      event_id: string;
      owner_type: "person_headshot" | "task_upload" | "event_logo" | "import_file" | "draft_file" | "submission_file";
      owner_id: string;
      status: "pending" | "ready";
      r2_etag: string | null;
      content_type: string;
      filename: string;
    }>();

  if (!row || row.status !== "ready" || !(await mediaAttachmentIsActive(env.DB, row))) {
    return context.notFound();
  }

  return serveMediaObject(env.MEDIA, key, row);
}

/**
 * The organizer's thumbnail of a file answer.
 *
 * It adds authorization rather than removing any: the caller must already be
 * entitled to read the submission the attachment is answering, exactly as the
 * record route requires, and only then does a raster image render inline (see
 * `serveInlineImageObject`). Everything else — a pending upload, a PDF, an SVG,
 * an attachment no answer references, a caller without program access — is a
 * 404 with no bytes served. The separate media origin keeps its role as the
 * only place arbitrary uploaded content is downloadable.
 */
async function handleAttachmentPreview(context: Context<ApiEnv>) {
  const env = uploadsEnv(context);
  const eventId = context.req.param("eventId") ?? "";
  const attachmentId = context.req.param("attachmentId") ?? "";

  const row = await env.DB.prepare(
    `SELECT attachment.status, attachment.r2_key, attachment.r2_etag,
            attachment.content_type, attachment.filename,
            submission.status AS submission_status
     FROM attachments attachment
     JOIN submission_answers answer
       ON json_extract(answer.value_json, '$.attachmentId') = attachment.id
     JOIN submissions submission
       ON submission.id = answer.submission_id AND submission.event_id = attachment.event_id
     WHERE attachment.id = ?1 AND attachment.event_id = ?2
     LIMIT 1`,
  )
    .bind(attachmentId, eventId)
    .first<{
      status: "pending" | "ready";
      r2_key: string;
      r2_etag: string | null;
      content_type: string;
      filename: string;
      submission_status: string;
    }>();

  if (row?.submission_status === "draft") await requireDraftRead(context, eventId);
  else await requireSubmissionRead(context, eventId);
  if (!row) throw ApiError.notFound("attachment not found");

  const response = await serveInlineImageObject(env.MEDIA, row.r2_key, row, isPreviewableImage);
  if (!response) throw ApiError.notFound("attachment not found");
  return response;
}

/**
 * A speaker's profile headshot has no submission answer to join through. Keep
 * it behind the same event-scoped organizer read, while allowing the owning
 * speaker or reviewer session to render its own photo after a profile save.
 * The pointer and owner type are both checked here so an attachment id or
 * person id from another conference cannot turn this into an object oracle.
 */
async function handlePersonHeadshot(context: Context<ApiEnv>) {
  const eventId = context.req.param("eventId") ?? "";
  const personId = context.req.param("personId") ?? "";
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();

  const speakerOwnsRequest = auth.kind === "session"
    && auth.personId === personId
    && (authHasRole(auth, "speaker", eventId) || authHasRole(auth, "reviewer", eventId));
  if (!speakerOwnsRequest) await requireSubmissionRead(context, eventId);

  const env = uploadsEnv(context);
  const row = await env.DB.prepare(
    `SELECT attachment.status, attachment.r2_key, attachment.r2_etag,
            attachment.content_type, attachment.filename
       FROM people person
       JOIN events event ON event.id = ?1 AND event.org_id = person.org_id
       JOIN attachments attachment
         ON attachment.id = person.headshot_attachment_id
        AND attachment.event_id = event.id
        AND attachment.owner_type = 'person_headshot'
        AND attachment.owner_id = person.id
      WHERE person.id = ?2
      LIMIT 1`,
  )
    .bind(eventId, personId)
    .first<{
      status: "pending" | "ready";
      r2_key: string;
      r2_etag: string | null;
      content_type: string;
      filename: string;
    }>();

  if (!row) throw ApiError.notFound("headshot not found");
  const response = await serveInlineImageObject(env.MEDIA, row.r2_key, row, isPreviewableImage);
  if (!response) throw ApiError.notFound("headshot not found");
  return response;
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

const authenticatedSignRequestSchema = z
  .object({
    ownerType: z.enum(["task_upload", "person_headshot"]),
    ownerId: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .openapi("AuthenticatedUploadSignRequest");

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
    url: z.string().describe("A short-lived signed URL on the separate media origin; it expires 24 hours after it is issued."),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .openapi("UploadCompleteResponse");

const idParamsSchema = z.object({ id: z.string() });
const mediaParamsSchema = z.object({ key: z.string() });
const attachmentPreviewParamsSchema = z.object({
  eventId: z.string().min(1),
  attachmentId: z.string().min(1),
});
const personHeadshotParamsSchema = z.object({
  eventId: z.string().min(1),
  personId: z.string().min(1),
});
const organizerHeadshotSignBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

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
    summary: "Create an authenticated self-owned upload presign",
    description:
      "Creates a presigned R2 PUT only for a task or profile upload owned by the authenticated session.",
    tags: ["Uploads"],
    request: {
      body: { content: { "application/json": { schema: authenticatedSignRequestSchema } } },
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

const signOrganizerHeadshot = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/people/{personId}/headshot/sign",
    operationId: "signOrganizerPersonHeadshot",
    summary: "Create an organizer headshot upload presign",
    description:
      "Creates a person-owned headshot upload only for an organizer who can edit the conference speaker record. Completion uses the shared authenticated upload verifier.",
    tags: ["Uploads", "Speaker roster"],
    request: {
      params: personHeadshotParamsSchema,
      body: { content: { "application/json": { schema: organizerHeadshotSignBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(uploadPresignResponseSchema, "A presigned R2 PUT and completion token."),
      ...uploadErrorResponses,
    },
  },
  (async (context: Context<ApiEnv>) => {
    const eventId = context.req.param("eventId") ?? "";
    const personId = context.req.param("personId") ?? "";
    const body = await context.req.json<z.infer<typeof organizerHeadshotSignBodySchema>>();
    const auth = getAuth(context);
    if (!auth || !authHasRole(auth, "program_lead", eventId)) {
      return uploadError(context, "forbidden", "organizer access is required for a headshot upload");
    }

    const speaker = await context.env.DB.prepare(
      `SELECT person.id
       FROM people person
       JOIN events conference ON conference.id = ?1 AND conference.org_id = person.org_id
       WHERE person.id = ?2
         AND (
           EXISTS (
             SELECT 1 FROM memberships membership
             WHERE membership.org_id = person.org_id AND membership.event_id = conference.id
               AND membership.person_id = person.id AND ${roleInSql("membership", WORK_HOLDING_PARTICIPATION_ROLES)}
           )
           OR EXISTS (
             SELECT 1 FROM participations participation
             JOIN submissions submission ON submission.id = participation.submission_id
             WHERE submission.event_id = conference.id AND participation.person_id = person.id
           )
         )
       LIMIT 1`,
    ).bind(eventId, personId).first<{ id: string }>();
    if (!speaker) return uploadError(context, "not_found", "speaker not found");

    const env = uploadsEnv(context);
    const policy = policyFor("person_headshot");
    if (!policy) return uploadError(context, "invalid_request", "headshot uploads are not configured");
    const decision = validateDeclared(policy, body);
    if (!decision.ok) return uploadError(context, "invalid_request", `rejected: ${decision.violation}`);

    const attachmentId = crypto.randomUUID();
    const nowMs = Date.now();
    const r2Key = objectKeyFor({ eventId, ownerType: "person_headshot", attachmentId, extension: extensionOf(body.filename) });
    await insertPendingAttachment(env.DB, {
      id: attachmentId,
      eventId,
      ownerType: "person_headshot",
      ownerId: personId,
      filename: sanitizeFilename(body.filename),
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      r2Key,
      nowMs,
    });

    try {
      const presigned = await signUpload(env, { attachmentId, key: r2Key, contentType: body.contentType, nowMs });
      const completionToken = await hmacHex(env.UPLOAD_TOKEN_SECRET, `${attachmentId}:person_headshot:${personId}`);
      return context.json({
        attachmentId,
        putUrl: presigned.url,
        requiredHeaders: presigned.requiredHeaders,
        expiresAt: presigned.expiresAt,
        completionToken,
        maxBytes: policy.maxBytes,
      }, 200);
    } catch (error) {
      await env.DB.prepare("DELETE FROM attachments WHERE id = ?1").bind(attachmentId).run();
      return uploadError(context, "invalid_request", `signing failed: ${(error as Error).message}`);
    }
  }) as never,
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
      "Serves a ready upload only from the configured separate media origin when presented with its short-lived signed URL. The link expires 24 hours after it is issued and is rejected immediately when its attachment or owning speaker participation is revoked; downloads remain attachments with nosniff protection.",
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

const localUploadPut = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/uploads/local/{id}",
    operationId: "putLocalUpload",
    summary: "Accept upload bytes locally in place of a presigned R2 PUT",
    description:
      "Local development only, and refused unless the Worker was started with LOCAL_UPLOAD_SHIM=1. Writes the bytes of an already-signed pending attachment through the MEDIA binding so the normal completion path can verify them, for checkouts with no R2 account to presign against.",
    tags: ["Uploads"],
    request: { params: idParamsSchema },
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(z.object({ ok: z.literal(true) }).openapi("LocalUploadPutResponse"), "The bytes were stored."),
      ...uploadErrorResponses,
    },
  },
  handleLocalPut as never,
);

const previewAttachment = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/attachments/{attachmentId}/preview",
    operationId: "previewSubmissionAttachment",
    summary: "Render a submission file answer's image inline",
    description:
      "Serves the thumbnail an organizer sees on a submission record. Requires the same program access the record itself requires, and serves only a ready raster image an answer on that conference references; anything else 404s.",
    tags: ["Uploads"],
    request: { params: attachmentPreviewParamsSchema },
    policy: {
      auth: { kind: "authenticated" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "image/*": { schema: z.any() } },
        description: "The attachment's image bytes, inline and sandboxed.",
      },
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  handleAttachmentPreview as never,
);

const previewPersonHeadshot = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/people/{personId}/headshot",
    operationId: "previewPersonHeadshot",
    summary: "Render a speaker headshot inline",
    description:
      "Serves the ready raster headshot currently attached to a speaker profile. Organizers need program read access; a speaker session may read only its own event-scoped headshot.",
    tags: ["Uploads"],
    request: { params: personHeadshotParamsSchema },
    policy: {
      auth: { kind: "authenticated" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "image/*": { schema: z.any() } },
        description: "The speaker's ready raster headshot, inline and sandboxed.",
      },
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  handlePersonHeadshot as never,
);

export const apiRoutes = [
  signPublicUpload,
  signTaskUpload,
  signOrganizerHeadshot,
  completePublicUpload,
  completeTaskUpload,
  localUploadPut,
  serveMedia,
  previewAttachment,
  previewPersonHeadshot,
];

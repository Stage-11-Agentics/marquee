import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  BULK_FAILURE_REPORT_LIMIT,
  BULK_ID_LIMIT,
  buildBulkResult,
  bulkResultSchema,
  bulkSelectorWireSchema,
  normalizeBulkSelector,
} from "../api/bulk";
import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { notifyExistingDecisions, writeBulkSubmissionDecisions } from "../jobs/cascade/decisions";
import { buildDecisionPlan, buildNotifyPlan, refuseZeroEffect, requireCurrentDecisionPlan } from "../jobs/cascade/decision-plan-service";
import { decisionPlanResponseSchema } from "../api/decision-plan";
import { getAuth } from "../lib/auth/auth-middleware";
import { PUBLISHED_SESSION_REFUSAL } from "../lib/publication-guard";
import { selectSubmissionIds, submissionFilterSchema, summarizeNotNotifiedSubmissions } from "./submissions.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const submissionIdSchema = z.string().min(1).max(200);
const bulkBodySchema = z
  .object({
    selector: bulkSelectorWireSchema(submissionFilterSchema, submissionIdSchema),
    action: z.enum(["accept", "reject", "waitlist", "withdraw"]),
    feedback_md: z.string().max(50_000).nullable().optional(),
    wave_id: z.string().min(1).max(200).nullable().optional(),
    confirm_published: z.boolean().optional(),
    plan_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const bulkPlanBodySchema = z
  .object({
    selector: bulkSelectorWireSchema(submissionFilterSchema, submissionIdSchema),
    action: z.enum(["accept", "reject", "waitlist", "withdraw"]),
    feedback_md: z.string().max(50_000).nullable().optional(),
    wave_id: z.string().min(1).max(200).nullable().optional(),
    confirm_published: z.boolean().optional(),
  })
  .strict();

const notifiedSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  sendable: z.number().int().nonnegative(),
  no_valid_address: z.number().int().nonnegative(),
  queue_revision: z.number().int().nonnegative(),
});
const notifyQuerySchema = z.object({ cursor: z.string().min(1).max(200).optional() });
const notifyBodySchema = z.object({
  queue_revision: z.number().int().nonnegative(),
}).strict();
const notifyNotifiedResultSchema = z.object({
  selected: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  skipped_no_address: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
  outbox_ids: z.array(z.string()),
  queue_revision: z.number().int().nonnegative(),
});

async function actorFor(context: Context<ApiEnv>): Promise<DecisionActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!token?.created_by) {
    throw ApiError.unauthenticated("the token issuer is no longer available");
  }
  return { kind: "api_token", personId: token.created_by, requestId };
}

async function resolveBulkIds(
  database: ApiEnv["Bindings"]["DB"],
  eventId: string,
  rawSelector: z.infer<typeof bulkPlanBodySchema>["selector"],
): Promise<string[]> {
  const selector = normalizeBulkSelector(rawSelector, (id) => submissionIdSchema.safeParse(id).success);
  if (selector.kind === "ids") return [...new Set(selector.ids)];
  const ids = await selectSubmissionIds(database, {
    eventId,
    ...(selector.filter as z.infer<typeof submissionFilterSchema>),
  });
  if (ids.length > BULK_ID_LIMIT) {
    throw ApiError.unprocessable(`selector resolves to more than ${BULK_ID_LIMIT} submissions; narrow the selection`, "selector");
  }
  return ids;
}

async function assertWaveBelongsToEvent(database: ApiEnv["Bindings"]["DB"], eventId: string, waveId: string | null | undefined): Promise<void> {
  if (!waveId) return;
  const wave = await database
    .prepare("SELECT 1 AS present FROM waves WHERE id = ? AND event_id = ?")
    .bind(waveId, eventId)
    .first<{ present: number }>();
  if (!wave) throw ApiError.badRequest("wave_id does not belong to this conference", "wave_id");
}

const planBulkDecision = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/decision-plan",
    operationId: "planBulkSubmissionDecision",
    summary: "Preview a selected submission decision",
    description: "Build a bounded read-only decision plan with disposition rows, one rendered recipient preview, and a fingerprint for apply.",
    tags: ["Submissions"],
    request: {
      params: eventParams,
      body: { content: { "application/json": { schema: bulkPlanBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(decisionPlanResponseSchema, "The current bounded decision plan."),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const ids = await resolveBulkIds(context.env.DB, eventId, body.selector);
    await assertWaveBelongsToEvent(context.env.DB, eventId, body.wave_id);
    try {
      return context.json(await buildDecisionPlan({
        db: context.env.DB,
        eventId,
        ids,
        action: body.action,
        feedbackMd: body.feedback_md,
        confirmPublished: body.confirm_published === true,
        waveId: body.wave_id,
      }), 200);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "event not found") throw ApiError.notFound("event not found");
      throw error;
    }
  },
);

const planNotifiedSubmissions = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/not-notified/plan",
    operationId: "planDecidedSubmissionsNotification",
    summary: "Preview notifications for decided submissions",
    description: "Build the shared bounded decision plan for the Decided · not notified surface, including one rendered recipient and the current queue revision.",
    tags: ["Submissions"],
    request: { params: eventParams },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(decisionPlanResponseSchema, "The current notification plan."),
      ...errorResponses([401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const ids = await selectSubmissionIds(context.env.DB, { eventId, status: "not_notified" });
    if (ids.length > BULK_ID_LIMIT) {
      throw ApiError.unprocessable(`notification plan is capped at ${BULK_ID_LIMIT} submissions; narrow the selection`, "selection");
    }
    try {
      return context.json(await buildNotifyPlan({ db: context.env.DB, eventId, ids }), 200);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "event not found") throw ApiError.notFound("event not found");
      throw error;
    }
  },
);

const bulkDecideSubmissions = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/bulk",
    operationId: "bulkDecideSubmissions",
    summary: "Apply a confirmed decision to selected conference submissions",
    description:
      "Accept, reject, waitlist, or withdraw a server-selected ID set. Filter selectors are resolved on the server without page materialization.",
    tags: ["Submissions"],
    request: {
      params: eventParams,
      headers: z.object({ "if-match": z.string().min(1).describe("The decision plan's current strong ETag.") }),
      body: { content: { "application/json": { schema: bulkBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "if-match",
    },
    responses: {
      200: jsonResponse(bulkResultSchema, "The per-record bulk decision summary."),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const selector = normalizeBulkSelector(body.selector, (id) => submissionIdSchema.safeParse(id).success);
    let ids: string[];
    if (selector.kind === "ids") {
      ids = [...new Set(selector.ids)];
    } else {
      ids = await selectSubmissionIds(context.env.DB, {
        eventId,
        ...(selector.filter as z.infer<typeof submissionFilterSchema>),
      });
      if (ids.length > BULK_ID_LIMIT) {
        throw ApiError.unprocessable(`selector resolves to more than ${BULK_ID_LIMIT} submissions; narrow the selection`, "selector");
      }
    }
    await assertWaveBelongsToEvent(context.env.DB, eventId, body.wave_id);

    const plan = await buildDecisionPlan({
      db: context.env.DB,
      eventId,
      ids,
      action: body.action,
      feedbackMd: body.feedback_md,
      confirmPublished: body.confirm_published === true,
      waveId: body.wave_id,
    });
    requireCurrentDecisionPlan({
      request: context.req.raw,
      plan,
      planFingerprint: body.plan_fingerprint,
    });
    if (plan.zero_effect) refuseZeroEffect(plan);

    const actor = await actorFor(context);
    const operationId = newUlid();
    const result = await writeBulkSubmissionDecisions({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      ids,
      actor,
      action: body.action,
      feedbackMd: body.feedback_md,
      confirmPublished: body.confirm_published === true,
      cache: context.env.CACHE,
      waveId: body.wave_id,
      operationId,
    });
    const failures = result.results
      .filter((item) => item.outcome === "failed")
      .slice(0, BULK_FAILURE_REPORT_LIMIT)
      .map((item) => ({
        id: item.id,
        code: item.error === PUBLISHED_SESSION_REFUSAL ? "published_while_live" : "transition_failed",
        message: item.error ?? "transition failed",
      }));
    return context.json(buildBulkResult({
      operation_id: operationId,
      selected: result.selected,
      succeeded: result.results.filter((item) => item.outcome === "succeeded").length,
      failed: result.results.filter((item) => item.outcome === "failed").length,
      state: failures.length > 0 ? "completed_with_failures" : "completed",
      outbox_enqueued: result.outboxEnqueued,
      published_count: result.publishedCount,
      failures: failures.length > 0 ? failures : undefined,
      results: result.results.map((item) => ({
        id: item.id,
        outcome: item.outcome,
        resulting_status: item.resultingStatus,
        ...(item.error ? { error: item.error } : {}),
      })),
    }), 200);
  },
);

const getNotifiedSummary = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions/not-notified/summary",
    operationId: "getDecidedNotNotifiedSummary",
    summary: "Summarize decided submissions without delivered notifications",
    description: "Read the derived notification gap behind the built-in Decided · not notified view.",
    tags: ["Submissions"],
    request: { params: eventParams },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(notifiedSummarySchema, "Derived notification gap summary"),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    return context.json(await summarizeNotNotifiedSubmissions(context.env.DB, eventId), 200);
  },
);

const notifyNotifiedSubmissions = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/not-notified/notify",
    operationId: "notifyDecidedSubmissions",
    summary: "Queue notifications for decided submissions",
    description: "Queue a bounded batch of messages for sendable decisions while preserving the existing decision rows byte-for-byte; use next_cursor while remaining is non-zero.",
    tags: ["Submissions"],
    request: {
      params: eventParams,
      query: notifyQuerySchema,
      body: { content: { "application/json": { schema: notifyBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      202: jsonResponse(notifyNotifiedResultSchema, "Notification retry summary"),
      ...errorResponses([400, 401, 403, 409, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const { cursor } = context.req.valid("query");
    const { queue_revision: queueRevision } = context.req.valid("json");
    const ids = await selectSubmissionIds(context.env.DB, { eventId, status: "not_notified" }, { limit: null });
    const result = await notifyExistingDecisions({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionIds: ids,
      queueRevision,
      cursor,
    });
    return context.json({
      selected: result.selected,
      queued: result.queued,
      skipped_no_address: result.skippedNoAddress,
      remaining: result.remaining,
      next_cursor: result.nextCursor,
      outbox_ids: result.outboxIds,
      queue_revision: result.queueRevision,
    }, 202);
  },
);

export const apiRoutes = [planBulkDecision, planNotifiedSubmissions, bulkDecideSubmissions, getNotifiedSummary, notifyNotifiedSubmissions];

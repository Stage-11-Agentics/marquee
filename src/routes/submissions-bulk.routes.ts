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
import { kindFeedbackResponseSchema } from "../api/kind-feedback";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { loadSubmissions, notifyExistingDecisions, writeBulkSubmissionDecisions } from "../jobs/cascade/decisions";
import { buildDecisionPlan, buildNotifyPlan, refuseZeroEffect, requireCurrentDecisionPlan } from "../jobs/cascade/decision-plan-service";
import {
  draftKindFeedback,
  KIND_FEEDBACK_PROVENANCE,
  KIND_FEEDBACK_UNAVAILABLE,
  kindFeedbackConfigured,
  type KindFeedbackEnvironment,
} from "../jobs/ai/kind-feedback";
import { decisionPlanResponseSchema } from "../api/decision-plan";
import { getAuth } from "../lib/auth/auth-middleware";
import { PUBLISHED_SESSION_REFUSAL } from "../lib/publication-guard";
import { canTransitionSubmissionStatus } from "../lib/submission-transitions";
import { selectSubmissionIds, submissionFilterSchema, summarizeNotNotifiedSubmissions } from "./submissions.queries";
import { claimRequestOperation, completeRequestOperation, dispatchRequestOperationNow, eventOperationScope, linkRequestOperationOutbox, markRequestOperationDispatchPending } from "../lib/request-operations";

const eventParams = z.object({ eventId: z.string().min(1) });
const idempotencyKeyHeaders = z.object({
  "idempotency-key": z.string().trim().min(1).max(200).optional(),
});
const submissionIdSchema = z.string().trim().min(1).max(200);
const bulkBodySchema = z
  .object({
    selector: bulkSelectorWireSchema(submissionFilterSchema, submissionIdSchema),
    action: z.enum(["accept", "reject", "waitlist", "withdraw"]),
    feedback_md: z.string().max(50_000).nullable().optional(),
    internal_note: z.string().max(5_000).nullable().optional(),
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
  operation: z.object({
    operation_id: z.string(),
    effect: z.enum(["changed", "no_op"]),
    reason_code: z.string().nullable(),
    notice: z.string().nullable(),
    duplicate_skipped: z.number().int().nonnegative(),
    dispatch_state: z.enum(["not_required", "pending", "dispatched"]),
  }),
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
        kindFeedbackEnabled: kindFeedbackConfigured(context.env),
      }), 200);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "event not found") throw ApiError.notFound("event not found");
      throw error;
    }
  },
);

const bulkKindFeedbackBodySchema = z
  .object({
    selector: bulkSelectorWireSchema(submissionFilterSchema, submissionIdSchema),
    action: z.enum(["accept", "reject", "waitlist", "withdraw"]),
    internal_note: z.string().max(5_000).nullable().optional(),
    confirm_published: z.boolean().optional(),
    wave_id: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

const draftBulkKindFeedback = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/decision-plan/kind-feedback",
    operationId: "draftBulkKindFeedback",
    summary: "Draft shared kind rejection feedback",
    description: "Make one model call for a bulk rejection and place the shared editable paragraph in the decision dialog; confirmation still controls every send.",
    tags: ["Submissions"],
    request: {
      params: eventParams,
      body: { content: { "application/json": { schema: bulkKindFeedbackBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(kindFeedbackResponseSchema, "The shared editable kind feedback paragraph or a non-blocking unavailable notice."),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    if (body.action !== "reject") {
      throw ApiError.badRequest("kind feedback is available for rejection decisions only", "action");
    }
    const ids = await resolveBulkIds(context.env.DB, eventId, body.selector);
    await assertWaveBelongsToEvent(context.env.DB, eventId, body.wave_id);
    const submissions = await loadSubmissions(context.env.DB, eventId, ids);
    if (submissions.length !== ids.length || submissions.length === 0) {
      throw ApiError.conflict("Every selected submission must still exist before drafting feedback.");
    }
    for (const submission of submissions) {
      const transitionError = canTransitionSubmissionStatus(submission.status, "rejected", "organizer");
      if (transitionError) throw ApiError.conflict(transitionError);
      if (submission.agenda_published === 1 && body.confirm_published !== true) {
        throw ApiError.conflict(PUBLISHED_SESSION_REFUSAL);
      }
    }
    const first = submissions[0]!;
    const tracks = new Set(submissions.map((submission) => submission.track_name).filter(Boolean));
    const track = tracks.size === 1 ? [...tracks][0]! : tracks.size > 1 ? "multiple tracks" : null;
    const actor = await actorFor(context);
    const result = await draftKindFeedback({
      actorPersonId: actor.personId,
      context: {
        decision: "reject",
        eventName: first.event_name,
        internalNote: body.internal_note ?? "",
        selectedCount: submissions.length,
        title: submissions.length === 1 ? first.title : `${submissions.length} selected submissions`,
        track,
      },
      environment: context.env as unknown as KindFeedbackEnvironment,
      eventId,
    });
    return context.json({
      paragraph: result.paragraph ?? null,
      notice: result.ok ? null : KIND_FEEDBACK_UNAVAILABLE,
      provenance: result.ok ? KIND_FEEDBACK_PROVENANCE : null,
    }, 200);
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

type BulkFailureCode =
  | "UNKNOWN_ID"
  | "FOREIGN_EVENT"
  | "ILLEGAL_DECISION"
  | "LIVE_REFUSED"
  | "STALE_SELECTION"
  | "NO_VALID_ADDRESS";

function bulkFailureCode(
  item: { id: string; error?: string },
  foreignIds: ReadonlySet<string>,
): BulkFailureCode {
  const message = item.error ?? "transition failed";
  if (message === "submission not found") return foreignIds.has(item.id) ? "FOREIGN_EVENT" : "UNKNOWN_ID";
  if (message === PUBLISHED_SESSION_REFUSAL) return "LIVE_REFUSED";
  if (/no valid email|no valid address/i.test(message)) return "NO_VALID_ADDRESS";
  if (/changed during|stale selection/i.test(message)) return "STALE_SELECTION";
  return "ILLEGAL_DECISION";
}

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
      headers: z.object({
        "if-match": z.string().min(1).describe("The decision plan's current strong ETag."),
        "idempotency-key": idempotencyKeyHeaders.shape["idempotency-key"],
      }),
      body: { content: { "application/json": { schema: bulkBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "if-match",
    },
    responses: {
      200: jsonResponse(bulkResultSchema, "The per-record bulk decision summary."),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500, 503]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const selector = normalizeBulkSelector(body.selector, (id) => submissionIdSchema.safeParse(id).success);
    const actor = await actorFor(context);
    const requestId = context.get("requestId") ?? crypto.randomUUID();
    const duplicateSkipped = selector.kind === "ids" ? selector.ids.length - new Set(selector.ids).size : 0;
    const scope = await eventOperationScope(context.env.DB, eventId);
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
      if (ids.length === 0) {
        throw ApiError.notFound("that selection resolves to nobody in this conference");
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
    // The preview/apply contract refuses an unkeyed zero-effect action before
    // mutation. A keyed request is an admitted operation, so it records and
    // replays the durable no-op receipt instead of losing that audit seam.
    if (plan.zero_effect && !context.req.header("Idempotency-Key")) refuseZeroEffect(plan);

    const operation = await claimRequestOperation({
      db: context.env.DB,
      scope,
      route: "events.submissions.bulk",
      idempotencyKey: context.req.header("Idempotency-Key"),
      requestId,
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      request: body,
    });
    if (operation.replay) return context.json(operation.replay.body, operation.replay.status as 200);
    const foreignIds = new Set<string>();
    if (selector.kind === "ids") {
      const existing = await context.env.DB.prepare(
        "SELECT id, event_id FROM submissions WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))",
      ).bind(JSON.stringify(ids)).all<{ id: string; event_id: string }>();
      for (const row of existing.results) {
        if (row.event_id !== eventId) foreignIds.add(row.id);
      }
    }
    const result = await writeBulkSubmissionDecisions({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      ids,
      actor,
      action: body.action,
      feedbackMd: body.feedback_md,
      internalNote: body.internal_note,
      confirmPublished: body.confirm_published === true,
      cache: context.env.CACHE,
      waveId: body.wave_id,
      operationId: operation.operationId,
      origin: new URL(context.req.url).origin,
      dispatchMail: false,
    });
    const failureCodeById = new Map(
      result.results
        .filter((item) => item.outcome === "failed")
        .map((item) => [item.id, bulkFailureCode(item, foreignIds)] as const),
    );
    const failureRows = result.results
      .filter((item) => item.outcome === "failed")
      .slice(0, BULK_FAILURE_REPORT_LIMIT)
      .map((item) => ({
        id: item.id,
        code: failureCodeById.get(item.id) ?? "ILLEGAL_DECISION",
        message: item.error ?? "transition failed",
      }));
    const succeeded = result.results.filter((item) => item.outcome === "succeeded").length;
    const alreadyInState = result.results.filter((item) => item.outcome === "already_in_state").length;
    const failed = result.results.filter((item) => item.outcome === "failed").length;
    const allAlready = succeeded === 0 && alreadyInState === result.selected && failed === 0;
    const allFailed = succeeded === 0 && failed > 0;
    const outboxIds = result.outboxIds;
    const operationResult = {
      operation_id: operation.operationId,
      effect: succeeded > 0 ? "changed" as const : "no_op" as const,
      reason_code: allAlready ? "ALREADY_IN_STATE" : allFailed ? "ALL_FAILED" : null,
      notice: allAlready
        ? `Nothing changed — every ${alreadyInState} selected record${alreadyInState === 1 ? " is" : "s are"} already in state`
        : allFailed
          ? `Nothing changed — all ${failed + alreadyInState} selected records were refused`
          : `${succeeded} selected record${succeeded === 1 ? " was" : "s were"} changed`,
      duplicate_skipped: duplicateSkipped,
      dispatch_state: outboxIds.length > 0 ? "pending" as const : "not_required" as const,
    };
    const failures = failureRows.length > 0 ? failureRows : undefined;
    const firstFailure = failureRows[0] ?? null;
    const pendingBody = buildBulkResult({
      operation_id: operation.operationId,
      selected: result.selected,
      succeeded,
      already_in_state: alreadyInState,
      failed,
      state: allAlready ? "completed_noop" : failures ? "completed_with_failures" : "completed",
      outbox_enqueued: result.outboxEnqueued,
      outbox_ids: outboxIds,
      published_count: result.publishedCount,
      failures,
      first_failure: firstFailure,
      operation: operationResult,
      results: result.results.map((item) => ({
        id: item.id,
        outcome: item.outcome,
        resulting_status: item.resultingStatus,
        ...(item.outcome === "already_in_state"
          ? { error: { code: "ALREADY_IN_STATE", message: `submission is already ${item.resultingStatus}` } }
          : item.error ? { error: { code: failureCodeById.get(item.id) ?? "ILLEGAL_DECISION", message: item.error } } : {}),
      })),
    });
    await linkRequestOperationOutbox(context.env.DB, operation.operationId, outboxIds);
    if (outboxIds.length > 0) {
      const dispatchAdmitted = await markRequestOperationDispatchPending(context.env.DB, operation.operationId, 200, pendingBody, outboxIds, { claimToken: operation.claimToken });
      if (!dispatchAdmitted) throw ApiError.conflict("the operation claim was reclaimed before mail dispatch", { code: "operation_in_flight", operation_id: operation.operationId });
      await dispatchRequestOperationNow(context.env.DB, context.env.MAIL_QUEUE, operation.operationId, outboxIds);
    }
    const bodyOut = buildBulkResult({
      ...pendingBody,
      operation: {
        ...operationResult,
        dispatch_state: outboxIds.length > 0 ? "dispatched" as const : "not_required" as const,
      },
    });
    if (allFailed) {
      const error = ApiError.conflict(operationResult.notice, bodyOut);
      await completeRequestOperation(context.env.DB, operation.operationId, 409, error.toEnvelope(requestId), { state: "failed", claimToken: operation.claimToken });
      throw error;
    }
    await completeRequestOperation(context.env.DB, operation.operationId, 200, bodyOut, { outboxIds, claimToken: operation.claimToken, dispatchClaimToken: operation.operationId });
    return context.json(bodyOut, 200);
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
      ...errorResponses([401, 403, 409, 429, 500, 503]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const { cursor } = context.req.valid("query");
    const { queue_revision: queueRevision } = context.req.valid("json");
    const actor = await actorFor(context);
    const requestId = context.get("requestId") ?? crypto.randomUUID();
    const operation = await claimRequestOperation({
      db: context.env.DB,
      scope: await eventOperationScope(context.env.DB, eventId),
      route: "events.submissions.not_notified.notify",
      requestId,
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      request: { cursor: cursor ?? null, queue_revision: queueRevision },
    });
    if (operation.replay) return context.json(operation.replay.body, operation.replay.status as 202);
    const ids = await selectSubmissionIds(context.env.DB, { eventId, status: "not_notified" }, { limit: null });
    const result = await notifyExistingDecisions({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionIds: ids,
      queueRevision,
      cursor,
      origin: new URL(context.req.url).origin,
      dispatch: false,
    });
    const noDecisionsRemain = result.selected === 0
      && result.skippedNoAddress === 0
      && result.queued === 0
      && result.remaining === 0;
    const noValidRecipient = result.selected === 0 && result.skippedNoAddress > 0;
    const operationResponse = {
      operation_id: operation.operationId,
      effect: result.outboxIds.length > 0 ? "changed" as const : "no_op" as const,
      reason_code: noDecisionsRemain
        ? "NO_DECISIONS_REMAIN"
        : noValidRecipient
          ? "NO_VALID_RECIPIENT"
          : result.outboxIds.length > 0 ? null : "NO_VALID_RECIPIENT",
      notice: noDecisionsRemain
        ? "Nothing changed — no undecided notification remains to send"
        : noValidRecipient
          ? "Nothing changed — every remaining decision has no valid address"
          : result.outboxIds.length > 0
            ? `Queued ${result.outboxIds.length} notification${result.outboxIds.length === 1 ? "" : "s"}`
            : "Nothing changed — no new notification was queued",
      duplicate_skipped: 0,
      dispatch_state: result.outboxIds.length > 0 ? "pending" as const : "not_required" as const,
    };
    if (noDecisionsRemain) {
      const error = ApiError.conflict(operationResponse.notice!, { operation: operationResponse });
      await completeRequestOperation(context.env.DB, operation.operationId, 409, error.toEnvelope(requestId), { state: "failed", claimToken: operation.claimToken });
      throw error;
    }
    const pendingResponse = {
      selected: result.selected,
      queued: result.queued,
      skipped_no_address: result.skippedNoAddress,
      remaining: result.remaining,
      next_cursor: result.nextCursor,
      outbox_ids: result.outboxIds,
      queue_revision: result.queueRevision,
      operation: operationResponse,
    };
    await linkRequestOperationOutbox(context.env.DB, operation.operationId, result.outboxIds);
    if (result.outboxIds.length > 0) {
      const dispatchAdmitted = await markRequestOperationDispatchPending(context.env.DB, operation.operationId, 202, pendingResponse, result.outboxIds, { claimToken: operation.claimToken });
      if (!dispatchAdmitted) throw ApiError.conflict("the operation claim was reclaimed before mail dispatch", { code: "operation_in_flight", operation_id: operation.operationId });
      await dispatchRequestOperationNow(context.env.DB, context.env.MAIL_QUEUE, operation.operationId, result.outboxIds);
    }
    const response = {
      ...pendingResponse,
      operation: {
        ...operationResponse,
        dispatch_state: result.outboxIds.length > 0 ? "dispatched" as const : "not_required" as const,
      },
    };
    await completeRequestOperation(context.env.DB, operation.operationId, 202, response, { outboxIds: result.outboxIds, claimToken: operation.claimToken, dispatchClaimToken: operation.operationId });
    return context.json(response, 202);
  },
);

export const apiRoutes = [planBulkDecision, draftBulkKindFeedback, planNotifiedSubmissions, bulkDecideSubmissions, getNotifiedSummary, notifyNotifiedSubmissions];

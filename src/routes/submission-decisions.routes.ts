import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { decisionPlanResponseSchema } from "../api/decision-plan";
import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { loadSubmission, resendSubmissionDecision, writeSubmissionDecision } from "../jobs/cascade/decisions";
import { buildDecisionPlan, refuseZeroEffect, requireCurrentDecisionPlan } from "../jobs/cascade/decision-plan-service";
import { PUBLISHED_SESSION_REFUSAL } from "../lib/publication-guard";
import { getAuth } from "../lib/auth/auth-middleware";

const eventSubmissionParams = z.object({
  eventId: z.string().min(1),
  submissionId: z.string().min(1),
});

const decisionBodySchema = z
  .object({
    recommendation: z.enum(["approve", "maybe", "deny"]),
    feedback_md: z.string().max(50_000).nullable().optional(),
    internal_note: z.string().max(5_000).nullable().optional(),
    confirm_published: z.boolean().optional(),
    plan_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const decisionResponseSchema = z
  .object({
    submission_id: z.string(),
    decision: z.enum(["approve", "maybe", "deny"]),
    resulting_status: z.enum(["accepted", "waitlisted", "rejected"]),
    decision_id: z.string(),
    outbox_id: z.string().nullable(),
    outbox_inserted: z.boolean(),
    tasks_assigned: z.number().int().min(0),
  })
  .openapi("SubmissionDecisionResult");

const resendDecisionResponseSchema = z
  .object({
    submission_id: z.string(),
    decision_id: z.string(),
    resulting_status: z.enum(["accepted", "rejected"]),
    outbox_id: z.string().nullable(),
    outbox_inserted: z.boolean(),
  })
  .openapi("SubmissionDecisionResendResult");

const planDecision = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/decision-plan",
    operationId: "planSubmissionDecision",
    summary: "Preview one submission decision",
    description: "Build the same bounded decision plan contract for one record before applying its recommendation.",
    tags: ["Submissions"],
    request: {
      params: eventSubmissionParams,
      body: { content: { "application/json": { schema: decisionBodySchema.omit({ plan_fingerprint: true }) } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(decisionPlanResponseSchema, "The current one-record decision plan."),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const submission = await loadSubmission(context.env.DB, eventId, submissionId);
    if (!submission) throw ApiError.notFound("submission not found");
    const action = body.recommendation === "approve"
      ? "accept"
      : body.recommendation === "deny"
        ? "reject"
        : "waitlist";
    return context.json(await buildDecisionPlan({
      db: context.env.DB,
      eventId,
      ids: [submissionId],
      action,
      feedbackMd: body.feedback_md,
      confirmPublished: body.confirm_published === true,
    }), 200);
  },
);

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

const decideSubmission = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/decision",
    operationId: "decideSubmission",
    summary: "Record a conference program decision",
    description:
      "Persists the record-owned recommendation, resulting status, acceptance cascade, and rendered demo-safe outbox message.",
    tags: ["Submissions"],
    request: {
      params: eventSubmissionParams,
      headers: z.object({ "if-match": z.string().min(1).describe("The decision plan's current strong ETag.") }),
      body: { content: { "application/json": { schema: decisionBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "if-match",
    },
    responses: {
      200: jsonResponse(decisionResponseSchema, "The decision and cascade result."),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const plan = await buildDecisionPlan({
      db: context.env.DB,
      eventId,
      ids: [submissionId],
      action: body.recommendation === "approve" ? "accept" : body.recommendation === "deny" ? "reject" : "waitlist",
      feedbackMd: body.feedback_md,
      confirmPublished: body.confirm_published === true,
    });
    requireCurrentDecisionPlan({
      request: context.req.raw,
      plan,
      planFingerprint: body.plan_fingerprint,
    });
    if (plan.zero_effect) refuseZeroEffect(plan);
    const actor = await actorFor(context);
    const result = await writeSubmissionDecision({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionId,
      actor,
      recommendation: body.recommendation,
      feedbackMd: body.feedback_md,
      confirmPublished: body.confirm_published === true,
      cache: context.env.CACHE,
      internalNote: body.internal_note,
      origin: new URL(context.req.url).origin,
    });
    if (result.outcome === "failed") {
      if (result.error === "submission not found") throw ApiError.notFound("submission not found");
      if (result.error === PUBLISHED_SESSION_REFUSAL) throw ApiError.conflict(result.error);
      throw ApiError.unprocessable(result.error ?? "decision could not be applied");
    }
    if (!result.resultingStatus || !result.decisionId) {
      throw new Error("decision completed without a durable decision row");
    }
    return context.json({
      submission_id: result.id,
      decision: body.recommendation,
      resulting_status: result.resultingStatus,
      decision_id: result.decisionId,
      outbox_id: result.outboxId ?? null,
      outbox_inserted: result.outboxInserted,
      tasks_assigned: result.tasksAssigned,
    }, 200);
  },
);

const resendDecision = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/decision/resend",
    operationId: "resendSubmissionDecision",
    summary: "Send one recorded decision again",
    description:
      "Queues a deliberate per-record retry using the current speaker address without changing the decision or bulk-notify eligibility.",
    tags: ["Submissions"],
    request: { params: eventSubmissionParams },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      202: jsonResponse(resendDecisionResponseSchema, "The deliberate resend was queued."),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const actor = await actorFor(context);
    const result = await resendSubmissionDecision({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionId,
      actor,
      origin: new URL(context.req.url).origin,
    });
    if (result.outcome === "failed") {
      if (result.error === "submission not found") throw ApiError.notFound("submission not found");
      if (result.error === "only accepted or rejected decisions can be resent" || result.error === "no accepted or rejected decision exists to resend") {
        throw ApiError.conflict(result.error);
      }
      throw ApiError.unprocessable(result.error ?? "the decision could not be resent");
    }
    if (!result.decisionId || !result.resultingStatus) {
      throw new Error("resend completed without a durable decision row");
    }
    return context.json({
      submission_id: result.id,
      decision_id: result.decisionId,
      resulting_status: result.resultingStatus,
      outbox_id: result.outboxId ?? null,
      outbox_inserted: result.outboxInserted,
    }, 202);
  },
);

export const apiRoutes = [planDecision, decideSubmission, resendDecision];

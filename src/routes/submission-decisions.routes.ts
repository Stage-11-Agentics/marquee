import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { writeSubmissionDecision } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";

const eventSubmissionParams = z.object({
  eventId: z.string().min(1),
  submissionId: z.string().min(1),
});

const decisionBodySchema = z
  .object({
    recommendation: z.enum(["approve", "maybe", "deny"]),
    feedback_md: z.string().max(50_000).nullable().optional(),
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

async function actorFor(context: Context<ApiEnv>): Promise<DecisionActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return { kind: "user", personId: auth.personId };
  const token = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!token?.created_by) {
    throw ApiError.unauthenticated("the token issuer is no longer available");
  }
  return { kind: "api_token", personId: token.created_by };
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
      body: { content: { "application/json": { schema: decisionBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(decisionResponseSchema, "The decision and cascade result."),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const actor = await actorFor(context);
    const result = await writeSubmissionDecision({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionId,
      actor,
      recommendation: body.recommendation,
      feedbackMd: body.feedback_md,
    });
    if (result.outcome === "failed") {
      if (result.error === "submission not found") throw ApiError.notFound("submission not found");
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

export const apiRoutes = [decideSubmission];

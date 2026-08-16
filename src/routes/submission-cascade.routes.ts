import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { runOnboardingCascade } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";

const paramsSchema = z.object({
  eventId: z.string().min(1),
  submissionId: z.string().min(1).max(200),
});

const resultSchema = z.object({
  submission_id: z.string(),
  tasks_assigned: z.number().int().nonnegative(),
  notifications_queued: z.number().int().nonnegative(),
  skipped_no_address: z.number().int().nonnegative(),
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
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { kind: "api_token", personId: token.created_by, requestId };
}

const runSubmissionOnboardingCascade = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/onboarding-cascade",
    operationId: "runSubmissionOnboardingCascade",
    summary: "Run onboarding after an Airtable decision edit",
    description:
      "Explicitly applies accepted-submission onboarding tasks and retries the existing decision notification after an inbound Airtable edit.",
    tags: ["Submissions"],
    request: { params: paramsSchema },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(resultSchema, "Onboarding cascade effects."),
      ...errorResponses([401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const result = await runOnboardingCascade({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      submissionId,
      actor: await actorFor(context),
      origin: new URL(context.req.url).origin,
    });
    if (result.outcome === "failed") {
      throw ApiError.unprocessable(result.error ?? "the onboarding cascade could not run");
    }
    return context.json({
      submission_id: result.id,
      tasks_assigned: result.tasksAssigned,
      notifications_queued: result.notificationsQueued,
      skipped_no_address: result.skippedNoAddress,
    }, 200);
  },
);

export const apiRoutes = [runSubmissionOnboardingCascade];

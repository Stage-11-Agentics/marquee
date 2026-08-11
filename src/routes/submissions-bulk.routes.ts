import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  BULK_FAILURE_REPORT_LIMIT,
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
import { writeBulkSubmissionDecisions } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";
import { selectSubmissionIds, submissionFilterSchema } from "./submissions.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const submissionIdSchema = z.string().min(1).max(200);
const bulkBodySchema = z
  .object({
    selector: bulkSelectorWireSchema(submissionFilterSchema, submissionIdSchema),
    action: z.enum(["accept", "reject", "waitlist", "withdraw"]),
    wave_id: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

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
      body: { content: { "application/json": { schema: bulkBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(bulkResultSchema, "The per-record bulk decision summary."),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
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
    }
    if (body.wave_id) {
      const wave = await context.env.DB
        .prepare("SELECT 1 AS present FROM waves WHERE id = ? AND event_id = ?")
        .bind(body.wave_id, eventId)
        .first<{ present: number }>();
      if (!wave) throw ApiError.badRequest("wave_id does not belong to this conference", "wave_id");
    }

    const actor = await actorFor(context);
    const operationId = newUlid();
    const result = await writeBulkSubmissionDecisions({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      ids,
      actor,
      action: body.action,
      waveId: body.wave_id,
      operationId,
    });
    const failures = result.results
      .filter((item) => item.outcome === "failed")
      .slice(0, BULK_FAILURE_REPORT_LIMIT)
      .map((item) => ({
        id: item.id,
        code: "transition_failed",
        message: item.error ?? "transition failed",
      }));
    return context.json(buildBulkResult({
      operation_id: operationId,
      selected: result.selected,
      succeeded: result.results.filter((item) => item.outcome === "succeeded").length,
      failed: result.results.filter((item) => item.outcome === "failed").length,
      state: failures.length > 0 ? "completed_with_failures" : "completed",
      outbox_enqueued: result.outboxEnqueued,
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

export const apiRoutes = [bulkDecideSubmissions];

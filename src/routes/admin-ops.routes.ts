import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { Env } from "../index";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { EventRow } from "../db/schema";
import { forbidden, getAuth, unauthorized } from "../lib/auth/auth-middleware";
import { authHasRole } from "../lib/auth/scope-resolution";
import { SHIPPED_DEMO_EVENT_ID } from "../lib/reset-demo/demo-fixture";
import { createResetJob, readResetJob } from "../lib/reset-demo/reset-jobs";

/**
 * Operational reset routes retain their local-validation and session checks in
 * the handlers. Defining them here makes the generated manifest and OpenAPI
 * aware of the same queue-backed operations used by the demo UI and script.
 */

export const RESET_DEMO_MESSAGE_TYPE = "reset_demo";

const authErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const resetJobSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "done", "failed"]),
  created_at: z.number(),
  updated_at: z.number(),
  error: z.string().optional(),
  result: z.unknown().optional(),
});
const resetJobIdParams = z.object({ jobId: z.string().min(1) });

const enqueueDemoReset = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/admin/reset-demo",
    operationId: "enqueueDemoReset",
    summary: "Queue a restoration of the seeded demo state",
    description:
      "Requires the local validation header or an owner/program-lead session for the demo event.",
    tags: ["Admin"],
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      202: jsonResponse(
        z.object({ ok: z.literal(true), job_id: z.string(), status: z.literal("queued") }),
        "The reset job was queued.",
      ),
      401: jsonResponse(authErrorSchema, "Authentication is required without local validation."),
      403: jsonResponse(authErrorSchema, "The demo is disabled or the session lacks scope."),
      ...errorResponses([429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const event = await context.env.DB.prepare(
      "SELECT * FROM events WHERE id = ? AND demo_mode = 1",
    ).bind(SHIPPED_DEMO_EVENT_ID).first<EventRow>();
    if (!event) {
      return context.json(
        { error: { code: "demo_disabled", message: "Reset is only available in demo mode" } },
        403,
      );
    }

    if (!passesLocalValidation(context) && !passesSessionScope(context, event.id)) {
      return getAuth(context)
        ? forbidden(context, "Reset requires an owner or program lead of the demo event")
        : unauthorized(context);
    }

    const job = await createResetJob(context.env.CACHE);
    await (context.env as unknown as Env).OPERATIONS_QUEUE.send({
      type: RESET_DEMO_MESSAGE_TYPE,
      job_id: job.id,
    });
    context.header("Cache-Control", "no-store");
    return context.json({ ok: true as const, job_id: job.id, status: job.status }, 202);
  }) as never,
);

const getDemoResetJob = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/admin/reset-demo/{jobId}",
    operationId: "getDemoResetJob",
    summary: "Read a queued demo reset job",
    tags: ["Admin"],
    request: { params: resetJobIdParams },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(resetJobSchema, "The reset job state."),
      404: jsonResponse(authErrorSchema, "The reset job does not exist."),
      ...errorResponses([429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const jobId = context.req.param("jobId");
    if (!jobId) {
      return context.json(
        { error: { code: "not_found", message: "Unknown reset job" } },
        404,
      );
    }
    const job = await readResetJob(context.env.CACHE, jobId);
    if (!job) {
      return context.json(
        { error: { code: "not_found", message: "Unknown reset job" } },
        404,
      );
    }
    context.header("Cache-Control", "no-store");
    return context.json(job, 200);
  }) as never,
);

function passesLocalValidation(context: Context<ApiEnv>): boolean {
  const expected = (context.env as unknown as Env).LOCAL_VALIDATION_TOKEN;
  return (
    expected !== undefined &&
    context.req.header("x-marquee-local-validation") === expected
  );
}

function passesSessionScope(
  context: Context<ApiEnv>,
  eventId: string,
): boolean {
  const auth = getAuth(context);
  if (!auth) return false;
  return authHasRole(auth, "program_lead", eventId);
}

export const apiRoutes = [enqueueDemoReset, getDemoResetJob];

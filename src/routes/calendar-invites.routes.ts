import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { sendCalendarInvites } from "../jobs/calendar/invites";
import { getAuth } from "../lib/auth/auth-middleware";

const params = z.object({
  eventId: z.string().min(1),
  submissionId: z.string().min(1),
});

const deliverySchema = z.object({
  method: z.literal("REQUEST"),
  outbox_id: z.string(),
  outbox_inserted: z.boolean(),
  person_id: z.string(),
  sequence: z.number().int().nonnegative(),
  uid: z.string(),
});

const inviteResponseSchema = z.object({
  data: z.array(deliverySchema),
  queued: z.number().int().nonnegative(),
});

function smokeHarnessRequested(context: Parameters<typeof getAuth>[0]): boolean {
  return context.req.header("x-marquee-smoke-harness") === "1" && getAuth(context)?.kind === "token";
}

const sendInvites = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/invites",
    operationId: "sendSubmissionCalendarInvites",
    summary: "Queue calendar invitations for a scheduled submission",
    description:
      "Queues one demo-safe METHOD:REQUEST invite per speaker/submitter. An authenticated smoke harness may explicitly opt into the live G3 policy; re-sends retain the original UID and increment SEQUENCE.",
    tags: ["Calendar"],
    request: { params },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(inviteResponseSchema, "Queued calendar invitations."),
      ...errorResponses([401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const submission = await context.env.DB
      .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ?")
      .bind(submissionId, eventId)
      .first<{ id: string }>();
    if (!submission) throw ApiError.notFound("submission not found");
    let deliveries;
    try {
      deliveries = await sendCalendarInvites({
        db: context.env.DB,
        eventId,
        origin: new URL(context.req.url).origin,
        queue: context.env.MAIL_QUEUE,
        submissionId,
        smokeHarness: smokeHarnessRequested(context),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "submission has no scheduled session") {
        throw ApiError.unprocessable("calendar invites require a scheduled session");
      }
      throw error;
    }
    return context.json({ data: deliveries, queued: deliveries.filter((delivery) => delivery.outbox_inserted).length }, 200);
  },
);

export const apiRoutes = [sendInvites];

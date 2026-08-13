import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  applyResendDeliveryEvent,
  parseResendDeliveryEvent,
  verifySvixSignature,
} from "../lib/inbound-delivery";

const receivedResponse = z.object({ received: z.literal(true) }).openapi("ResendWebhookReceived");

const postResendWebhook = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/webhooks/resend",
    operationId: "receiveResendWebhook",
    summary: "Receive delivery events from Resend",
    description:
      "Accepts Resend delivery events after verifying the Svix signature. Delivery is joined to an outbox row by provider message id and applied in provider event order; unknown message ids are acknowledged without disclosure.",
    tags: ["Webhooks"],
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(receivedResponse, "The event was accepted."),
      ...errorResponses([400, 401, 429, 500]),
    },
  },
  async (context) => {
    const body = await context.req.raw.text();
    const valid = await verifySvixSignature({
      body,
      secret: context.env.RESEND_WEBHOOK_SECRET,
      headers: {
        id: context.req.header("svix-id") ?? null,
        timestamp: context.req.header("svix-timestamp") ?? null,
        signature: context.req.header("svix-signature") ?? null,
      },
    });
    if (!valid) throw ApiError.unauthenticated("invalid webhook signature");

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw ApiError.badRequest("webhook body must be valid JSON");
    }

    const eventId = context.req.header("svix-id")?.trim();
    if (!eventId) throw ApiError.unauthenticated("invalid webhook signature");

    let event;
    try {
      event = parseResendDeliveryEvent(payload, eventId);
    } catch {
      throw ApiError.badRequest("webhook event is malformed");
    }

    // Resend sends more event kinds than the delivery states Marquee needs.
    // They are validly signed and acknowledged, but they carry no state we can
    // safely join to the delivery ledger.
    if (event) await applyResendDeliveryEvent(context.env.DB, event);

    context.header("Cache-Control", "no-store");
    return context.json({ received: true }, 200);
  },
);

export const apiRoutes = [postResendWebhook];

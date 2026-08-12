import { z } from "@hono/zod-openapi";

import type {
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookEventType,
} from "../db/schema";
import { WEBHOOK_EVENT_TYPES } from "../db/schema";
import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { constantTimeEqualHex, mintToken, sha256Hex } from "../lib/auth/random-token";

const eventParams = z.object({ eventId: z.string().min(1) });
const webhookParams = eventParams.extend({ webhookId: z.string().min(1) });

const webhookEvent = z.enum(WEBHOOK_EVENT_TYPES);

const httpsUrl = z
  .string()
  .trim()
  .url("enter a valid webhook URL")
  .refine((value: string) => value.startsWith("https://"), "webhook URL must use https://");

const webhookEvents = z
  .array(webhookEvent)
  .min(1, "choose at least one event")
  .max(6)
  .refine((events: WebhookEventType[]) => new Set(events).size === events.length, "events must not contain duplicates");

const endpointInput = z.object({
  url: httpsUrl,
  events: webhookEvents,
  enabled: z.boolean().default(true),
});

const endpointPatch = z.object({
  url: httpsUrl.optional(),
  events: webhookEvents.optional(),
  enabled: z.boolean().optional(),
}).strict();

/** The raw secret is deliberately never part of an endpoint response. */
const testInput = z.object({ secret: z.string().trim().min(1) });

const endpointSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  url: z.string(),
  events: z.array(webhookEvent),
  enabled: z.boolean(),
  created_at: z.number(),
  last_delivery_at: z.number().nullable(),
});

const deliverySchema = z.object({
  id: z.string(),
  endpoint_id: z.string(),
  event_type: webhookEvent,
  payload: z.string(),
  status: z.enum(["queued", "delivered", "failed"]),
  attempts: z.number().int().nonnegative(),
  response_code: z.number().int().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  delivered_at: z.number().nullable(),
});

const errors = errorResponses([400, 401, 403, 404, 422, 500]);
const endpointListResponse = z.object({ data: z.array(endpointSchema) });
const endpointResponse = jsonResponse(z.object({ data: endpointSchema }), "Webhook endpoint");
const endpointCreateResponse = jsonResponse(
  z.object({ data: endpointSchema, secret: z.string() }),
  "Webhook endpoint and one-time signing secret",
);
const deliveryListResponse = z.object({ data: z.array(deliverySchema) });
const deliveryResponse = jsonResponse(z.object({ data: deliverySchema }), "Webhook delivery result");

const EVENT_TYPES: readonly WebhookEventType[] = WEBHOOK_EVENT_TYPES;

function eventsFromRow(row: Pick<WebhookEndpointRow, "events_json">): WebhookEventType[] {
  return JSON.parse(row.events_json) as WebhookEventType[];
}

function summarizeEndpoint(row: WebhookEndpointRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    url: row.url,
    events: eventsFromRow(row),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    last_delivery_at: row.last_delivery_at,
  };
}

function summarizeDelivery(row: WebhookDeliveryRow) {
  return {
    id: row.id,
    endpoint_id: row.endpoint_id,
    event_type: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    response_code: row.response_code,
    error: row.error,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  };
}

async function assertEventExists(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
  if (!event) throw ApiError.notFound("conference not found");
}

async function endpointFor(db: D1Database, eventId: string, webhookId: string): Promise<WebhookEndpointRow> {
  const row = await db
    .prepare("SELECT * FROM webhook_endpoints WHERE id = ? AND event_id = ?")
    .bind(webhookId, eventId)
    .first<WebhookEndpointRow>();
  if (!row) throw ApiError.notFound("webhook endpoint not found");
  return row;
}

function normalizeEvents(events: readonly WebhookEventType[]): WebhookEventType[] {
  const unique = [...new Set(events)];
  if (unique.length !== events.length) throw ApiError.unprocessable("events must not contain duplicates", "events");
  if (!unique.every((event) => EVENT_TYPES.includes(event))) {
    throw ApiError.unprocessable("events contains an unsupported event", "events");
  }
  return unique;
}

/** HMAC-SHA256 over the contract's `id.timestamp.body` signing input. */
export async function signWebhookPayload(
  secret: string,
  deliveryId: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${deliveryId}.${timestamp}.${body}`),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const listWebhooks = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/webhooks",
    operationId: "listWebhookEndpoints",
    summary: "List outbound webhook endpoints",
    description: "Lists endpoint metadata and the configured six-event allowlist without exposing signing secrets.",
    tags: ["Webhooks"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(endpointListResponse, "Webhook endpoints"), ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await assertEventExists(context.env.DB, eventId);
    const rows = await context.env.DB
      .prepare("SELECT * FROM webhook_endpoints WHERE event_id = ? ORDER BY created_at DESC, id DESC")
      .bind(eventId)
      .all<WebhookEndpointRow>();
    return context.json({ data: rows.results.map(summarizeEndpoint) }, 200);
  },
);

const createWebhook = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/webhooks",
    operationId: "createWebhookEndpoint",
    summary: "Create an outbound webhook endpoint",
    description: "Creates an HTTPS endpoint, stores only a hash of its generated signing secret, and returns the secret once.",
    tags: ["Webhooks"],
    request: { params: eventParams, body: { content: { "application/json": { schema: endpointInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: endpointCreateResponse, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await assertEventExists(context.env.DB, eventId);
    const body = context.req.valid("json");
    const events = normalizeEvents(body.events);
    const now = Date.now();
    const id = newUlid(now);
    const secret = `whsec_${mintToken()}`;
    await context.env.DB.prepare(
      `INSERT INTO webhook_endpoints
       (id, event_id, url, secret_hash, events_json, enabled, created_at, last_delivery_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(id, eventId, body.url, await sha256Hex(secret), JSON.stringify(events), body.enabled ? 1 : 0, now).run();

    const row = await endpointFor(context.env.DB, eventId, id);
    return context.json({ data: summarizeEndpoint(row), secret }, 201);
  },
);

const updateWebhook = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/webhooks/{webhookId}",
    operationId: "updateWebhookEndpoint",
    summary: "Update an outbound webhook endpoint",
    description: "Updates the URL, selected event types, or enabled state; the existing signing secret is unchanged.",
    tags: ["Webhooks"],
    request: { params: webhookParams, body: { content: { "application/json": { schema: endpointPatch } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: endpointResponse, ...errors },
  },
  async (context) => {
    const { eventId, webhookId } = context.req.valid("param");
    const current = await endpointFor(context.env.DB, eventId, webhookId);
    const body = context.req.valid("json");
    if (body.url === undefined && body.events === undefined && body.enabled === undefined) {
      throw ApiError.badRequest("provide at least one endpoint field to update");
    }
    const updates: string[] = [];
    const values: Array<string | number> = [];
    if (body.url !== undefined) {
      updates.push("url = ?");
      values.push(body.url);
    }
    if (body.events !== undefined) {
      updates.push("events_json = ?");
      values.push(JSON.stringify(normalizeEvents(body.events)));
    }
    if (body.enabled !== undefined) {
      updates.push("enabled = ?");
      values.push(body.enabled ? 1 : 0);
    }
    values.push(webhookId, eventId);
    await context.env.DB.prepare(
      `UPDATE webhook_endpoints SET ${updates.join(", ")} WHERE id = ? AND event_id = ?`,
    ).bind(...values).run();
    const row = await endpointFor(context.env.DB, eventId, current.id);
    return context.json({ data: summarizeEndpoint(row) }, 200);
  },
);

const deleteWebhook = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/webhooks/{webhookId}",
    operationId: "deleteWebhookEndpoint",
    summary: "Delete an outbound webhook endpoint",
    description: "Deletes the endpoint and its local delivery history; no signing secret is recoverable after deletion.",
    tags: ["Webhooks"],
    request: { params: webhookParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.object({ id: z.string(), deleted: z.literal(true) }) }), "Deleted webhook endpoint"), ...errors },
  },
  async (context) => {
    const { eventId, webhookId } = context.req.valid("param");
    await endpointFor(context.env.DB, eventId, webhookId);
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM webhook_deliveries WHERE endpoint_id = ?").bind(webhookId),
      context.env.DB.prepare("DELETE FROM webhook_endpoints WHERE id = ? AND event_id = ?").bind(webhookId, eventId),
    ]);
    return context.json({ data: { id: webhookId, deleted: true as const } }, 200);
  },
);

const listWebhookDeliveries = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/webhooks/{webhookId}/deliveries",
    operationId: "listWebhookDeliveries",
    summary: "List deliveries for an outbound webhook endpoint",
    description: "Reads the latest delivery outcomes, including response codes, attempts, and safe error text.",
    tags: ["Webhooks"],
    request: { params: webhookParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(deliveryListResponse, "Webhook delivery log"), ...errors },
  },
  async (context) => {
    const { eventId, webhookId } = context.req.valid("param");
    await endpointFor(context.env.DB, eventId, webhookId);
    const rows = await context.env.DB
      .prepare("SELECT * FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at DESC, id DESC LIMIT 100")
      .bind(webhookId)
      .all<WebhookDeliveryRow>();
    return context.json({ data: rows.results.map(summarizeDelivery) }, 200);
  },
);

/**
 * Test-send is intentionally synchronous and direct. It proves the signing
 * path and records a real delivery row; automatic event producers and the
 * WEBHOOK_QUEUE consumer are a separate follow-up.
 */
const testWebhook = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/webhooks/{webhookId}/test",
    operationId: "testWebhookEndpoint",
    summary: "Send one signed test delivery",
    description: "Signs and POSTs a sample payload using the caller-supplied one-time secret, then records the real outcome.",
    tags: ["Webhooks"],
    request: { params: webhookParams, body: { content: { "application/json": { schema: testInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: deliveryResponse, ...errors },
  },
  async (context) => {
    const { eventId, webhookId } = context.req.valid("param");
    const endpoint = await endpointFor(context.env.DB, eventId, webhookId);
    const { secret } = context.req.valid("json");
    if (!constantTimeEqualHex(await sha256Hex(secret), endpoint.secret_hash)) {
      throw ApiError.unprocessable("the signing secret does not match this endpoint", "secret");
    }
    const eventType = eventsFromRow(endpoint)[0];
    if (!eventType) throw ApiError.unprocessable("this endpoint has no configured event", "events");
    const now = Date.now();
    const deliveryId = newUlid(now);
    const payload = JSON.stringify({
      type: "webhook.test",
      event_id: eventId,
      endpoint_id: webhookId,
      event_type: eventType,
      created_at: now,
    });
    const signature = await signWebhookPayload(secret, deliveryId, now, payload);

    await context.env.DB.prepare(
      `INSERT INTO webhook_deliveries
       (id, endpoint_id, event_type, payload, status, attempts, response_code, error, created_at, delivered_at)
       VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, ?, NULL)`,
    ).bind(deliveryId, webhookId, eventType, payload, now).run();

    let status: "delivered" | "failed" = "failed";
    let responseCode: number | null = null;
    let error: string | null = null;
    let deliveredAt: number | null = null;
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-marquee-webhook-id": deliveryId,
          "x-marquee-webhook-timestamp": String(now),
          "x-marquee-webhook-signature": `sha256=${signature}`,
          "x-marquee-webhook-event": eventType,
        },
        body: payload,
      });
      responseCode = response.status;
      if (response.ok) {
        status = "delivered";
        deliveredAt = Date.now();
      } else {
        error = `remote endpoint returned HTTP ${response.status}`;
      }
    } catch (reason: unknown) {
      error = reason instanceof Error ? reason.message.slice(0, 500) : "request failed";
    }

    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE webhook_deliveries
         SET status = ?, attempts = 1, response_code = ?, error = ?, delivered_at = ?
         WHERE id = ? AND endpoint_id = ?`,
      ).bind(status, responseCode, error, deliveredAt, deliveryId, webhookId),
      context.env.DB.prepare("UPDATE webhook_endpoints SET last_delivery_at = ? WHERE id = ? AND event_id = ?")
        .bind(Date.now(), webhookId, eventId),
    ]);

    const delivery = await context.env.DB
      .prepare("SELECT * FROM webhook_deliveries WHERE id = ? AND endpoint_id = ?")
      .bind(deliveryId, webhookId)
      .first<WebhookDeliveryRow>();
    if (!delivery) throw new Error("created_webhook_delivery_disappeared");
    return context.json({ data: summarizeDelivery(delivery) }, 200);
  },
);

export const apiRoutes = [
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  testWebhook,
];

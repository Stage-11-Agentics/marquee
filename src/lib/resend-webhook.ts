import type { D1Database } from "@cloudflare/workers-types";

import type {
  OutboxBounceSubtype,
  OutboxBounceType,
  OutboxDeliveryState,
} from "../db/schema";
import { verifyHmacSha256 } from "./r2/rate-limit";

export const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export interface ResendDeliveryEvent {
  providerMessageId: string;
  eventId: string;
  createdAt: number;
  state: Exclude<OutboxDeliveryState, "unknown">;
  bounceType: OutboxBounceType | null;
  bounceSubtype: OutboxBounceSubtype | null;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function timestampSeconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Verify the exact Svix signing input. The provider signs the raw body, so the
 * route must call this before JSON parsing or re-serialization can change it.
 */
export async function verifySvixSignature(input: {
  body: string;
  headers: SvixHeaders;
  secret: string | undefined;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { body, headers, secret } = input;
  if (!secret?.startsWith("whsec_")) return false;
  if (!headers.id || !headers.signature) return false;

  const timestamp = timestampSeconds(headers.timestamp);
  if (timestamp === null) return false;

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? SVIX_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const secretBytes = decodeBase64(secret.slice("whsec_".length));
  if (!secretBytes) return false;

  const signedContent = `${headers.id}.${timestamp}.${body}`;
  const candidates = headers.signature
    .trim()
    .split(/\s+/)
    .map((value) => value.split(",", 2))
    .filter(([version, encoded]) => version === "v1" && Boolean(encoded))
    .map(([, encoded]) => decodeBase64(encoded ?? ""))
    .filter((value): value is Uint8Array => value !== null);

  for (const candidate of candidates) {
    if (await verifyHmacSha256(secretBytes, signedContent, candidate)) return true;
  }
  return false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function eventCreatedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value < 1_000_000_000_000 ? value * 1_000 : value);
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounceType(value: unknown): OutboxBounceType {
  return value === "Permanent" || value === "Transient" || value === "Undetermined"
    ? value
    : "Undetermined";
}

function bounceSubtype(value: unknown): OutboxBounceSubtype {
  return value === "NoEmail"
    || value === "MailboxFull"
    || value === "Suppressed"
    || value === "MessageTooLarge"
    || value === "ContentRejected"
    || value === "AttachmentRejected"
    || value === "General"
    ? value
    : "General";
}

/**
 * Return null for valid Resend events that do not carry a delivery fact. A
 * supported event with missing identity/timestamp is malformed and throws so
 * the provider retries a request that could not be safely interpreted.
 */
export function parseResendDeliveryEvent(payload: unknown, eventId: string): ResendDeliveryEvent | null {
  const root = object(payload);
  const type = typeof root?.type === "string" ? root.type : null;
  if (type !== "email.delivered" && type !== "email.bounced" && type !== "email.complained" && type !== "email.delivery_delayed") {
    return null;
  }

  const data = object(root?.data);
  const providerMessageId = typeof data?.email_id === "string" ? data.email_id.trim() : "";
  const createdAt = eventCreatedAt(root?.created_at);
  if (!providerMessageId || createdAt === null) throw new Error("delivery event identity is incomplete");

  if (type === "email.delivered") {
    return {
      providerMessageId,
      eventId,
      createdAt,
      state: "delivered",
      bounceType: null,
      bounceSubtype: null,
    };
  }

  if (type === "email.complained") {
    return {
      providerMessageId,
      eventId,
      createdAt,
      state: "complained",
      bounceType: null,
      bounceSubtype: null,
    };
  }

  if (type === "email.delivery_delayed") {
    return {
      providerMessageId,
      eventId,
      createdAt,
      state: "bounced_soft",
      bounceType: "Transient",
      bounceSubtype: "General",
    };
  }

  const bounce = object(data?.bounce);
  const typeValue = bounceType(bounce?.type);
  return {
    providerMessageId,
    eventId,
    createdAt,
    state: typeValue === "Permanent" ? "bounced_hard" : "bounced_soft",
    bounceType: typeValue,
    bounceSubtype: bounceSubtype(bounce?.subType ?? bounce?.subtype),
  };
}

/**
 * Apply one provider fact only if it is newer than the fact already stored for
 * this message. The event-created timestamp, not request arrival time, is the
 * ordering cursor. The event id is a deterministic tie-break for equal clocks
 * and also makes a replay a no-op.
 */
export async function applyResendDeliveryEvent(
  database: D1Database,
  event: ResendDeliveryEvent,
  now = Date.now(),
): Promise<boolean> {
  const deliveredAt = event.state === "delivered" ? event.createdAt : null;
  const result = await database
    .prepare(`
      UPDATE outbox
      SET delivery_state = ?,
          bounce_type = ?,
          bounce_subtype = ?,
          delivered_at = ?,
          delivery_event_id = ?,
          delivery_event_created_at = ?,
          status = CASE
            WHEN ? = 'bounced_hard' AND status = 'sent' THEN 'failed'
            WHEN ? <> 'bounced_hard' AND delivery_state = 'bounced_hard' AND error IS NULL THEN 'sent'
            ELSE status
          END,
          updated_at = ?
      WHERE provider_message_id = ?
        AND (
          delivery_event_created_at IS NULL
          OR delivery_event_created_at < ?
          OR (
            delivery_event_created_at = ?
            AND COALESCE(delivery_event_id, '') < ?
          )
        )
    `)
    .bind(
      event.state,
      event.bounceType,
      event.bounceSubtype,
      deliveredAt,
      event.eventId,
      event.createdAt,
      event.state,
      event.state,
      now,
      event.providerMessageId,
      event.createdAt,
      event.createdAt,
      event.eventId,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

import { describe, expect, test } from "vitest";

import {
  hmacSha256,
} from "../../src/lib/r2/rate-limit";
import {
  parseResendDeliveryEvent,
  verifySvixSignature,
} from "../../src/lib/resend-webhook";

const SECRET = "whsec_dGVzdC13ZWJob29rLXNlY3JldA==";
const SECRET_BYTES = new TextEncoder().encode("test-webhook-secret");
const NOW_SECONDS = Math.floor(Date.parse("2026-08-12T12:00:00.000Z") / 1_000);

function base64(bytes: ArrayBuffer | Uint8Array): string {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signedHeaders(body: string, id = "msg_mrq79", timestamp = NOW_SECONDS): Promise<{
  id: string;
  timestamp: string;
  signature: string;
}> {
  const digest = await hmacSha256(SECRET_BYTES, `${id}.${timestamp}.${body}`);
  return { id, timestamp: String(timestamp), signature: `v1,${base64(digest)}` };
}

describe("MRQ-79 · Resend inbound webhook", () => {
  test("CONTRACT · Svix signs the exact raw body and accepts a valid v1 signature", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
    const headers = await signedHeaders(body);

    await expect(verifySvixSignature({ body, headers, secret: SECRET, nowMs: NOW_SECONDS * 1_000 })).resolves.toBe(true);
    await expect(verifySvixSignature({
      body: `${body} `,
      headers,
      secret: SECRET,
      nowMs: NOW_SECONDS * 1_000,
    })).resolves.toBe(false);
    await expect(verifySvixSignature({
      body,
      headers: { ...headers, signature: "v1,not-the-signature" },
      secret: SECRET,
      nowMs: NOW_SECONDS * 1_000,
    })).resolves.toBe(false);
  });

  test("CONTRACT · stale and malformed signing timestamps are refused before replay", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
    const stale = await signedHeaders(body, "msg_stale", NOW_SECONDS - 301);

    await expect(verifySvixSignature({ body, headers: stale, secret: SECRET, nowMs: NOW_SECONDS * 1_000 })).resolves.toBe(false);
    await expect(verifySvixSignature({
      body,
      headers: { ...stale, timestamp: "not-a-timestamp" },
      secret: SECRET,
      nowMs: NOW_SECONDS * 1_000,
    })).resolves.toBe(false);
    await expect(verifySvixSignature({ body, headers: stale, secret: undefined, nowMs: NOW_SECONDS * 1_000 })).resolves.toBe(false);
  });

  test("CONTRACT · delivery events map to durable states without exposing unsupported event kinds", () => {
    expect(parseResendDeliveryEvent({
      type: "email.delivered",
      created_at: "2026-08-12T11:59:00.000Z",
      data: { email_id: "re_delivered" },
    }, "evt_delivered")).toMatchObject({
      providerMessageId: "re_delivered",
      eventId: "evt_delivered",
      state: "delivered",
      bounceType: null,
      bounceSubtype: null,
    });

    expect(parseResendDeliveryEvent({
      type: "email.bounced",
      created_at: "2026-08-12T11:59:01.000Z",
      data: { email_id: "re_hard", bounce: { type: "Permanent", subType: "NoEmail" } },
    }, "evt_hard")).toMatchObject({ state: "bounced_hard", bounceType: "Permanent", bounceSubtype: "NoEmail" });

    expect(parseResendDeliveryEvent({
      type: "email.bounced",
      created_at: "2026-08-12T11:59:02.000Z",
      data: { email_id: "re_soft", bounce: { type: "Transient", subType: "MailboxFull" } },
    }, "evt_soft")).toMatchObject({ state: "bounced_soft", bounceType: "Transient", bounceSubtype: "MailboxFull" });

    expect(parseResendDeliveryEvent({
      type: "email.bounced",
      created_at: "2026-08-12T11:59:03.000Z",
      data: { email_id: "re_unknown", bounce: { type: "new-provider-type", subType: "new-subtype" } },
    }, "evt_unknown")).toMatchObject({ state: "bounced_soft", bounceType: "Undetermined", bounceSubtype: "General" });

    expect(parseResendDeliveryEvent({
      type: "email.complained",
      created_at: "2026-08-12T11:59:04.000Z",
      data: { email_id: "re_complaint" },
    }, "evt_complaint")).toMatchObject({ state: "complained" });

    expect(parseResendDeliveryEvent({
      type: "email.sent",
      created_at: "2026-08-12T11:59:05.000Z",
      data: { email_id: "re_ignored" },
    }, "evt_ignored")).toBeNull();
  });

  test("CONTRACT · supported events without an identity or event clock are rejected", () => {
    expect(() => parseResendDeliveryEvent({
      type: "email.delivered",
      created_at: "2026-08-12T11:59:00.000Z",
      data: {},
    }, "evt_missing_id")).toThrow();
    expect(() => parseResendDeliveryEvent({
      type: "email.bounced",
      data: { email_id: "re_missing_clock", bounce: { type: "Permanent" } },
    }, "evt_missing_clock")).toThrow();
  });
});

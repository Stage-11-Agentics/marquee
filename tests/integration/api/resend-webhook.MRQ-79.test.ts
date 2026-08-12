import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { hmacSha256 } from "../../../src/lib/r2/rate-limit";
import { processMailOutbox, type MailProvider } from "../../../src/jobs/mail/consumer";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const SECRET_BYTES = new TextEncoder().encode("test-webhook-secret");
const EVENT_ID = "evt-mrq79";
const PROVIDER_MESSAGE_ID = "re_mrq79_hard";
const ORDERED_PROVIDER_MESSAGE_ID = "re_mrq79_ordered";
const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function base64(bytes: ArrayBuffer): string {
  const value = new Uint8Array(bytes);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function request(body: string, options: { timestamp?: number; id?: string; signature?: string } = {}): Promise<Response> {
  const id = options.id ?? crypto.randomUUID();
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1_000);
  const digest = await hmacSha256(SECRET_BYTES, `${id}.${timestamp}.${body}`);
  return SELF.fetch(`${ORIGIN}/api/v1/webhooks/resend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(timestamp),
      "svix-signature": options.signature ?? `v1,${base64(digest)}`,
    },
    body,
  });
}

async function outboxRow(id: string): Promise<{
  status: string;
  delivery_state: string;
  bounce_type: string | null;
  bounce_subtype: string | null;
  delivery_event_id: string | null;
  delivery_event_created_at: number | null;
}> {
  const row = await env.DB.prepare(
    `SELECT status, delivery_state, bounce_type, bounce_subtype, delivery_event_id, delivery_event_created_at
     FROM outbox WHERE id = ?`,
  ).bind(id).first<{
    status: string;
    delivery_state: string;
    bounce_type: string | null;
    bounce_subtype: string | null;
    delivery_event_id: string | null;
    delivery_event_created_at: number | null;
  }>();
  if (!row) throw new Error(`missing outbox row ${id}`);
  return row;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq79', 'MRQ-79 Org', 'mrq-79-org', ?, ?)").bind(NOW, NOW),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES (?, 'org-mrq79', 'MRQ-79 Conference', 'mrq-79', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO outbox
      (id, event_id, template_key, person_id, to_email, subject, html, text, status, send_policy,
       idempotency_key, provider_message_id, error, created_at, updated_at)
      VALUES
        ('outbox-mrq79-hard', ?, 'decision', NULL, 'hard@mrq79.test', 'Decision', '<p>Decision</p>', 'Decision', 'sent', 'always_live', 'key-mrq79-hard', ?, NULL, ?, ?),
        ('outbox-mrq79-ordered', ?, 'decision', NULL, 'ordered@mrq79.test', 'Decision', '<p>Decision</p>', 'Decision', 'sent', 'always_live', 'key-mrq79-ordered', ?, NULL, ?, ?)`)
      .bind(EVENT_ID, PROVIDER_MESSAGE_ID, NOW, NOW, EVENT_ID, ORDERED_PROVIDER_MESSAGE_ID, NOW, NOW),
  ]);
}

describe.sequential("MRQ-79 Resend inbound webhook", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · unsigned, stale, and malformed webhook requests are refused", async () => {
    const body = JSON.stringify({ type: "email.delivered", created_at: new Date(NOW).toISOString(), data: { email_id: PROVIDER_MESSAGE_ID } });
    const unsigned = await SELF.fetch(`${ORIGIN}/api/v1/webhooks/resend`, { method: "POST", body });
    expect(unsigned.status).toBe(401);

    const stale = await request(body, { timestamp: Math.floor(Date.now() / 1_000) - 301 });
    expect(stale.status).toBe(401);

    const malformed = await request("{not-json");
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain(PROVIDER_MESSAGE_ID);
  });

  test("CONTRACT · a hard bounce is joined by provider id, moves sent off the transport, and replays idempotently", async () => {
    const body = JSON.stringify({
      type: "email.bounced",
      created_at: new Date(NOW).toISOString(),
      data: { email_id: PROVIDER_MESSAGE_ID, bounce: { type: "Permanent", subType: "NoEmail" } },
    });
    const first = await request(body, { id: "evt_mrq79_hard" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    expect(await outboxRow("outbox-mrq79-hard")).toEqual({
      status: "failed",
      delivery_state: "bounced_hard",
      bounce_type: "Permanent",
      bounce_subtype: "NoEmail",
      delivery_event_id: "evt_mrq79_hard",
      delivery_event_created_at: NOW,
    });

    const replay = await request(body, { id: "evt_mrq79_hard" });
    expect(replay.status).toBe(200);
    expect(await outboxRow("outbox-mrq79-hard")).toMatchObject({
      status: "failed",
      delivery_state: "bounced_hard",
      delivery_event_id: "evt_mrq79_hard",
    });
  });

  test("CONTRACT · event time, not arrival time, protects newer delivery truth from an older retry", async () => {
    const newer = JSON.stringify({
      type: "email.delivered",
      created_at: new Date(NOW + 2_000).toISOString(),
      data: { email_id: ORDERED_PROVIDER_MESSAGE_ID },
    });
    const older = JSON.stringify({
      type: "email.bounced",
      created_at: new Date(NOW + 1_000).toISOString(),
      data: { email_id: ORDERED_PROVIDER_MESSAGE_ID, bounce: { type: "Permanent", subType: "NoEmail" } },
    });

    expect((await request(newer, { id: "evt_mrq79_newer" })).status).toBe(200);
    expect((await request(older, { id: "evt_mrq79_older" })).status).toBe(200);
    expect(await outboxRow("outbox-mrq79-ordered")).toEqual({
      status: "sent",
      delivery_state: "delivered",
      bounce_type: null,
      bounce_subtype: null,
      delivery_event_id: "evt_mrq79_newer",
      delivery_event_created_at: NOW + 2_000,
    });
  });

  test("CONTRACT · a valid event for another message is acknowledged without disclosing or creating a row", async () => {
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date(NOW).toISOString(),
      data: { email_id: "re_mrq79_not_in_marquee" },
    });
    const response = await request(body, { id: "evt_mrq79_unmatched" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE provider_message_id = ?").bind("re_mrq79_not_in_marquee").first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("CONTRACT · a short batch response leaves the unmatched row unknown instead of borrowing its neighbor's provider id", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO outbox
        (id, event_id, template_key, person_id, to_email, subject, html, text, status, send_policy,
         idempotency_key, provider_message_id, error, created_at, updated_at)
        VALUES
          ('outbox-mrq79-batch-first', ?, 'decision', NULL, 'first@mrq79.test', 'Decision', '<p>Decision</p>', 'Decision', 'queued', 'always_live', 'key-mrq79-batch-first', NULL, NULL, ?, ?),
          ('outbox-mrq79-batch-second', ?, 'decision', NULL, 'second@mrq79.test', 'Decision', '<p>Decision</p>', 'Decision', 'queued', 'always_live', 'key-mrq79-batch-second', NULL, NULL, ?, ?)`)
        .bind(EVENT_ID, NOW, NOW, EVENT_ID, NOW, NOW),
    ]);
    const provider: MailProvider = {
      async sendBatch() { return ["re_mrq79_batch_first"]; },
      async sendSingle() { return "re_mrq79_batch_single"; },
    };

    await expect(processMailOutbox(
      env.DB,
      { DB: env.DB, RESEND_API_KEY: "test-key" },
      ["outbox-mrq79-batch-first", "outbox-mrq79-batch-second"],
      { provider, now: NOW },
    )).resolves.toMatchObject({ sent: 2, failed: 0 });
    const rows = await env.DB.prepare(
      "SELECT id, provider_message_id, delivery_state FROM outbox WHERE id IN (?, ?) ORDER BY id",
    ).bind("outbox-mrq79-batch-first", "outbox-mrq79-batch-second").all<{ id: string; provider_message_id: string | null; delivery_state: string }>();
    expect(rows.results).toEqual([
      { id: "outbox-mrq79-batch-first", provider_message_id: "re_mrq79_batch_first", delivery_state: "unknown" },
      { id: "outbox-mrq79-batch-second", provider_message_id: null, delivery_state: "unknown" },
    ]);
  });
});

import { beforeEach, expect, test, vi } from "vitest";

import { app } from "../../../src/index";
import { signWebhookPayload } from "../../../src/routes/webhooks.routes";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_webhooks_ac241";
const EVENT_ID = "evt_webhooks_ac241";
const PERSON_ID = "person_webhooks_ac241";
const SESSION_ID = "session_webhooks_ac241";
const COOKIE = `mq_session=${SESSION_ID}`;

const EVENT_TYPES = [
  "submission.created",
  "submission.status_changed",
  "evaluation.completed",
  "speaker_task.completed",
  "agenda.published",
  "speaker.confirmed",
] as const;

interface EndpointResponse {
  data: {
    id: string;
    url: string;
    events: string[];
    enabled: boolean;
  };
  secret: string;
}

interface DeliveryResponse {
  data: {
    id: string;
    endpoint_id: string;
    event_type: string;
    payload: string;
    status: string;
    attempts: number;
    response_code: number | null;
  };
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, {
    ...init,
    headers: { cookie: COOKIE, ...(init.headers ?? {}) },
  }, env);
}

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Webhook Test Organization", "webhooks-ac241", now, now),
    env.DB.prepare(
      `INSERT INTO events
       (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '2026-10-12', '2026-10-14', 'America/New_York', 'Test venue', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, "Webhook Test Conference", "webhooks-ac241", now, now),
    env.DB.prepare(
      `INSERT INTO people
       (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
    ).bind(PERSON_ID, ORG_ID, "webhooks@example.com", "Webhook Operator", now, now),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)",
    ).bind("membership_webhooks_ac241", ORG_ID, EVENT_ID, PERSON_ID, now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions
       (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'webhooks-ac241', NULL, ?, ?)`,
    ).bind(SESSION_ID, PERSON_ID, now + 3_600_000, now, now),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("AC-241 · endpoint CRUD validates HTTPS and the six-event allowlist while storing only a secret hash", async () => {
  const invalid = await request(`/api/v1/events/${EVENT_ID}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://hooks.example.test", events: ["submission.created"] }),
  });
  expect(invalid.status).toBe(400);

  const created = await request(`/api/v1/events/${EVENT_ID}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://hooks.example.test/marquee",
      events: ["submission.created", "agenda.published"],
    }),
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as EndpointResponse;
  expect(createdBody.data).toMatchObject({ url: "https://hooks.example.test/marquee", events: ["submission.created", "agenda.published"], enabled: true });
  expect(createdBody.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);

  const stored = await env.DB.prepare("SELECT secret_hash, events_json FROM webhook_endpoints WHERE id = ?")
    .bind(createdBody.data.id)
    .first<{ secret_hash: string; events_json: string }>();
  expect(stored?.secret_hash).not.toBe(createdBody.secret);
  expect(stored?.secret_hash).toHaveLength(64);
  expect(JSON.parse(stored?.events_json ?? "[]")).toEqual(["submission.created", "agenda.published"]);

  const listed = await request(`/api/v1/events/${EVENT_ID}/webhooks`);
  expect(listed.status).toBe(200);
  expect(await listed.text()).not.toContain(createdBody.secret);

  const patched = await request(`/api/v1/events/${EVENT_ID}/webhooks/${createdBody.data.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, events: ["speaker.confirmed"] }),
  });
  expect(patched.status).toBe(200);
  expect((await patched.json() as { data: EndpointResponse["data"] }).data).toMatchObject({ enabled: false, events: ["speaker.confirmed"] });

  const duplicateEvents = await request(`/api/v1/events/${EVENT_ID}/webhooks/${createdBody.data.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: ["speaker.confirmed", "speaker.confirmed"] }),
  });
  expect(duplicateEvents.status).toBe(400);
});

test("AC-241 · test-send signs id.timestamp.body, records the real response, and exposes the delivery log", async () => {
  const created = await request(`/api/v1/events/${EVENT_ID}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://hooks.example.test/marquee", events: [...EVENT_TYPES] }),
  });
  const endpoint = await created.json() as EndpointResponse;
  const outbound = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", outbound);

  try {
    const wrongSecret = await request(`/api/v1/events/${EVENT_ID}/webhooks/${endpoint.data.id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "whsec_wrong" }),
    });
    expect(wrongSecret.status).toBe(422);
    expect(outbound).not.toHaveBeenCalled();
    expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM webhook_deliveries WHERE endpoint_id = ?").bind(endpoint.data.id).first<{ total: number }>())?.total).toBe(0);

    const response = await request(`/api/v1/events/${EVENT_ID}/webhooks/${endpoint.data.id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: endpoint.secret }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as DeliveryResponse;
    expect(body.data).toMatchObject({ status: "delivered", attempts: 1, response_code: 202, event_type: "submission.created" });
    expect(outbound).toHaveBeenCalledOnce();

    const requestInit = outbound.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(requestInit.headers);
    const payload = String(requestInit.body);
    const deliveryId = headers.get("x-marquee-webhook-id") ?? "";
    const timestamp = Number(headers.get("x-marquee-webhook-timestamp"));
    const expected = await signWebhookPayload(endpoint.secret, deliveryId, timestamp, payload);
    expect(headers.get("x-marquee-webhook-signature")).toBe(`sha256=${expected}`);
    expect(payload).toContain('"type":"webhook.test"');

    const log = await request(`/api/v1/events/${EVENT_ID}/webhooks/${endpoint.data.id}/deliveries`);
    expect(log.status).toBe(200);
    expect((await log.json() as { data: DeliveryResponse["data"][] }).data[0]).toMatchObject({ id: body.data.id, status: "delivered", response_code: 202, attempts: 1 });

    const deleted = await request(`/api/v1/events/${EVENT_ID}/webhooks/${endpoint.data.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM webhook_deliveries WHERE endpoint_id = ?").bind(endpoint.data.id).first<{ total: number }>())?.total).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("AC-241 · unauthenticated webhook management fails closed without creating a row", async () => {
  const response = await app.request(`${ORIGIN}/api/v1/events/${EVENT_ID}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://hooks.example.test/marquee", events: ["submission.created"] }),
  }, env);
  expect(response.status).toBe(401);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM webhook_endpoints").first<{ total: number }>();
  expect(count?.total).toBe(0);
});

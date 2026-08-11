import { beforeEach, expect, test } from "vitest";

import { app } from "../../src/index";
import { consumeMagicLink, mintMagicLink } from "../../src/lib/auth/magic-links";
import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "./apply-migrations";

beforeEach(async () => {
  await applyMigrations();
});

async function seedDemoFixture(): Promise<void> {
  const now = Date.now();
  for (const row of demoFixtureRows(now)) {
    await env.DB.prepare(row.statement).bind(...row.bindings).run();
  }
}

test("AC-2 · POST /api/v1/auth/demo 403s and sets no session cookie when demo_mode=0", async () => {
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("AC-2 · POST /api/v1/auth/demo 200s and sets a session cookie when demo_mode=1", async () => {
  await seedDemoFixture();
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toMatch(/mq_session=/);
  const body = await response.json<{ person: { id: string } }>();
  expect(body.person.id).toBe(DEMO_ORGANIZER_PERSON_ID);
});

test("CONTRACT · demo session cookie carries no Domain attribute", async () => {
  await seedDemoFixture();
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "speaker" }),
    headers: { "content-type": "application/json" },
  }, env);
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).not.toMatch(/Domain=/i);
});

test("CONTRACT · magic-link request enqueues an outbox row and returns the on-screen link only in demo mode", async () => {
  await seedDemoFixture();
  const response = await app.request("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({
      email: "organizer@demo.marquee.example",
      event_id: DEMO_EVENT_ID,
    }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(200);
  const body = await response.json<{ magic_link?: string }>();
  expect(body.magic_link).toContain("/api/v1/auth/exchange?token=");

  const outboxRow = await env.DB.prepare(
    "SELECT * FROM outbox WHERE person_id = ? AND template_key = 'magic_link_login'",
  )
    .bind(DEMO_ORGANIZER_PERSON_ID)
    .first<{ status: string }>();
  expect(outboxRow).not.toBeNull();
  expect(outboxRow?.status).toBe("queued");
});

test("CONTRACT · magic link is single-use and rejects a second exchange", async () => {
  await seedDemoFixture();
  const link = await mintMagicLink(env.DB, { personId: DEMO_ORGANIZER_PERSON_ID, purpose: "login" });
  const first = await consumeMagicLink(env.DB, link.token);
  expect(first).not.toBeNull();
  const second = await consumeMagicLink(env.DB, link.token);
  expect(second).toBeNull();
});

test("CONTRACT · magic link is rejected once past its expiry", async () => {
  await seedDemoFixture();
  const now = Date.now();
  const link = await mintMagicLink(env.DB, { personId: DEMO_ORGANIZER_PERSON_ID, purpose: "login", now });
  const expired = await consumeMagicLink(env.DB, link.token, now + 16 * 60_000);
  expect(expired).toBeNull();
});

test("CONTRACT · demo login rejects a role with no matching demo persona", async () => {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(DEMO_ORGANIZATION_ID, "Marquee Demo", "marquee-demo", now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
  )
    .bind(
      DEMO_EVENT_ID,
      DEMO_ORGANIZATION_ID,
      "AIE NYC 2026",
      "aie-nyc-2026",
      "The demo conference",
      "2026-10-19",
      "2026-10-21",
      "America/New_York",
      "Javits Center",
      now,
      now,
    )
    .run();
  // No demo persona/membership rows exist for this event.
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "speaker" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
});

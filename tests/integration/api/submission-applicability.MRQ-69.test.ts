import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const SESSION_ID = "sess-mrq-69-admin";
const FORM_ID = "form-mrq-69-answers";
const CONTENT_FIELD_ID = "field-mrq-69-content";
const PRODUCT_FIELD_ID = "field-mrq-69-product";
const OUTCOME_FIELD_ID = "field-mrq-69-outcome";
const ORIGIN = "https://marquee.stage11.dev";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${SESSION_ID}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(`
      INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
      VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)
    `).bind(SESSION_ID, ORGANIZER_ID, now + 86_400_000, now, now),
    env.DB.prepare(`
      INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, created_at, updated_at)
      VALUES (?, ?, 'Answer guard form', 'mrq-69-answers', 'abstract', 'open', NULL, NULL, ?, ?)
    `).bind(FORM_ID, EVENT_ID, now, now),
    env.DB.prepare(`
      INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES (?, ?, 'vendor_content', 'Product discussion', NULL, 'single_select', 1, 0, ?, NULL, ?, ?)
    `).bind(CONTENT_FIELD_ID, FORM_ID, JSON.stringify({ options: ["No", "Yes"] }), now, now),
    env.DB.prepare(`
      INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES (?, ?, 'vendor_product', 'Product or service', NULL, 'short_text', 1, 1, ?, ?, ?, ?)
    `).bind(PRODUCT_FIELD_ID, FORM_ID, JSON.stringify({ minLength: 8 }), JSON.stringify({ all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] }), now, now),
    env.DB.prepare(`
      INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES (?, ?, 'audience_outcome', 'Audience outcome', NULL, 'long_text', 0, 2, ?, NULL, ?, ?)
    `).bind(OUTCOME_FIELD_ID, FORM_ID, JSON.stringify({ minLength: 12 }), now, now),
  ]);
}

async function answerCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM submission_answers").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function submissionCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM submissions").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

describe.sequential("MRQ-69 admin answer applicability", () => {
  beforeAll(seedFixture, 10_000);

  test("AC-25 + AC-133 · admin create persists applicable answers and drops hidden answers", async () => {
    const submissionsBefore = await submissionCount();
    const answersBefore = await answerCount();
    const positive = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "abstract",
        title: "Applicable answer record",
        form_id: FORM_ID,
        answers: [
          { field_id: CONTENT_FIELD_ID, value_text: "Yes" },
          { field_id: PRODUCT_FIELD_ID, value_text: "Northstar" },
        ],
      }),
    });
    expect(positive.status).toBe(201);
    const positiveBody = await positive.json<{ id: string }>();
    const positiveRows = await env.DB.prepare(
      "SELECT field_id FROM submission_answers WHERE submission_id = ? ORDER BY field_id",
    ).bind(positiveBody.id).all<{ field_id: string }>();
    expect(positiveRows.results.map((row) => row.field_id)).toEqual([CONTENT_FIELD_ID, PRODUCT_FIELD_ID]);

    const hidden = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "abstract",
        title: "Hidden answer record",
        answers: [
          { field_id: CONTENT_FIELD_ID, value_text: "No" },
          { field_id: PRODUCT_FIELD_ID, value_text: "hidden" },
        ],
      }),
    });
    expect(hidden.status).toBe(201);
    const hiddenBody = await hidden.json<{ id: string }>();
    const hiddenRows = await env.DB.prepare(
      "SELECT field_id FROM submission_answers WHERE submission_id = ?",
    ).bind(hiddenBody.id).all<{ field_id: string }>();
    expect(hiddenRows.results.map((row) => row.field_id)).toEqual([CONTENT_FIELD_ID]);
    expect(hiddenRows.results.map((row) => row.field_id)).not.toContain(PRODUCT_FIELD_ID);
    expect(await submissionCount()).toBe(submissionsBefore + 2);
    expect(await answerCount()).toBe(answersBefore + 3);
  });

  test("AC-25 + AC-133 · invalid applicable minLength returns 422 without a submission or answer row", async () => {
    const submissionsBefore = await submissionCount();
    const answersBefore = await answerCount();
    const invalid = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "abstract",
        title: "Invalid answer record",
        form_id: FORM_ID,
        answers: [
          { field_id: CONTENT_FIELD_ID, value_text: "Yes" },
          { field_id: PRODUCT_FIELD_ID, value_text: "short" },
        ],
      }),
    });
    expect(invalid.status).toBe(422);
    const error = await invalid.json<{ error: { field?: string; message: string } }>();
    expect(error.error.field).toBe("vendor_product");
    expect(error.error.message).toMatch(/invalid/i);
    expect(await submissionCount()).toBe(submissionsBefore);
    expect(await answerCount()).toBe(answersBefore);
  });
});

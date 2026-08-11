import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq68";
const TOKEN = "mq_mrq68-program-token";
const NOW = Date.parse("2026-08-11T12:00:00.000Z");

interface GapItem {
  id: string;
  notified: {
    state: string;
    label: string;
    detail: string;
    outbox_status: string | null;
  } | null;
}

interface ListResponse {
  data: GapItem[];
  total: number;
}

interface DecisionSnapshot {
  id: string;
  submission_id: string;
  feedback_md: string | null;
  decided_by_person_id: string;
  decided_at: number;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq68', 'MRQ-68 Org', 'mrq-68-org', ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq68', 'MRQ-68 Conference', 'mrq-68', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES
       ('person-mrq68-actor', 'org-mrq68', 'organizer@mrq68.test', 'Program Lead', ?, ?),
       ('person-mrq68-good', 'org-mrq68', 'speaker@mrq68.test', 'Ada Lovelace', ?, ?),
       ('person-mrq68-invalid', 'org-mrq68', 'not-an-email', 'Missing Address', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq68', 'org-mrq68', ?, 'person-mrq68-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq68', 'org-mrq68', NULL, 'MRQ-68 test token', ?, 'mq_mrq68', ?, 'person-mrq68-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
       VALUES
        ('sub-mrq68-airtable', ?, 'abstract', 'Airtable decision', 'accepted', 'public', 'person-mrq68-good', 'airtable', ?, ?, ?),
        ('sub-mrq68-queued', ?, 'abstract', 'Queued decision', 'accepted', 'public', 'person-mrq68-good', 'marquee', ?, ?, ?),
        ('sub-mrq68-suppressed', ?, 'abstract', 'Suppressed decision', 'rejected', 'public', 'person-mrq68-good', 'marquee', ?, ?, ?),
        ('sub-mrq68-failed', ?, 'abstract', 'Failed decision', 'accepted', 'public', 'person-mrq68-good', 'marquee', ?, ?, ?),
        ('sub-mrq68-no-address', ?, 'abstract', 'No address decision', 'rejected', 'public', 'person-mrq68-invalid', 'marquee', ?, ?, ?),
        ('sub-mrq68-sent', ?, 'abstract', 'Already sent decision', 'accepted', 'public', 'person-mrq68-good', 'marquee', ?, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('par-mrq68-airtable', 'sub-mrq68-airtable', 'person-mrq68-good', 'speaker', 0, ?, ?),
        ('par-mrq68-queued', 'sub-mrq68-queued', 'person-mrq68-good', 'speaker', 0, ?, ?),
        ('par-mrq68-suppressed', 'sub-mrq68-suppressed', 'person-mrq68-good', 'speaker', 0, ?, ?),
        ('par-mrq68-failed', 'sub-mrq68-failed', 'person-mrq68-good', 'speaker', 0, ?, ?),
        ('par-mrq68-no-address', 'sub-mrq68-no-address', 'person-mrq68-invalid', 'speaker', 0, ?, ?),
        ('par-mrq68-sent', 'sub-mrq68-sent', 'person-mrq68-good', 'speaker', 0, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO outbox
        (id, event_id, template_key, entity_id, person_id, to_email, subject, html, text, status,
         suppressed_reason, idempotency_key, error, sent_at, created_at, updated_at)
       VALUES
        ('outbox-mrq68-queued', ?, 'acceptance', 'sub-mrq68-queued', 'person-mrq68-good', 'speaker@mrq68.test', 'Queued', '<p>Queued</p>', 'Queued', 'queued', NULL, 'key-mrq68-queued', NULL, NULL, ?, ?),
        ('outbox-mrq68-suppressed', ?, 'rejection', 'sub-mrq68-suppressed', 'person-mrq68-good', 'speaker@mrq68.test', 'Suppressed', '<p>Suppressed</p>', 'Suppressed', 'suppressed', 'operator pause', 'key-mrq68-suppressed', NULL, NULL, ?, ?),
        ('outbox-mrq68-failed', ?, 'acceptance', 'sub-mrq68-failed', 'person-mrq68-good', 'speaker@mrq68.test', 'Failed', '<p>Failed</p>', 'Failed', 'failed', NULL, 'key-mrq68-failed', 'provider offline', NULL, ?, ?),
        ('outbox-mrq68-sent', ?, 'acceptance', 'sub-mrq68-sent', 'person-mrq68-good', 'speaker@mrq68.test', 'Sent', '<p>Sent</p>', 'Sent', 'sent', NULL, 'key-mrq68-sent', NULL, ?, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW, EVENT_ID, NOW, NOW, EVENT_ID, NOW, NOW, EVENT_ID, NOW, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO submission_decisions
        (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
       VALUES
        ('decision-mrq68-airtable', ?, 'sub-mrq68-airtable', 'approve', 'accepted', 'Airtable feedback', 'person-mrq68-actor', ?, NULL, ?, ?),
        ('decision-mrq68-queued', ?, 'sub-mrq68-queued', 'approve', 'accepted', 'Queued feedback', 'person-mrq68-actor', ?, 'outbox-mrq68-queued', ?, ?),
        ('decision-mrq68-suppressed', ?, 'sub-mrq68-suppressed', 'deny', 'rejected', 'Suppressed feedback', 'person-mrq68-actor', ?, 'outbox-mrq68-suppressed', ?, ?),
        ('decision-mrq68-failed', ?, 'sub-mrq68-failed', 'approve', 'accepted', 'Failed feedback', 'person-mrq68-actor', ?, 'outbox-mrq68-failed', ?, ?),
        ('decision-mrq68-no-address', ?, 'sub-mrq68-no-address', 'deny', 'rejected', 'Address feedback', 'person-mrq68-actor', ?, NULL, ?, ?),
        ('decision-mrq68-sent', ?, 'sub-mrq68-sent', 'approve', 'accepted', 'Sent feedback', 'person-mrq68-actor', ?, 'outbox-mrq68-sent', ?, ?)`,
    ).bind(
      EVENT_ID, NOW, NOW, NOW,
      EVENT_ID, NOW, NOW, NOW,
      EVENT_ID, NOW, NOW, NOW,
      EVENT_ID, NOW, NOW, NOW,
      EVENT_ID, NOW, NOW, NOW,
      EVENT_ID, NOW, NOW, NOW,
    ),
  ]);
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${TOKEN}` };
}

async function listGaps(): Promise<ListResponse> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions?status=not_notified&per_page=50`, { headers: authHeaders() });
  expect(response.status).toBe(200);
  return response.json<ListResponse>();
}

async function summary(): Promise<{ total: number; sendable: number; no_valid_address: number }> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/not-notified/summary`, { headers: authHeaders() });
  expect(response.status).toBe(200);
  return response.json();
}

describe.sequential("MRQ-68 decided not notified", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-268 · the immutable built-in view derives all three reasons, excludes sent decisions, and keeps the dashboard row at zero space", async () => {
    const viewsResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/views`, { headers: authHeaders() });
    expect(viewsResponse.status).toBe(200);
    const views = await viewsResponse.json<{ data: Array<{ id: string; name: string; built_in: boolean; config: { filters: { status?: string }; columns: string[] } }> }>();
    const builtIn = views.data.find((view) => view.id === "decided-not-notified");
    expect(builtIn).toMatchObject({ id: "decided-not-notified", name: "Decided · not notified", built_in: true });
    expect(builtIn?.config.filters.status).toBe("not_notified");
    expect(builtIn?.config.columns).toContain("notified");

    const list = await listGaps();
    expect(list.total).toBe(5);
    expect(list.data.map((item) => item.id)).toEqual([
      "sub-mrq68-airtable",
      "sub-mrq68-failed",
      "sub-mrq68-no-address",
      "sub-mrq68-queued",
      "sub-mrq68-suppressed",
    ]);
    expect(list.data.find((item) => item.id === "sub-mrq68-airtable")?.notified).toMatchObject({ state: "changed_in_airtable", label: "Changed in Airtable" });
    expect(list.data.find((item) => item.id === "sub-mrq68-no-address")?.notified).toMatchObject({ state: "no_valid_address", label: "No valid address" });
    expect(list.data.find((item) => item.id === "sub-mrq68-failed")?.notified).toMatchObject({ state: "not_delivered", label: "Not delivered", outbox_status: "failed" });
    expect(list.data.find((item) => item.id === "sub-mrq68-suppressed")?.notified?.detail).toContain("operator pause");

    const gapSummary = await summary();
    expect(gapSummary).toEqual({ total: 5, sendable: 4, no_valid_address: 1 });

    const dashboardResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/dashboard`, { headers: authHeaders() });
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json<{ attention: { decided_not_notified: { count: number; href: string; note: string } } }>();
    expect(dashboard.attention.decided_not_notified).toMatchObject({ count: 4, href: "/submissions?status=not_notified" });
    expect(dashboard.attention.decided_not_notified.note).toContain("1 need an address first");

    const patchResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/views/decided-not-notified`, { method: "PATCH", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ name: "Changed" }) });
    expect(patchResponse.status).toBe(409);
    const deleteResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/views/decided-not-notified`, { method: "DELETE", headers: authHeaders() });
    expect(deleteResponse.status).toBe(409);
  });

  test("AC-269 · Notify queues fresh rows against existing decisions, preserves decision bytes, and closes sent gaps", async () => {
    const before = await env.DB.prepare(
      `SELECT id, submission_id, feedback_md, decided_by_person_id, decided_at
       FROM submission_decisions WHERE event_id = ? ORDER BY id ASC`,
    ).bind(EVENT_ID).all<DecisionSnapshot>();
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/not-notified/notify`, { method: "POST", headers: authHeaders() });
    expect(response.status).toBe(202);
    const result = await response.json<{ selected: number; queued: number; skipped_no_address: number; outbox_ids: string[] }>();
    expect(result).toMatchObject({ selected: 4, queued: 4, skipped_no_address: 1 });
    expect(result.outbox_ids).toHaveLength(4);

    const after = await env.DB.prepare(
      `SELECT id, submission_id, feedback_md, decided_by_person_id, decided_at
       FROM submission_decisions WHERE event_id = ? ORDER BY id ASC`,
    ).bind(EVENT_ID).all<DecisionSnapshot>();
    expect(after.results).toEqual(before.results);
    const retries = await env.DB.prepare(
      "SELECT id, entity_id, idempotency_key, status FROM outbox WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id ASC",
    ).bind(JSON.stringify(result.outbox_ids)).all<{ id: string; entity_id: string; idempotency_key: string; status: string }>();
    expect(retries.results).toHaveLength(4);
    expect(retries.results.every((row) => row.entity_id.startsWith("decision-mrq68-") && row.status === "queued")).toBe(true);
    expect(retries.results.every((row) => !row.idempotency_key.startsWith("key-mrq68-"))).toBe(true);
    expect(retries.results.some((row) => row.entity_id === "decision-mrq68-no-address")).toBe(false);

    await env.DB.batch(result.outbox_ids.map((id) => env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").bind(NOW + 1, NOW + 1, id)));
    const afterSent = await listGaps();
    expect(afterSent.total).toBe(1);
    expect(afterSent.data[0]?.id).toBe("sub-mrq68-no-address");
    expect((await summary()).sendable).toBe(0);

    await env.DB.prepare("UPDATE people SET email = 'now-valid@mrq68.test' WHERE id = 'person-mrq68-invalid'").run();
    const finalNotify = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/not-notified/notify`, { method: "POST", headers: authHeaders() });
    expect(finalNotify.status).toBe(202);
    const finalResult = await finalNotify.json<{ selected: number; queued: number; skipped_no_address: number; outbox_ids: string[] }>();
    expect(finalResult).toMatchObject({ selected: 1, queued: 1, skipped_no_address: 0 });
    await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").bind(NOW + 2, NOW + 2, finalResult.outbox_ids[0]).run();

    const clear = await listGaps();
    expect(clear.total).toBe(0);
    const dashboardResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/dashboard`, { headers: authHeaders() });
    const dashboard = await dashboardResponse.json<{ attention: { decided_not_notified: { count: number; note: string } } }>();
    expect(dashboard.attention.decided_not_notified).toEqual({
      count: 0,
      id: "decided-not-notified",
      label: "Decided · not notified",
      href: "/submissions?status=not_notified",
      note: "Every decision has reached its speaker",
    });
  });
});

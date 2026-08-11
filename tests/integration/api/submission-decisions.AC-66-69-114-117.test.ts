import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq19";
const TOKEN = "mq_mrq19-program-token";
const NOW = Date.parse("2026-08-10T12:00:00.000Z");

interface BulkResponse {
  operation_id: string;
  selected: number;
  succeeded: number;
  failed: number;
  state: string;
  outbox_enqueued: number;
  failures?: Array<{ id: string; code: string; message: string }>;
  results?: Array<{ id: string; outcome: string; resulting_status: string | null; error?: string }>;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-mrq19', 'MRQ-19 Org', 'mrq-19-org', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq19', 'MRQ-19 Conference', 'mrq-19', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO forms
        (id, event_id, name, slug, kind, status, created_at, updated_at)
       VALUES ('form-mrq19', ?, 'Open CFP', 'open-cfp', 'abstract', 'open', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, created_at, updated_at)
       VALUES ('person-mrq19-actor', 'org-mrq19', 'organizer@example.com', 'Program Lead', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, created_at, updated_at)
       VALUES ('person-mrq19-speaker', 'org-mrq19', 'ada@example.com', 'Ada Lovelace', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, created_at, updated_at)
       VALUES ('person-mrq19-invalid', 'org-mrq19', 'not-an-email', 'Missing Email', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships
        (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq19', 'org-mrq19', ?, 'person-mrq19-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq19', 'org-mrq19', NULL, 'MRQ-19 test token', ?, 'mq_mrq19', ?, 'person-mrq19-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO waves
        (id, event_id, name, decision_on, target_count, position, created_at, updated_at)
       VALUES ('wave-mrq19', ?, 'Wave 2', '2026-09-01', 150, 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at)
       VALUES ('task-template-mrq19', ?, 'Speaker agreement', 'acknowledge', 'Confirm the agreement', 7, 0, 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO email_templates
        (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
       VALUES
        ('template-mrq19-accept', ?, 'acceptance', 'Acceptance', 'Accepted: {{submission.title}}', 'Hi {{speaker.first_name}}, {{submission.title}} is accepted.', 1, ?, ?),
        ('template-mrq19-reject', ?, 'rejection', 'Rejection', 'Update: {{submission.title}}', 'Hi {{speaker.first_name}}, an update for {{submission.title}}.', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW, EVENT_ID, NOW, NOW),
  ]);

  await env.DB.prepare(
    `WITH RECURSIVE sequence(n) AS (
      VALUES (1)
      UNION ALL SELECT n + 1 FROM sequence WHERE n < 150
    )
    INSERT INTO submissions
      (id, event_id, form_id, kind, title, status, origin, wave_id,
       submitter_person_id, submitted_at, created_at, updated_at)
    SELECT printf('sub-mrq19-%03d', n), ?, 'form-mrq19', 'abstract',
           printf('Talk %03d', n), 'submitted', 'public', NULL,
           'person-mrq19-speaker', ?, ?, ?
    FROM sequence`,
  ).bind(EVENT_ID, NOW, NOW, NOW).run();
  await env.DB.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
     SELECT 'participation-' || id, id, 'person-mrq19-speaker', 'speaker', 0, ?, ?
     FROM submissions WHERE event_id = ?`,
  ).bind(NOW, NOW, EVENT_ID).run();
  await env.DB.prepare(
    `INSERT INTO submissions
      (id, event_id, form_id, kind, title, status, origin, submitter_person_id,
       submitted_at, created_at, updated_at)
     VALUES ('sub-mrq19-invalid-email', ?, 'form-mrq19', 'abstract', 'No email', 'in_review', 'public',
             'person-mrq19-invalid', ?, ?, ?)`,
  ).bind(EVENT_ID, NOW, NOW, NOW).run();
  await env.DB.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
     VALUES ('participation-mrq19-invalid', 'sub-mrq19-invalid-email', 'person-mrq19-invalid', 'speaker', 0, ?, ?)`,
  ).bind(NOW, NOW).run();
}

async function requestBulk(body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/bulk`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function requestRecord(submissionId: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe.sequential("MRQ-19 shared decision cascade", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-66, AC-67, AC-68, AC-69 · filter-wide accept resolves all 150 records, reports per-record state, and leaves the CFP open", async () => {
    const started = performance.now();
    const response = await requestBulk({
      selector: { filter: { status: "submitted" } },
      action: "accept",
      wave_id: "wave-mrq19",
    });
    const elapsed = performance.now() - started;
    expect(response.status).toBe(200);
    const result = await response.json<BulkResponse>();
    expect(result.selected).toBe(150);
    expect(result.succeeded).toBe(150);
    expect(result.failed).toBe(0);
    expect(result.state).toBe("completed");
    expect(result.outbox_enqueued).toBe(150);
    expect(result.results).toHaveLength(150);
    expect(elapsed).toBeLessThan(5_000);

    const statuses = await env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(status = 'accepted') AS accepted FROM submissions WHERE event_id = ? AND id LIKE 'sub-mrq19-%'",
    ).bind(EVENT_ID).first<{ total: number; accepted: number }>();
    const decisions = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM submission_decisions WHERE event_id = ? AND resulting_status = 'accepted'",
    ).bind(EVENT_ID).first<{ total: number }>();
    const tasks = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM speaker_tasks WHERE event_id = ? AND submission_id LIKE 'sub-mrq19-%'",
    ).bind(EVENT_ID).first<{ total: number }>();
    const form = await env.DB.prepare("SELECT status FROM forms WHERE id = 'form-mrq19'").first<{ status: string }>();
    expect(statuses).toEqual({ total: 151, accepted: 150 });
    expect(decisions?.total).toBe(150);
    expect(tasks?.total).toBe(150);
    expect(form?.status).toBe("open");
  }, 20_000);

  test("AC-114, AC-115, AC-116, AC-117 · record-owned reject shares rendered merge fields, status history, and UNIQUE outbox identity", async () => {
    const recordDecision = await requestRecord("sub-mrq19-002", {
      recommendation: "maybe",
      feedback_md: "Hold this for the next conference wave.",
    });
    expect(recordDecision.status).toBe(200);
    expect(await recordDecision.json()).toMatchObject({
      submission_id: "sub-mrq19-002",
      decision: "maybe",
      resulting_status: "waitlisted",
    });
    const recordHistory = await env.DB.prepare(
      "SELECT feedback_md, resulting_status FROM submission_decisions WHERE submission_id = 'sub-mrq19-002' ORDER BY decided_at DESC LIMIT 1",
    ).first<{ feedback_md: string | null; resulting_status: string }>();
    expect(recordHistory).toEqual({
      feedback_md: "Hold this for the next conference wave.",
      resulting_status: "waitlisted",
    });

    const accepted = await env.DB.prepare(
      "SELECT id FROM submissions WHERE event_id = ? AND status = 'accepted' ORDER BY id LIMIT 1",
    ).bind(EVENT_ID).first<{ id: string }>();
    expect(accepted?.id).toBeTruthy();

    const first = await requestBulk({
      selector: { ids: [accepted?.id] },
      action: "reject",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json<BulkResponse>();
    expect(firstBody.succeeded).toBe(1);
    const outbox = await env.DB.prepare(
      "SELECT subject, text, idempotency_key FROM outbox WHERE event_id = ? AND template_key = 'rejection' ORDER BY created_at DESC LIMIT 1",
    ).bind(EVENT_ID).first<{ subject: string; text: string; idempotency_key: string }>();
    expect(outbox?.subject).toContain("Talk");
    expect(outbox?.text).toContain("Ada");
    expect(outbox?.text).toContain("Talk");
    expect(outbox?.idempotency_key).toHaveLength(64);

    const repeated = await requestBulk({
      selector: { ids: [accepted?.id] },
      action: "reject",
    });
    expect(repeated.status).toBe(200);
    const repeatedBody = await repeated.json<BulkResponse>();
    expect(repeatedBody.succeeded).toBe(0);
    expect(repeatedBody.failed).toBe(1);
    const outboxCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ? AND template_key = 'rejection'",
    ).bind(EVENT_ID).first<{ total: number }>();
    const rejected = await env.DB.prepare(
      "SELECT status FROM submissions WHERE id = ? AND event_id = ?",
    ).bind(accepted?.id, EVENT_ID).first<{ status: string }>();
    expect(outboxCount?.total).toBe(1);
    expect(rejected?.status).toBe("rejected");
  }, 20_000);

  test("CONTRACT · a consequential transition with no valid speaker email stays unchanged and returns an honest failure", async () => {
    const response = await requestBulk({
      selector: { ids: ["sub-mrq19-invalid-email"] },
      action: "accept",
    });
    expect(response.status).toBe(200);
    const result = await response.json<BulkResponse>();
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures?.[0]?.message).toContain("valid email");
    const row = await env.DB.prepare(
      "SELECT status FROM submissions WHERE id = 'sub-mrq19-invalid-email'",
    ).first<{ status: string }>();
    expect(row?.status).toBe("in_review");
  });
});

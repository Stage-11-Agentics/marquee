import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { publicEmbedCacheKey } from "../../../src/lib/public-site";
import { selectSubmissionIds } from "../../../src/routes/submissions.queries";
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
  published_count?: number;
  state: string;
  outbox_enqueued: number;
  failures?: Array<{ id: string; code: string; message: string }>;
  results?: Array<{ id: string; outcome: string; resulting_status: string | null; error?: string }>;
}

interface SubmissionListResponse {
  data: Array<{ id: string; status: string }>;
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
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
      `INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at)
       VALUES ('building-mrq19', ?, 'MRQ-19 Hall', '1 Conference Way', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-mrq19', ?, 'building-mrq19', 'Main Stage', 300, 0, '[]', NULL, ?, ?)`,
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
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
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
    SELECT printf('sub-mrq19-%03d', n), ?, 'form-mrq19', CASE WHEN n = 100 THEN 'session' ELSE 'abstract' END,
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

async function requestList(query: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions${query}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
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

async function requestRecordRead(submissionId: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

describe.sequential("MRQ-19 shared decision cascade", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-66, AC-67, AC-68, AC-69 · filter-wide accept resolves all 150 records, reports per-record state, and leaves the CFP open", async () => {
    const response = await requestBulk({
      selector: { filter: { status: "submitted" } },
      action: "accept",
      wave_id: "wave-mrq19",
    });
    expect(response.status).toBe(200);
    const result = await response.json<BulkResponse>();
    expect(result.selected).toBe(150);
    expect(result.succeeded).toBe(150);
    expect(result.failed).toBe(0);
    expect(result.state).toBe("completed");
    expect(result.outbox_enqueued).toBe(150);
    expect(result.results).toHaveLength(150);

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

  test("CONTRACT · MRQ-97 · accepted_any keeps an accepted record findable from wave pending through publication", async () => {
    const listAcceptedFacts = async (): Promise<SubmissionListResponse> => {
      const response = await requestList("?status=accepted_any&sort=title&per_page=100");
      expect(response.status).toBe(200);
      return response.json<SubmissionListResponse>();
    };
    const findTarget = (result: SubmissionListResponse) => result.data.find((item) => item.id === "sub-mrq19-100");

    const freshlyAccepted = await listAcceptedFacts();
    expect(freshlyAccepted.total).toBe(150);
    expect(findTarget(freshlyAccepted)).toMatchObject({ id: "sub-mrq19-100", status: "accepted" });
    expect(await requestRecordRead("sub-mrq19-100").then((response) => response.json<{ stage: string }>())).toMatchObject({ stage: "waved" });
    expect(await env.DB.prepare("SELECT status FROM submissions WHERE id = 'sub-mrq19-100'").first<{ status: string }>()).toEqual({ status: "accepted" });

    const storedSelectorIds = await selectSubmissionIds(env.DB, { eventId: EVENT_ID, status: "accepted_any" }, { statusSemantics: "stored" });
    expect(storedSelectorIds).toHaveLength(150);

    await env.DB.prepare("UPDATE waves SET sent_at = ? WHERE id = 'wave-mrq19'").bind(NOW + 1).run();
    const onboarding = await listAcceptedFacts();
    expect(findTarget(onboarding)).toMatchObject({ id: "sub-mrq19-100", status: "accepted" });
    expect(await requestRecordRead("sub-mrq19-100").then((response) => response.json<{ stage: string }>())).toMatchObject({ stage: "onboarding" });

    const scheduled = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/sub-mrq19-100/schedule`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ starts_at: NOW + 86_400_000, duration_min: 30, room_id: "room-mrq19" }),
    });
    expect(scheduled.status).toBe(200);
    expect(await scheduled.json<{ stage: string }>()).toMatchObject({ stage: "scheduled" });
    expect(findTarget(await listAcceptedFacts())).toMatchObject({ id: "sub-mrq19-100", status: "scheduled" });

    const published = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/sub-mrq19-100/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(published.status).toBe(200);
    expect(await published.json<{ stage: string }>()).toMatchObject({ stage: "published" });
    expect(findTarget(await listAcceptedFacts())).toMatchObject({ id: "sub-mrq19-100", status: "published" });
  }, 20_000);

  test("CONTRACT · MRQ-230 · a published decision refuses without confirmation and bulk reports the skipped live record", async () => {
    const before = await env.DB.prepare(
      `SELECT s.status, s.is_published,
              (SELECT COUNT(*) FROM submission_decisions WHERE submission_id = s.id) AS decisions,
              (SELECT COUNT(*) FROM outbox WHERE entity_id = s.id) AS outbox
       FROM submissions s WHERE s.id = 'sub-mrq19-100'`,
    ).first<{ status: string; is_published: number; decisions: number; outbox: number }>();
    expect(before).toMatchObject({ status: "accepted", is_published: 1, decisions: 1 });
    expect(await env.DB.prepare("SELECT is_published FROM agenda_items WHERE submission_id = 'sub-mrq19-100'").first()).toEqual({ is_published: 1 });

    const refused = await requestRecord("sub-mrq19-100", { recommendation: "deny" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "conflict",
        message: "This session is live on the conference site. Unpublish it or reverse the acceptance to change its outcome.",
      },
    });
    const afterRefusal = await env.DB.prepare(
      `SELECT s.status, s.is_published,
              (SELECT COUNT(*) FROM submission_decisions WHERE submission_id = s.id) AS decisions,
              (SELECT COUNT(*) FROM outbox WHERE entity_id = s.id) AS outbox
       FROM submissions s WHERE s.id = 'sub-mrq19-100'`,
    ).first<{ status: string; is_published: number; decisions: number; outbox: number }>();
    expect(afterRefusal).toEqual(before);

    const bulk = await requestBulk({ selector: { ids: ["sub-mrq19-100"] }, action: "reject" });
    expect(bulk.status).toBe(200);
    expect(await bulk.json<BulkResponse>()).toMatchObject({
      selected: 1,
      succeeded: 0,
      failed: 1,
      published_count: 1,
    });
    expect(await env.DB.prepare("SELECT status FROM submissions WHERE id = 'sub-mrq19-100'").first()).toEqual({ status: "accepted" });

    const cacheKey = publicEmbedCacheKey(EVENT_ID, "mrq19-sessions");
    await env.CACHE.put(cacheKey, JSON.stringify({ cached: true }), { expirationTtl: 60 });
    expect(await env.CACHE.get(cacheKey, "json")).toEqual({ cached: true });
    const confirmed = await requestRecord("sub-mrq19-100", { recommendation: "deny", confirm_published: true });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ resulting_status: "rejected" });
    expect(await env.CACHE.get(cacheKey, "json")).toBeNull();
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
      "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ? AND entity_id = ? AND template_key = 'rejection'",
    ).bind(EVENT_ID, accepted?.id).first<{ total: number }>();
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

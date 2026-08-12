import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq80";
const TOKEN = "mq_mrq80-program-token";
const NOW = Date.parse("2026-08-12T12:00:00.000Z");
const SPEAKER_ID = "person-mrq80-speaker";
const DECISION_ID = "decision-mrq80-accepted";
const SUBMISSION_ID = "sub-mrq80-accepted";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-mrq80', 'MRQ-80 Org', 'mrq-80-org', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq80', 'MRQ-80 Conference', 'mrq-80', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES
        ('person-mrq80-actor', 'org-mrq80', 'organizer@mrq80.test', 'Program Lead', ?, ?),
        (?, 'org-mrq80', 'old-address@mrq80.test', 'Ada Lovelace', ?, ?),
        ('person-mrq80-pending', 'org-mrq80', 'pending@mrq80.test', 'Pending Speaker', ?, ?)`,
    ).bind(NOW, NOW, SPEAKER_ID, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq80', 'org-mrq80', ?, 'person-mrq80-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq80', 'org-mrq80', NULL, 'MRQ-80 test token', ?, 'mq_mrq80', ?, 'person-mrq80-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
       VALUES
        (?, ?, 'abstract', 'A talk that bounced', 'accepted', 'public', ?, 'marquee', ?, ?, ?),
        ('sub-mrq80-pending', ?, 'abstract', 'A pending talk', 'in_review', 'public', 'person-mrq80-pending', 'marquee', ?, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('participation-mrq80-accepted', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq80-pending', 'sub-mrq80-pending', 'person-mrq80-pending', 'speaker', 0, ?, ?)`,
    ).bind(SUBMISSION_ID, SPEAKER_ID, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO outbox
        (id, event_id, template_key, entity_id, person_id, to_email, subject, html, text,
         status, idempotency_key, sent_at, created_at, updated_at)
       VALUES ('outbox-mrq80-original', ?, 'acceptance', ?, ?, 'old-address@mrq80.test',
         'Your session was accepted', '<p>Accepted</p>', 'Accepted', 'sent',
         'original-mrq80-key', ?, ?, ?)`,
    ).bind(EVENT_ID, DECISION_ID, SPEAKER_ID, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submission_decisions
        (id, event_id, submission_id, decision, resulting_status, feedback_md,
         decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
       VALUES (?, ?, ?, 'approve', 'accepted', 'The original feedback',
         'person-mrq80-actor', ?, 'outbox-mrq80-original', ?, ?)`,
    ).bind(DECISION_ID, EVENT_ID, SUBMISSION_ID, NOW, NOW, NOW),
  ]);
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${TOKEN}` };
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
}

describe.sequential("MRQ-80 deliberate decision resend", () => {
  beforeAll(seedFixture, 20_000);

  test("the canonical speaker edit persists a corrected address, then one named resend queues a fresh attempt", async () => {
    const beforeDecision = await env.DB.prepare(
      "SELECT id, feedback_md, decided_at, outbox_id FROM submission_decisions WHERE id = ?",
    ).bind(DECISION_ID).first<Record<string, unknown>>();
    const recordBefore = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`);
    expect(recordBefore.status).toBe(200);
    expect(await recordBefore.json<{ actions: { can_resend_decision: boolean } }>()).toMatchObject({ actions: { can_resend_decision: true } });

    const speakerPatch = await request(`/api/v1/events/${EVENT_ID}/speakers/${SPEAKER_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new-address@mrq80.test" }),
    });
    expect(speakerPatch.status).toBe(200);
    expect(await speakerPatch.json<{ speaker: { email: string } }>()).toMatchObject({ speaker: { email: "new-address@mrq80.test" } });

    const resend = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/decision/resend`, { method: "POST" });
    expect(resend.status).toBe(202);
    const resendBody = await resend.json<{
      submission_id: string;
      decision_id: string;
      resulting_status: string;
      outbox_id: string;
      outbox_inserted: boolean;
    }>();
    expect(resendBody).toMatchObject({
      submission_id: SUBMISSION_ID,
      decision_id: DECISION_ID,
      resulting_status: "accepted",
      outbox_inserted: true,
    });

    const afterDecision = await env.DB.prepare(
      "SELECT id, feedback_md, decided_at, outbox_id FROM submission_decisions WHERE id = ?",
    ).bind(DECISION_ID).first<Record<string, unknown>>();
    expect(afterDecision).toEqual(beforeDecision);
    expect(await env.DB.prepare("SELECT email FROM people WHERE id = ?").bind(SPEAKER_ID).first()).toEqual({ email: "new-address@mrq80.test" });

    const retry = await env.DB.prepare(
      "SELECT id, entity_id, to_email, status, idempotency_key FROM outbox WHERE id = ?",
    ).bind(resendBody.outbox_id).first<{ id: string; entity_id: string; to_email: string; status: string; idempotency_key: string }>();
    expect(retry).toMatchObject({ id: resendBody.outbox_id, entity_id: DECISION_ID, to_email: "new-address@mrq80.test" });
    expect(["queued", "suppressed"]).toContain(retry?.status);
    expect(retry?.idempotency_key).toHaveLength(64);
    expect(retry?.idempotency_key).not.toBe("original-mrq80-key");

    const audit = await env.DB.prepare(
      "SELECT action, entity_id, after_json FROM audit_log WHERE event_id = ? AND action = 'submission.decision_resent'",
    ).bind(EVENT_ID).first<{ action: string; entity_id: string; after_json: string }>();
    expect(audit?.entity_id).toBe(SUBMISSION_ID);
    expect(JSON.parse(audit?.after_json ?? "{}" )).toMatchObject({ outbox_id: resendBody.outbox_id, to_email: "new-address@mrq80.test" });
  });

  test("the bulk notifier still excludes the already-sent decision after a deliberate resend", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = ?").bind(EVENT_ID).first<{ total: number }>();
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions/not-notified/notify`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ selected: 0, queued: 0, skipped_no_address: 0, remaining: 0, next_cursor: null, outbox_ids: [] });
    const after = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = ?").bind(EVENT_ID).first<{ total: number }>();
    expect(after).toEqual(before);
  });

  test("resend refuses a record without an accepted or rejected decision", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions/sub-mrq80-pending/decision/resend`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json<{ error: { message: string } }>()).toMatchObject({ error: { message: "only accepted or rejected decisions can be resent" } });
    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/sub-mrq80-pending`);
    expect(record.status).toBe(200);
    expect(await record.json<{ actions: { can_resend_decision: boolean } }>()).toMatchObject({ actions: { can_resend_decision: false } });
  });
});

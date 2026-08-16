import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq234-plan";
const TOKEN = "mq_mrq234-plan-token";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq234-plan', 'MRQ-234 Org', 'mrq234-plan', ?, ?)").bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq234-plan', 'MRQ-234 Conference', 'mrq234-plan', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES
       ('person-mrq234-plan-actor', 'org-mrq234-plan', 'organizer@mrq234.test', 'Program Lead', ?, ?),
       ('person-mrq234-plan-good', 'org-mrq234-plan', 'ada@mrq234.test', 'Ada Lovelace', ?, ?),
       ('person-mrq234-plan-invalid', 'org-mrq234-plan', 'not-an-email', 'Missing Address', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq234-plan', 'org-mrq234-plan', ?, 'person-mrq234-plan-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq234-plan', 'org-mrq234-plan', NULL, 'MRQ-234 test token', ?, 'mq_mrq234', ?, 'person-mrq234-plan-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
       VALUES
        ('sub-mrq234-plan-good', ?, 'abstract', 'Read first', 'submitted', 'public', 'person-mrq234-plan-good', 'marquee', ?, ?, ?),
        ('sub-mrq234-plan-invalid', ?, 'abstract', 'Needs an address', 'submitted', 'public', 'person-mrq234-plan-invalid', 'marquee', ?, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW, NOW, EVENT_ID, NOW, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('par-mrq234-plan-good', 'sub-mrq234-plan-good', 'person-mrq234-plan-good', 'speaker', 0, ?, ?),
        ('par-mrq234-plan-invalid', 'sub-mrq234-plan-invalid', 'person-mrq234-plan-invalid', 'speaker', 0, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
       VALUES ('template-mrq234-plan-acceptance', ?, 'acceptance', 'Acceptance', 'Accepted: {{submission.title}}', 'Hi {{speaker.first_name}}\\n\\n{{decision.feedback}}', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
  ]);
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

describe.sequential("MRQ-234 decision plan routes", () => {
  beforeAll(seedFixture, 20_000);

  test("bulk plan returns four rows, a real rendered recipient, feedback echo, demo truth, and strong fingerprint", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/decision-plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        selector: { ids: ["sub-mrq234-plan-good", "sub-mrq234-plan-invalid"] },
        action: "accept",
        feedback_md: "  Please join us.  ",
      }),
    });
    expect(response.status).toBe(200);
    const plan = await response.json<{
      action: string;
      feedback_md: string | null;
      rows: Array<{ disposition: string; count: number; records: Array<{ id: string; reason: string }> }>;
      recipient_preview: { to_email: string; subject: string; text: string; html: string } | null;
      demo_suppressed: number;
      plan_fingerprint: string;
      etag: string;
      queue_revision: number;
      selected: number;
    }>();
    expect(plan.action).toBe("accept");
    expect(plan.feedback_md).toBe("Please join us.");
    expect(plan.rows.map((row) => row.disposition)).toEqual(["will_send", "already_notified", "no_valid_address", "cannot_move"]);
    expect(plan.rows.map((row) => row.count)).toEqual([1, 0, 1, 0]);
    expect(plan.recipient_preview).toMatchObject({ to_email: "ada@mrq234.test", subject: "Accepted: Read first" });
    expect(plan.recipient_preview?.text).toContain("Please join us.");
    expect(plan.recipient_preview?.html).toContain("Please join us.");
    expect(plan.demo_suppressed).toBe(1);
    expect(plan.selected).toBe(2);
    expect(plan.plan_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.etag).toBe(`"${plan.plan_fingerprint}:0"`);
    expect(plan.queue_revision).toBe(NOW);
  });

  test("single-record plan uses the same contract and does not fabricate mail for waitlist", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/sub-mrq234-plan-good/decision-plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ recommendation: "maybe", feedback_md: "Hold for the next wave." }),
    });
    expect(response.status).toBe(200);
    const plan = await response.json<{ mail_mode: string; recipient_preview: unknown; rows: Array<{ disposition: string; count: number }> }>();
    expect(plan.mail_mode).toBe("none");
    expect(plan.recipient_preview).toBeNull();
    expect(plan.rows[0]).toMatchObject({ disposition: "will_send", count: 1 });
  });
});

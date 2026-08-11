import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { readDeliveryHealth } from "../../../src/routes/health-surface.routes";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq74";
const OTHER_EVENT_ID = "evt-mrq74-other";
const TOKEN = "mq_mrq74-program-token";
const NOW = Date.parse("2026-08-11T18:00:00.000Z");
const DAY = 86_400_000;

interface HealthSnapshot {
  generated_at: number;
  event_id: string;
  demo_mode: boolean;
  summary: { level: string; headline: string; detail: string };
  capabilities: Array<{ id: string; label: string; level: string; headline: string; detail: string; href: string | null }>;
  quota: { sent_today: number; waiting: number; daily_limit: number; remaining: number; level: string; headline: string; detail: string };
  totals: { delivered: number; waiting: number; held_back: number; undelivered: number };
  owed: Array<{ submission_id: string; person_name: string; state: string; level: string; reason: string; what_to_do: string; href: string }>;
  owed_total: number;
  owed_urgent: number;
  owed_counted: number;
  owed_reasons: Array<{ state: string; level: string; reason: string; count: number }>;
  owed_shown: number;
  owed_href: string;
  infrastructure_reported: boolean;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq74', 'MRQ-74 Org', 'mrq-74-org', ?, ?)").bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES
        (?, 'org-mrq74', 'MRQ-74 Conference', 'mrq-74', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?),
        (?, 'org-mrq74', 'Other Conference', 'mrq-74-other', '2026-11-01', '2026-11-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW, OTHER_EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES
        ('person-mrq74-actor', 'org-mrq74', 'organizer@mrq74.test', 'Program Lead', ?, ?),
        ('person-mrq74-bounced', 'org-mrq74', 'bounced@mrq74.test', 'Ada Lovelace', ?, ?),
        ('person-mrq74-silent', 'org-mrq74', 'silent@mrq74.test', 'Grace Hopper', ?, ?),
        ('person-mrq74-noaddress', 'org-mrq74', 'not-an-email', 'Katherine Johnson', ?, ?),
        ('person-mrq74-told', 'org-mrq74', 'told@mrq74.test', 'Annie Easley', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq74', 'org-mrq74', ?, 'person-mrq74-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq74', 'org-mrq74', NULL, 'MRQ-74 test token', ?, 'mq_mrq74', ?, 'person-mrq74-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read"], event_ids: [EVENT_ID, OTHER_EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, created_at, updated_at)
       VALUES ('form-mrq74', ?, 'Call for speakers', 'cfp', 'abstract', 'open', ?, ?, ?, ?)`,
    ).bind(EVENT_ID, NOW - 30 * DAY, NOW + 4 * DAY, NOW, NOW),
  ]);

  const submissions: Array<[string, string, string, string, string]> = [
    ["sub-mrq74-bounced", EVENT_ID, "Bounced acceptance", "accepted", "person-mrq74-bounced"],
    ["sub-mrq74-silent", EVENT_ID, "Never written acceptance", "accepted", "person-mrq74-silent"],
    ["sub-mrq74-noaddress", EVENT_ID, "No address rejection", "rejected", "person-mrq74-noaddress"],
    ["sub-mrq74-told", EVENT_ID, "Delivered acceptance", "accepted", "person-mrq74-told"],
    ["sub-mrq74-other", OTHER_EVENT_ID, "Another conference's gap", "accepted", "person-mrq74-silent"],
  ];
  await env.DB.batch(submissions.map(([id, eventId, title, status, personId]) => env.DB.prepare(
    `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
     VALUES (?, ?, 'abstract', ?, ?, 'public', ?, 'marquee', ?, ?, ?)`,
  ).bind(id, eventId, title, status, personId, NOW - 20 * DAY, NOW - 20 * DAY, NOW)));

  await env.DB.batch(submissions.map(([id, , , , personId]) => env.DB.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
     VALUES (?, ?, ?, 'speaker', 0, ?, ?)`,
  ).bind(`par-${id}`, id, personId, NOW, NOW)));

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO outbox (id, event_id, template_key, entity_id, person_id, to_email, subject, html, text, status,
        suppressed_reason, idempotency_key, error, sent_at, created_at, updated_at)
       VALUES
        ('outbox-mrq74-bounced', ?, 'acceptance', 'decision-mrq74-bounced', 'person-mrq74-bounced', 'bounced@mrq74.test', 'You are in', '<p>In</p>', 'In', 'failed', NULL, 'key-mrq74-bounced', 'the address was rejected', NULL, ?, ?),
        ('outbox-mrq74-told', ?, 'acceptance', 'decision-mrq74-told', 'person-mrq74-told', 'told@mrq74.test', 'You are in', '<p>In</p>', 'In', 'sent', NULL, 'key-mrq74-told', NULL, ?, ?, ?),
        ('outbox-mrq74-reminder', ?, 'reminder', 'sub-mrq74-told', 'person-mrq74-told', 'told@mrq74.test', 'A reminder', '<p>Soon</p>', 'Soon', 'sent', NULL, 'key-mrq74-reminder', NULL, ?, ?, ?)`,
    ).bind(EVENT_ID, NOW - 2 * DAY, NOW, EVENT_ID, NOW - DAY, NOW - DAY, NOW, EVENT_ID, NOW - 60_000, NOW - 60_000, NOW),
    env.DB.prepare(
      `INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
       VALUES
        ('decision-mrq74-bounced', ?, 'sub-mrq74-bounced', 'approve', 'accepted', NULL, 'person-mrq74-actor', ?, 'outbox-mrq74-bounced', ?, ?),
        ('decision-mrq74-silent', ?, 'sub-mrq74-silent', 'approve', 'accepted', NULL, 'person-mrq74-actor', ?, NULL, ?, ?),
        ('decision-mrq74-noaddress', ?, 'sub-mrq74-noaddress', 'deny', 'rejected', NULL, 'person-mrq74-actor', ?, NULL, ?, ?),
        ('decision-mrq74-told', ?, 'sub-mrq74-told', 'approve', 'accepted', NULL, 'person-mrq74-actor', ?, 'outbox-mrq74-told', ?, ?),
        ('decision-mrq74-other', ?, 'sub-mrq74-other', 'approve', 'accepted', NULL, 'person-mrq74-actor', ?, NULL, ?, ?)`,
    ).bind(
      EVENT_ID, NOW - 2 * DAY, NOW, NOW,
      EVENT_ID, NOW - 5 * DAY, NOW, NOW,
      EVENT_ID, NOW - DAY, NOW, NOW,
      EVENT_ID, NOW - DAY, NOW, NOW,
      OTHER_EVENT_ID, NOW - 6 * DAY, NOW, NOW,
    ),
  ]);
}

async function health(headers: HeadersInit, eventId = EVENT_ID): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${eventId}/delivery-health`, { headers });
}

describe.sequential("MRQ-74 delivery health surface", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · the route is authenticated and grant-scoped like every other program read", async () => {
    expect((await health({})).status).toBe(401);
    expect((await health({ authorization: "Bearer mq_not-a-real-token" })).status).toBe(401);
    expect((await health({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  test("CONTRACT · the ledger answers who is owed a message, worst first, each row opening its record", async () => {
    const response = await health({ authorization: `Bearer ${TOKEN}` });
    const snapshot = await response.json<HealthSnapshot>();

    expect(snapshot.event_id).toBe(EVENT_ID);
    expect(snapshot.owed_total).toBe(3);
    expect(snapshot.owed_urgent).toBe(3);
    expect(snapshot.owed_counted).toBe(3);
    // Worst first: the particular failures that each need a person outrank the
    // bulk case of a decision that simply was never sent.
    expect(snapshot.owed.map((row) => row.submission_id)).toEqual([
      "sub-mrq74-bounced",
      "sub-mrq74-noaddress",
      "sub-mrq74-silent",
    ]);
    expect(snapshot.owed.every((row) => row.level === "alarm")).toBe(true);
    expect(snapshot.owed.map((row) => row.state)).toEqual(["undelivered", "no_address", "never_prepared"]);
    expect(snapshot.owed.map((row) => row.href)).toEqual([
      "/submissions/sub-mrq74-bounced",
      "/submissions/sub-mrq74-noaddress",
      "/submissions/sub-mrq74-silent",
    ]);
    expect(snapshot.owed[0].person_name).toBe("Ada Lovelace");
    expect(snapshot.owed_reasons.map((reason) => reason.count)).toEqual([1, 1, 1]);
    expect(snapshot.owed_href).toBe("/submissions?status=not_notified");
    expect(snapshot.summary.level).toBe("alarm");
    expect(snapshot.summary.headline).toBe("3 speakers have not heard from you.");
  });

  test("CONTRACT · a decision that reached its speaker never appears as owed", async () => {
    const snapshot = await (await health({ authorization: `Bearer ${TOKEN}` })).json<HealthSnapshot>();
    expect(snapshot.owed.some((row) => row.submission_id === "sub-mrq74-told")).toBe(false);
    expect(snapshot.totals).toEqual({ delivered: 2, waiting: 0, held_back: 0, undelivered: 1 });
  });

  test("CONTRACT · the ledger is scoped to one conference, at the door and in the query", async () => {
    // A credential that carries no standing on the second conference is refused
    // outright, and the read itself never crosses conferences either.
    expect((await health({ authorization: `Bearer ${TOKEN}` }, OTHER_EVENT_ID)).status).toBe(403);

    const other = await readDeliveryHealth(env.DB, OTHER_EVENT_ID, NOW);
    expect(other.owed.map((row) => row.submission_id)).toEqual(["sub-mrq74-other"]);
    expect(other.totals.delivered).toBe(0);
    expect(other.owed_total).toBe(1);
  });

  test("CONTRACT · the capability panel is the same eight rows and the raw error text never leaves the store", async () => {
    const snapshot = await (await health({ authorization: `Bearer ${TOKEN}` })).json<HealthSnapshot>();
    expect(snapshot.capabilities.map((row) => row.id)).toEqual([
      "storage", "submissions", "email", "calendar", "uploads", "mirror", "webhooks", "scheduled",
    ]);
    expect(snapshot.capabilities.find((row) => row.id === "email")?.level).toBe("alarm");
    expect(snapshot.capabilities.find((row) => row.id === "submissions")?.level).toBe("ok");
    expect(JSON.stringify(snapshot)).not.toContain("the address was rejected");
  });

  test("CONTRACT · the send allowance counts the whole installation, because the ceiling belongs to the mail account", async () => {
    const snapshot = await (await health({ authorization: `Bearer ${TOKEN}` })).json<HealthSnapshot>();
    expect(snapshot.quota.daily_limit).toBe(100);
    expect(snapshot.quota.sent_today).toBeGreaterThanOrEqual(1);
    expect(snapshot.quota.remaining).toBe(100 - snapshot.quota.sent_today);
  });

  test("CONTRACT · the real telemetry report decides the platform rows", async () => {
    // Not a fixture: this is the live diagnostics body, so the two surfaces
    // cannot drift apart without this test noticing.
    const probeResponse = await SELF.fetch(`${ORIGIN}/api/v1/telemetry/diagnostics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(probeResponse.status).toBe(200);
    const diagnostics = await probeResponse.json<{
      status: string;
      probes: Array<{ name: string; ok: boolean }>;
      crons: Array<{ cron: string; last_success_at: number; age_ms: number; stale: boolean }>;
    }>();
    expect(diagnostics.probes.map((probe) => probe.name)).toEqual(["d1", "kv", "r2", "queues"]);

    const reported = await readDeliveryHealth(env.DB, EVENT_ID, NOW, diagnostics);
    expect(reported.infrastructure_reported).toBe(true);
    // D1 answered — this test is talking to it — so that row is green from a
    // real probe rather than an assumption.
    expect(reported.capabilities.find((row) => row.id === "storage")?.level).toBe("ok");
    // Every trigger reports a zero stamp on a store that has never run one:
    // unknown, never a decade overdue.
    expect(diagnostics.crons.every((cron) => cron.last_success_at === 0)).toBe(true);
    expect(reported.capabilities.find((row) => row.id === "scheduled")?.level).toBe("unknown");

    const unreported = await readDeliveryHealth(env.DB, EVENT_ID, NOW);
    expect(unreported.infrastructure_reported).toBe(false);
    expect(unreported.capabilities.find((row) => row.id === "scheduled")?.level).toBe("unknown");
    expect(unreported.capabilities.find((row) => row.id === "storage")?.level).toBe("unknown");
  });

  test("CONTRACT · a stopped hourly trigger reaches the screen as a red row that names what stopped", async () => {
    const { recordCronHeartbeat, readCronHeartbeats } = await import("../../../src/lib/observability/heartbeat");
    await recordCronHeartbeat(env.CACHE, "0 * * * *", NOW - 12 * 3_600_000);
    const crons = await readCronHeartbeats(env.CACHE, NOW);
    const reported = await readDeliveryHealth(env.DB, EVENT_ID, NOW, { status: "degraded", probes: [], crons });

    const scheduled = reported.capabilities.find((row) => row.id === "scheduled");
    expect(scheduled?.level).toBe("alarm");
    expect(scheduled?.headline).toBe("Deadline reminders has not run in 12 hours.");
    expect(scheduled?.detail).toContain("reminder emails before your form closes");
    expect(JSON.stringify(scheduled)).not.toContain("* * *");
  });
});

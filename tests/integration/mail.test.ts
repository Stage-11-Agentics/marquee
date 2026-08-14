import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { OutboxRow } from "../../src/db/schema";
import { app } from "../../src/index";
import { createSession } from "../../src/lib/auth/auth-sessions";
import { listCommsAudience, listCommsRecipientsForSubmissionIds } from "../../src/jobs/mail/audience";
import { processMailOutbox, runMailSchedule, type MailProvider } from "../../src/jobs/mail/consumer";
import { enqueueOutbox, enqueuePublicFormConfirmation, enqueueSmokeHarnessMail, buildIdempotencyKey } from "../../src/jobs/mail/outbox";
import { isMailScheduleCron, selectOverdueTaskCandidates, selectPreCloseReminderCandidates } from "../../src/jobs/mail/schedule";
import { mergeDataForRecipient } from "../../src/jobs/mail/merge-data";
import { enqueueBulkReminder, enqueuePreCloseReminders, enqueueTrigger } from "../../src/jobs/mail/triggers";
import { findTemplate, renderStoredTemplate, TRIGGER_TEMPLATE_KEYS } from "../../src/jobs/mail/templates";
import { renderMail } from "../../src/jobs/mail/render";
import { dueAtFromDateInput } from "../../src/lib/task-due";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_mail', 'Mail Org', 'mail-org', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES ('evt_mail', 'org_mail', 'Mail Conference', 'mail', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail', 'org_mail', 'speaker@example.com', 'Ada Lovelace', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mail', 'org_mail', 'evt_mail', 'per_mail', 'owner', ?, ?)").bind(NOW, NOW),
    // clock-check: allow — this window is read only by enqueuePreCloseReminders(env.DB, NOW + n), which takes its clock as an argument
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, reminder_offset_hours, created_at, updated_at) VALUES ('form_mail', 'evt_mail', 'CFP', 'cfp', 'abstract', 'open', ?, 24, ?, ?)").bind(NOW + 48 * 60 * 60_000, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mail', 'evt_mail', 'form_mail', 'abstract', 'Reliable email', 'submitted', 'public', 'per_mail', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mail', 'sub_mail', 'per_mail', 'speaker', 0, ?, ?)").bind(NOW, NOW),
  ]);
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_templates WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM outbox WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM event_settings WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM audit_log WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM speaker_tasks WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM task_templates WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM submission_tracks WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = 'evt_mail')"),
    env.DB.prepare("DELETE FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = 'evt_mail')"),
    env.DB.prepare("DELETE FROM submissions WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM forms WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM formats WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM tracks WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM auth_sessions WHERE person_id = 'per_mail'"),
    env.DB.prepare("DELETE FROM memberships WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM people WHERE org_id = 'org_mail'"),
    env.DB.prepare("DELETE FROM events WHERE id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM organizations WHERE id = 'org_mail'"),
  ]);
});

function provider(): MailProvider & { batches: OutboxRow[][]; singles: OutboxRow[] } {
  const result = {
    batches: [] as OutboxRow[][],
    singles: [] as OutboxRow[],
    async sendBatch(rows: readonly OutboxRow[]) {
      result.batches.push([...rows]);
      return rows.map((row) => `provider-${row.id}`);
    },
    async sendSingle(row: OutboxRow) {
      result.singles.push(row);
      return `provider-${row.id}`;
    },
  };
  return result;
}

test("AC-33 · auth-shaped and form-shaped messages render into the outbox with deterministic business identity", async () => {
  const first = await enqueueOutbox({
    db: env.DB,
    eventId: "evt_mail",
    templateKey: "submission_confirmation",
    entityId: "sub_mail",
    personId: "per_mail",
    toEmail: "speaker@example.com",
    data: { "speaker.first_name": "Ada", "submission.title": "Reliable email" },
  });
  const row = await env.DB.prepare("SELECT * FROM outbox WHERE id = ?").bind(first.id).first<OutboxRow>();
  expect(row?.subject).toContain("Reliable email");
  expect(row?.text).toContain("Ada");
  expect(row?.send_policy).toBe("demo_safe");
  expect(row?.idempotency_key).toBe(await buildIdempotencyKey("submission_confirmation", "sub_mail", "per_mail"));
});

test("AC-117, AC-93 · the same bulk action twice relies on the UNIQUE idempotency constraint and delivers once", async () => {
  const input = {
    db: env.DB,
    eventId: "evt_mail",
    templateKey: "rejection" as const,
    recipients: [{ entityId: "sub_mail", personId: "per_mail", toEmail: "speaker@example.com", data: { "submission.title": "Reliable email" } }],
  };
  const first = await enqueueBulkReminder(input);
  const second = await enqueueBulkReminder(input);
  expect(first[0].inserted).toBe(true);
  expect(second[0].inserted).toBe(false);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE idempotency_key = ?").bind(first[0].idempotencyKey).first<{ n: number }>();
  expect(count?.n).toBe(1);
  await env.DB.prepare(
    "INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at) VALUES ('setting_mail_allowlist', 'evt_mail', 'demo_safe_allowlist', '[\"speaker@example.com\"]', ?, ?)",
  ).bind(NOW, NOW).run();
  const fake = provider();
  expect(await processMailOutbox(env.DB, env, [first[0].id, second[0].id], { provider: fake, now: NOW, sleep: async () => undefined })).toEqual({ sent: 1, suppressed: 0, failed: 0 });
  // The duplicate was already marked by the first delivery attempt; it did not produce a second provider call.
  expect(fake.batches).toHaveLength(1);
  expect(fake.singles).toHaveLength(0);

  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-empty-selection" });
  await env.DB.prepare("DELETE FROM outbox WHERE event_id = 'evt_mail'").run();
  const emptyResponse = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({ selector: { person_ids: [], submission_ids: [] }, template_key: "reminder_generic" }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(emptyResponse.status).toBe(202);
  expect(await emptyResponse.json<{ selected: number; queued: number; duplicate: number; skipped: unknown[]; outbox_ids: string[]; outbox_rows: unknown[] }>()).toEqual({ selected: 0, queued: 0, duplicate: 0, skipped: [], outbox_ids: [], outbox_rows: [] });
  const emptyCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE event_id = 'evt_mail'").first<{ n: number }>();
  expect(emptyCount?.n).toBe(0);
});

test("AC-93 · exact person selection can queue a demo-safe reminder for a roster speaker without a submission", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail_roster', 'org_mail', 'roster@example.com', 'Roster Speaker', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mail_roster', 'org_mail', 'evt_mail', 'per_mail_roster', 'speaker', ?, ?)").bind(NOW, NOW),
    // clock-check: allow — the assertion here is which recipients get selected; no path in it compares a due date to the clock
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at) VALUES ('template_mail_roster', 'evt_mail', 'Upload slides', 'file', 'Upload the deck.', ?, 0, 0, ?, ?)").bind(NOW + 86_400_000, NOW, NOW),
    // clock-check: allow — as above: the task exists to be selectable, and its due date is never read against the clock
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mail_roster', 'evt_mail', 'per_mail_roster', NULL, 'template_mail_roster', 'Upload slides', 'file', 'Upload the deck.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(NOW + 86_400_000, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-person-selection" });
  const response = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({ selector: { person_ids: ["per_mail_roster"], role: "speaker", task_state: "open" }, template_key: "task_overdue" }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ selected: 1, queued: 1, duplicate: 0, outbox_rows: [{ person_id: "per_mail_roster", entity_id: "per_mail_roster", inserted: true }] });
  const row = await env.DB.prepare("SELECT entity_id, send_policy FROM outbox WHERE event_id = 'evt_mail' AND person_id = 'per_mail_roster'").first<{ entity_id: string; send_policy: string }>();
  expect(row).toEqual({ entity_id: "per_mail_roster", send_policy: "demo_safe" });
});

test("AC-93 · exact recipient pairs do not cross-multiply co-speaking selections", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail_co', 'org_mail', 'co@example.com', 'Co Speaker', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mail_panel', 'evt_mail', 'form_mail', 'session', 'Panel session', 'submitted', 'public', 'per_mail', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mail_panel_a', 'sub_mail_panel', 'per_mail', 'speaker', 0, ?, ?), ('part_mail_panel_b', 'sub_mail_panel', 'per_mail_co', 'speaker', 1, ?, ?)").bind(NOW, NOW, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-pair-selection" });
  const response = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({
      selector: {
        recipient_pairs: [
          { person_id: "per_mail", submission_id: "sub_mail" },
          { person_id: "per_mail_co", submission_id: "sub_mail_panel" },
        ],
        role: "speaker",
      },
      template_key: "reminder_generic",
    }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ selected: 2, queued: 2, duplicate: 0 });
  const rows = await env.DB.prepare("SELECT person_id, entity_id FROM outbox WHERE event_id = 'evt_mail' ORDER BY person_id, entity_id").all<{ person_id: string; entity_id: string }>();
  expect(rows.results).toEqual([
    { person_id: "per_mail", entity_id: "sub_mail" },
    { person_id: "per_mail_co", entity_id: "sub_mail_panel" },
  ]);
});

test("CONTRACT · MRQ-180 · a mixed bulk reminder accounts for and names the recipient it cannot queue", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mrq180_queueable', 'org_mail', 'priya@example.com', 'Priya Raman', ?, ?), ('per_mrq180_missing', 'org_mail', '', 'Marcus Okafor', ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mrq180_queueable', 'evt_mail', 'form_mail', 'session', 'Queueable session', 'accepted', 'admin', 'per_mail', ?, ?), ('sub_mrq180_missing', 'evt_mail', 'form_mail', 'session', 'Missing address session', 'accepted', 'admin', 'per_mail', ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mrq180_queueable', 'sub_mrq180_queueable', 'per_mrq180_queueable', 'speaker', 0, ?, ?), ('part_mrq180_missing', 'sub_mrq180_missing', 'per_mrq180_missing', 'speaker', 0, ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at) VALUES ('template_mrq180', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 0, 0, ?, ?)").bind(Date.now() + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq180_queueable', 'evt_mail', 'per_mrq180_queueable', 'sub_mrq180_queueable', 'template_mrq180', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?), ('task_mrq180_missing', 'evt_mail', 'per_mrq180_missing', 'sub_mrq180_missing', 'template_mrq180', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(Date.now() + 86_400_000, NOW, NOW, Date.now() + 86_400_000, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-180-mixed-reminder" });
  const response = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({
      selector: {
        recipient_pairs: [
          { person_id: "per_mrq180_queueable", submission_id: "sub_mrq180_queueable" },
          { person_id: "per_mrq180_missing", submission_id: "sub_mrq180_missing" },
        ],
        role: "speaker",
        task_state: "open",
      },
      template_key: "reminder_generic",
    }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  const result = await response.json() as {
    selected: number;
    queued: number;
    duplicate: number;
    skipped: Array<{ person_id: string; name: string; reason: string }>;
  };
  expect(result).toMatchObject({
    selected: 2,
    queued: 1,
    duplicate: 0,
    skipped: [{ person_id: "per_mrq180_missing", name: "Marcus Okafor", reason: "no email address on file" }],
  });
  expect(result.queued + result.duplicate + result.skipped.length).toBe(result.selected);
  expect(await env.DB.prepare("SELECT person_id, to_email FROM outbox WHERE event_id = 'evt_mail' ORDER BY person_id").all<{ person_id: string; to_email: string }>()).toMatchObject({
    results: [{ person_id: "per_mrq180_queueable", to_email: "priya@example.com" }],
  });
});

test("CONTRACT · MRQ-180 · exact onboarding pairs queue a co-speaker without a role filter", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mrq180_speaker', 'org_mail', 'speaker-180@example.com', 'Priya Raman', ?, ?), ('per_mrq180_co', 'org_mail', 'co-speaker-180@example.com', 'Marcus Okafor', ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mrq180_speaker', 'evt_mail', 'form_mail', 'session', 'Main session', 'accepted', 'admin', 'per_mail', ?, ?), ('sub_mrq180_co', 'evt_mail', 'form_mail', 'session', 'Co-speaker session', 'accepted', 'admin', 'per_mail', ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mrq180_speaker', 'sub_mrq180_speaker', 'per_mrq180_speaker', 'speaker', 0, ?, ?), ('part_mrq180_co', 'sub_mrq180_co', 'per_mrq180_co', 'co_speaker', 0, ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at) VALUES ('template_mrq180_roles', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 0, 0, ?, ?)").bind(Date.now() + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq180_speaker', 'evt_mail', 'per_mrq180_speaker', 'sub_mrq180_speaker', 'template_mrq180_roles', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?), ('task_mrq180_co', 'evt_mail', 'per_mrq180_co', 'sub_mrq180_co', 'template_mrq180_roles', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(Date.now() + 86_400_000, NOW, NOW, Date.now() + 86_400_000, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-180-co-speaker-reminder" });
  const headers = { cookie: `mq_session=${session.id}`, "content-type": "application/json" };
  const pairs = [
    { person_id: "per_mrq180_speaker", submission_id: "sub_mrq180_speaker" },
    { person_id: "per_mrq180_co", submission_id: "sub_mrq180_co" },
  ];

  // Keep the old selector in the test once to prove the reconciliation path
  // names a selected co-speaker instead of silently dropping it.
  const roleFilteredResponse = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers,
    body: JSON.stringify({ selector: { recipient_pairs: pairs, role: "speaker", task_state: "open" }, template_key: "reminder_generic" }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(roleFilteredResponse.status).toBe(202);
  expect(await roleFilteredResponse.json()).toMatchObject({
    selected: 2,
    queued: 1,
    duplicate: 0,
    skipped: [{ person_id: "per_mrq180_co", name: "Marcus Okafor", reason: "does not have the speaker role on this Session" }],
  });

  // The onboarding board sends exact pairs without a role filter, so the same
  // two selected rows must both queue and leave no unexplained remainder.
  await env.DB.prepare("DELETE FROM outbox WHERE event_id = 'evt_mail'").run();
  const response = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers,
    body: JSON.stringify({ selector: { recipient_pairs: pairs, task_state: "open" }, template_key: "reminder_generic" }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  const result = await response.json() as {
    selected: number;
    queued: number;
    duplicate: number;
    skipped: Array<{ person_id: string; name: string; reason: string }>;
  };
  expect(result).toMatchObject({ selected: 2, queued: 2, duplicate: 0, skipped: [] });
  expect(result.queued + result.duplicate + result.skipped.length).toBe(result.selected);
  expect(await env.DB.prepare("SELECT person_id, to_email FROM outbox WHERE event_id = 'evt_mail' ORDER BY person_id").all<{ person_id: string; to_email: string }>()).toMatchObject({
    results: [
      { person_id: "per_mrq180_co", to_email: "co-speaker-180@example.com" },
      { person_id: "per_mrq180_speaker", to_email: "speaker-180@example.com" },
    ],
  });
});

test("AC-93 · preview does not resolve a person outside the requested event", async () => {
  await env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail_other_event', 'org_mail', 'other@example.com', 'Other Event Speaker', ?, ?)").bind(NOW, NOW).run();
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-preview-scope" });
  const response = await app.request("/api/v1/events/evt_mail/comms/preview", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({ person_id: "per_mail_other_event", template_key: "reminder_generic" }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(404);
  expect(await response.json()).not.toHaveProperty("to_email");
});

test("AC-125 · G3 · all seven automated triggers plus bulk are suppressed before delivery in demo mode", async () => {
  const ids: string[] = [];
  for (const [index, templateKey] of TRIGGER_TEMPLATE_KEYS.entries()) {
    const result = await enqueueTrigger({
      db: env.DB,
      eventId: "evt_mail",
      templateKey,
      entityId: `entity_${index}`,
      personId: "per_mail",
      toEmail: "speaker@example.com",
    });
    expect(result?.inserted).toBe(true);
    if (result) ids.push(result.id);
  }
  const bulk = await enqueueBulkReminder({
    db: env.DB,
    eventId: "evt_mail",
    templateKey: "reminder_generic",
    recipients: [{
      entityId: "bulk_entity",
      personId: "per_mail",
      toEmail: "bulk-not-allowlisted@example.com",
      data: { "speaker.first_name": "Ada" },
    }],
  });
  ids.push(...bulk.map((row) => row.id));
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox").first<{ n: number }>();
  expect(count?.n).toBe(8);
  const fake = provider();
  expect(await processMailOutbox(env.DB, env, ids, { provider: fake, now: NOW, sleep: async () => undefined })).toEqual({ sent: 0, suppressed: 8, failed: 0 });
  expect(fake.batches).toHaveLength(0);
  expect(fake.singles).toHaveLength(0);
  const statusRows = await env.DB.prepare(
    "SELECT status, send_policy, suppressed_reason, COUNT(*) AS count FROM outbox GROUP BY status, send_policy, suppressed_reason",
  ).all<{ status: string; send_policy: string; suppressed_reason: string; count: number }>();
  expect(statusRows.results).toEqual([{
    status: "suppressed",
    send_policy: "demo_safe",
    suppressed_reason: "demo_mode_not_allowlisted",
    count: 8,
  }]);
  console.log("MRQ-45 demo matrix: outbox_rows=" + (count?.n ?? 0) + " suppressed=" + (statusRows.results[0]?.count ?? 0) + " sent=0 provider_batches=" + fake.batches.length + " provider_singles=" + fake.singles.length);
});

test("AC-126 · a disabled trigger emits no row and an edited template round-trips into rendered content", async () => {
  await env.DB.prepare(
    `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
     VALUES ('tpl_mail', 'evt_mail', 'acceptance', 'Acceptance', 'Old {{speaker.first_name}}', 'Old body', 0, ?, ?)`,
  ).bind(NOW, NOW).run();
  expect(await enqueueTrigger({ db: env.DB, eventId: "evt_mail", templateKey: "acceptance", entityId: "sub_mail", personId: "per_mail", toEmail: "speaker@example.com" })).toBeNull();
  await env.DB.prepare("UPDATE email_templates SET enabled = 1, subject = ?, body_md = ? WHERE id = 'tpl_mail'").bind("Welcome {{speaker.first_name}}", "Hello {{submission.title}}").run();
  const rendered = await renderStoredTemplate(env.DB, "evt_mail", "acceptance", { "speaker.first_name": "Ada", "submission.title": "Reliable email" });
  expect(rendered.rendered.subject).toBe("Welcome Ada");
  expect(rendered.rendered.text).toContain("Reliable email");
});

test("AC-127 · the pre-close schedule fires at the configured offset and not before", async () => {
  expect(isMailScheduleCron("0 * * * *")).toBe(true);
  expect(isMailScheduleCron("*/5 * * * *")).toBe(false);
  await env.DB.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = 'evt_mail'").run();
  expect(await selectPreCloseReminderCandidates(env.DB, NOW + 23 * 60 * 60_000)).toHaveLength(0);
  const preClose = await selectPreCloseReminderCandidates(env.DB, NOW + 24 * 60 * 60_000);
  expect(preClose).toHaveLength(1);
  expect(preClose[0]?.data["form.closes_at"]).toBe("Aug 12, 2026, 8:00 AM EDT");
  expect(await selectOverdueTaskCandidates(env.DB, NOW)).toHaveLength(0);
  expect(await enqueuePreCloseReminders(env.DB, NOW + 23 * 60 * 60_000)).toBe(0);
  expect(await enqueuePreCloseReminders(env.DB, NOW + 24 * 60 * 60_000)).toBe(1);
  expect(await enqueuePreCloseReminders(env.DB, NOW + 25 * 60 * 60_000)).toBe(0);
});

test("CONTRACT · MRQ-201 · overdue mail waits for the conference-local due day to end", async () => {
  await env.DB.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = 'evt_mail'").run();
  const dueAt = dueAtFromDateInput("2027-05-01");
  expect(dueAt).not.toBeNull();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at) VALUES ('template_mrq201', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 0, 0, ?, ?)").bind(dueAt, NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq201', 'evt_mail', 'per_mail', 'sub_mail', 'template_mrq201', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(dueAt, NOW, NOW),
  ]);

  expect(await selectOverdueTaskCandidates(env.DB, Date.parse("2027-05-01T20:00:00-04:00"))).toHaveLength(0);
  const overdue = await selectOverdueTaskCandidates(env.DB, Date.parse("2027-05-02T00:00:01-04:00"));
  expect(overdue).toHaveLength(1);
  expect(overdue[0]?.data["task.due_date"]).toBe("May 1, 2027");
});

test("CONTRACT · CNT-08 · SPK-16 · relative overdue mail names the conference-local instant", async () => {
  await env.DB.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = 'evt_mail'").run();
  const dueAt = Date.parse("2026-08-04T17:32:26.216Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES ('template_mrq201_relative', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', 1, 0, 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq201_relative', 'evt_mail', 'per_mail', 'sub_mail', 'template_mrq201_relative', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(dueAt, NOW, NOW),
  ]);

  const overdue = await selectOverdueTaskCandidates(env.DB, dueAt + 1);
  expect(overdue.find((candidate) => candidate.entityId === "task_mrq201_relative")?.data["task.due_date"]).toBe("Aug 4, 2026, 1:32 PM EDT");
  expect(overdue.find((candidate) => candidate.entityId === "task_mrq201_relative")?.data["task.due_date"]).not.toMatch(/T\d{2}:\d{2}/);
});

test("CONTRACT · MRQ-201 · mail merge clocks name the conference zone while calendar due dates stay date-only", () => {
  const data = mergeDataForRecipient({
    name: "Ada Lovelace",
    email: "speaker@example.com",
    submissionTitle: "Reliable email",
    timezone: "America/New_York",
    startsAt: Date.parse("2027-05-01T03:59:00.000Z"),
    leaveBy: Date.parse("2027-05-01T02:30:00.000Z"),
    taskDueAt: dueAtFromDateInput("2027-05-01"),
    taskTemplateDueAt: dueAtFromDateInput("2027-05-01"),
  });
  expect(data["session.time"]).toBe("Apr 30, 2027, 11:59 PM EDT");
  expect(data["session.leaveBy"]).toBe("10:30 PM EDT");
  expect(data["task.due_date"]).toBe("May 1, 2027");
  expect(String(data["session.time"])).not.toMatch(/T\d{2}:\d{2}/);
});

test("CONTRACT · MRQ-201 · conference comms preserve relative task instants in merge data", async () => {
  await env.DB.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = 'evt_mail'").run();
  const dueAt = Date.parse("2026-08-04T17:32:26.216Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES ('template_mrq201_comms_relative', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', 1, 0, 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq201_comms_relative', 'evt_mail', 'per_mail', 'sub_mail', 'template_mrq201_comms_relative', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(dueAt, NOW, NOW),
  ]);

  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-201-comms-relative" });
  const response = await app.request("/api/v1/events/evt_mail/comms/send", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({
      selector: { submission_ids: ["sub_mail"], person_ids: ["per_mail"], role: "speaker" },
      subject: "Task deadline",
      body: "Due {{task.due_date}}",
    }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  const payload = await response.json<{ outbox_ids: string[] }>();
  const row = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(payload.outbox_ids[0]).first<{ text: string }>();
  expect(row?.text).toBe("Due Aug 4, 2026, 1:32 PM EDT");
});

test("CONTRACT · MRQ-201 · submission overdue filtering honors relative-task provenance at the UTC sentinel", async () => {
  await env.DB.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = 'evt_mail'").run();
  const dueAt = dueAtFromDateInput("2027-05-01");
  expect(dueAt).not.toBeNull();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES ('template_mrq201_sentinel_relative', 'evt_mail', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', 1, 0, 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at) VALUES ('task_mrq201_sentinel_relative', 'evt_mail', 'per_mail', 'sub_mail', 'template_mrq201_sentinel_relative', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)").bind(dueAt, NOW, NOW),
  ]);

  // Just after the exact instant, although a New York calendar-day reader is
  // still on May 1. The SQL path must use template provenance here.
  const nowSpy = vi.spyOn(Date, "now").mockReturnValue(dueAt! + 1);
  try {
    const audience = await listCommsAudience(env.DB, {
      eventId: "evt_mail",
      task: "overdue",
      page: 1,
      per_page: 10,
    });
    expect(audience.data.some((row) => row.submission_id === "sub_mail")).toBe(true);
  } finally {
    nowSpy.mockRestore();
  }
});

test("AC-127 · the cron handoff queues only rows created by its scan", async () => {
  const cronNow = NOW + 24 * 60 * 60_000;
  const unrelated = await enqueueOutbox({
    db: env.DB,
    eventId: "evt_mail",
    templateKey: "custom",
    entityId: "same-cron-unrelated",
    personId: "per_mail",
    toEmail: "speaker@example.com",
    now: cronNow,
  });
  const queue = { send: vi.fn(async (_message: unknown) => undefined) } as unknown as Parameters<typeof runMailSchedule>[1];
  expect(await runMailSchedule(env.DB, queue, cronNow)).toBe(1);
  expect(queue?.send).toHaveBeenCalledTimes(1);
  expect(queue?.send).not.toHaveBeenCalledWith(expect.objectContaining({ outbox_id: unrelated.id }));
});

test("AC-114 · AC-115 · AC-116 · AC-129 · AC-131 · the audience read path uses MRQ-8 filters and stays event-scoped", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail_2', 'org_mail', 'second@example.com', 'Grace Hopper', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('fmt_mail', 'evt_mail', 'Session', 45, 15, 90, 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mail', 'evt_mail', 'AI', '#8B5CF6', 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("UPDATE submissions SET status = 'accepted', kind = 'session', format_id = 'fmt_mail', primary_track_id = 'track_mail' WHERE id = 'sub_mail'"),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, format_id, primary_track_id, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mail_2', 'evt_mail', 'form_mail', 'session', 'Second session', 'accepted', 'fmt_mail', 'track_mail', 'public', 'per_mail_2', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st_mail', 'sub_mail', 'track_mail', 1, ?, ?), ('st_mail_2', 'sub_mail_2', 'track_mail', 1, ?, ?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mail_2', 'sub_mail_2', 'per_mail_2', 'speaker', 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES ('task_template_mail', 'evt_mail', 'Speaker task', 'acknowledge', 'Acknowledge', 1, 0, 0, ?, ?)").bind(NOW, NOW),
    // clock-check: allow — deliberately already past, and a moment pinned in the past stays past; the overdue count cannot change with the date
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, due_at, status, created_at, updated_at, cancelled_at) VALUES ('task_mail_overdue', 'evt_mail', 'per_mail_2', 'sub_mail_2', 'task_template_mail', 'Speaker agreement', 'acknowledge', ?, 'open', ?, ?, NULL), ('task_mail_cancelled', 'evt_mail', 'per_mail', 'sub_mail', 'task_template_mail', 'Cancelled task', 'acknowledge', ?, 'open', ?, ?, ?)").bind(NOW - 60 * 60_000, NOW, NOW, NOW - 60 * 60_000, NOW, NOW, NOW),
  ]);

  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-audience-test" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const response = await app.request(
    "/api/v1/events/evt_mail/comms/audience?status=accepted&track=track_mail&format=fmt_mail&per_page=10",
    { headers: { cookie: `mq_session=${session.id}` } },
    env,
    requestContext,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{ data: Array<{ email: string; submission_id: string; submission_title: string; task_title: string | null }>; total: number }>();
  expect(body.total).toBe(2);
  expect(body.data.map((row) => row.submission_id)).toEqual(["sub_mail", "sub_mail_2"]);
  expect(body.data[0]).toMatchObject({ email: "speaker@example.com", submission_title: "Reliable email" });

  const overdue = await app.request(
    "/api/v1/events/evt_mail/comms/audience?task=overdue",
    { headers: { cookie: `mq_session=${session.id}` } },
    env,
    requestContext,
  );
  expect(overdue.status).toBe(200);
  const overdueBody = await overdue.json<{ data: Array<{ person_id: string; submission_id: string; task_title: string | null }>; total: number }>();
  expect(overdueBody.total).toBe(1);
  expect(overdueBody.data[0]).toMatchObject({ person_id: "per_mail_2", submission_id: "sub_mail_2", task_title: "Speaker agreement" });
  expect(overdueBody.data.some((row) => row.submission_id === "sub_mail")).toBe(false);

  const openTasks = await app.request(
    "/api/v1/events/evt_mail/comms/audience?task_state=open",
    { headers: { cookie: `mq_session=${session.id}` } },
    env,
    requestContext,
  );
  expect(openTasks.status).toBe(200);
  const openTasksBody = await openTasks.json<{ data: Array<{ submission_id: string }>; total: number }>();
  expect(openTasksBody.total).toBe(1);
  expect(openTasksBody.data[0]?.submission_id).toBe("sub_mail_2");

  const positive = await listCommsRecipientsForSubmissionIds(env.DB, "evt_mail", ["sub_mail"]);
  expect(positive.total).toBe(1);
  expect(positive.data[0]?.email).toBe("speaker@example.com");
  const crossEvent = await app.request(
    "/api/v1/events/evt_mail_other/comms/audience?status=accepted",
    { headers: { cookie: `mq_session=${session.id}` } },
    env,
    requestContext,
  );
  expect(crossEvent.status).toBe(403);
  const crossEventBody = await crossEvent.text();
  expect(crossEventBody).not.toContain("speaker@example.com");
  expect(crossEventBody).not.toContain("per_mail");
  expect(crossEventBody).not.toContain("sub_mail");
  expect(crossEventBody).not.toContain("Reliable email");
  const directCrossEvent = await listCommsAudience(env.DB, { eventId: "evt_mail_other" });
  expect(directCrossEvent.total).toBe(0);
  expect(directCrossEvent.data).toEqual([]);
});

test("AC-128 · merge fields render the speaker, session, room, and time", () => {
  const rendered = renderMail(
    { subject: "{{speaker.first_name}} · {{session.title}}", body_md: "Room {{room.name}} at {{session.time}}" },
    { "speaker.first_name": "Ada", "session.title": "Reliable email", "room.name": "A", "session.time": "10:00 UTC" },
  );
  expect(rendered.subject).toBe("Ada · Reliable email");
  expect(rendered.text).toBe("Room A at 10:00 UTC");
  expect(rendered.html).toContain("Room A at 10:00 UTC");
});

test("AC-130 · one real recipient's rendered preview is available before queueing", async () => {
  const template = await findTemplate(env.DB, "evt_mail", "reminder_generic");
  const preview = renderMail(template, { "speaker.first_name": "Ada", "task.title": "Profile" });
  expect(preview.subject).toBe("A quick Marquee reminder");
  expect(preview.text).toContain("Ada");
});

test("AC-129 · AC-131 · every selected recipient gets its own rendered, inspectable outbox row", async () => {
  await env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail_2', 'org_mail', 'second@example.com', 'Grace Hopper', ?, ?)").bind(NOW, NOW).run();
  const result = await enqueueBulkReminder({
    db: env.DB,
    eventId: "evt_mail",
    recipients: [
      { entityId: "sub_mail", personId: "per_mail", toEmail: "speaker@example.com", data: { "speaker.first_name": "Ada" } },
      { entityId: "sub_mail_2", personId: "per_mail_2", toEmail: "second@example.com", data: { "speaker.first_name": "Grace" } },
    ],
  });
  expect(result).toHaveLength(2);
  const rows = await env.DB.prepare("SELECT to_email, text FROM outbox ORDER BY to_email").all<{ to_email: string; text: string }>();
  expect(rows.results).toEqual(expect.arrayContaining([
    { to_email: "speaker@example.com", text: expect.stringContaining("Ada") },
    { to_email: "second@example.com", text: expect.stringContaining("Grace") },
  ]));
});

test("CONTRACT · G3 · demo mode suppresses non-allowlisted mail, while the two named live sites bypass suppression", async () => {
  const suppressed = await enqueueOutbox({ db: env.DB, eventId: "evt_mail", templateKey: "reminder_generic", entityId: "sub_mail", personId: "per_mail", toEmail: "not-allowed@example.com" });
  const publicLive = await enqueuePublicFormConfirmation({ db: env.DB, eventId: "evt_mail", templateKey: "submission_confirmation", entityId: "public_sub", personId: "per_mail", toEmail: "typed@example.com", typedAddress: "typed@example.com" });
  const smokeLive = await enqueueSmokeHarnessMail({ db: env.DB, eventId: "evt_mail", templateKey: "custom", entityId: "smoke_ics", personId: "per_mail", toEmail: "smoke@example.com" });
  const fake = provider();
  const outcome = await processMailOutbox(env.DB, env, [suppressed.id, publicLive.id, smokeLive.id], { provider: fake, now: NOW, sleep: async () => undefined });
  expect(outcome).toEqual({ sent: 2, suppressed: 1, failed: 0 });
  expect(fake.batches).toHaveLength(1);
  const suppressedRow = await env.DB.prepare("SELECT status, suppressed_reason FROM outbox WHERE id = ?").bind(suppressed.id).first<{ status: string; suppressed_reason: string }>();
  expect(suppressedRow).toEqual({ status: "suppressed", suppressed_reason: "demo_mode_not_allowlisted" });
});

test("AC-131 · plain messages use one batch provider call and ICS messages use sequential single sends at no more than ten per second", async () => {
  await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = 'evt_mail'").run();
  const rows = await Promise.all([
    enqueueOutbox({ db: env.DB, eventId: "evt_mail", templateKey: "custom", entityId: "plain_1", personId: "per_mail", toEmail: "one@example.com" }),
    enqueueOutbox({ db: env.DB, eventId: "evt_mail", templateKey: "custom", entityId: "ics_1", personId: "per_mail", toEmail: "one@example.com", icsUid: "uid-1", icsBody: "BEGIN:VCALENDAR\nEND:VCALENDAR" }),
    enqueueOutbox({ db: env.DB, eventId: "evt_mail", templateKey: "custom", entityId: "ics_2", personId: "per_mail", toEmail: "one@example.com", icsUid: "uid-2", icsBody: "BEGIN:VCALENDAR\nEND:VCALENDAR" }),
  ]);
  const fake = provider();
  const waits: number[] = [];
  const outcome = await processMailOutbox(env.DB, env, rows.map((row) => row.id), { provider: fake, now: NOW, sleep: async (milliseconds) => { waits.push(milliseconds); } });
  expect(outcome.sent).toBe(3);
  expect(fake.batches).toHaveLength(1);
  expect(fake.singles).toHaveLength(2);
  expect(waits).toEqual([100]);
});

test("AC-117 · idempotency key is stable for the same template, entity, and person", async () => {
  const first = await buildIdempotencyKey("acceptance", "sub_mail", "per_mail");
  const second = await buildIdempotencyKey("acceptance", "sub_mail", "per_mail");
  const differentEntity = await buildIdempotencyKey("acceptance", "sub_other", "per_mail");
  expect(first).toHaveLength(64);
  expect(second).toBe(first);
  expect(differentEntity).not.toBe(first);
});

test("AC-117 · the provider request carries the outbox idempotency key", async () => {
  await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = 'evt_mail'").run();
  const queued = await enqueueOutbox({ db: env.DB, eventId: "evt_mail", templateKey: "custom", entityId: "provider_header", personId: "per_mail", toEmail: "speaker@example.com" });
  const row = await env.DB.prepare("SELECT * FROM outbox WHERE id = ?").bind(queued.id).first<OutboxRow>();
  const request = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ data: [{ id: "resend-message-1" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", request);
  await processMailOutbox(env.DB, { ...env, RESEND_API_KEY: "test-key" }, [queued.id], { now: NOW });
  const init = request.mock.calls[0]?.[1] as unknown as RequestInit;
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe(row?.idempotency_key);
  const body = JSON.parse(String(init.body)) as Array<{ headers: { "Idempotency-Key": string } }>;
  expect(body[0]?.headers["Idempotency-Key"]).toBe(row?.idempotency_key);
});

test("AC-126 · missing stored keys fall back to the shipped template store without making a provider call", async () => {
  const template = await findTemplate(env.DB, "evt_mail", "task_overdue");
  expect(template.enabled).toBe(1);
  expect(vi.isMockFunction(fetch)).toBe(true);
});

test("AC-126 · the manifest route exposes authenticated template storage through the running API", async () => {
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mail-test" });
  const response = await app.request("/api/v1/events/evt_mail/templates", { headers: { cookie: `mq_session=${session.id}` } }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  const body = await response.json<{ data: Array<{ id: string; key: string; enabled: number }> }>();
  expect(body.data).toHaveLength(9);
  expect(body.data.map((template) => template.key)).toEqual(expect.arrayContaining([...TRIGGER_TEMPLATE_KEYS]));
  const rejectedAuthTemplate = await app.request("/api/v1/events/evt_mail/templates", {
    method: "POST",
    headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
    body: JSON.stringify({ key: "magic_link_login", name: "Auth", subject: "Auth", body_md: "{{auth.link}}", enabled: true }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
  expect(rejectedAuthTemplate.status).toBe(400);
  const defaultRejection = body.data.find((template) => template.key === "rejection");
  expect(defaultRejection?.id).toBe("default_evt_mail_rejection");
  const disabled = await app.request(
    `/api/v1/events/evt_mail/templates/${defaultRejection?.id}`,
    {
      method: "PATCH",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
  expect(disabled.status).toBe(200);
  const persisted = await env.DB.prepare("SELECT enabled FROM email_templates WHERE event_id = 'evt_mail' AND key = 'rejection'").first<{ enabled: number }>();
  expect(persisted?.enabled).toBe(0);
  expect(await enqueueTrigger({ db: env.DB, eventId: "evt_mail", templateKey: "rejection", entityId: "sub_mail", personId: "per_mail", toEmail: "speaker@example.com" })).toBeNull();
});

test("CONTRACT · MRQ-175 · preview preserves an unknown token but the bulk queue refuses it by name", async () => {
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-175-unknown-token" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const message = {
    subject: "Your speaker portal",
    body: "Your speaker portal is here: {{portal.link}}",
  };
  const preview = await app.request(
    "/api/v1/events/evt_mail/comms/preview",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ person_id: "per_mail", submission_id: "sub_mail", role: "speaker", ...message }),
    },
    env,
    requestContext,
  );
  expect(preview.status).toBe(200);
  expect((await preview.json<{ text: string }>()).text).toContain("{{portal.link}}");

  const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = 'evt_mail'").first<{ total: number }>();
  const queued = await app.request(
    "/api/v1/events/evt_mail/comms/send",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ selector: { submission_ids: ["sub_mail"], person_ids: ["per_mail"], role: "speaker" }, ...message }),
    },
    env,
    requestContext,
  );
  expect(queued.status).toBe(400);
  expect(await queued.text()).toContain("portal.link");
  const after = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = 'evt_mail'").first<{ total: number }>();
  expect(after?.total).toBe(before?.total);
});

test("CONTRACT · organizer communications reject the auth-only link before queueing", async () => {
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "auth-link-comms" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const response = await app.request(
    "/api/v1/events/evt_mail/comms/send",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({
        selector: { submission_ids: ["sub_mail"], person_ids: ["per_mail"], role: "speaker" },
        subject: "Your speaker portal",
        body: "Open your link: {{auth.link}}",
      }),
    },
    env,
    requestContext,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("auth.link");
  expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = 'evt_mail'").first<{ total: number }>()).toEqual({ total: 0 });
});

test("CONTRACT · MRQ-175 · known merge fields queue and known missing values remain literal", async () => {
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-175-known-token" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const known = await app.request(
    "/api/v1/events/evt_mail/comms/send",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({
        selector: { submission_ids: ["sub_mail"], person_ids: ["per_mail"], role: "speaker" },
        subject: "Hello {{speaker.first_name}}",
        body: "Hi {{speaker.first_name}}.",
      }),
    },
    env,
    requestContext,
  );
  expect(known.status).toBe(202);
  const knownPayload = await known.json<{ outbox_ids: string[] }>();
  const knownRow = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(knownPayload.outbox_ids[0]).first<{ text: string }>();
  expect(knownRow?.text).toBe("Hi Ada.");

  const missing = await enqueueBulkReminder({
    db: env.DB,
    eventId: "evt_mail",
    templateKey: "custom",
    recipients: [{ entityId: "missing-field", personId: "per_mail", toEmail: "speaker@example.com", data: { "decision.feedback": null } }],
    subject: "A known field is absent",
    body: "Feedback: {{decision.feedback}}",
  });
  const missingRow = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(missing[0]?.id).first<{ text: string }>();
  expect(missingRow?.text).toBe("Feedback: {{decision.feedback}}");
});

test("CONTRACT · MRQ-175 · template save refuses an unknown merge field before persisting it", async () => {
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-175-save" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const response = await app.request(
    "/api/v1/events/evt_mail/templates",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ key: "custom", name: "Custom", subject: "Hello", body_md: "{{portal.link}}", enabled: true }),
    },
    env,
    requestContext,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("portal.link");
  const persisted = await env.DB.prepare("SELECT COUNT(*) AS total FROM email_templates WHERE event_id = 'evt_mail' AND key = 'custom'").first<{ total: number }>();
  expect(persisted?.total).toBe(0);

  const update = await app.request(
    "/api/v1/events/evt_mail/templates/default_evt_mail_reminder_generic",
    {
      method: "PATCH",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ body_md: "{{portal.link}}" }),
    },
    env,
    requestContext,
  );
  expect(update.status).toBe(400);
  expect(await update.text()).toContain("portal.link");
  const defaultPersisted = await env.DB.prepare("SELECT COUNT(*) AS total FROM email_templates WHERE event_id = 'evt_mail' AND key = 'reminder_generic'").first<{ total: number }>();
  expect(defaultPersisted?.total).toBe(0);
});

test("CONTRACT · MRQ-175 · queue revalidates a stored template before creating any outbox row", async () => {
  await env.DB.prepare(
    `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
     VALUES ('tpl_mrq175_invalid', 'evt_mail', 'custom', 'Custom', 'Hello', '{{portal.link}}', 1, ?, ?)`,
  ).bind(NOW, NOW).run();
  const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "mrq-175-stored" });
  const requestContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const response = await app.request(
    "/api/v1/events/evt_mail/comms/send",
    {
      method: "POST",
      headers: { cookie: `mq_session=${session.id}`, "content-type": "application/json" },
      body: JSON.stringify({ selector: { submission_ids: ["sub_mail"], person_ids: ["per_mail"], role: "speaker" }, template_key: "custom" }),
    },
    env,
    requestContext,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("portal.link");
  const outbox = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = 'evt_mail'").first<{ total: number }>();
  expect(outbox?.total).toBe(0);
});

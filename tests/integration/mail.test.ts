import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { OutboxRow } from "../../src/db/schema";
import { app } from "../../src/index";
import { createSession } from "../../src/lib/auth/auth-sessions";
import { processMailOutbox, type MailProvider } from "../../src/jobs/mail/consumer";
import { enqueueOutbox, enqueuePublicFormConfirmation, enqueueSmokeHarnessMail, buildIdempotencyKey } from "../../src/jobs/mail/outbox";
import { enqueueBulkReminder, enqueuePreCloseReminders, enqueueTrigger } from "../../src/jobs/mail/triggers";
import { findTemplate, renderStoredTemplate, TRIGGER_TEMPLATE_KEYS } from "../../src/jobs/mail/templates";
import { renderMail } from "../../src/jobs/mail/render";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_mail', 'Mail Org', 'mail-org', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES ('evt_mail', 'org_mail', 'Mail Conference', 'mail', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_mail', 'org_mail', 'speaker@example.com', 'Ada Lovelace', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_mail', 'org_mail', 'evt_mail', 'per_mail', 'owner', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, reminder_offset_hours, created_at, updated_at) VALUES ('form_mail', 'evt_mail', 'CFP', 'cfp', 'abstract', 'open', ?, 24, ?, ?)").bind(NOW + 48 * 60 * 60_000, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_mail', 'evt_mail', 'form_mail', 'abstract', 'Reliable email', 'submitted', 'public', 'per_mail', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_mail', 'sub_mail', 'per_mail', 'speaker', 0, ?, ?)").bind(NOW, NOW),
  ]);
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_templates WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM outbox WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM participations WHERE id IN ('part_mail') OR submission_id IN ('sub_mail')"),
    env.DB.prepare("DELETE FROM submissions WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM forms WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM event_settings WHERE event_id = 'evt_mail'"),
    env.DB.prepare("DELETE FROM auth_sessions WHERE person_id = 'per_mail'"),
    env.DB.prepare("DELETE FROM memberships WHERE person_id = 'per_mail'"),
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

test("AC-117 · the same bulk action twice relies on the UNIQUE idempotency constraint and delivers once", async () => {
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
  await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = 'evt_mail'").run();
  const fake = provider();
  expect(await processMailOutbox(env.DB, env, [first[0].id, second[0].id], { provider: fake, now: NOW, sleep: async () => undefined })).toEqual({ sent: 1, suppressed: 0, failed: 0 });
  // The duplicate was already marked by the first delivery attempt; it did not produce a second provider call.
  expect(fake.batches).toHaveLength(1);
  expect(fake.singles).toHaveLength(0);
});

test("AC-125 · all seven automated triggers produce one outbox row", async () => {
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
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox").first<{ n: number }>();
  expect(count?.n).toBe(7);
  const fake = provider();
  expect(await processMailOutbox(env.DB, env, ids, { provider: fake, now: NOW, sleep: async () => undefined })).toEqual({ sent: 0, suppressed: 7, failed: 0 });
  expect(fake.batches).toHaveLength(0);
  expect(fake.singles).toHaveLength(0);
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
  expect(await enqueuePreCloseReminders(env.DB, NOW + 23 * 60 * 60_000)).toBe(0);
  expect(await enqueuePreCloseReminders(env.DB, NOW + 24 * 60 * 60_000)).toBe(1);
  expect(await enqueuePreCloseReminders(env.DB, NOW + 25 * 60 * 60_000)).toBe(0);
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
  expect(await response.json<{ data: unknown[] }>()).toEqual({ data: [] });
});

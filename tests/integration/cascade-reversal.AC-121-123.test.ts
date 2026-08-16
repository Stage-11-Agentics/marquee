import { SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import {
  reconcileTaskSet,
  writeAcceptanceReversal,
  writeSubmissionDecision,
} from "../../src/jobs/cascade/decisions";
import { buildIdempotencyKey } from "../../src/jobs/mail/outbox";
import { enqueueOverdueTaskReminders } from "../../src/jobs/mail/triggers";
import { purgePublicEmbedCache } from "../../src/lib/public-site";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.parse("2026-08-20T16:00:00.000Z");
const ACTOR_REQUEST_ID = "req-reversal-fixture";
const ACTOR = {
  kind: "user" as const,
  personId: "person-reversal-actor",
  requestId: ACTOR_REQUEST_ID,
};

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const acceptanceCancelKey = await buildIdempotencyKey("acceptance", "sub-cancel", "person-reversal-speaker");
  const acceptanceRetainKey = await buildIdempotencyKey("acceptance", "sub-retain", "person-reversal-speaker");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-reversal', 'Reversal Org', 'reversal-org', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES ('evt-reversal', 'org-reversal', 'Reversal Conference', 'reversal', '2026-10-01', '2026-10-02', 'America/New_York', 'live', 1, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES ('person-reversal-actor', 'org-reversal', 'program@example.com', 'Program Lead', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES ('person-reversal-speaker', 'org-reversal', 'speaker@example.com', 'Ada Speaker', ?, ?)`,
    ).bind(NOW, NOW),
    // clock-check: allow — every deadline in this suite is read back through enqueueOverdueTaskReminders(env.DB, NOW + 2_500), an injected clock that cannot drift
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at)
       VALUES ('template-reversal', 'evt-reversal', 'Speaker agreement', 'acknowledge', 'Confirm the agreement.', ?, 0, 1, ?, ?)`,
    ).bind(NOW + 7 * 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO email_templates
        (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
       VALUES
        ('email-acceptance', 'evt-reversal', 'acceptance', 'Acceptance', 'Accepted: {{submission.title}}', 'Accepted.', 1, ?, ?),
        ('email-rejection', 'evt-reversal', 'rejection', 'Rejection', 'Rejected: {{submission.title}}', 'Rejected.', 1, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at)
       VALUES ('building-reversal', 'evt-reversal', 'Building A', '1 Main Street', 0, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at)
       VALUES ('room-reversal', 'evt-reversal', 'building-reversal', 'Room 1', 100, 0, ?, ?)`,
    ).bind(NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, decided_at, decided_by_person_id, is_published, created_at, updated_at)
       VALUES
        ('sub-cancel', 'evt-reversal', 'session', 'Cancel this acceptance', 'accepted', 'public', 'person-reversal-speaker', ?, 'person-reversal-actor', 1, ?, ?),
        ('sub-retain', 'evt-reversal', 'session', 'Retain this acceptance', 'accepted', 'public', 'person-reversal-speaker', ?, 'person-reversal-actor', 1, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('participation-cancel', 'sub-cancel', 'person-reversal-speaker', 'speaker', 0, ?, ?),
        ('participation-retain', 'sub-retain', 'person-reversal-speaker', 'speaker', 0, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW),
    // clock-check: allow — these due dates are only ever compared against the NOW this suite hands the reminder trigger, never against the wall clock
    env.DB.prepare(
      `INSERT INTO speaker_tasks
        (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status,
         completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at)
       VALUES
        ('task-cancel-open', 'evt-reversal', 'person-reversal-speaker', 'sub-cancel', 'template-reversal', 'Open cancel task', 'acknowledge', 'Open', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?),
        ('task-cancel-done', 'evt-reversal', 'person-reversal-speaker', 'sub-cancel', 'template-reversal', 'Done cancel task', 'acknowledge', 'Done', ?, 'done', ?, NULL, NULL, 'marquee', NULL, ?, ?),
        ('task-retain-open', 'evt-reversal', 'person-reversal-speaker', 'sub-retain', 'template-reversal', 'Open retain task', 'acknowledge', 'Open', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)`,
    ).bind(NOW + 7 * 86_400_000, NOW, NOW, NOW + 7 * 86_400_000, NOW, NOW, NOW, NOW + 7 * 86_400_000, NOW, NOW),
    // clock-check: allow — the only reads of this agenda row are negative (a 404 and a not.toContain), which time can strengthen but not break
    env.DB.prepare(
      `INSERT INTO agenda_items
        (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at)
       VALUES
        ('agenda-cancel', 'evt-reversal', 'sub-cancel', 'session', ?, 30, 'room-reversal', 1, ?, ?),
        ('agenda-retain', 'evt-reversal', 'sub-retain', 'session', ?, 30, 'room-reversal', 1, ?, ?)`,
    ).bind(NOW + 86_400_000, NOW, NOW, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO outbox
        (id, event_id, template_key, entity_id, person_id, to_email, subject, html, text, ics_uid, ics_body,
         status, send_policy, suppressed_reason, idempotency_key, scheduled_for, created_at, updated_at)
       VALUES
        ('mail-cancel', 'evt-reversal', 'acceptance', 'sub-cancel', 'person-reversal-speaker', 'speaker@example.com', 'Accepted', '<p>Accepted</p>', 'Accepted', NULL, NULL, 'queued', 'demo_safe', NULL, 'key-mail-cancel', ?, ?, ?),
        ('ics-cancel', 'evt-reversal', 'calendar_request', 'sub-cancel:person-reversal-speaker:1:REQUEST', 'person-reversal-speaker', 'speaker@example.com', 'Invite', '<p>Invite</p>', 'Invite', 'uid-cancel', 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nUID:uid-cancel\r\nSEQUENCE:1\r\nEND:VCALENDAR\r\n', 'queued', 'demo_safe', NULL, 'key-ics-cancel', NULL, ?, ?),
        ('mail-retain', 'evt-reversal', 'acceptance', 'sub-retain', 'person-reversal-speaker', 'speaker@example.com', 'Accepted', '<p>Accepted</p>', 'Accepted', NULL, NULL, 'queued', 'demo_safe', NULL, 'key-mail-retain', ?, ?, ?),
        ('ics-retain', 'evt-reversal', 'calendar_request', 'sub-retain:person-reversal-speaker:1:REQUEST', 'person-reversal-speaker', 'speaker@example.com', 'Invite', '<p>Invite</p>', 'Invite', 'uid-retain', 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nUID:uid-retain\r\nSEQUENCE:1\r\nEND:VCALENDAR\r\n', 'queued', 'demo_safe', NULL, 'key-ics-retain', NULL, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO calendar_invites
        (id, submission_id, person_id, uid, sequence, last_method, last_sent_at, status, created_at, updated_at)
       VALUES
        ('invite-cancel', 'sub-cancel', 'person-reversal-speaker', 'uid-cancel', 1, 'REQUEST', ?, 'active', ?, ?),
        ('invite-retain', 'sub-retain', 'person-reversal-speaker', 'uid-retain', 1, 'REQUEST', ?, 'active', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE outbox SET idempotency_key = ? WHERE id = 'mail-cancel'").bind(acceptanceCancelKey),
    env.DB.prepare("UPDATE outbox SET idempotency_key = ? WHERE id = 'mail-retain'").bind(acceptanceRetainKey),
  ]);
}

beforeAll(seedFixture);

test("AC-121, AC-122, AC-123, AC-317 · cancel choices mutate task, email, calendar, and publication rows", async () => {
  const taskCountBefore = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE submission_id = 'sub-cancel'").first<{ count: number }>();
  const result = await writeAcceptanceReversal({
    cache: env.CACHE,
    db: env.DB,
    eventId: "evt-reversal",
    submissionId: "sub-cancel",
    actor: ACTOR,
    queue: env.MAIL_QUEUE,
    tasks: "cancel",
    emails: "cancel",
    calendar: "cancel",
    outcome: "rejected",
    origin: "https://marquee.stage11.dev",
    now: NOW + 2_000,
  });
  expect(result).toMatchObject({
    outcome: "succeeded",
    resultingStatus: "rejected",
    tasksCancelled: 1,
    emailsCancelled: 1,
    calendarCancelled: 1,
  });

  const submission = await env.DB.prepare("SELECT status, decided_at, decided_by_person_id, is_published FROM submissions WHERE id = 'sub-cancel'").first<{ status: string; decided_at: number; decided_by_person_id: string; is_published: number }>();
  expect(submission).toEqual({ status: "rejected", decided_at: NOW + 2_000, decided_by_person_id: ACTOR.personId, is_published: 0 });
  const tasks = await env.DB.prepare("SELECT id, status, cancelled_at, due_at FROM speaker_tasks WHERE submission_id = 'sub-cancel' ORDER BY id").all<{ id: string; status: string; cancelled_at: number | null; due_at: number }>();
  expect(tasks.results).toEqual([
    { id: "task-cancel-done", status: "done", cancelled_at: null, due_at: NOW + 7 * 86_400_000 },
    { id: "task-cancel-open", status: "open", cancelled_at: NOW + 2_000, due_at: NOW + 7 * 86_400_000 },
  ]);
  const taskCountAfter = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE submission_id = 'sub-cancel'").first<{ count: number }>();
  expect(taskCountAfter?.count).toBe(taskCountBefore?.count);
  const taskAudit = await env.DB.prepare(
    `SELECT actor_person_id, actor_kind, created_at, after_json
     FROM audit_log
     WHERE event_id = 'evt-reversal' AND entity_id = 'sub-cancel' AND action = 'submission.tasks_cancelled'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).first<{ actor_person_id: string; actor_kind: string; created_at: number; after_json: string }>();
  expect(taskAudit).toMatchObject({ actor_person_id: ACTOR.personId, actor_kind: ACTOR.kind, created_at: NOW + 2_000 });
  expect(JSON.parse(taskAudit?.after_json ?? "{}")).toMatchObject({
    choice: "cancel",
    reason: "This talk was rejected by the conference.",
    rows: 1,
  });
  const email = await env.DB.prepare("SELECT status, suppressed_reason FROM outbox WHERE id = 'mail-cancel'").first<{ status: string; suppressed_reason: string | null }>();
  expect(email).toEqual({ status: "suppressed", suppressed_reason: "acceptance_reversed" });
  const agenda = await env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = 'sub-cancel'").first();
  expect(agenda).toBeNull();
  const publicSession = await SELF.fetch("https://marquee.stage11.dev/s/sub-cancel?event=reversal");
  expect(publicSession.status).toBe(404);
  const publicEmbed = await SELF.fetch("https://marquee.stage11.dev/api/v1/public/embeds/reversal-agenda?event=reversal");
  expect(publicEmbed.status).toBe(200);
  expect(await publicEmbed.text()).not.toContain("sub-cancel");
  const invite = await env.DB.prepare("SELECT uid, sequence, last_method, status FROM calendar_invites WHERE id = 'invite-cancel'").first<{ uid: string; sequence: number; last_method: string; status: string }>();
  expect(invite).toEqual({ uid: "uid-cancel", sequence: 2, last_method: "CANCEL", status: "cancelled" });
  const cancelIcs = await env.DB.prepare("SELECT ics_body FROM outbox WHERE ics_uid = 'uid-cancel' ORDER BY created_at DESC LIMIT 1").first<{ ics_body: string }>();
  expect(cancelIcs?.ics_body).toContain("METHOD:CANCEL\r\n");
  expect(cancelIcs?.ics_body).toContain("UID:uid-cancel\r\n");
  expect(cancelIcs?.ics_body).toContain("SEQUENCE:2\r\n");

  // clock-check: allow — this due date exists to be overdue relative to the NOW passed on the next line, not relative to today
  await env.DB.prepare(
    "UPDATE speaker_tasks SET due_at = ? WHERE id = 'task-retain-open'",
  ).bind(NOW - 1_000).run();
  expect(await enqueueOverdueTaskReminders(env.DB, NOW + 2_500)).toBe(1);
  const overdueRows = await env.DB.prepare(
    `SELECT entity_id, template_key
     FROM outbox
     WHERE event_id = 'evt-reversal' AND template_key = 'task_overdue'
     ORDER BY entity_id`,
  ).all<{ entity_id: string; template_key: string }>();
  expect(overdueRows.results).toEqual([{ entity_id: "task-retain-open", template_key: "task_overdue" }]);
  const outboxBeforeReaccept = await env.DB.prepare(
    "SELECT id, idempotency_key, status, updated_at FROM outbox WHERE event_id = 'evt-reversal' ORDER BY id",
  ).all<Record<string, string | number | null>>();

  const reaccepted = await writeSubmissionDecision({
    db: env.DB,
    eventId: "evt-reversal",
    submissionId: "sub-cancel",
    actor: ACTOR,
    queue: env.MAIL_QUEUE,
    recommendation: "approve",
    now: NOW + 3_000,
  });
  expect(reaccepted).toMatchObject({ outcome: "succeeded", resultingStatus: "accepted", tasksAssigned: 1 });
  const outboxAfterReaccept = await env.DB.prepare(
    "SELECT id, idempotency_key, status, updated_at FROM outbox WHERE event_id = 'evt-reversal' ORDER BY id",
  ).all<Record<string, string | number | null>>();
  expect(outboxAfterReaccept.results).toEqual(outboxBeforeReaccept.results);
  const restoredTask = await env.DB.prepare("SELECT status, cancelled_at, due_at FROM speaker_tasks WHERE id = 'task-cancel-open'").first<{ status: string; cancelled_at: number | null; due_at: number }>();
  expect(restoredTask).toEqual({ status: "open", cancelled_at: null, due_at: NOW + 7 * 86_400_000 });
  const restorationAudit = await env.DB.prepare(
    `SELECT actor_person_id, actor_kind, created_at, after_json
     FROM audit_log
     WHERE event_id = 'evt-reversal' AND entity_id = 'sub-cancel' AND action = 'submission.tasks_reconciled'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).first<{ actor_person_id: string; actor_kind: string; created_at: number; after_json: string }>();
  expect(restorationAudit).toMatchObject({ actor_person_id: ACTOR.personId, actor_kind: ACTOR.kind, created_at: NOW + 3_000 });
  expect(JSON.parse(restorationAudit?.after_json ?? "{}")).toMatchObject({ created: 0, restored: 1, rows: 1 });

  // clock-check: allow — reconciliation is driven by the explicit NOW + 5_000 in these bindings, not by Date.now()
  await env.DB.prepare(
    `INSERT INTO task_templates
      (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at)
     VALUES ('template-reconcile', 'evt-reversal', 'New acceptance task', 'acknowledge', 'A newly assigned task.', ?, 1, 1, ?, ?)`,
  ).bind(NOW + 8 * 86_400_000, NOW + 5_000, NOW + 5_000).run();
  const outboxBeforeReconcile = await env.DB.prepare(
    `SELECT id, template_key, entity_id, person_id, status, idempotency_key, updated_at
     FROM outbox WHERE event_id = 'evt-reversal' ORDER BY id`,
  ).all<Record<string, string | number | null>>();
  const firstReconcile = await reconcileTaskSet(env.DB, "evt-reversal", ["sub-cancel"], NOW + 5_000, ACTOR);
  expect([...firstReconcile.entries()]).toEqual([["sub-cancel", 1]]);
  const tasksAfterFirstReconcile = await env.DB.prepare(
    `SELECT id, status, cancelled_at, due_at, updated_at
     FROM speaker_tasks WHERE submission_id = 'sub-cancel' ORDER BY id`,
  ).all<Record<string, string | number | null>>();
  const outboxAfterFirstReconcile = await env.DB.prepare(
    `SELECT id, template_key, entity_id, person_id, status, idempotency_key, updated_at
     FROM outbox WHERE event_id = 'evt-reversal' ORDER BY id`,
  ).all<Record<string, string | number | null>>();
  expect(outboxAfterFirstReconcile.results).toEqual(outboxBeforeReconcile.results);
  const secondReconcile = await reconcileTaskSet(env.DB, "evt-reversal", ["sub-cancel"], NOW + 6_000, ACTOR);
  expect([...secondReconcile.entries()]).toEqual([]);
  const tasksAfterSecondReconcile = await env.DB.prepare(
    `SELECT id, status, cancelled_at, due_at, updated_at
     FROM speaker_tasks WHERE submission_id = 'sub-cancel' ORDER BY id`,
  ).all<Record<string, string | number | null>>();
  const outboxAfterSecondReconcile = await env.DB.prepare(
    `SELECT id, template_key, entity_id, person_id, status, idempotency_key, updated_at
     FROM outbox WHERE event_id = 'evt-reversal' ORDER BY id`,
  ).all<Record<string, string | number | null>>();
  expect(tasksAfterSecondReconcile.results).toEqual(tasksAfterFirstReconcile.results);
  expect(outboxAfterSecondReconcile.results).toEqual(outboxAfterFirstReconcile.results);
  const reconciliationAudits = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM audit_log
     WHERE event_id = 'evt-reversal' AND entity_id = 'sub-cancel' AND action = 'submission.tasks_reconciled'`,
  ).first<{ count: number }>();
  expect(reconciliationAudits?.count).toBe(2);
});

test("AC-121, AC-122, AC-123, AC-317 · retain choices leave every selected row active while removing placement", async () => {
  await purgePublicEmbedCache(env.CACHE, { eventId: "evt-reversal" });
  const before = await SELF.fetch("https://marquee.stage11.dev/api/v1/public/embeds/reversal-agenda?event=reversal");
  expect(before.status).toBe(200);
  const beforeBody = await before.json<{ sessions: Array<{ title: string }> }>();
  expect(beforeBody.sessions.some((session) => session.title === "Retain this acceptance")).toBe(true);

  const result = await writeAcceptanceReversal({
    cache: env.CACHE,
    db: env.DB,
    eventId: "evt-reversal",
    submissionId: "sub-retain",
    actor: ACTOR,
    queue: env.MAIL_QUEUE,
    tasks: "retain",
    emails: "retain",
    calendar: "retain",
    outcome: "withdrawn",
    origin: "https://marquee.stage11.dev",
    now: NOW + 4_000,
  });
  expect(result).toMatchObject({ outcome: "succeeded", resultingStatus: "withdrawn", tasksCancelled: 0, emailsCancelled: 0, calendarCancelled: 0 });
  const submission = await env.DB.prepare("SELECT status, decided_at, decided_by_person_id, is_published FROM submissions WHERE id = 'sub-retain'").first<{ status: string; decided_at: number; decided_by_person_id: string; is_published: number }>();
  expect(submission).toEqual({ status: "withdrawn", decided_at: NOW + 4_000, decided_by_person_id: ACTOR.personId, is_published: 0 });
  const task = await env.DB.prepare("SELECT status, cancelled_at FROM speaker_tasks WHERE id = 'task-retain-open'").first<{ status: string; cancelled_at: number | null }>();
  expect(task).toEqual({ status: "open", cancelled_at: null });
  const retainAudit = await env.DB.prepare(
    `SELECT actor_person_id, actor_kind, created_at, after_json
     FROM audit_log
     WHERE event_id = 'evt-reversal' AND entity_id = 'sub-retain' AND action = 'submission.tasks_retained'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).first<{ actor_person_id: string; actor_kind: string; created_at: number; after_json: string }>();
  expect(retainAudit).toMatchObject({ actor_person_id: ACTOR.personId, actor_kind: ACTOR.kind, created_at: NOW + 4_000 });
  expect(JSON.parse(retainAudit?.after_json ?? "{}")).toMatchObject({
    choice: "retain",
    reason: "Open tasks were kept active after acceptance reversal.",
    rows: 0,
  });
  const email = await env.DB.prepare("SELECT status, suppressed_reason FROM outbox WHERE id = 'mail-retain'").first<{ status: string; suppressed_reason: string | null }>();
  expect(email).toEqual({ status: "queued", suppressed_reason: null });
  const invite = await env.DB.prepare("SELECT sequence, last_method, status FROM calendar_invites WHERE id = 'invite-retain'").first<{ sequence: number; last_method: string; status: string }>();
  expect(invite).toEqual({ sequence: 1, last_method: "REQUEST", status: "active" });
  const calendarRows = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE ics_uid = 'uid-retain'").first<{ total: number }>();
  expect(calendarRows?.total).toBe(1);
  const agenda = await env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = 'sub-retain'").first();
  expect(agenda).toBeNull();
  const publicSession = await SELF.fetch("https://marquee.stage11.dev/s/sub-retain?event=reversal");
  expect(publicSession.status).toBe(404);
  const after = await SELF.fetch("https://marquee.stage11.dev/api/v1/public/embeds/reversal-agenda?event=reversal");
  expect(after.status).toBe(200);
  const afterBody = await after.json<{ sessions: Array<{ title: string }> }>();
  expect(afterBody.sessions.some((session) => session.title === "Retain this acceptance")).toBe(false);
});

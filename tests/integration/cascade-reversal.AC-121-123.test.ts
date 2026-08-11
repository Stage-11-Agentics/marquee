import { SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import {
  writeAcceptanceReversal,
  writeSubmissionDecision,
} from "../../src/jobs/cascade/decisions";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.parse("2026-08-20T16:00:00.000Z");
const ACTOR = { kind: "user" as const, personId: "person-reversal-actor" };

async function seedFixture(): Promise<void> {
  await applyMigrations();
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
        (id, event_id, kind, title, status, origin, submitter_person_id, decided_at, decided_by_person_id, created_at, updated_at)
       VALUES
        ('sub-cancel', 'evt-reversal', 'session', 'Cancel this acceptance', 'accepted', 'public', 'person-reversal-speaker', ?, 'person-reversal-actor', ?, ?),
        ('sub-retain', 'evt-reversal', 'session', 'Retain this acceptance', 'accepted', 'public', 'person-reversal-speaker', ?, 'person-reversal-actor', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('participation-cancel', 'sub-cancel', 'person-reversal-speaker', 'speaker', 0, ?, ?),
        ('participation-retain', 'sub-retain', 'person-reversal-speaker', 'speaker', 0, ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO speaker_tasks
        (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status,
         completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at)
       VALUES
        ('task-cancel-open', 'evt-reversal', 'person-reversal-speaker', 'sub-cancel', 'template-reversal', 'Open cancel task', 'acknowledge', 'Open', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?),
        ('task-cancel-done', 'evt-reversal', 'person-reversal-speaker', 'sub-cancel', 'template-reversal', 'Done cancel task', 'acknowledge', 'Done', ?, 'done', ?, NULL, NULL, 'marquee', NULL, ?, ?),
        ('task-retain-open', 'evt-reversal', 'person-reversal-speaker', 'sub-retain', 'template-reversal', 'Open retain task', 'acknowledge', 'Open', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)`,
    ).bind(NOW + 7 * 86_400_000, NOW, NOW, NOW + 7 * 86_400_000, NOW, NOW, NOW, NOW + 7 * 86_400_000, NOW, NOW),
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
}

beforeAll(seedFixture);

test("AC-121, AC-122, AC-123 · cancel choices mutate task, email, calendar, and agenda rows", async () => {
  const result = await writeAcceptanceReversal({
    db: env.DB,
    eventId: "evt-reversal",
    submissionId: "sub-cancel",
    actor: ACTOR,
    queue: env.MAIL_QUEUE,
    tasks: "cancel",
    emails: "cancel",
    calendar: "cancel",
    outcome: "rejected",
    origin: "https://marquee.example",
    now: NOW + 2_000,
  });
  expect(result).toMatchObject({
    outcome: "succeeded",
    resultingStatus: "rejected",
    tasksCancelled: 1,
    emailsCancelled: 1,
    calendarCancelled: 1,
  });

  const submission = await env.DB.prepare("SELECT status, decided_at, decided_by_person_id FROM submissions WHERE id = 'sub-cancel'").first<{ status: string; decided_at: number; decided_by_person_id: string }>();
  expect(submission).toEqual({ status: "rejected", decided_at: NOW + 2_000, decided_by_person_id: ACTOR.personId });
  const tasks = await env.DB.prepare("SELECT id, status, cancelled_at, due_at FROM speaker_tasks WHERE submission_id = 'sub-cancel' ORDER BY id").all<{ id: string; status: string; cancelled_at: number | null; due_at: number }>();
  expect(tasks.results).toEqual([
    { id: "task-cancel-done", status: "done", cancelled_at: null, due_at: NOW + 7 * 86_400_000 },
    { id: "task-cancel-open", status: "open", cancelled_at: NOW + 2_000, due_at: NOW + 7 * 86_400_000 },
  ]);
  const email = await env.DB.prepare("SELECT status, suppressed_reason FROM outbox WHERE id = 'mail-cancel'").first<{ status: string; suppressed_reason: string | null }>();
  expect(email).toEqual({ status: "suppressed", suppressed_reason: "acceptance_reversed" });
  const agenda = await env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = 'sub-cancel'").first();
  expect(agenda).toBeNull();
  const publicSession = await SELF.fetch("https://marquee.example/s/sub-cancel?event=reversal");
  expect(publicSession.status).toBe(404);
  const publicEmbed = await SELF.fetch("https://marquee.example/api/v1/public/embeds/reversal-agenda?event=reversal");
  expect(publicEmbed.status).toBe(200);
  expect(await publicEmbed.text()).not.toContain("sub-cancel");
  const invite = await env.DB.prepare("SELECT uid, sequence, last_method, status FROM calendar_invites WHERE id = 'invite-cancel'").first<{ uid: string; sequence: number; last_method: string; status: string }>();
  expect(invite).toEqual({ uid: "uid-cancel", sequence: 2, last_method: "CANCEL", status: "cancelled" });
  const cancelIcs = await env.DB.prepare("SELECT ics_body FROM outbox WHERE ics_uid = 'uid-cancel' ORDER BY created_at DESC LIMIT 1").first<{ ics_body: string }>();
  expect(cancelIcs?.ics_body).toContain("METHOD:CANCEL\r\n");
  expect(cancelIcs?.ics_body).toContain("UID:uid-cancel\r\n");
  expect(cancelIcs?.ics_body).toContain("SEQUENCE:2\r\n");

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
  const restoredTask = await env.DB.prepare("SELECT status, cancelled_at, due_at FROM speaker_tasks WHERE id = 'task-cancel-open'").first<{ status: string; cancelled_at: number | null; due_at: number }>();
  expect(restoredTask).toEqual({ status: "open", cancelled_at: null, due_at: NOW + 7 * 86_400_000 });
});

test("AC-121, AC-122, AC-123 · retain choices leave every selected row active while removing placement", async () => {
  const result = await writeAcceptanceReversal({
    db: env.DB,
    eventId: "evt-reversal",
    submissionId: "sub-retain",
    actor: ACTOR,
    queue: env.MAIL_QUEUE,
    tasks: "retain",
    emails: "retain",
    calendar: "retain",
    outcome: "withdrawn",
    origin: "https://marquee.example",
    now: NOW + 4_000,
  });
  expect(result).toMatchObject({ outcome: "succeeded", resultingStatus: "withdrawn", tasksCancelled: 0, emailsCancelled: 0, calendarCancelled: 0 });
  const submission = await env.DB.prepare("SELECT status, decided_at, decided_by_person_id FROM submissions WHERE id = 'sub-retain'").first<{ status: string; decided_at: number; decided_by_person_id: string }>();
  expect(submission).toEqual({ status: "withdrawn", decided_at: NOW + 4_000, decided_by_person_id: ACTOR.personId });
  const task = await env.DB.prepare("SELECT status, cancelled_at FROM speaker_tasks WHERE id = 'task-retain-open'").first<{ status: string; cancelled_at: number | null }>();
  expect(task).toEqual({ status: "open", cancelled_at: null });
  const email = await env.DB.prepare("SELECT status, suppressed_reason FROM outbox WHERE id = 'mail-retain'").first<{ status: string; suppressed_reason: string | null }>();
  expect(email).toEqual({ status: "queued", suppressed_reason: null });
  const invite = await env.DB.prepare("SELECT sequence, last_method, status FROM calendar_invites WHERE id = 'invite-retain'").first<{ sequence: number; last_method: string; status: string }>();
  expect(invite).toEqual({ sequence: 1, last_method: "REQUEST", status: "active" });
  const calendarRows = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE ics_uid = 'uid-retain'").first<{ total: number }>();
  expect(calendarRows?.total).toBe(1);
  const agenda = await env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = 'sub-retain'").first();
  expect(agenda).toBeNull();
  const publicSession = await SELF.fetch("https://marquee.example/s/sub-retain?event=reversal");
  expect(publicSession.status).toBe(404);
});

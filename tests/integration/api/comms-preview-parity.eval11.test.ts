import { afterEach, beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

/**
 * sbek round 11, manual CNT-08: "Preview merge" rendered `{{task.title}}` and
 * `{{task.due_date}}` literally while the queued send merged them correctly.
 *
 * Wrong in exactly the place being wrong costs most. Preview is the surface an
 * organizer checks BEFORE mailing real speakers; one that under-renders sends
 * them back to rewrite copy that was already right, or — worse — to delete the
 * tokens that were about to work.
 *
 * The assertion is parity, not a fixed string: whatever the send produces for a
 * recipient, the preview of that same recipient must produce too. A test that
 * pinned expected text would pass the day someone changed the renderer and
 * moved only one of the two callers.
 */

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DUE_AT = Date.parse("2026-09-01T17:00:00.000Z");
const CONTEXT = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/** Every token the compose drawer offers that depends on task context. */
const MESSAGE = {
  subject: "Still outstanding: {{task.title}}",
  body: "Hello {{speaker.first_name}} — {{task.title}} for {{submission.title}} is due {{task.due_date}}.",
};

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_cnt08', 'CNT08 Org', 'cnt08-org', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES ('evt_cnt08', 'org_cnt08', 'CNT08 Conference', 'cnt08', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_cnt08_chair', 'org_cnt08', 'chair@example.com', 'Grace Chair', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('per_cnt08_speaker', 'org_cnt08', 'speaker@example.com', 'Ada Lovelace', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_cnt08', 'org_cnt08', 'evt_cnt08', 'per_cnt08_chair', 'owner', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, reminder_offset_hours, created_at, updated_at) VALUES ('form_cnt08', 'evt_cnt08', 'CFP', 'cfp', 'abstract', 'open', ?, 24, ?, ?)").bind(NOW + 48 * 60 * 60_000, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES ('sub_cnt08', 'evt_cnt08', 'form_cnt08', 'abstract', 'Reliable agents', 'accepted', 'public', 'per_cnt08_speaker', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_cnt08', 'sub_cnt08', 'per_cnt08_speaker', 'speaker', 0, ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, position, created_at, updated_at) VALUES ('tpl_cnt08', 'evt_cnt08', 'Presentation upload', 'file', 'Upload the deck.', ?, 0, ?, ?)").bind(DUE_AT, NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, created_at, updated_at) VALUES ('task_cnt08', 'evt_cnt08', 'per_cnt08_speaker', 'sub_cnt08', 'tpl_cnt08', 'Presentation upload', 'file', 'Upload the deck.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?)").bind(DUE_AT, NOW, NOW),
  ]);
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM audit_log WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM email_templates WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM speaker_tasks WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM task_templates WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = 'evt_cnt08')"),
    env.DB.prepare("DELETE FROM submissions WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM forms WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM auth_sessions WHERE person_id = 'per_cnt08_chair'"),
    env.DB.prepare("DELETE FROM memberships WHERE event_id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM people WHERE org_id = 'org_cnt08'"),
    env.DB.prepare("DELETE FROM events WHERE id = 'evt_cnt08'"),
    env.DB.prepare("DELETE FROM organizations WHERE id = 'org_cnt08'"),
  ]);
});

async function organizerHeaders(): Promise<Record<string, string>> {
  const session = await createSession(env.DB, { personId: "per_cnt08_chair", roleHint: "owner", userAgent: "cnt08" });
  return { cookie: `mq_session=${session.id}`, "content-type": "application/json" };
}

async function preview(headers: Record<string, string>, body: Record<string, unknown>): Promise<{ subject: string; text: string }> {
  const response = await app.request("/api/v1/events/evt_cnt08/comms/preview", { method: "POST", headers, body: JSON.stringify(body) }, env, CONTEXT);
  const payload = await response.text();
  expect(response.status, payload).toBe(200);
  return JSON.parse(payload) as { subject: string; text: string };
}

async function queued(headers: Record<string, string>, selector: Record<string, unknown>): Promise<{ subject: string; text: string }> {
  const response = await app.request("/api/v1/events/evt_cnt08/comms/send", {
    method: "POST", headers, body: JSON.stringify({ selector, ...MESSAGE }),
  }, env, CONTEXT);
  expect(response.status, await response.text()).toBe(202);
  const row = await env.DB.prepare("SELECT subject, text FROM outbox WHERE event_id = 'evt_cnt08' ORDER BY created_at DESC LIMIT 1").first<{ subject: string; text: string }>();
  expect(row, "the send queued a row to compare against").not.toBeNull();
  return row!;
}

test("CONTRACT · CNT-08 · the preview renders every token the send renders", async () => {
  const headers = await organizerHeaders();
  const sent = await queued(headers, { recipient_pairs: [{ person_id: "per_cnt08_speaker", submission_id: "sub_cnt08" }], task_state: "open" });

  // The send is the oracle: it is what the speaker actually receives.
  expect(sent.text, "the send itself must merge the task tokens").toContain("Presentation upload");
  expect(sent.text).not.toContain("{{");
  expect(sent.subject).not.toContain("{{");

  const shown = await preview(headers, { person_id: "per_cnt08_speaker", submission_id: "sub_cnt08", ...MESSAGE });
  expect(shown.subject).toBe(sent.subject);
  expect(shown.text).toBe(sent.text);
});

test("CONTRACT · CNT-08 · the preview still merges when the drawer knows no submission", async () => {
  // The compose drawer passes `submission_id: reminderSubmission(row) ?? undefined`,
  // and a speaker with no accepted session leaves it undefined. That must not
  // silently drop task context the send would have found.
  const headers = await organizerHeaders();
  const sent = await queued(headers, { person_ids: ["per_cnt08_speaker"], task_state: "open" });
  const shown = await preview(headers, { person_id: "per_cnt08_speaker", ...MESSAGE });

  expect(shown.text).toBe(sent.text);
  expect(shown.text).not.toContain("{{task.");
});

test("CONTRACT · CNT-08 · a token with no value reads the same in the preview as in the send", async () => {
  // Parity must not be reached by making the preview as empty as the fallback
  // was. A recipient with no open task resolves `task.*` to the renderer's
  // em-dash in BOTH surfaces — not a literal token in one and a dash in the
  // other, which is the shape of the defect.
  const headers = await organizerHeaders();
  await env.DB.prepare("DELETE FROM speaker_tasks WHERE event_id = 'evt_cnt08'").run();
  const sent = await queued(headers, { person_ids: ["per_cnt08_speaker"] });
  const shown = await preview(headers, { person_id: "per_cnt08_speaker", ...MESSAGE });

  expect(shown.text).toBe(sent.text);
  expect(shown.subject).toBe(sent.subject);
  // The context that DOES exist is still there — parity is not agreement on
  // nothing.
  expect(shown.text).toContain("Ada");
  expect(shown.text).toContain("Reliable agents");
  expect(shown.text).not.toContain("{{");
});

test("CONTRACT · CNT-08 · a recipient with no participation still previews their own name", async () => {
  // The three-field fallback is not deleted, only demoted: an organizer on the
  // membership with no submission of their own has no task context to merge,
  // and must still get a preview rather than a 404 or a blank.
  const headers = await organizerHeaders();
  const shown = await preview(headers, { person_id: "per_cnt08_chair", ...MESSAGE });
  expect(shown.text).toContain("Grace");
});

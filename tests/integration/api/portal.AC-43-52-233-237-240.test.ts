import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { cancelTaskSet } from "../../../src/jobs/cascade/decisions";
import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_SPEAKER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";
import { verifyAndComplete } from "../../../src/lib/r2/complete";
import { policyFor, validateDeclared } from "../../../src/lib/r2/policy";
import { readImageDimensions } from "../../../src/lib/r2/sniff";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const SPEAKER_ID = DEMO_SPEAKER_PERSON_ID;
const OTHER_PERSON_ID = "per_portal_other";
const REGISTERED_HELPER_ID = "per_portal_helper";
const OWNER_ID = "per_demo_organizer";
const FORM_ID = "form-portal";
const SUBMISSION_ID = "sub-portal-talk";
const REVIEW_SUBMISSION_ID = "sub-portal-review";
const DETAIL_CONTEXT_FIELD_ID = "field-portal-context";
// Anchored to the real clock, not to a calendar date. Task state and form
// windows are derived from Date.now() in production, so every fixture here
// means "a day before now" or "a day after now" — relative offsets. Pinned to
// an absolute date, those offsets silently change meaning as the wall clock
// passes them: this file's `NOW + 86_400_000` fixtures were written as "due
// tomorrow", and on 2026-08-12T15:00Z they became "due in the past", flipping
// a task from risk to overdue and closing a form window that a test expects
// open. The suite went red with no commit behind it. Only the anchor moves.
const NOW = Date.now();
const DAY_MS = 86_400_000;
// A one-day millisecond subtraction can still be today's event-local calendar
// date near UTC midnight. Keep the fixed-day template two calendar days back
// so its overdue state is stable without changing the production clock.
const OVERDUE_AT = NOW - 2 * DAY_MS;

let speakerCookie = "";
let otherSpeakerCookie = "";
let ownerCookie = "";

async function request(path: string, init: RequestInit = {}, cookie = speakerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'marquee', ?, ?)`,
    ).bind(OTHER_PERSON_ID, DEMO_ORGANIZATION_ID, "other@portal.example", "Other Speaker Secret", "Other title", "Other company", "Other private bio", "[]", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'speaker', ?, ?)`,
    ).bind("mem-portal-other", DEMO_ORGANIZATION_ID, EVENT_ID, OTHER_PERSON_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO waves (id, event_id, name, decision_on, target_count, sent_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind("wave-portal-next", EVENT_ID, "Wave 2", "2026-09-01", 20, 1, NOW, NOW),
    // clock-check: allow — this form opens_at/closes_at window is compared as exact instants, not event-local calendar days
    env.DB.prepare(
      `INSERT INTO forms
        (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md, per_submitter_limit,
         min_speakers, max_speakers, max_sponsors, reminder_offset_hours, thankyou_template_key,
         admin_notify_person_ids, turnstile_required, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'session', 'open', ?, ?, '', 3, 1, 4, 0, NULL, NULL, '[]', 0, ?, ?)`,
    ).bind(FORM_ID, EVENT_ID, "Speaker details", "speaker-details", NOW - 86_400_000, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES (?, ?, 'needs_details', 'Needs detail?', NULL, 'single_select', 1, 0, ?, NULL, ?, ?)`,
    ).bind("field-portal-trigger", FORM_ID, JSON.stringify({ options: ["yes", "no"] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES (?, ?, 'detail_note', 'Detail note', 'Only shown when needed.', 'long_text', 1, 1, '{}', ?, ?, ?)`,
    ).bind("field-portal-conditional", FORM_ID, JSON.stringify({ all: [{ fieldKey: "needs_details", op: "equals", value: "yes" }] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES (?, ?, 'detail_context', 'Detail context', NULL, 'short_text', 0, 2, '{}', NULL, ?, ?)`,
    ).bind(DETAIL_CONTEXT_FIELD_ID, FORM_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, wave_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'session', ?, ?, 'accepted', 'public', ?, NULL, ?, ?, 0, ?, 'marquee', ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, FORM_ID, "A title with a very long diacritic name — Café déjà vu", "Original portal description", SPEAKER_ID, NOW, NOW, "a title with a very long diacritic name cafe deja vu", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'session', ?, ?, 'in_review', 'public', ?, ?, ?, 0, ?, 'marquee', ?, ?)`,
    ).bind(REVIEW_SUBMISSION_ID, EVENT_ID, FORM_ID, "Review wave submission", "Pending review", SPEAKER_ID, NOW, NOW, "review wave submission", NOW + 1_000, NOW + 1_000),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
       VALUES ('sub-portal-public', ?, ?, 'session', 'Public profile session', 'Public session description', 'accepted', 'public', ?, ?, ?, 1, 'public profile session', 'marquee', ?, ?)`,
    ).bind(EVENT_ID, FORM_ID, SPEAKER_ID, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
       VALUES ('sub-portal-other', ?, ?, 'session', 'Other speaker secret title', 'Other speaker private description', 'accepted', 'public', ?, ?, ?, 0, 'other speaker secret title', 'marquee', ?, ?)`,
    ).bind(EVENT_ID, FORM_ID, OTHER_PERSON_ID, NOW, NOW, NOW, NOW),
    ...[
      ["part-portal-talk", SUBMISSION_ID, SPEAKER_ID],
      ["part-portal-review", REVIEW_SUBMISSION_ID, SPEAKER_ID],
      ["part-portal-public", "sub-portal-public", SPEAKER_ID],
      ["part-portal-other", "sub-portal-other", OTHER_PERSON_ID],
    ].map(([id, submissionId, personId]) => env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, 'speaker', 0, 'pending', ?, ?)`,
    ).bind(id, submissionId, personId, NOW, NOW)),
    env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
       VALUES ('building-portal', ?, 'North Hall', '1 Conference Way', 0, 40.7625, -73.9814, 5, 'operator secret — never public', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-portal', ?, 'building-portal', 'Room 101', 120, 0, '[]', NULL, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    // clock-check: allow — agenda starts_at is an exact schedule instant, not an event-local calendar deadline
    env.DB.prepare(
      `INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
       VALUES ('agenda-portal-talk', ?, ?, 'session', ?, 30, 'room-portal', NULL, 0, ?, ?),
              ('agenda-portal-public', ?, 'sub-portal-public', 'session', ?, 30, 'room-portal', NULL, 1, ?, ?)`,
    ).bind(EVENT_ID, SUBMISSION_ID, NOW + 86_400_000, NOW, NOW, EVENT_ID, NOW + 172_800_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submission_decisions
        (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, created_at, updated_at)
       VALUES ('decision-portal', ?, ?, 'approve', 'accepted', 'A useful note from the conference.', ?, ?, ?, ?)`,
    ).bind(EVENT_ID, SUBMISSION_ID, OWNER_ID, NOW, NOW, NOW),
    ...[
      ["template-portal-ack", "acknowledge", "Read the speaker agreement", null, OVERDUE_AT],
      ["template-portal-file", "file", "Upload your deck", null, NOW + 2 * DAY_MS],
      ["template-portal-form", "form", "Complete speaker details", FORM_ID, NOW + 172_800_000],
      ["template-portal-finalize-talk", "acknowledge", "Finalize talk description", null, NOW + 259_200_000],
      ["template-portal-finalize-bio", "acknowledge", "Finalize bio & photos", null, NOW + 345_600_000],
    ].map(([id, kind, name, formId, dueAt]) => env.DB.prepare(
      `INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, EVENT_ID, name, kind, `Payload for ${name}`, dueAt, formId, kind === "file" ? JSON.stringify({ accept: ["pdf"] }) : null, Number(String(id).endsWith("ack") ? 0 : String(id).endsWith("file") ? 1 : 2), NOW, NOW)),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, created_at, updated_at)
       VALUES ('task-portal-ack', ?, ?, ?, 'template-portal-ack', 'Read the speaker agreement', 'acknowledge', 'Acknowledge the current speaker agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-file', ?, ?, ?, 'template-portal-file', 'Upload your deck', 'file', 'Upload the requested deck file.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-form', ?, ?, ?, 'template-portal-form', 'Complete speaker details', 'form', 'Answer the visible conditional fields.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-subject-talk', ?, ?, ?, 'template-portal-finalize-talk', 'Finalize talk description', 'acknowledge', 'Confirm the title and abstract before publication.', ?, 'done', ?, '{"acknowledged":true}', NULL, 'marquee', ?, ?),
              ('task-portal-subject-bio', ?, ?, ?, 'template-portal-finalize-bio', 'Finalize bio & photos', 'acknowledge', 'Review your bio and add a headshot for the speaker gallery.', ?, 'done', ?, '{"acknowledged":true}', NULL, 'marquee', ?, ?),
              ('task-portal-other', ?, ?, ?, 'template-portal-ack', 'Other speaker private task', 'acknowledge', 'This belongs only to another speaker.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?)`,
    ).bind(
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, OVERDUE_AT, NOW, NOW,
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW + 2 * DAY_MS, NOW, NOW,
      EVENT_ID, SPEAKER_ID, REVIEW_SUBMISSION_ID, NOW + 172_800_000, NOW, NOW,
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW + 259_200_000, NOW, NOW, NOW,
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW + 345_600_000, NOW, NOW, NOW,
      EVENT_ID, OTHER_PERSON_ID, "sub-portal-other", NOW + 2 * DAY_MS, NOW, NOW,
    ),
    env.DB.prepare(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
       VALUES ('attachment-portal-file', ?, 'task_upload', 'task-portal-file', 'uploads/portal/deck.pdf', 'deck.pdf', 'application/pdf', 10, 'ready', 'etag', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
       VALUES ('attachment-portal-headshot', ?, 'person_headshot', ?, 'uploads/portal/headshot.png', 'robin-headshot.png', 'image/png', 12, 'ready', 'headshot-etag', ?, ?)`,
    ).bind(EVENT_ID, SPEAKER_ID, NOW, NOW),
    env.DB.prepare("UPDATE people SET headshot_attachment_id = 'attachment-portal-headshot' WHERE id = ?").bind(SPEAKER_ID),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'marquee', ?, ?)`,
    ).bind(REGISTERED_HELPER_ID, DEMO_ORGANIZATION_ID, "registered.helper@example.com", "Private Registry Name", NOW, NOW),
  ]);

  const speakerSession = await createSession(env.DB, { personId: SPEAKER_ID, roleHint: "speaker", userAgent: "portal-test", now: NOW });
  const otherSession = await createSession(env.DB, { personId: OTHER_PERSON_ID, roleHint: "speaker", userAgent: "portal-test", now: NOW });
  const ownerSession = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "portal-test", now: NOW });
  speakerCookie = `mq_session=${speakerSession.id}`;
  otherSpeakerCookie = `mq_session=${otherSession.id}`;
  ownerCookie = `mq_session=${ownerSession.id}`;
}

async function portal(cookie = speakerCookie): Promise<{ response: Response; body: any }> {
  const response = await request("/api/v1/me/portal", {}, cookie);
  return { response, body: await response.json() };
}

describe.sequential("MRQ-16 speaker portal", () => {
  beforeAll(seedFixture, 15_000);

  test("CONTRACT · the portal route is present in the generated registry and OpenAPI document", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
    expect(response.status).toBe(200);
    const document = await response.json<{ paths: Record<string, unknown> }>();
    expect(document.paths["/api/v1/me/portal"]).toBeTruthy();
    expect(document.paths["/api/v1/me/tasks/{taskId}/complete"]).toBeTruthy();
  });

  test("AC-43 · the status hero data is the first portal submission and carries the current status and wave", async () => {
    const { response, body } = await portal();
    expect(response.status).toBe(200);
    expect(body.submissions[0]).toMatchObject({ status: "in_review", wave: "Wave 2", status_label: "Under review", status_tone: "" });
  });

  test("AC-44 · a pre-decision speaker receives a concrete next-wave date instead of a bare pending state", async () => {
    const { body } = await portal();
    const review = body.submissions.find((submission: { id: string }) => submission.id === REVIEW_SUBMISSION_ID);
    expect(review).toMatchObject({ wave: "Wave 2", wave_decision_on: "2026-09-01" });
    expect(review.wave_decision_on).not.toBeNull();
  });

  test("AC-45 · changing a submission status is reflected on the speaker's next portal load", async () => {
    await env.DB.prepare("UPDATE submissions SET status = 'accepted', wave_id = 'wave-portal-next', updated_at = ? WHERE id = ?").bind(NOW + 2_000, REVIEW_SUBMISSION_ID).run();
    const { body } = await portal();
    expect(body.submissions.find((submission: { id: string }) => submission.id === REVIEW_SUBMISSION_ID)).toMatchObject({ status: "accepted", wave: "Wave 2" });
  });

  test("AC-46 · task rows expose title, kind, due date, state, and deterministic due-date order", async () => {
    const { body } = await portal();
    expect(body.tasks.map((task: { id: string }) => task.id).slice(0, 3)).toEqual(["task-portal-ack", "task-portal-file", "task-portal-form"]);
    expect(body.tasks[0]).toMatchObject({ title: "Read the speaker agreement", kind: "acknowledge", status: "open", due_at: OVERDUE_AT });
  });

  test("CONTRACT · MRQ-93 · subject-bearing acknowledgement tasks retain their template identity while generic acknowledgement stays generic", async () => {
    const { body } = await portal();
    expect(body.tasks.find((task: { id: string }) => task.id === "task-portal-subject-talk")).toMatchObject({
      template_id: "template-portal-finalize-talk",
      submission_id: SUBMISSION_ID,
      kind: "acknowledge",
      payload: { kind: "acknowledge", acknowledged: true },
    });
    expect(body.tasks.find((task: { id: string }) => task.id === "task-portal-subject-bio")).toMatchObject({
      template_id: "template-portal-finalize-bio",
      submission_id: SUBMISSION_ID,
      kind: "acknowledge",
    });
    expect(body.tasks.find((task: { id: string }) => task.id === "task-portal-ack")).toMatchObject({
      template_id: "template-portal-ack",
      kind: "acknowledge",
      payload: { kind: "acknowledge", acknowledged: false },
    });
  });

  test("AC-401 · MRQ-246 · portal form completion rejects stored-plus-submitted group overage like the organizer path", async () => {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO form_length_rules (id, form_id, label, field_keys, max_chars, sort_order, created_at, updated_at)
        VALUES ('rule-portal-mrq-246', ?, 'Updated programme block', ?, 10, 0, ?, ?)
      `).bind(FORM_ID, JSON.stringify(["detail_note", "detail_context"]), NOW, NOW),
      env.DB.prepare(`
        INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
        VALUES ('answer-portal-mrq-246-note', ?, 'field-portal-conditional', ?, NULL, ?, ?)
      `).bind(SUBMISSION_ID, "12345678901", NOW, NOW),
      env.DB.prepare(`
        INSERT INTO speaker_tasks
          (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status,
           completed_at, response_json, attachment_id, last_write_source, created_at, updated_at)
        VALUES ('task-portal-mrq-246', ?, ?, ?, 'template-portal-form', 'Combined character budget', 'form',
                'Complete the combined character budget.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?)
      `).bind(EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW + 3 * DAY_MS, NOW, NOW),
    ]);

    const partial = await request("/api/v1/me/tasks/task-portal-mrq-246/complete", {
      method: "POST",
      body: JSON.stringify({ answers: { needs_details: "yes" } }),
    });
    expect(partial.status).toBe(422);
    const partialBody = await partial.json<{ error: { details: Array<{ fieldKey: string; kind?: string }> } }>();
    expect(partialBody.error.details[0]).toMatchObject({ fieldKey: "detail_note", kind: "form_length_rule" });

    const hidden = await request("/api/v1/me/tasks/task-portal-mrq-246/complete", {
      method: "POST",
      body: JSON.stringify({ answers: { needs_details: "no" } }),
    });
    expect(hidden.status).toBe(200);
  });

  test("AC-47 · acknowledge, file, and form task registry entries open real payload surfaces and validate completion", async () => {
    const ack = await request("/api/v1/me/tasks/task-portal-ack/complete", { method: "POST", body: JSON.stringify({ acknowledged: false }) });
    expect(ack.status).toBe(422);
    const acknowledged = await request("/api/v1/me/tasks/task-portal-ack/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) });
    expect(acknowledged.status).toBe(200);
    const file = await request("/api/v1/me/tasks/task-portal-file/complete", { method: "POST", body: JSON.stringify({ attachment_id: "attachment-portal-file" }) });
    expect(file.status).toBe(200);
    const form = await request("/api/v1/me/tasks/task-portal-form/complete", { method: "POST", body: JSON.stringify({ answers: { needs_details: "no", detail_note: "must not be required while hidden" } }) });
    expect(form.status).toBe(200);
    const { body } = await portal();
    expect(body.tasks.filter((task: { id: string }) => task.id.startsWith("task-portal-") && task.id !== "task-portal-other").every((task: { status: string }) => task.status === "done")).toBe(true);
  });

  test("CONTRACT · SPK-10 · the speaker record returns pointer-based profile and task file histories", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/onboarding/speakers/${SPEAKER_ID}`, {}, ownerCookie);
    expect(response.status).toBe(200);
    const body = await response.json<{ files: { profile: { latest: { filename: string; is_latest: boolean } | null; version_count: number }; tasks: Array<{ task_id: string; list: { latest: { filename: string; is_latest: boolean } | null } }> } }>();
    expect(body.files.profile).toMatchObject({ version_count: 1, latest: { filename: "robin-headshot.png", is_latest: true } });
    expect(body.files.tasks.find((task) => task.task_id === "task-portal-file")?.list.latest).toMatchObject({ filename: "deck.pdf", is_latest: true });
  });

  test("AC-48, AC-91, AC-92, AC-94, AC-148 · completed portal work updates organizer attention and the chase matrix", async () => {
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL, due_at = ? WHERE id = 'task-portal-ack'").bind(OVERDUE_AT).run();
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL WHERE id = 'task-portal-file'").run();
    const uploaded = await request("/api/v1/me/tasks/task-portal-file/complete", { method: "POST", body: JSON.stringify({ attachment_id: "attachment-portal-file" }) });
    expect(uploaded.status).toBe(200);
    const before = await request(`/api/v1/events/${EVENT_ID}/dashboard`, {}, ownerCookie);
    expect(before.status).toBe(200);
    const beforeBody = await before.json<{ attention: { overdue_submissions: { count: number } } }>();
    const chaseBefore = await request(`/api/v1/events/${EVENT_ID}/onboarding`, {}, ownerCookie);
    const chaseBeforeBody = await chaseBefore.json<{ data: Array<{ cells: Record<string, { state: string; glyph: string }> }> }>();
    expect(chaseBeforeBody.data[0]?.cells["template-portal-ack"]).toMatchObject({ state: "overdue", glyph: "!" });
    expect(chaseBeforeBody.data[0]?.cells["template-portal-file"]).toMatchObject({ state: "done", glyph: "✓" });
    const completed = await request("/api/v1/me/tasks/task-portal-ack/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) });
    expect(completed.status).toBe(200);
    const after = await request(`/api/v1/events/${EVENT_ID}/dashboard`, {}, ownerCookie);
    const afterBody = await after.json<{ attention: { overdue_submissions: { count: number } } }>();
    expect(afterBody.attention.overdue_submissions.count).toBeLessThan(beforeBody.attention.overdue_submissions.count);
    const chaseAfter = await request(`/api/v1/events/${EVENT_ID}/onboarding`, {}, ownerCookie);
    const chaseAfterBody = await chaseAfter.json<{ data: Array<{ cells: Record<string, { state: string; glyph: string }>; person: { id: string; name: string } }> }>();
    // MRQ-111: a speaker who has finished everything stays on the board with a
    // clear row rather than disappearing from the only screen that claims to
    // list speakers. "Still owes something" is the `incomplete` filter's job.
    expect(chaseAfterBody.data.find((row) => row.person.id === SPEAKER_ID)?.cells["template-portal-ack"]).toMatchObject({ state: "done", glyph: "\u2713" });
    expect(chaseAfterBody.data.find((row) => row.person.id === OTHER_PERSON_ID)?.cells["template-portal-ack"]).toMatchObject({ state: "risk", glyph: "\u00d7" });
    const chaseIncomplete = await request(`/api/v1/events/${EVENT_ID}/onboarding?filter=incomplete`, {}, ownerCookie);
    const chaseIncompleteBody = await chaseIncomplete.json<{ data: Array<{ person: { id: string } }> }>();
    expect(chaseIncompleteBody.data.find((row) => row.person.id === SPEAKER_ID)).toBeUndefined();
  });

  test("AC-49 · overdue tasks carry a textual marker and a distinct overdue data state", async () => {
    const { body } = await portal();
    const overdue = body.tasks.find((task: { id: string }) => task.id === "task-portal-ack");
    expect(overdue).toMatchObject({ overdue: false, status: "done" });
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL, due_at = ? WHERE id = 'task-portal-ack'").bind(OVERDUE_AT).run();
    const refreshed = await portal();
    expect(refreshed.body.tasks.find((task: { id: string }) => task.id === "task-portal-ack")).toMatchObject({ overdue: true, status: "open" });
  });

  test("AC-264, AC-265 · cancelled tasks leave the portal visible but leave active chase readers", async () => {
    await env.DB.batch([
      // clock-check: allow — these task rows override a fixed template with relative instant probes, so due_at is compared exactly
      env.DB.prepare(
        `INSERT INTO speaker_tasks
          (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status,
           completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at)
         VALUES ('task-portal-review-open', ?, ?, ?, 'template-portal-ack', 'Review task', 'acknowledge', 'Review task.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?),
                ('task-portal-positive-open', ?, ?, 'sub-portal-public', 'template-portal-ack', 'Positive task', 'acknowledge', 'Positive control task.', ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)`,
      ).bind(
        EVENT_ID, SPEAKER_ID, REVIEW_SUBMISSION_ID, NOW - 2_000, NOW, NOW,
        EVENT_ID, SPEAKER_ID, NOW - 2_000, NOW, NOW,
      ),
    ]);
    const taskCountBefore = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE event_id = ?").bind(EVENT_ID).first<{ count: number }>();

    const boardBeforeResponse = await request(`/api/v1/events/${EVENT_ID}/board?per_page=100`, {}, ownerCookie);
    expect(boardBeforeResponse.status).toBe(200);
    const boardBefore = await boardBeforeResponse.json<{ data: Array<{ id: string; stage: string }> }>();
    expect(boardBefore.data.find((card) => card.id === REVIEW_SUBMISSION_ID)?.stage).toBe("waved");

    expect(await cancelTaskSet(env.DB, EVENT_ID, SUBMISSION_ID, NOW + 5_000)).toBe(1);
    expect(await cancelTaskSet(env.DB, EVENT_ID, REVIEW_SUBMISSION_ID, NOW + 5_000)).toBe(1);
    const taskCountAfter = await env.DB.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE event_id = ?").bind(EVENT_ID).first<{ count: number }>();
    expect(taskCountAfter?.count).toBe(taskCountBefore?.count);
    const activeTaskCounts = await env.DB.prepare(
      `SELECT submission_id, COUNT(*) AS count
       FROM speaker_tasks
       WHERE event_id = ? AND status = 'open' AND cancelled_at IS NULL
       GROUP BY submission_id ORDER BY submission_id`,
    ).bind(EVENT_ID).all<{ submission_id: string | null; count: number }>();
    expect(activeTaskCounts.results).toEqual([
      { submission_id: "sub-portal-other", count: 1 },
      { submission_id: "sub-portal-public", count: 1 },
    ]);

    const portalAfter = await portal();
    expect(portalAfter.response.status).toBe(200);
    expect(portalAfter.body.tasks.find((task: { id: string }) => task.id === "task-portal-ack")).toMatchObject({
      cancelled_at: NOW + 5_000,
      cancelled_reason: "This talk was withdrawn from the conference.",
      overdue: false,
    });
    expect(portalAfter.body.tasks.find((task: { id: string }) => task.id === "task-portal-positive-open")).toMatchObject({
      cancelled_at: null,
      status: "open",
    });
    const cancelledCompletion = await request("/api/v1/me/tasks/task-portal-ack/complete", {
      method: "POST",
      body: JSON.stringify({ acknowledged: true }),
    });
    expect(cancelledCompletion.status).toBe(409);
    const cancelledTaskAfterAttempt = await env.DB.prepare("SELECT status, cancelled_at FROM speaker_tasks WHERE id = 'task-portal-ack'").first<{ status: string; cancelled_at: number | null }>();
    expect(cancelledTaskAfterAttempt).toEqual({ status: "open", cancelled_at: NOW + 5_000 });

    const chaseResponse = await request(`/api/v1/events/${EVENT_ID}/onboarding`, {}, ownerCookie);
    expect(chaseResponse.status).toBe(200);
    const chase = await chaseResponse.json<{
      data: Array<{ person: { id: string }; cells: Record<string, { task_id: string | null; owed: boolean }> }>;
      metrics: { accepted_speakers: number };
    }>();
    const speakerRow = chase.data.find((row) => row.person.id === SPEAKER_ID);
    expect(speakerRow).toBeDefined();
    expect(speakerRow?.cells["template-portal-ack"]).toMatchObject({ task_id: "task-portal-positive-open", owed: true });
    expect(chase.data.flatMap((row) => Object.values(row.cells)).some((cell) => cell.task_id === "task-portal-ack")).toBe(false);
    expect(chase.metrics.accepted_speakers).toBeGreaterThan(0);

    const submissionsResponse = await request(`/api/v1/events/${EVENT_ID}/submissions?status=onboarding&per_page=100`, {}, ownerCookie);
    expect(submissionsResponse.status).toBe(200);
    const submissions = await submissionsResponse.json<{ data: Array<{ id: string }> }>();
    const submissionIds = submissions.data.map((item) => item.id);
    expect(submissionIds).not.toContain(SUBMISSION_ID);
    expect(submissionIds).not.toContain(REVIEW_SUBMISSION_ID);
    expect(submissionIds).toEqual(expect.arrayContaining(["sub-portal-other"]));
    expect(submissionIds).not.toContain("sub-portal-public");

    const boardAfterResponse = await request(`/api/v1/events/${EVENT_ID}/board?per_page=100`, {}, ownerCookie);
    expect(boardAfterResponse.status).toBe(200);
    const boardAfter = await boardAfterResponse.json<{ data: Array<{ id: string; stage: string }> }>();
    expect(boardAfter.data.find((card) => card.id === REVIEW_SUBMISSION_ID)?.stage).toBe("waved");
  });

  test("AC-50 · profile editing persists title, company, bio, social links, and headshot reference for any speaker status", async () => {
    const update = await request("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify({ title: "Principal Speaker", company: "New Company", bio: "A long diacritic bio — naïve façade.", social_links: ["https://example.com/profile"], headshot_attachment_id: null }) });
    expect(update.status).toBe(200);
    const { body } = await portal();
    expect(body.person).toMatchObject({ title: "Principal Speaker", company: "New Company", bio: "A long diacritic bio — naïve façade.", social_links: ["https://example.com/profile"], headshot_attachment_id: null });
  });

  test("AC-51 · a portal profile edit propagates to the public speaker page without an admin action", async () => {
    await request("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify({ title: "Publicly Updated Title", company: "Publicly Updated Company", bio: "Publicly updated speaker bio.", social_links: ["https://example.com/public"], headshot_attachment_id: null }) });
    const response = await SELF.fetch(`${ORIGIN}/p/demo-speaker?event=aie-nyc-2026`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Publicly Updated Title");
    expect(html).toContain("Publicly updated speaker bio.");
  });

  test("AC-52 · headshot rules accept JPEG, PNG, and WebP through the shared path and reject undersized crop inputs", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x80, 0x00, 0x80, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7f, 0x00, 0x00, 0x7f, 0x00, 0x00]);
    expect(readImageDimensions(jpeg, "jpeg")).toEqual({ width: 128, height: 128 });
    expect(readImageDimensions(png, "png")).toEqual({ width: 128, height: 128 });
    expect(readImageDimensions(webp, "webp")).toEqual({ width: 128, height: 128 });
    expect(readImageDimensions(new Uint8Array([...png.slice(0, 16), 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40]), "png")).toEqual({ width: 64, height: 64 });
    const policy = policyFor("person_headshot");
    expect(policy).not.toBeNull();
    for (const [filename, contentType] of [["headshot.jpg", "image/jpeg"], ["headshot.png", "image/png"], ["headshot.webp", "image/webp"]]) {
      expect(validateDeclared(policy!, { filename, contentType, sizeBytes: 100 }).ok).toBe(true);
    }
    for (const [kind, contentType, bytes] of [["jpeg", "image/jpeg", jpeg], ["png", "image/png", png], ["webp", "image/webp", webp]] as const) {
      const key = `mrq-16-ac52-${kind}`;
      await env.MEDIA.put(key, bytes);
      await expect(verifyAndComplete(env.MEDIA, {
        id: `attachment-${kind}`,
        event_id: EVENT_ID,
        owner_type: "person_headshot",
        owner_id: SPEAKER_ID,
        r2_key: key,
        filename: `headshot.${kind === "jpeg" ? "jpg" : kind}`,
        content_type: contentType,
        size_bytes: bytes.byteLength,
        status: "pending",
      })).resolves.toEqual({ ok: false, reason: "dimension_too_small" });
      await expect(env.MEDIA.head(key)).resolves.toBeNull();
    }
  });

  test("AC-233 · the event handbook preserves static Markdown headings and links in the portal payload", async () => {
    const { body } = await portal();
    expect(body.handbook.markdown).toContain("# Speaker handbook");
    expect(body.handbook.markdown).toContain("[Conference site]");
  });

  test("CONTRACT · a speaker can only read or edit a submission they participate in", async () => {
    const ownRead = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`);
    expect(ownRead.status).toBe(200);

    const otherRead = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, {}, otherSpeakerCookie);
    expect([403, 404]).toContain(otherRead.status);
    const otherWrite = await request(
      `/api/v1/me/submissions/${SUBMISSION_ID}/talk`,
      { method: "PATCH", body: JSON.stringify({ title: "Speaker B must not edit speaker A" }) },
      otherSpeakerCookie,
    );
    expect([403, 404]).toContain(otherWrite.status);

    const unchanged = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`);
    expect((await unchanged.json<{ submission: { title: string } }>()).submission.title).not.toBe("Speaker B must not edit speaker A");
  });

  test("AC-318 · a speaker cannot rewrite a live session's public content", async () => {
    const response = await request(`/api/v1/me/submissions/sub-portal-public/talk`, {
      method: "PATCH",
      body: JSON.stringify({ title: "A speaker cannot silently replace this live title" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "conflict",
        message: "This session is live on the conference site. Ask the conference organizer to unpublish it or reverse the acceptance before changing its public content.",
      },
    });
    expect(await env.DB.prepare("SELECT title FROM submissions WHERE id = 'sub-portal-public'").first()).toEqual({ title: "Public profile session" });
  });

  test("AC-237 · speaker talk edits record actor and time, close with the form, and reopen only by organizer control", async () => {
    const first = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, { method: "PATCH", body: JSON.stringify({ title: "Updated conference talk", description: "Updated description" }) });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ history: Array<{ actor_person_id: string; created_at: number }> }>();
    expect(firstBody.history[0]).toMatchObject({ actor_person_id: SPEAKER_ID });
    expect(firstBody.history[0]?.created_at).toBeTypeOf("number");
    // clock-check: allow — this is an intentional millisecond boundary transition for an exact-instant form close
    await env.DB.prepare("UPDATE forms SET status = 'closed', closes_at = ? WHERE id = ?").bind(NOW - 1, FORM_ID).run();
    const closed = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, { method: "PATCH", body: JSON.stringify({ title: "Should be blocked" }) });
    expect(closed.status).toBe(403);
    const organizer = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/talk-editing`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }, ownerCookie);
    expect(organizer.status).toBe(200);
    const reopened = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, { method: "PATCH", body: JSON.stringify({ title: "Reopened by conference" }) });
    expect(reopened.status).toBe(200);
    const reopenedBody = await reopened.json<{ history: unknown[] }>();
    expect(reopenedBody.history.length).toBeGreaterThanOrEqual(2);
  });

  test("AC-240, AC-260 · the authenticated portal carries the arrival note while the public agenda does not", async () => {
    const { body } = await portal();
    const scheduled = body.submissions.find((submission: { id: string }) => submission.id === SUBMISSION_ID);
    expect(scheduled.slot).toMatchObject({ room: "Room 101", is_published: false, show_building_comparison: false });
    expect(scheduled.slot.day).not.toBe("—");
    expect(scheduled.slot.date).not.toBe("—");
    expect(scheduled.slot.time).not.toBe("—");
    expect(scheduled.slot.location).toMatchObject({
      building: "North Hall",
      address: "1 Conference Way",
      access_note: "operator secret — never public",
      access_minutes: 5,
    });
    expect(JSON.stringify(body)).toContain("operator secret — never public");
    const publicPage = await request("/agenda?event=aie-nyc-2026", {}, "");
    const publicBody = await publicPage.text();
    expect(publicPage.status).toBe(200);
    expect(publicBody).not.toContain("operator secret — never public");

    await env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
       VALUES ('building-portal-annex', ?, 'South Hall', '2 Conference Way', 1, 40.7618, -73.9808, 2, 'Use the south lobby', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW).run();
    const twoBuilding = await portal();
    const twoBuildingScheduled = twoBuilding.body.submissions.find((submission: { id: string }) => submission.id === SUBMISSION_ID);
    expect(twoBuildingScheduled.slot).toMatchObject({ room: "Room 101 · North Hall", show_building_comparison: true });
    expect(twoBuildingScheduled.slot.location).toMatchObject({ address: "1 Conference Way", access_note: "operator secret — never public", access_minutes: 5 });
    await env.DB.prepare("DELETE FROM buildings WHERE id = 'building-portal-annex'").run();
  });

  test("CONTRACT · the session guard returns the required status and never discloses another speaker's portal data", async () => {
    const anonymous = await request("/api/v1/me/portal", {}, "");
    const anonymousBody = await anonymous.text();
    expect(anonymous.status).toBe(401);
    expect(anonymousBody).not.toContain("Other Speaker Secret");
    const speakerOne = await portal();
    expect(speakerOne.response.status).toBe(200);
    expect(JSON.stringify(speakerOne.body)).not.toContain("Other Speaker Secret");
    expect(JSON.stringify(speakerOne.body)).not.toContain("task-portal-other");
    const denied = await request("/api/v1/me/tasks/task-portal-other/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) });
    const deniedBody = await denied.text();
    expect(denied.status).toBe(404);
    expect(deniedBody).not.toContain(OTHER_PERSON_ID);
    const other = await portal(otherSpeakerCookie);
    expect(other.response.status).toBe(200);
    expect(JSON.stringify(other.body)).toContain("Other Speaker Secret");
  });

  test("CONTRACT · MRQ-286 · a helper gets a scoped magic-link portal, task attribution, and revocation", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL, completed_by_person_id = NULL, response_json = NULL, attachment_id = NULL, cancelled_at = NULL WHERE id IN ('task-portal-ack', 'task-portal-file', 'task-portal-form')"),
      env.DB.prepare("UPDATE forms SET status = 'open', closes_at = ? WHERE id = ?").bind(NOW + 3 * DAY_MS, FORM_ID),
    ]);
    const added = await request(`/api/v1/me/helpers?eventId=${EVENT_ID}`, {
      method: "POST",
      body: JSON.stringify({ name: "Typed Assistant", email: "registered.helper@example.com" }),
    });
    expect(added.status).toBe(200);
    const addedBody = await added.json<{ helper: { id: string; helper_person_id: string; helper_name: string; helper_email: string }; invite?: { magic_link?: string } }>();
    expect(addedBody.helper).toMatchObject({ helper_name: "Typed Assistant", helper_email: "registered.helper@example.com" });
    expect(addedBody.helper.helper_person_id).toBe(addedBody.helper.id);
    expect(addedBody.helper.helper_person_id).not.toBe(REGISTERED_HELPER_ID);
    expect(JSON.stringify(addedBody)).not.toContain("Private Registry Name");
    expect(addedBody.invite?.magic_link).toBeTruthy();

    const inviteUrl = new URL(addedBody.invite!.magic_link!);
    const exchanged = await request(`${inviteUrl.pathname}${inviteUrl.search}`, { redirect: "manual" }, "");
    expect(exchanged.status).toBe(302);
    const helperCookie = exchanged.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(helperCookie).toMatch(/^mq_session=/);

    const helperPortal = await request(`/api/v1/me/portal?eventId=${EVENT_ID}`, {}, helperCookie);
    expect(helperPortal.status).toBe(200);
    const helperBody = await helperPortal.json<{ seat: string; person: { name: string }; submissions: Array<{ title: string; slot: unknown }>; tasks: Array<{ id: string; kind: string }> }>();
    expect(helperBody).toMatchObject({ seat: "helper", person: { name: "Typed Assistant" } });
    expect(helperBody.tasks.map((task) => task.kind)).toEqual(expect.arrayContaining(["acknowledge", "form", "file"]));
    expect(JSON.stringify(helperBody)).not.toContain("Updated description");
    expect(JSON.stringify(helperBody)).not.toContain("Other speaker private task");

    const profileWrite = await request("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify({ bio: "helper must not edit speaker profile" }) }, helperCookie);
    expect([403, 404]).toContain(profileWrite.status);
    const talkWrite = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, { method: "PATCH", body: JSON.stringify({ title: "helper must not edit talk" }) }, helperCookie);
    expect([403, 404]).toContain(talkWrite.status);
    const otherTask = await request("/api/v1/me/tasks/task-portal-other/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) }, helperCookie);
    expect([403, 404]).toContain(otherTask.status);

    const uploaded = await request("/api/v1/me/tasks/task-portal-file/complete", { method: "POST", body: JSON.stringify({ attachment_id: "attachment-portal-file" }) }, helperCookie);
    expect(uploaded.status).toBe(200);
    const form = await request("/api/v1/me/tasks/task-portal-form/complete", { method: "POST", body: JSON.stringify({ answers: { needs_details: "no" } }) }, helperCookie);
    expect(form.status).toBe(200);

    const completed = await request("/api/v1/me/tasks/task-portal-ack/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) }, helperCookie);
    const completedText = await completed.text();
    expect(completed.status, completedText).toBe(200);
    const task = await env.DB.prepare("SELECT completed_by_person_id FROM speaker_tasks WHERE id = 'task-portal-ack'").first<{ completed_by_person_id: string }>();
    expect(task?.completed_by_person_id).toBe(REGISTERED_HELPER_ID);
    const speakerAfter = await portal();
    expect(speakerAfter.body.tasks.find((item: { id: string }) => item.id === "task-portal-ack").completed_by).toMatchObject({ name: "Typed Assistant" });
    expect(speakerAfter.body.helpers).toEqual(expect.arrayContaining([
      expect.objectContaining({ helper_name: "Typed Assistant", helper_person_id: addedBody.helper.id }),
    ]));
    expect(JSON.stringify(speakerAfter.body)).not.toContain(REGISTERED_HELPER_ID);
    const audit = await env.DB.prepare("SELECT actor_person_id, after_json FROM audit_log WHERE action = 'speaker_task.completed' AND entity_id = 'task-portal-ack' ORDER BY created_at DESC LIMIT 1").first<{ actor_person_id: string; after_json: string }>();
    expect(audit?.actor_person_id).toBe(REGISTERED_HELPER_ID);
    expect(JSON.parse(audit!.after_json)).toMatchObject({ on_behalf_of_person_id: SPEAKER_ID });

    const removed = await request(`/api/v1/me/helpers/${addedBody.helper.helper_person_id}?eventId=${EVENT_ID}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const revokedPortal = await request(`/api/v1/me/portal?eventId=${EVENT_ID}`, {}, helperCookie);
    expect([403, 404]).toContain(revokedPortal.status);
  });

  test("CONTRACT · MRQ-286 · an organizer can add and remove a helper for a speaker", async () => {
    const added = await request(`/api/v1/events/${EVENT_ID}/speakers/${SPEAKER_ID}/helpers`, {
      method: "POST",
      body: JSON.stringify({ name: "Organizer Assistant", email: "organizer.helper@example.com" }),
    }, ownerCookie);
    const addedBody = await added.json<{ helper: { id: string; helper_person_id: string; helper_name: string; helper_email: string } }>();
    expect(added.status).toBe(200);
    expect(addedBody.helper).toMatchObject({ helper_name: "Organizer Assistant", helper_email: "organizer.helper@example.com" });

    const removed = await request(`/api/v1/events/${EVENT_ID}/speakers/${SPEAKER_ID}/helpers/${addedBody.helper.helper_person_id}`, { method: "DELETE" }, ownerCookie);
    const removedText = await removed.text();
    expect(removed.status, removedText).toBe(200);
  });

});

import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_SPEAKER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";
import { verifyAndComplete } from "../../../src/lib/r2/complete";
import { policyFor, validateDeclared } from "../../../src/lib/r2/policy";
import { readImageDimensions } from "../../../src/lib/r2/sniff";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const SPEAKER_ID = DEMO_SPEAKER_PERSON_ID;
const OTHER_PERSON_ID = "per_portal_other";
const OWNER_ID = "per_demo_organizer";
const FORM_ID = "form-portal";
const SUBMISSION_ID = "sub-portal-talk";
const REVIEW_SUBMISSION_ID = "sub-portal-review";
const NOW = Date.UTC(2026, 7, 11, 15, 0, 0);

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
      `INSERT INTO buildings (id, event_id, name, address, position, access_minutes, access_note, created_at, updated_at)
       VALUES ('building-portal', ?, 'North Hall', '1 Conference Way', 0, 5, 'operator secret — never public', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-portal', ?, 'building-portal', 'Room 101', 120, 0, '[]', NULL, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
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
      ["template-portal-ack", "acknowledge", "Read the speaker agreement", null, NOW - 86_400_000],
      ["template-portal-file", "file", "Upload your deck", null, NOW + 86_400_000],
      ["template-portal-form", "form", "Complete speaker details", FORM_ID, NOW + 172_800_000],
    ].map(([id, kind, name, formId, dueAt]) => env.DB.prepare(
      `INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, EVENT_ID, name, kind, `Payload for ${name}`, dueAt, formId, kind === "file" ? JSON.stringify({ accept: ["pdf"] }) : null, Number(String(id).endsWith("ack") ? 0 : String(id).endsWith("file") ? 1 : 2), NOW, NOW)),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, last_write_source, created_at, updated_at)
       VALUES ('task-portal-ack', ?, ?, ?, 'template-portal-ack', 'Read the speaker agreement', 'acknowledge', 'Acknowledge the current speaker agreement.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-file', ?, ?, ?, 'template-portal-file', 'Upload your deck', 'file', 'Upload the requested deck file.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-form', ?, ?, ?, 'template-portal-form', 'Complete speaker details', 'form', 'Answer the visible conditional fields.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?),
              ('task-portal-other', ?, ?, ?, 'template-portal-ack', 'Other speaker private task', 'acknowledge', 'This belongs only to another speaker.', ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?)`,
    ).bind(
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW - 86_400_000, NOW, NOW,
      EVENT_ID, SPEAKER_ID, SUBMISSION_ID, NOW + 86_400_000, NOW, NOW,
      EVENT_ID, SPEAKER_ID, REVIEW_SUBMISSION_ID, NOW + 172_800_000, NOW, NOW,
      EVENT_ID, OTHER_PERSON_ID, "sub-portal-other", NOW + 86_400_000, NOW, NOW,
    ),
    env.DB.prepare(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
       VALUES ('attachment-portal-file', ?, 'task_upload', 'task-portal-file', 'uploads/portal/deck.pdf', 'deck.pdf', 'application/pdf', 10, 'ready', 'etag', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
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
    expect(body.submissions[0]).toMatchObject({ status: "in_review", wave: "Wave 2", status_label: "In Review" });
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
    expect(body.tasks[0]).toMatchObject({ title: "Read the speaker agreement", kind: "acknowledge", status: "open", due_at: NOW - 86_400_000 });
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

  test("AC-48, AC-91, AC-92, AC-94, AC-148 · completed portal work updates organizer attention and the chase matrix", async () => {
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL, due_at = ? WHERE id = 'task-portal-ack'").bind(NOW - 86_400_000).run();
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL WHERE id = 'task-portal-file'").run();
    const uploaded = await request("/api/v1/me/tasks/task-portal-file/complete", { method: "POST", body: JSON.stringify({ attachment_id: "attachment-portal-file" }) });
    expect(uploaded.status).toBe(200);
    const before = await request(`/api/v1/events/${EVENT_ID}/dashboard`, {}, ownerCookie);
    expect(before.status).toBe(200);
    const beforeBody = await before.json<{ attention: { overdue_submissions: { count: number } } }>();
    const chaseBefore = await request(`/api/v1/events/${EVENT_ID}/onboarding`, {}, ownerCookie);
    const chaseBeforeBody = await chaseBefore.json<{ rows: Array<{ cells: Record<string, { state: string; glyph: string }> }> }>();
    expect(chaseBeforeBody.rows[0]?.cells["template-portal-ack"]).toMatchObject({ state: "overdue", glyph: "!" });
    expect(chaseBeforeBody.rows[0]?.cells["template-portal-file"]).toMatchObject({ state: "done", glyph: "✓" });
    const completed = await request("/api/v1/me/tasks/task-portal-ack/complete", { method: "POST", body: JSON.stringify({ acknowledged: true }) });
    expect(completed.status).toBe(200);
    const after = await request(`/api/v1/events/${EVENT_ID}/dashboard`, {}, ownerCookie);
    const afterBody = await after.json<{ attention: { overdue_submissions: { count: number } } }>();
    expect(afterBody.attention.overdue_submissions.count).toBeLessThan(beforeBody.attention.overdue_submissions.count);
    const chaseAfter = await request(`/api/v1/events/${EVENT_ID}/onboarding`, {}, ownerCookie);
    const chaseAfterBody = await chaseAfter.json<{ rows: Array<{ cells: Record<string, { state: string; glyph: string }>; person: { id: string; name: string } }> }>();
    expect(chaseAfterBody.rows.find((row) => row.person.id === SPEAKER_ID)).toBeUndefined();
    expect(chaseAfterBody.rows.find((row) => row.person.id === OTHER_PERSON_ID)?.cells["template-portal-ack"]).toMatchObject({ state: "risk", glyph: "×" });
  });

  test("AC-49 · overdue tasks carry a textual marker and a distinct overdue data state", async () => {
    const { body } = await portal();
    const overdue = body.tasks.find((task: { id: string }) => task.id === "task-portal-ack");
    expect(overdue).toMatchObject({ overdue: false, status: "done" });
    await env.DB.prepare("UPDATE speaker_tasks SET status = 'open', completed_at = NULL, due_at = ? WHERE id = 'task-portal-ack'").bind(NOW - 86_400_000).run();
    const refreshed = await portal();
    expect(refreshed.body.tasks.find((task: { id: string }) => task.id === "task-portal-ack")).toMatchObject({ overdue: true, status: "open" });
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

  test("AC-237 · speaker talk edits record actor and time, close with the form, and reopen only by organizer control", async () => {
    const first = await request(`/api/v1/me/submissions/${SUBMISSION_ID}/talk`, { method: "PATCH", body: JSON.stringify({ title: "Updated conference talk", description: "Updated description" }) });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ history: Array<{ actor_person_id: string; created_at: number }> }>();
    expect(firstBody.history[0]).toMatchObject({ actor_person_id: SPEAKER_ID });
    expect(firstBody.history[0]?.created_at).toBeTypeOf("number");
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

  test("AC-240 · the portal schedule carries day, time, Room · Building, and no operator access note", async () => {
    const { body } = await portal();
    const scheduled = body.submissions.find((submission: { id: string }) => submission.id === SUBMISSION_ID);
    expect(scheduled.slot).toMatchObject({ room: "Room 101 · North Hall", is_published: false });
    expect(scheduled.slot.day).not.toBe("—");
    expect(scheduled.slot.date).not.toBe("—");
    expect(scheduled.slot.time).not.toBe("—");
    expect(JSON.stringify(body)).not.toContain("operator secret");
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

});

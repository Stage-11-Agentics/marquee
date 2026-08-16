import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_ORGANIZER_PERSON_ID, DEMO_SPEAKER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const OWNER_ID = DEMO_ORGANIZER_PERSON_ID;
const SPEAKER_ID = DEMO_SPEAKER_PERSON_ID;
const OTHER_ID = "per_mrq38_other";
const SUB_DECLINE = "sub-mrq38-decline";
const SUB_DECLINE_NO_NOTE = "sub-mrq38-decline-no-note";
const SUB_TWO_ROLES = "sub-mrq38-two-roles";
const SUB_SINGLE = "sub-mrq38-single";
const SUB_NO_FEEDBACK = "sub-mrq38-no-feedback";
const BULK_IDS = ["sub-mrq38-bulk-1", "sub-mrq38-bulk-2", "sub-mrq38-bulk-3"];
// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();

let speakerCookie = "";
let otherSpeakerCookie = "";
let ownerCookie = "";

async function request(path: string, init: RequestInit = {}, cookie = speakerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function requestDecision(submissionId: string, body: Record<string, unknown>, cookie = ownerCookie): Promise<Response> {
  const plan = await request(`/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision-plan`, {
    method: "POST",
    body: JSON.stringify(body),
  }, cookie);
  expect(plan.status).toBe(200);
  const planBody = await plan.json<{ plan_fingerprint: string; etag: string }>();
  return request(`/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision`, {
    method: "POST",
    headers: { "if-match": planBody.etag },
    body: JSON.stringify({ ...body, plan_fingerprint: planBody.plan_fingerprint }),
  }, cookie);
}

async function requestBulkDecision(body: Record<string, unknown>, cookie = ownerCookie): Promise<Response> {
  const plan = await request(`/api/v1/events/${EVENT_ID}/submissions/decision-plan`, {
    method: "POST",
    body: JSON.stringify(body),
  }, cookie);
  expect(plan.status).toBe(200);
  const planBody = await plan.json<{ plan_fingerprint: string; etag: string }>();
  return request(`/api/v1/events/${EVENT_ID}/submissions/bulk`, {
    method: "POST",
    headers: { "if-match": planBody.etag },
    body: JSON.stringify({ ...body, plan_fingerprint: planBody.plan_fingerprint }),
  }, cookie);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();

  const submissions = [
    [SUB_DECLINE, "accepted", "Declineable conference role"],
    [SUB_DECLINE_NO_NOTE, "accepted", "Declineable role without a note"],
    [SUB_TWO_ROLES, "accepted", "Two independent conference roles"],
    [SUB_SINGLE, "in_review", "Single decision with feedback"],
    [SUB_NO_FEEDBACK, "in_review", "Single decision without feedback"],
    ...BULK_IDS.map((id, index) => [id, "in_review", `Bulk accepted session ${index + 1}`]),
  ] as const;
  const participations = [
    ["part-mrq38-decline", SUB_DECLINE, "speaker", 0],
    ["part-mrq38-decline-no-note", SUB_DECLINE_NO_NOTE, "speaker", 0],
    ["part-mrq38-speaker-role", SUB_TWO_ROLES, "speaker", 0],
    ["part-mrq38-moderator-role", SUB_TWO_ROLES, "moderator", 1],
    ["part-mrq38-single", SUB_SINGLE, "speaker", 0],
    ["part-mrq38-no-feedback", SUB_NO_FEEDBACK, "speaker", 0],
    ...BULK_IDS.map((submissionId, index) => [`part-mrq38-bulk-${index + 1}`, submissionId, "speaker", 0] as const),
  ] as const;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'marquee', ?, ?)`,
    ).bind(OTHER_ID, DEMO_ORGANIZATION_ID, "other-mrq38@example.test", "Other Speaker", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'speaker', ?, ?)`,
    ).bind("mem-mrq38-other", DEMO_ORGANIZATION_ID, EVENT_ID, OTHER_ID, NOW, NOW),
    ...submissions.map(([id, status, title]) => env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, abstract, status, origin, submitter_person_id, submitted_at, created_at, updated_at)
       VALUES (?, ?, 'session', ?, ?, ?, 'admin', ?, ?, ?, ?)`,
    ).bind(id, EVENT_ID, title, `${title} abstract`, status, SPEAKER_ID, NOW, NOW, NOW)),
    ...participations.map(([id, submissionId, role, position]) => env.DB.prepare(
      `INSERT INTO participations
        (id, submission_id, person_id, role, position, confirmation_status, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    ).bind(id, submissionId, SPEAKER_ID, role, position, NOW, NOW)),
    env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
       VALUES ('building-mrq38', ?, 'North Hall', '1 Conference Way', 0, 40.7625, -73.9814, 0, 'Use the North Hall security desk', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-mrq38', ?, 'building-mrq38', 'Room 101', 100, 0, '[]', NULL, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    // clock-check: allow — agenda starts_at is an exact schedule instant, not an event-local calendar deadline
    env.DB.prepare(
      `INSERT INTO agenda_items
        (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
       VALUES ('agenda-mrq38-decline', ?, ?, 'session', NULL, ?, 30, 'room-mrq38', NULL, 0, ?, ?)`,
    ).bind(EVENT_ID, SUB_DECLINE, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
       VALUES ('building-mrq64-current', ?, 'South Annex', '2 Conference Way', 1, 40.7586, -73.9861, 3, 'Use the south lobby for conference access', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-mrq64-current', ?, 'building-mrq64-current', 'Room 201', 100, 0, '[]', NULL, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    // clock-check: allow — agenda starts_at is an exact schedule instant, not an event-local calendar deadline
    env.DB.prepare(
      `INSERT INTO agenda_items
        (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
       VALUES ('agenda-mrq64-current', ?, ?, 'session', NULL, ?, 30, 'room-mrq64-current', NULL, 0, ?, ?)`,
    ).bind(EVENT_ID, SUB_NO_FEEDBACK, NOW + 86_400_000 + 120 * 60_000, NOW, NOW),
  ]);

  const speakerSession = await createSession(env.DB, { personId: SPEAKER_ID, roleHint: "speaker", userAgent: "mrq38-test", now: NOW });
  const otherSession = await createSession(env.DB, { personId: OTHER_ID, roleHint: "speaker", userAgent: "mrq38-test", now: NOW });
  const ownerSession = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq38-test", now: NOW });
  speakerCookie = `mq_session=${speakerSession.id}`;
  otherSpeakerCookie = `mq_session=${otherSession.id}`;
  ownerCookie = `mq_session=${ownerSession.id}`;
}

async function portal(cookie = speakerCookie): Promise<{ response: Response; body: any }> {
  const response = await request("/api/v1/me/portal", {}, cookie);
  return { response, body: await response.json() };
}

describe.sequential("MRQ-38 role confirmation and decision feedback", () => {
  beforeAll(seedFixture, 15_000);

  test("AC-152 + AC-153 · each authenticated role responds independently and a different speaker changes nothing", async () => {
    const wrongRole = await request(`/api/v1/me/participations/part-mrq38-speaker-role/confirm`, { method: "POST" }, otherSpeakerCookie);
    expect(wrongRole.status).toBe(404);
    const unchanged = await env.DB.prepare(
      "SELECT id, confirmation_status FROM participations WHERE submission_id = ? ORDER BY position",
    ).bind(SUB_TWO_ROLES).all<{ id: string; confirmation_status: string }>();
    expect(unchanged.results).toEqual([
      { id: "part-mrq38-speaker-role", confirmation_status: "pending" },
      { id: "part-mrq38-moderator-role", confirmation_status: "pending" },
    ]);

    const first = await request(`/api/v1/me/participations/part-mrq38-speaker-role/confirm`, { method: "POST" });
    expect(first.status).toBe(200);
    const afterFirst = await env.DB.prepare(
      "SELECT id, confirmation_status FROM participations WHERE submission_id = ? ORDER BY position",
    ).bind(SUB_TWO_ROLES).all<{ id: string; confirmation_status: string }>();
    expect(afterFirst.results).toEqual([
      { id: "part-mrq38-speaker-role", confirmation_status: "confirmed" },
      { id: "part-mrq38-moderator-role", confirmation_status: "pending" },
    ]);
    const leadAfterFirst = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUB_TWO_ROLES}`, {}, ownerCookie);
    expect(leadAfterFirst.status).toBe(200);
    const leadAfterFirstBody = await leadAfterFirst.json<{ participants: Array<{ role: string; confirmation_status: string }> }>();
    expect(leadAfterFirstBody.participants.map((participant) => [participant.role, participant.confirmation_status])).toEqual([
      ["speaker", "confirmed"],
      ["moderator", "pending"],
    ]);

    const second = await request(`/api/v1/me/participations/part-mrq38-moderator-role/confirm`, { method: "POST" });
    expect(second.status).toBe(200);
    const afterSecond = await env.DB.prepare(
      "SELECT id, confirmation_status FROM participations WHERE submission_id = ? ORDER BY position",
    ).bind(SUB_TWO_ROLES).all<{ id: string; confirmation_status: string }>();
    expect(afterSecond.results.every((row) => row.confirmation_status === "confirmed")).toBe(true);
    const snapshot = await portal();
    expect(snapshot.response.status).toBe(200);
    const portalRoles = snapshot.body.submissions.find((submission: { id: string }) => submission.id === SUB_TWO_ROLES).participations;
    expect(portalRoles).toHaveLength(2);
    expect(portalRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "part-mrq38-speaker-role", role: "speaker", confirmation_status: "confirmed" }),
      expect.objectContaining({ id: "part-mrq38-moderator-role", role: "moderator", confirmation_status: "confirmed" }),
    ]));
    const leadRecord = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUB_TWO_ROLES}`, {}, ownerCookie);
    expect(leadRecord.status).toBe(200);
    const leadRecordBody = await leadRecord.json<{ participants: Array<{ role: string; confirmation_status: string }> }>();
    expect(leadRecordBody.participants.map((participant) => [participant.role, participant.confirmation_status])).toEqual([
      ["speaker", "confirmed"],
      ["moderator", "confirmed"],
    ]);

    const repeat = await request(`/api/v1/me/participations/part-mrq38-speaker-role/confirm`, { method: "POST" });
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ changed: false, participation: { confirmation_status: "confirmed" } });
    const conflicting = await request(`/api/v1/me/participations/part-mrq38-speaker-role/decline`, {
      method: "POST",
      body: JSON.stringify({ note: "Should be rejected" }),
    });
    expect(conflicting.status).toBe(409);
    const afterConflict = await env.DB.prepare(
      "SELECT id, confirmation_status FROM participations WHERE submission_id = ? ORDER BY position",
    ).bind(SUB_TWO_ROLES).all<{ id: string; confirmation_status: string }>();
    expect(afterConflict.results).toEqual([
      { id: "part-mrq38-speaker-role", confirmation_status: "confirmed" },
      { id: "part-mrq38-moderator-role", confirmation_status: "confirmed" },
    ]);

    const beforeAccepted = await env.DB.prepare(
      "SELECT confirmation_status FROM participations WHERE id = ?",
    ).bind("part-mrq38-single").first<{ confirmation_status: string }>();
    expect(beforeAccepted?.confirmation_status).toBe("pending");
    const tooEarly = await request(`/api/v1/me/participations/part-mrq38-single/confirm`, { method: "POST" });
    expect(tooEarly.status).toBe(409);
    const afterTooEarly = await env.DB.prepare(
      "SELECT confirmation_status FROM participations WHERE id = ?",
    ).bind("part-mrq38-single").first<{ confirmation_status: string }>();
    expect(afterTooEarly?.confirmation_status).toBe("pending");
  });

  test("AC-154 · declining flags the agenda, records the role, and notifies the program lead through demo-safe outbox", async () => {
    const response = await request(`/api/v1/me/participations/part-mrq38-decline/decline`, {
      method: "POST",
      body: JSON.stringify({ note: "Schedule conflict" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: true, participation: { confirmation_status: "declined", role: "speaker" } });

    const agenda = await request(`/api/v1/events/${EVENT_ID}/agenda`, {}, ownerCookie);
    expect(agenda.status).toBe(200);
    const agendaBody = await agenda.json<{ sessions: Array<{ submission_id: string; has_declined_participant: boolean; speakers: Array<{ confirmation_status: string }> }> }>();
    expect(agendaBody.sessions.find((session) => session.submission_id === SUB_DECLINE)).toMatchObject({
      has_declined_participant: true,
      speakers: [{ confirmation_status: "declined" }],
    });

    const notice = await env.DB.prepare(
      `SELECT person_id, entity_id, send_policy, text FROM outbox
       WHERE event_id = ? AND template_key = 'custom' AND entity_id = ?`,
    ).bind(EVENT_ID, "part-mrq38-decline").first<{ person_id: string; entity_id: string; send_policy: string; text: string }>();
    expect(notice).toMatchObject({ person_id: OWNER_ID, entity_id: "part-mrq38-decline", send_policy: "demo_safe" });
    expect(notice?.text).toContain("declined the speaker role");
    expect(notice?.text).toContain("Schedule conflict");

    const audit = await env.DB.prepare(
      `SELECT action, before_json, after_json FROM audit_log
       WHERE event_id = ? AND action = 'participation.declined' AND entity_id = ?`,
    ).bind(EVENT_ID, SUB_DECLINE).first<{ action: string; before_json: string; after_json: string }>();
    expect(audit?.action).toBe("participation.declined");
    expect(JSON.parse(audit?.before_json ?? "{}")).toMatchObject({ participation_id: "part-mrq38-decline", confirmation_status: "pending" });
    expect(JSON.parse(audit?.after_json ?? "{}")).toMatchObject({ participation_id: "part-mrq38-decline", confirmation_status: "declined", note: "Schedule conflict" });

    const noNote = await request(`/api/v1/me/participations/part-mrq38-decline-no-note/decline`, { method: "POST", body: JSON.stringify({}) });
    expect(noNote.status).toBe(200);
    expect(await noNote.json()).toMatchObject({ changed: true, participation: { confirmation_status: "declined" } });
    const noNoteNotice = await env.DB.prepare(
      "SELECT text FROM outbox WHERE event_id = ? AND template_key = 'custom' AND entity_id = ?",
    ).bind(EVENT_ID, "part-mrq38-decline-no-note").first<{ text: string }>();
    expect(noNoteNotice?.text).toContain("declined the speaker role");
    expect(noNoteNotice?.text).not.toContain("Note from the speaker");
    const unrelated = await env.DB.prepare(
      "SELECT id, confirmation_status FROM participations WHERE submission_id = ? ORDER BY position",
    ).bind(SUB_TWO_ROLES).all<{ id: string; confirmation_status: string }>();
    expect(unrelated.results.every((row) => row.confirmation_status === "confirmed")).toBe(true);

    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUB_DECLINE}`, {}, ownerCookie);
    expect(record.status).toBe(200);
    const recordBody = await record.json<{ participants: Array<{ role: string; confirmation_status: string }> }>();
    expect(recordBody.participants).toEqual([expect.objectContaining({ role: "speaker", confirmation_status: "declined" })]);
  });

  test("AC-235 · single and bulk decisions write one decision row, render feedback once, and the portal reads those exact rows", async () => {
    const single = await requestDecision(SUB_SINGLE, { recommendation: "approve", feedback_md: "Line one\r\nLine two  " });
    expect(single.status).toBe(200);
    const singleResult = await single.json<{ decision_id: string; outbox_id: string | null }>();
    const singleDecision = await env.DB.prepare(
      "SELECT id, feedback_md, outbox_id FROM submission_decisions WHERE id = ?",
    ).bind(singleResult.decision_id).first<{ id: string; feedback_md: string | null; outbox_id: string | null }>();
    expect(singleDecision).toEqual({ id: singleResult.decision_id, feedback_md: "Line one\nLine two", outbox_id: singleResult.outbox_id });
    const singleOutbox = await env.DB.prepare("SELECT text, html, send_policy FROM outbox WHERE id = ?").bind(singleResult.outbox_id).first<{ text: string; html: string; send_policy: string }>();
    expect(singleOutbox?.send_policy).toBe("demo_safe");
    expect(singleOutbox?.text).toContain("Line one\nLine two");
    expect(singleOutbox?.text).toContain("AIE NYC 2026");
    expect(singleOutbox?.text).toMatch(/https:\/\/marquee\.stage11\.dev\/api\/v1\/auth\/exchange\?token=/);
    expect(singleOutbox?.text).not.toContain("{{portal.link}}");
    expect(singleOutbox?.html).toContain("AIE NYC 2026");

    const noFeedback = await requestDecision(SUB_NO_FEEDBACK, { recommendation: "approve" });
    expect(noFeedback.status).toBe(200);
    const noFeedbackDecision = await env.DB.prepare(
      "SELECT feedback_md FROM submission_decisions WHERE submission_id = ?",
    ).bind(SUB_NO_FEEDBACK).first<{ feedback_md: string | null }>();
    expect(noFeedbackDecision?.feedback_md).toBeNull();

    const bulk = await requestBulkDecision({ selector: { ids: BULK_IDS }, action: "accept", feedback_md: "Shared bulk note" });
    expect(bulk.status).toBe(200);
    const bulkResult = await bulk.json<{ succeeded: number; outbox_enqueued: number }>();
    expect(bulkResult).toMatchObject({ succeeded: 3, outbox_enqueued: 3 });

    const decisions = await env.DB.prepare(
      `SELECT id, submission_id, feedback_md, outbox_id FROM submission_decisions
       WHERE event_id = ? AND submission_id IN (?, ?, ?) ORDER BY submission_id`,
    ).bind(EVENT_ID, ...BULK_IDS).all<{ id: string; submission_id: string; feedback_md: string | null; outbox_id: string | null }>();
    expect(decisions.results).toHaveLength(3);
    expect(decisions.results.every((row) => row.feedback_md === "Shared bulk note" && row.outbox_id !== null)).toBe(true);
    const acceptanceOutbox = await env.DB.prepare(
      `SELECT entity_id, person_id, send_policy, text FROM outbox
       WHERE event_id = ? AND template_key = 'acceptance' AND entity_id IN (?, ?, ?) ORDER BY entity_id`,
    ).bind(EVENT_ID, ...BULK_IDS).all<{ entity_id: string; person_id: string; send_policy: string; text: string }>();
    expect(acceptanceOutbox.results).toHaveLength(3);
    expect(acceptanceOutbox.results.every((row) => row.person_id === SPEAKER_ID && row.send_policy === "demo_safe" && row.text.includes("Shared bulk note"))).toBe(true);

    const snapshot = await portal();
    expect(snapshot.response.status).toBe(200);
    const portalRows = snapshot.body.submissions.filter((submission: { id: string }) => BULK_IDS.includes(submission.id));
    expect(portalRows).toHaveLength(3);
    for (const row of portalRows as Array<{ id: string; decision_feedback: { id: string; markdown: string } }>) {
      const decision = decisions.results.find((candidate) => candidate.submission_id === row.id);
      expect(row.decision_feedback).toEqual({ id: decision?.id, markdown: "Shared bulk note", decided_at: expect.any(Number) });
      expect(decision?.outbox_id).not.toBeNull();
    }
    const noFeedbackPortalRow = snapshot.body.submissions.find((submission: { id: string }) => submission.id === SUB_NO_FEEDBACK);
    expect(noFeedbackPortalRow.decision_feedback).toBeNull();
  });

  test("AC-236 · the record message consumer uses the shared seam, is demo-safe, is logged once, and empty selection cannot bulk-send", async () => {
    const body = {
      selector: { submission_ids: [SUB_SINGLE], person_ids: [SPEAKER_ID], role: "speaker" },
      subject: "Hello {{speaker.first_name}}",
      body: "Hi {{speaker.first_name}},\n\n{{submission.title}}",
    };
    const first = await request(`/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      headers: { "Idempotency-Key": "mrq226-compose-1" },
      body: JSON.stringify(body),
    }, ownerCookie);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ selected: 1, queued: 1, duplicate: 0, outbox_rows: [expect.objectContaining({ entity_id: SUB_SINGLE, person_id: SPEAKER_ID, inserted: true })] });
    const message = await env.DB.prepare(
      `SELECT id, subject, text, send_policy FROM outbox
       WHERE event_id = ? AND template_key = 'custom' AND entity_id = ? AND person_id = ?`,
    ).bind(EVENT_ID, SUB_SINGLE, SPEAKER_ID).first<{ id: string; subject: string; text: string; send_policy: string }>();
    expect(message).toMatchObject({ subject: "Hello Demo", text: "Hi Demo,\n\nSingle decision with feedback", send_policy: "demo_safe" });
    const audit = await env.DB.prepare(
      `SELECT action, entity_id, after_json, request_id FROM audit_log
       WHERE event_id = ? AND action = 'submission.message_queued' AND entity_id = ?`,
    ).bind(EVENT_ID, SUB_SINGLE).first<{ action: string; entity_id: string; after_json: string; request_id: string | null }>();
    expect(audit?.action).toBe("submission.message_queued");
    expect(JSON.parse(audit?.after_json ?? "{}")).toMatchObject({ outbox_id: message?.id, person_id: SPEAKER_ID, template_key: "custom" });
    // The join this column exists for: the audit row names the same request the
    // caller was handed, so one id reaches both the change and the log line.
    const auditRequestId = first.headers.get("x-request-id");
    expect(auditRequestId).toBeTruthy();
    expect(audit?.request_id).toBe(auditRequestId);

    const repeated = await request(`/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      headers: { "Idempotency-Key": "mrq226-compose-1" },
      body: JSON.stringify(body),
    }, ownerCookie);
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toMatchObject({ selected: 1, queued: 1, duplicate: 0 });

    // The same compose can be retried with its durable key, while a new
    // nudge with no key is a new send even when the recipient and copy match.
    const newNudge = await request(`/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      body: JSON.stringify(body),
    }, ownerCookie);
    expect(newNudge.status).toBe(202);
    expect(await newNudge.json()).toMatchObject({ selected: 1, queued: 1, duplicate: 0 });
    const messageCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ? AND template_key = 'custom' AND entity_id = ? AND person_id = ?",
    ).bind(EVENT_ID, SUB_SINGLE, SPEAKER_ID).first<{ total: number }>();
    expect(messageCount?.total).toBe(2);

    const empty = await request(`/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      body: JSON.stringify({ selector: { submission_ids: [], person_ids: [SPEAKER_ID], role: "speaker" }, subject: "Must not send", body: "Must not send" }),
    }, ownerCookie);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { code: "malformed_request", field: "selector.submission_ids" } });
    const afterEmpty = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ? AND template_key = 'custom' AND entity_id = ?",
    ).bind(EVENT_ID, SUB_SINGLE).first<{ total: number }>();
    expect(afterEmpty?.total).toBe(2);
  });

  test("AC-261 · place merge fields render through preview, while unknown fields block delivery", async () => {
    const body = {
      subject: "Where to be: {{session.room}} · {{session.building}}",
      body: "{{session.title}}\n{{session.room}}\n{{session.building}}\n{{session.address}}\n{{session.accessNote}}\nLeave by {{session.leaveBy}}\nUnknown {{session.not_a_field}}",
    };
    const preview = await request(`/api/v1/events/${EVENT_ID}/comms/preview`, {
      method: "POST",
      body: JSON.stringify({ person_id: SPEAKER_ID, submission_id: SUB_NO_FEEDBACK, role: "speaker", ...body }),
    }, ownerCookie);
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json<{ subject: string; text: string; html: string; to_email: string }>();
    const previewBody = { subject: previewPayload.subject, text: previewPayload.text, html: previewPayload.html };
    expect(previewBody.text).toContain("Room 201");
    expect(previewBody.text).toContain("South Annex");
    expect(previewBody.text).toContain("2 Conference Way");
    expect(previewBody.text).toContain("Use the south lobby for conference access");
    expect(previewBody.text).toContain("Leave by");
    expect(previewBody.text).toContain("{{session.not_a_field}}");

    const sent = await request(`/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      body: JSON.stringify({ selector: { submission_ids: [SUB_NO_FEEDBACK], person_ids: [SPEAKER_ID], role: "speaker" }, ...body }),
    }, ownerCookie);
    expect(sent.status).toBe(400);
    expect(await sent.text()).toContain("session.not_a_field");
    const delivered = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ? AND template_key = 'custom' AND entity_id = ? AND person_id = ?",
    ).bind(EVENT_ID, SUB_NO_FEEDBACK, SPEAKER_ID).first<{ total: number }>();
    expect(delivered?.total).toBe(0);
  });
});

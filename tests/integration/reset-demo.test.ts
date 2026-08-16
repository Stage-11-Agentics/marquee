import {
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";

import { app } from "../../src/index";
import { RESET_DEMO_MESSAGE_TYPE } from "../../src/routes/admin-ops.routes";
import worker from "../../src/index";
import {
  SHIPPED_DEMO_EVENT_ID as DEMO_EVENT_ID,
  SHIPPED_DEMO_ORGANIZATION_ID as DEMO_ORGANIZATION_ID,
  SHIPPED_DEMO_ORGANIZER_PERSON_ID as DEMO_ORGANIZER_PERSON_ID,
  SHIPPED_DEMO_SPEAKER_PERSON_ID as DEMO_SPEAKER_PERSON_ID,
} from "../../src/lib/reset-demo/demo-fixture";
import { reseedDemo, WIPE_ORDER } from "../../src/lib/reset-demo/reseed-demo";
import { createResetJob, readResetJob } from "../../src/lib/reset-demo/reset-jobs";
import { runResetJob } from "../../src/lib/reset-demo/reset-consumer";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16);
const DEMO_OBJECT_KEY = "uploads/" + DEMO_EVENT_ID + "/task_upload/dirty-attachment.bin";
const UNRELATED_ORG_ID = "org_unrelated_reset";
const UNRELATED_EVENT_ID = "evt_unrelated_reset";
const UNRELATED_PERSON_ID = "per_unrelated_reset";
const UNRELATED_SUBMISSION_ID = "sub_unrelated_reset";
const UNRELATED_OBJECT_KEY = "uploads/" + UNRELATED_EVENT_ID + "/event_logo/unrelated-logo.png";

const SEEDED_COUNTS: Record<string, number> = {
  webhook_deliveries: 0,
  webhook_endpoints: 0,
  submission_notes: 0,
  submission_decisions: 680,
  submission_answers: 4091,
  submission_tracks: 1156,
  participations: 1027,
  evaluations: 62,
  comparisons: 0,
  // 102 organizer/agent rows plus the committee's 100 abstracts materialized at
  // the round's three reviews each (MRQ-169: pools produce rows, never blankets).
  round_assignments: 402,
  round_promotions: 0,
  rubric_criteria: 7,
  evaluation_rounds: 2,
  evaluation_plans: 1,
  committee_members: 4,
  committees: 1,
  reviewer_track_scopes: 40,
  saved_views: 0,
  // One row, and it earns its place: the reason the Gold sponsorship's banner
  // deliverable was cancelled, written through the same audit shape the
  // withdrawal cascade uses, which is where the portal reads "why" from.
  audit_log: 1,
  file_comments: 0,
  calendar_cancellations: 0,
  calendar_invites: 0,
  calendar_sequence_ledger: 0,
  outbox_calendar_parts: 0,
  submission_reference_ledger: 1,
  speaker_tasks: 358,
  task_templates: 15,
  agenda_items: 27,
  embeds: 0,
  // Attendee-created, never seeded: a fresh demo has nobody's schedule in it,
  // nobody's stars, and nobody's email attached to either.
  public_schedules: 0,
  schedule_claims: 0,
  session_star_beacons: 0,
  event_attendances: 0,
  import_rows: 0,
  imports: 0,
  submissions: 1003,
  // Sponsor Sessions are guaranteed placements outside the 1,000-row competitive
  // pool (SPEC Amendment 23), which is why `submissions` is 1,003 rather than
  // 1,000 while every competitive count is unchanged.
  sponsorship_contacts: 4,
  sponsorships: 2,
  sponsor_tiers: 3,
  form_admins: 0,
  form_fields: 33,
  field_library: 2,
  form_length_rules: 0,
  forms: 7,
  email_templates: 0,
  outbox: 0,
  routing_rules: 0,
  waves: 3,
  rooms: 10,
  buildings: 3,
  tracks: 8,
  formats: 4,
  magic_links: 0,
  auth_sessions: 0,
  api_tokens: 1,
  memberships: 163,
  // Lists remain organizer-authored, but the demo includes two org-level
  // Outreach cards so the board demonstrates one funnel aimed at two events.
  // A reset must still sweep the append-only log, or a note/card would outlive
  // the person it is about.
  person_list_members: 0,
  person_lists: 0,
  person_events: 2,
  people: 1109,
  // Org-scoped like people, and swept after them: `people.company_id` points here.
  companies: 2,
  attachments: 40,
  event_settings: 0,
  mirror_credentials: 0,
  mirror_outbox: 0,
  mirror_state: 0,
  events: 2,
  organizations: 1,
};

const UNRELATED_COUNTS: Record<string, number> = {
  webhook_deliveries: 1,
  webhook_endpoints: 1,
  submissions: 1,
  memberships: 1,
  people: 1,
  attachments: 1,
  events: 1,
  organizations: 1,
  mirror_outbox: 1,
};

beforeEach(async () => {
  await applyMigrations();
  await env.MEDIA.delete([DEMO_OBJECT_KEY, UNRELATED_OBJECT_KEY]);
});

async function dispatchResetJob(jobId: string, mirrorSend: (message: unknown) => void) {
  const batch = createMessageBatch("operations-queue", [
    { id: "msg-" + jobId, timestamp: new Date(), attempts: 1, body: { type: RESET_DEMO_MESSAGE_TYPE, job_id: jobId } },
  ]);
  const ctx = createExecutionContext();
  const testEnv = { ...env, MIRROR_QUEUE: { send: mirrorSend } as unknown as typeof env.MIRROR_QUEUE };
  await worker.queue?.(batch, testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

async function tableCounts(): Promise<Record<string, number>> {
  const results = await env.DB.batch(
    WIPE_ORDER.map((table) => env.DB.prepare("SELECT COUNT(*) AS n FROM " + table)),
  );
  return Object.fromEntries(
    WIPE_ORDER.map((table, index) => [
      table,
      Number((results[index]?.results[0] as { n?: unknown } | undefined)?.n ?? 0),
    ]),
  );
}

function expectedCountsAfterReset(): Record<string, number> {
  return Object.fromEntries(
    WIPE_ORDER.map((table) => [
      table,
      SEEDED_COUNTS[table]! + (UNRELATED_COUNTS[table] ?? 0),
    ]),
  );
}

async function demoLogin(role: "organizer" | "speaker"): Promise<Response> {
  return app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role }),
    headers: { "content-type": "application/json" },
  }, env);
}

async function dirtyDemoState(): Promise<void> {
  const inReview = await env.DB.prepare(
    "SELECT id FROM submissions WHERE event_id = ? AND status = 'in_review' ORDER BY id LIMIT 2",
  ).bind(DEMO_EVENT_ID).all<{ id: string }>();
  expect(inReview.results.length).toBe(2);

  const openTask = await env.DB.prepare(
    "SELECT id FROM speaker_tasks WHERE event_id = ? AND status = 'open' ORDER BY id LIMIT 1",
  ).bind(DEMO_EVENT_ID).first<{ id: string }>();
  expect(openTask).not.toBeNull();

  const unplaced = await env.DB.prepare(
    "SELECT s.id, s.primary_track_id FROM submissions s " +
    "LEFT JOIN agenda_items a ON a.submission_id = s.id " +
    "WHERE s.event_id = ? AND s.status = 'accepted' AND s.kind = 'session' AND a.id IS NULL " +
    "ORDER BY s.id LIMIT 1",
  ).bind(DEMO_EVENT_ID).first<{ id: string; primary_track_id: string }>();
  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE event_id = ? ORDER BY id LIMIT 1",
  ).bind(DEMO_EVENT_ID).first<{ id: string }>();
  expect(unplaced).not.toBeNull();
  expect(room).not.toBeNull();

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE submissions SET status = 'accepted', decided_at = ?, decided_by_person_id = ?, updated_at = ? WHERE id = ?",
    ).bind(NOW, DEMO_ORGANIZER_PERSON_ID, NOW, inReview.results[0]!.id),
    env.DB.prepare(
      "UPDATE submissions SET status = 'rejected', decided_at = ?, decided_by_person_id = ?, updated_at = ? WHERE id = ?",
    ).bind(NOW, DEMO_ORGANIZER_PERSON_ID, NOW, inReview.results[1]!.id),
    env.DB.prepare(
      "INSERT INTO submission_notes (id, submission_id, author_person_id, body_md, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind("submission-note-dirty", inReview.results[0]!.id, DEMO_ORGANIZER_PERSON_ID, "Dirty internal note", NOW),
    env.DB.prepare(
      "INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, outbox_id, created_at, updated_at) VALUES (?, ?, ?, 'approve', 'accepted', 'Dirty accept', ?, ?, NULL, ?, ?)",
    ).bind("decision-dirty-accept", DEMO_EVENT_ID, inReview.results[0]!.id, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, outbox_id, created_at, updated_at) VALUES (?, ?, ?, 'deny', 'rejected', 'Dirty reject', ?, ?, NULL, ?, ?)",
    ).bind("decision-dirty-reject", DEMO_EVENT_ID, inReview.results[1]!.id, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, NOW),
    env.DB.prepare(
      "UPDATE speaker_tasks SET status = 'done', completed_at = ?, response_json = ?, updated_at = ? WHERE id = ?",
    ).bind(NOW, JSON.stringify({ dirty: true }), NOW, openTask!.id),
    env.DB.prepare(
      "INSERT INTO agenda_items (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', NULL, ?, 45, ?, ?, 1, ?, ?)",
    ).bind("agenda-dirty-published", DEMO_EVENT_ID, unplaced!.id, NOW, room!.id, unplaced!.primary_track_id, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO outbox (id, event_id, template_key, person_id, to_email, subject, html, text, ics_uid, ics_body, status, send_policy, suppressed_reason, idempotency_key, provider_message_id, error, scheduled_for, sent_at, created_at, updated_at, entity_id) VALUES (?, ?, 'reminder', ?, ?, 'Dirty reminder', '<p>Dirty reminder</p>', 'Dirty reminder', NULL, NULL, 'queued', 'demo_safe', NULL, ?, NULL, NULL, ?, NULL, ?, ?, NULL)",
    ).bind("outbox-dirty-reminder", DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, "program.committee@example.com", "dirty-reminder", NOW, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO saved_views (id, event_id, person_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, 'Dirty saved view', ?, ?, ?)",
    ).bind("saved-view-dirty", DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, JSON.stringify({ status: ["rejected"] }), NOW, NOW),
    env.DB.prepare(
      "INSERT INTO imports (id, event_id, source, file_key, mapping, status, undone_at, created_at, updated_at) VALUES (?, ?, 'sessionize', ?, '{}', 'completed', NULL, ?, ?)",
    ).bind("import-dirty", DEMO_EVENT_ID, "uploads/" + DEMO_EVENT_ID + "/import/dirty.json", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO import_rows (id, import_id, row_index, entity, outcome, reason, target_id, before_json, created_at, updated_at) VALUES (?, ?, 0, 'submission', 'created', NULL, ?, NULL, ?, ?)",
    ).bind("import-row-dirty", "import-dirty", "dirty-target", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO webhook_endpoints (id, event_id, url, secret_hash, events_json, enabled, created_at, last_delivery_at) VALUES (?, ?, 'https://hooks.example.test/marquee', 'dirty-secret', '[\"submission.created\"]', 1, ?, NULL)",
    ).bind("webhook-dirty", DEMO_EVENT_ID, NOW),
    env.DB.prepare(
      "INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, created_at) VALUES (?, ?, 'submission.created', '{}', 'queued', ?)",
    ).bind("webhook-delivery-dirty", "webhook-dirty", NOW),
    env.DB.prepare(
      "INSERT INTO mirror_outbox (id, table_name, row_id, op, payload, status, created_at, updated_at) VALUES (?, 'submissions', ?, 'upsert', ?, 'queued', ?, ?)",
    ).bind("mirror-dirty", inReview.results[0]!.id, JSON.stringify({ event_id: DEMO_EVENT_ID }), NOW, NOW),
    // MRQ-208. The demo is exactly where anonymous stars and claimed schedules
    // land, and a wipe that walked past them would delete the sessions and
    // people they reference and abort the whole batch — leaving a demo that can
    // never be reset again, with a real email address in it. Asserting zero
    // afterwards proves nothing unless something is here to remove.
    env.DB.prepare(
      "INSERT INTO public_schedules (code, event_id, session_ids, write_key_hash, from_device, created_at, updated_at) VALUES (?, ?, ?, 'dirty-hash', 1, ?, ?)",
    ).bind("MQ-DIRTYSCHEDULE", DEMO_EVENT_ID, JSON.stringify([unplaced!.id]), NOW, NOW),
    env.DB.prepare(
      "INSERT INTO session_star_beacons (event_id, session_id, device_hash, created_at) VALUES (?, ?, ?, ?)",
    ).bind(DEMO_EVENT_ID, unplaced!.id, "d".repeat(32), NOW),
    env.DB.prepare(
      "INSERT INTO event_attendances (id, person_id, event_id, source, schedule_code, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'claim', ?, ?, ?, ?)",
    ).bind("attendance-dirty", DEMO_ORGANIZER_PERSON_ID, DEMO_EVENT_ID, "MQ-DIRTYSCHEDULE", NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO schedule_claims (code, event_id, email, token_hash, pending_write_key, feed_token, person_id, minted_person, requested_at, verified_at, created_at, updated_at)
       VALUES (?, ?, 'dirty.attendee@example.com', 'dirty-token-hash', NULL, NULL, ?, 0, ?, ?, ?, ?)`,
    ).bind("MQ-DIRTYSCHEDULE", DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, NOW, NOW, NOW, NOW),
  ]);

  await env.MEDIA.put(DEMO_OBJECT_KEY, new Uint8Array([1, 2, 3, 4]));
  await env.DB.prepare(
    "INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at) VALUES (?, ?, 'task_upload', ?, ?, 'dirty.bin', 'application/octet-stream', 4, 'ready', NULL, 'dirty-etag', ?, ?)",
  ).bind("attachment-dirty", DEMO_EVENT_ID, openTask!.id, DEMO_OBJECT_KEY, NOW, NOW).run();

  const login = await demoLogin("organizer");
  expect(login.status).toBe(200);
  expect((await login.json<{ person: { id: string } }>()).person.id).toBe(DEMO_ORGANIZER_PERSON_ID);
}

async function insertUnrelatedTenant(): Promise<void> {
  await env.MEDIA.put(UNRELATED_OBJECT_KEY, new Uint8Array([5, 6, 7]));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Unrelated Reset Org', 'unrelated-reset', ?, ?)",
    ).bind(UNRELATED_ORG_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Unrelated Conference', 'unrelated-reset', '2026-11-01', '2026-11-02', 'UTC', 'live', 0, ?, ?)",
    ).bind(UNRELATED_EVENT_ID, UNRELATED_ORG_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'unrelated@example.com', 'Unrelated Person', 0, 'marquee', ?, ?)",
    ).bind(UNRELATED_PERSON_ID, UNRELATED_ORG_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', ?, ?)",
    ).bind("membership-unrelated-reset", UNRELATED_ORG_ID, UNRELATED_EVENT_ID, UNRELATED_PERSON_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'abstract', 'Unrelated submission', 'submitted', 'public', ?, ?, ?)",
    ).bind(UNRELATED_SUBMISSION_ID, UNRELATED_EVENT_ID, UNRELATED_PERSON_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at) VALUES (?, ?, 'event_logo', ?, ?, 'logo.png', 'image/png', 3, 'ready', 'unrelated-etag', ?, ?)",
    ).bind("attachment-unrelated-reset", UNRELATED_EVENT_ID, UNRELATED_EVENT_ID, UNRELATED_OBJECT_KEY, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO webhook_endpoints (id, event_id, url, secret_hash, events_json, enabled, created_at) VALUES (?, ?, 'https://hooks.example.test/unrelated', 'unrelated-secret', '[\"agenda.published\"]', 1, ?)",
    ).bind("webhook-unrelated", UNRELATED_EVENT_ID, NOW),
    env.DB.prepare(
      "INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, created_at) VALUES (?, ?, 'agenda.published', '{}', 'queued', ?)",
    ).bind("webhook-delivery-unrelated", "webhook-unrelated", NOW),
    env.DB.prepare(
      "INSERT INTO mirror_outbox (id, table_name, row_id, op, payload, status, created_at, updated_at) VALUES (?, 'events', ?, 'upsert', ?, 'queued', ?, ?)",
    ).bind("mirror-unrelated", UNRELATED_EVENT_ID, JSON.stringify({ event_id: UNRELATED_EVENT_ID, org_id: UNRELATED_ORG_ID }), NOW, NOW),
  ]);
}

async function assertResetState(): Promise<void> {
  expect(Object.keys(SEEDED_COUNTS).sort()).toEqual([...WIPE_ORDER].sort());
  expect(await tableCounts()).toEqual(expectedCountsAfterReset());
  const referenceFloor = await env.DB.prepare(
    `SELECT l.last_sequence, MAX(CAST(substr(s.reference_code, 5) AS INTEGER)) AS submission_max
     FROM submission_reference_ledger l
     LEFT JOIN submissions s ON s.event_id = l.event_id
     WHERE l.event_id = ?
     GROUP BY l.event_id, l.last_sequence`,
  ).bind(DEMO_EVENT_ID).first<{ last_sequence: number; submission_max: number }>();
  expect(referenceFloor).toEqual({ last_sequence: referenceFloor?.submission_max, submission_max: referenceFloor?.submission_max });
  expect(await env.DB.prepare(
    "SELECT id FROM submission_notes WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
  ).bind(DEMO_EVENT_ID).first()).toBeNull();

  const event = await env.DB.prepare(
    "SELECT id, name, demo_mode FROM events WHERE id = ?",
  ).bind(DEMO_EVENT_ID).first<{ id: string; name: string; demo_mode: number }>();
  expect(event).toEqual({ id: DEMO_EVENT_ID, name: "AI Engineer New York 2026", demo_mode: 1 });

  const organizerTokenAdmin = await env.DB.prepare(
    "SELECT event_id, role FROM memberships WHERE org_id = ? AND person_id = ? AND event_id IS NULL AND role IN ('program_lead', 'owner')",
  ).bind(DEMO_ORGANIZATION_ID, DEMO_ORGANIZER_PERSON_ID).first<{ event_id: string | null; role: string }>();
  expect(organizerTokenAdmin).toEqual({ event_id: null, role: "owner" });

  expect(await env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(UNRELATED_ORG_ID).first()).not.toBeNull();
  expect(await env.DB.prepare("SELECT id FROM submissions WHERE id = ?").bind(UNRELATED_SUBMISSION_ID).first()).not.toBeNull();
  expect(await env.MEDIA.head(DEMO_OBJECT_KEY)).toBeNull();
  expect(await env.MEDIA.head(UNRELATED_OBJECT_KEY)).not.toBeNull();
}

async function assertBothDemoLogins(): Promise<void> {
  const organizer = await demoLogin("organizer");
  expect(organizer.status).toBe(200);
  expect((await organizer.json<{ person: { id: string } }>()).person.id).toBe(DEMO_ORGANIZER_PERSON_ID);

  const speaker = await demoLogin("speaker");
  expect(speaker.status).toBe(200);
  const speakerBody = await speaker.json<{ person: { id: string } }>();
  expect(speakerBody.person.id).toBe(DEMO_SPEAKER_PERSON_ID);
}

test("AC-230 · reset-demo restores the full seeded baseline from dirty state, scopes tenants and R2, and is idempotent", async () => {
  await reseedDemo(env.DB, NOW, env.MEDIA);
  await dirtyDemoState();
  await insertUnrelatedTenant();

  const postResponse = await app.request(
    "/api/v1/admin/reset-demo",
    { method: "POST", headers: { "x-marquee-local-validation": "test-local-validation-token" } },
    { ...env, LOCAL_VALIDATION_TOKEN: "test-local-validation-token" },
  );
  expect(postResponse.status).toBe(202);
  const { job_id: jobId } = await postResponse.json<{ job_id: string }>();
  const mirrorSend = vi.fn();
  await dispatchResetJob(jobId, mirrorSend);

  const job = await readResetJob(env.CACHE, jobId);
  expect(job?.status).toBe("done");
  expect(job?.result).toMatchObject({ deletedObjects: 1 });
  await assertResetState();
  const firstReferenceFloor = await env.DB.prepare(
    "SELECT last_sequence FROM submission_reference_ledger WHERE event_id = ?",
  ).bind(DEMO_EVENT_ID).first<{ last_sequence: number }>();
  expect(mirrorSend).toHaveBeenCalledTimes(1);
  expect(mirrorSend.mock.calls[0][0]).toMatchObject({ type: "mirror_reconcile" });

  await assertBothDemoLogins();
  const secondPost = await app.request(
    "/api/v1/admin/reset-demo",
    { method: "POST", headers: { "x-marquee-local-validation": "test-local-validation-token" } },
    { ...env, LOCAL_VALIDATION_TOKEN: "test-local-validation-token" },
  );
  expect(secondPost.status).toBe(202);
  const { job_id: secondJobId } = await secondPost.json<{ job_id: string }>();
  const secondMirrorSend = vi.fn();
  await dispatchResetJob(secondJobId, secondMirrorSend);
  const secondJob = await readResetJob(env.CACHE, secondJobId);
  expect(secondJob?.status).toBe("done");
  expect(secondJob?.result).toMatchObject({ deletedObjects: 0 });
  await assertResetState();
  const secondReferenceFloor = await env.DB.prepare(
    "SELECT last_sequence FROM submission_reference_ledger WHERE event_id = ?",
  ).bind(DEMO_EVENT_ID).first<{ last_sequence: number }>();
  expect(secondReferenceFloor?.last_sequence).toBeGreaterThan(firstReferenceFloor?.last_sequence ?? 0);
  expect(secondMirrorSend).toHaveBeenCalledTimes(1);
  await assertBothDemoLogins();
});

test("CONTRACT · reset-demo suppresses row feed and emits one reconcile with a configured mirror", async () => {
  await reseedDemo(env.DB, NOW, env.MEDIA);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, local_row_count, remote_row_count, created_at, updated_at)
       VALUES ('state-reset-people', 'people', 'tbl_people_reset', 0, 0, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, local_row_count, remote_row_count, created_at, updated_at)
       VALUES ('state-reset-submissions', 'submissions', 'tbl_submissions_reset', 0, 0, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, local_row_count, remote_row_count, created_at, updated_at)
       VALUES ('state-reset-tasks', 'speaker_tasks', 'tbl_tasks_reset', 0, 0, ?, ?)`,
    ).bind(NOW, NOW),
  ]);

  const job = await createResetJob(env.CACHE, NOW);
  const mirrorMessages: unknown[] = [];
  try {
    await runResetJob(
      {
        ...env,
        MIRROR_QUEUE: {
          send: async (message: unknown) => mirrorMessages.push(message),
        } as unknown as typeof env.MIRROR_QUEUE,
      },
      job.id,
    );

    const outbox = await env.DB.prepare("SELECT COUNT(*) AS count FROM mirror_outbox").first<{ count: number }>();
    expect(Number(outbox?.count)).toBe(0);
    expect(mirrorMessages).toEqual([
      expect.objectContaining({ type: "mirror_reconcile", reason: "reset_demo" }),
    ]);
  } finally {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mirror_outbox"),
      env.DB.prepare("DELETE FROM mirror_state WHERE id IN ('state-reset-people', 'state-reset-submissions', 'state-reset-tasks')"),
    ]);
  }
});

test("AC-230 · POST /api/v1/admin/reset-demo 403s with no demo_mode=1 event", async () => {
  const testEnv = { ...env, LOCAL_VALIDATION_TOKEN: "test-local-validation-token" };
  const response = await app.request(
    "/api/v1/admin/reset-demo",
    { method: "POST", headers: { "x-marquee-local-validation": "test-local-validation-token" } },
    testEnv,
  );
  expect(response.status).toBe(403);
});

test("CONTRACT · POST /api/v1/admin/reset-demo 401s with no local-validation header and no session", async () => {
  await reseedDemo(env.DB, NOW, env.MEDIA);
  const response = await app.request("/api/v1/admin/reset-demo", { method: "POST" }, env);
  expect(response.status).toBe(401);
});

test("CONTRACT · reset-demo restores only the canonical demo organization", async () => {
  await reseedDemo(env.DB, NOW, env.MEDIA);
  const before = await env.DB.prepare("SELECT id FROM organizations").first<{ id: string }>();
  expect(before?.id).toBe(DEMO_ORGANIZATION_ID);
});

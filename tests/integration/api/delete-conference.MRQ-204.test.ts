import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 25, 15);
const ORG_ID = "org_delete_204";
const EVENT_ID = "evt_delete_204";
const SIBLING_EVENT_ID = "evt_delete_204_sibling";
const ACTOR_ID = "per_delete_204_actor";
const SPEAKER_ID = "per_delete_204_speaker";
const REVIEWER_ID = "per_delete_204_reviewer";
const OTHER_PERSON_ID = "per_delete_204_other";
const MULTI_EVENT_TOKEN_ID = "token_delete_204_multi";
const SESSION_ID = "session_delete_204";
const MAGIC_LINK_ID = "magic_delete_204_portal";
const EVENT_ATTACHMENT_ID = "attachment_delete_204_event";
const HEADSHOT_ATTACHMENT_ID = "attachment_delete_204_headshot";
const TASK_ID = "task_delete_204";
const COOKIE = `mq_session=${SESSION_ID}`;

type CountRow = { total: number };

const EVENT_SCOPED_COUNTS: Record<string, string> = {
  events: "SELECT COUNT(*) AS total FROM events WHERE id = ?",
  formats: "SELECT COUNT(*) AS total FROM formats WHERE event_id = ?",
  tracks: "SELECT COUNT(*) AS total FROM tracks WHERE event_id = ?",
  buildings: "SELECT COUNT(*) AS total FROM buildings WHERE event_id = ?",
  rooms: "SELECT COUNT(*) AS total FROM rooms WHERE event_id = ?",
  waves: "SELECT COUNT(*) AS total FROM waves WHERE event_id = ?",
  attachments: "SELECT COUNT(*) AS total FROM attachments WHERE event_id = ?",
  memberships: "SELECT COUNT(*) AS total FROM memberships WHERE event_id = ?",
  magic_links: "SELECT COUNT(*) AS total FROM magic_links WHERE event_id = ?",
  api_tokens: "SELECT COUNT(*) AS total FROM api_tokens WHERE event_id = ?",
  forms: "SELECT COUNT(*) AS total FROM forms WHERE event_id = ?",
  form_fields: "SELECT COUNT(*) AS total FROM form_fields WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)",
  form_admins: "SELECT COUNT(*) AS total FROM form_admins WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)",
  email_templates: "SELECT COUNT(*) AS total FROM email_templates WHERE event_id = ?",
  outbox: "SELECT COUNT(*) AS total FROM outbox WHERE event_id = ?",
  routing_rules: "SELECT COUNT(*) AS total FROM routing_rules WHERE event_id = ?",
  submissions: "SELECT COUNT(*) AS total FROM submissions WHERE event_id = ?",
  submission_answers: "SELECT COUNT(*) AS total FROM submission_answers WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
  submission_tracks: "SELECT COUNT(*) AS total FROM submission_tracks WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
  submission_decisions: "SELECT COUNT(*) AS total FROM submission_decisions WHERE event_id = ?",
  saved_views: "SELECT COUNT(*) AS total FROM saved_views WHERE event_id = ?",
  participations: "SELECT COUNT(*) AS total FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
  evaluation_plans: "SELECT COUNT(*) AS total FROM evaluation_plans WHERE event_id = ?",
  evaluation_rounds: "SELECT COUNT(*) AS total FROM evaluation_rounds WHERE plan_id IN (SELECT id FROM evaluation_plans WHERE event_id = ?)",
  rubric_criteria: "SELECT COUNT(*) AS total FROM rubric_criteria WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
  committees: "SELECT COUNT(*) AS total FROM committees WHERE event_id = ?",
  committee_members: "SELECT COUNT(*) AS total FROM committee_members WHERE committee_id IN (SELECT id FROM committees WHERE event_id = ?)",
  reviewer_track_scopes: "SELECT COUNT(*) AS total FROM reviewer_track_scopes WHERE event_id = ?",
  round_assignments: "SELECT COUNT(*) AS total FROM round_assignments WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?) OR round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
  evaluations: "SELECT COUNT(*) AS total FROM evaluations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?) OR round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
  comparisons: "SELECT COUNT(*) AS total FROM comparisons WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
  round_promotions: "SELECT COUNT(*) AS total FROM round_promotions WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?) OR from_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?) OR to_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
  agenda_items: "SELECT COUNT(*) AS total FROM agenda_items WHERE event_id = ?",
  task_templates: "SELECT COUNT(*) AS total FROM task_templates WHERE event_id = ?",
  speaker_tasks: "SELECT COUNT(*) AS total FROM speaker_tasks WHERE event_id = ?",
  calendar_invites: "SELECT COUNT(*) AS total FROM calendar_invites WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
  public_schedules: "SELECT COUNT(*) AS total FROM public_schedules WHERE event_id = ?",
  imports: "SELECT COUNT(*) AS total FROM imports WHERE event_id = ?",
  import_rows: "SELECT COUNT(*) AS total FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE event_id = ?)",
  embeds: "SELECT COUNT(*) AS total FROM embeds WHERE event_id = ?",
  event_settings: "SELECT COUNT(*) AS total FROM event_settings WHERE event_id = ?",
  webhook_endpoints: "SELECT COUNT(*) AS total FROM webhook_endpoints WHERE event_id = ?",
  webhook_deliveries: "SELECT COUNT(*) AS total FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE event_id = ?)",
  mirror_outbox: "SELECT COUNT(*) AS total FROM mirror_outbox WHERE json_extract(payload, '$.event_id') = ? OR (table_name = 'events' AND row_id = ?)",
};

function statement(sql: string, ...bindings: unknown[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...bindings);
}

async function run(statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 40) {
    await env.DB.batch(statements.slice(offset, offset + 40));
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    `${ORIGIN}${path}`,
    { ...init, headers: { cookie: COOKIE, ...(init.headers ?? {}) } },
    env,
  );
}

async function countRows(sql: string, ...bindings: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...bindings).first<CountRow>();
  return Number(row?.total ?? 0);
}

async function eventScopedCounts(eventId = EVENT_ID): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [table, sql] of Object.entries(EVENT_SCOPED_COUNTS)) {
    const bindings = (table === "round_assignments" || table === "evaluations")
      ? [eventId, eventId]
      : table === "round_promotions"
        ? [eventId, eventId, eventId]
        : table === "mirror_outbox"
          ? [eventId, eventId]
          : [eventId];
    result[table] = await countRows(sql, ...bindings);
  }
  return result;
}

async function rows(sql: string, ...bindings: unknown[]): Promise<unknown[]> {
  return (await env.DB.prepare(sql).bind(...bindings).all()).results;
}

async function seedFixture(): Promise<void> {
  await run([
    statement(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ORG_ID,
      "Deletion fixture organization",
      "deletion-204",
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)`,
      EVENT_ID,
      ORG_ID,
      "Delete Me Conference",
      "delete-me",
      "Everything scoped to this conference",
      "2026-10-12",
      "2026-10-14",
      "America/New_York",
      "Conference Hall",
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'UTC', 'Another Hall', 'draft', 0, ?, ?)`,
      SIBLING_EVENT_ID,
      ORG_ID,
      "Keep This Conference",
      "keep-this",
      "2026-11-12",
      "2026-11-13",
      NOW,
      NOW,
    ),
    ...[
      [ACTOR_ID, "organizer@delete-204.test", "Organizer"],
      [SPEAKER_ID, "speaker@delete-204.test", "Speaker"],
      [REVIEWER_ID, "reviewer@delete-204.test", "Reviewer"],
      [OTHER_PERSON_ID, "other@delete-204.test", "Unrelated CRM person"],
    ].map(([id, email, name]) => statement(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Role', 'Company', 'A durable CRM record', NULL, '[]', '{}', 0, 'marquee', ?, ?)`,
      id,
      ORG_ID,
      email,
      name,
      NOW,
      NOW,
    )),
    statement(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', ?, ?)",
      "membership_delete_204_actor",
      ORG_ID,
      EVENT_ID,
      ACTOR_ID,
      NOW,
      NOW,
    ),
    statement(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', ?, ?)",
      "membership_delete_204_sibling",
      ORG_ID,
      SIBLING_EVENT_ID,
      ACTOR_ID,
      NOW,
      NOW,
    ),
    statement(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)",
      "membership_delete_204_speaker",
      ORG_ID,
      EVENT_ID,
      SPEAKER_ID,
      NOW,
      NOW,
    ),
    statement(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)",
      "membership_delete_204_reviewer",
      ORG_ID,
      EVENT_ID,
      REVIEWER_ID,
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'delete-204-test', NULL, ?, ?)`,
      SESSION_ID,
      ACTOR_ID,
      NOW + 3_600_000,
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at)
       VALUES ('person_event_delete_204_note', ?, ?, 'note', ?, ?, ?)`,
      ORG_ID,
      SPEAKER_ID,
      JSON.stringify({ body: "Keep this CRM note" }),
      ACTOR_ID,
      NOW,
    ),
    statement(
      `INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at)
       VALUES ('person_event_delete_204_tag', ?, ?, 'tag', ?, ?, ?)`,
      ORG_ID,
      SPEAKER_ID,
      JSON.stringify({ tag: "important", op: "add" }),
      ACTOR_ID,
      NOW + 1,
    ),
    statement(
      `INSERT INTO person_lists (id, org_id, name, kind, config_json, created_by, created_at, updated_at)
       VALUES ('person_list_delete_204', ?, 'Keep these people', 'fixed', '{}', ?, ?, ?)`,
      ORG_ID,
      ACTOR_ID,
      NOW,
      NOW,
    ),
    statement(
      "INSERT INTO person_list_members (list_id, person_id, created_at) VALUES ('person_list_delete_204', ?, ?)",
      SPEAKER_ID,
      NOW,
    ),
    statement(
      "INSERT INTO saved_views (id, event_id, person_id, name, config_json, created_at, updated_at) VALUES ('saved_view_delete_204', ?, ?, 'My queue', '{}', ?, ?)",
      EVENT_ID,
      ACTOR_ID,
      NOW,
      NOW,
    ),
  ]);

  await run([
    statement(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
       VALUES (?, ?, 'person_headshot', ?, ?, 'speaker.png', 'image/png', 4, 'ready', 'headshot-sha', 'headshot-etag', ?, ?)`,
      HEADSHOT_ATTACHMENT_ID,
      EVENT_ID,
      SPEAKER_ID,
      `uploads/${EVENT_ID}/person_headshot/${HEADSHOT_ATTACHMENT_ID}.png`,
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
       VALUES (?, ?, 'task_upload', ?, ?, 'deck.pdf', 'application/pdf', 4, 'ready', 'task-sha', 'task-etag', ?, ?)`,
      EVENT_ATTACHMENT_ID,
      EVENT_ID,
      TASK_ID,
      `uploads/${EVENT_ID}/task_upload/${EVENT_ATTACHMENT_ID}.pdf`,
      NOW,
      NOW,
    ),
    statement(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
       VALUES ('attachment_delete_204_sibling', ?, 'event_logo', ?, 'uploads/sibling/logo.png', 'logo.png', 'image/png', 4, 'ready', 'sibling-sha', 'sibling-etag', ?, ?)`,
      SIBLING_EVENT_ID,
      SIBLING_EVENT_ID,
      NOW,
      NOW,
    ),
  ]);
  await env.DB.prepare("UPDATE people SET headshot_attachment_id = ? WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID, SPEAKER_ID).run();

  await run([
    statement("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_delete_204', ?, 'Talk', 30, 15, 60, 0, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_delete_204', ?, 'Main', '#7C5CFC', 0, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES ('building_delete_204', ?, 'Main Hall', '1 Main Street', 0, 40.7, -74, 5, 'Use the east door', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES ('room_delete_204', ?, 'building_delete_204', 'Room 1', 100, 0, '[\"projector\"]', 'Quiet room', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO waves (id, event_id, name, decision_on, target_count, sent_at, position, created_at, updated_at) VALUES ('wave_delete_204', ?, 'First wave', '2026-09-01', 10, NULL, 0, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, welcome_md, created_at, updated_at) VALUES ('form_delete_204_abstract', ?, 'Abstract CFP', 'abstract-cfp', 'abstract', 'open', ?, 'Welcome', ?, ?)", EVENT_ID, NOW + 86_400_000, NOW, NOW),
    statement("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, welcome_md, created_at, updated_at) VALUES ('form_delete_204_session', ?, 'Session CFP', 'session-cfp', 'session', 'draft', NULL, 'Welcome', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at) VALUES ('template_delete_204', ?, 'welcome', 'Welcome', 'Welcome', 'Hello', 1, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO routing_rules (id, event_id, name, when_json, then_json, position, enabled, created_at, updated_at) VALUES ('routing_delete_204', ?, 'Accept all', '{}', '{}', 0, 1, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES ('field_delete_204_abstract', 'form_delete_204_abstract', 'title', 'Title', 'short_text', 1, 0, '{}', ?, ?)", NOW, NOW),
    statement("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES ('field_delete_204_session', 'form_delete_204_session', 'title', 'Title', 'short_text', 1, 0, '{}', ?, ?)", NOW, NOW),
    statement("INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES ('form_admin_delete_204', 'form_delete_204_abstract', ?, ?, ?)", ACTOR_ID, NOW, NOW),
    statement("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES ('plan_delete_204', ?, 'Plan', '', 1, 5, 'open', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES ('round_delete_204_one', 'plan_delete_204', 0, 'Round one', 'scorecard', 0, 1, ?, ?)", NOW, NOW),
    statement("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES ('round_delete_204_two', 'plan_delete_204', 1, 'Round two', 'comparison', 0, 1, ?, ?)", NOW, NOW),
    statement("INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES ('criterion_delete_204', 'round_delete_204_one', 'Clarity', 100, 0, ?, ?)", NOW, NOW),
    statement("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES ('committee_delete_204', ?, 'Committee', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES ('committee_member_delete_204', 'committee_delete_204', ?, 'reviewer', ?, ?)", REVIEWER_ID, NOW, NOW),
    statement("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES ('scope_delete_204', ?, ?, 'track_delete_204', ?, ?)", EVENT_ID, REVIEWER_ID, NOW, NOW),
    statement("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at) VALUES ('template_task_delete_204', ?, 'Upload deck', 'file', 'Deck', ?, NULL, NULL, NULL, 0, 1, ?, ?)", EVENT_ID, NOW + 86_400_000, NOW, NOW),
    statement("INSERT INTO imports (id, event_id, source, file_key, mapping, status, created_at, updated_at) VALUES ('import_delete_204', ?, 'sessionize', 'imports/delete.csv', '{}', 'done', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO embeds (id, event_id, name, kind, slug, config, enabled, created_at, updated_at) VALUES ('embed_delete_204', ?, 'Agenda embed', 'agenda', 'delete-embed', '{}', 1, ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at) VALUES ('setting_delete_204', ?, 'speaker_social_platforms', '[\"x\"]', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO public_schedules (code, event_id, session_ids, write_key_hash, created_at, updated_at) VALUES ('share204', ?, '[\"submission_delete_204_session\"]', 'write-key', ?, ?)", EVENT_ID, NOW, NOW),
    statement("INSERT INTO webhook_endpoints (id, event_id, url, secret_hash, events_json, enabled, created_at) VALUES ('webhook_delete_204', ?, 'https://hooks.example.test/marquee', 'secret', '[\"agenda.published\"]', 1, ?)", EVENT_ID, NOW),
    statement("INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at) VALUES ('token_delete_204', ?, ?, 'Event token', 'token-hash', 'mq_test', ?, ?, ?, ?)", ORG_ID, EVENT_ID, JSON.stringify({ permissions: ["program:write"], event_ids: [EVENT_ID] }), ACTOR_ID, NOW, NOW),
    statement("INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at) VALUES (?, ?, NULL, 'Multi-event token', 'multi-token-hash', 'mq_multi', ?, ?, ?, ?)", MULTI_EVENT_TOKEN_ID, ORG_ID, JSON.stringify({ permissions: ["program:read"], event_ids: [EVENT_ID, SIBLING_EVENT_ID] }), ACTOR_ID, NOW, NOW),
  ]);

  await run([
    ...[
      ["submission_delete_204_abstract_one", "form_delete_204_abstract", "abstract", "Abstract one"],
      ["submission_delete_204_abstract_two", "form_delete_204_abstract", "abstract", "Abstract two"],
      ["submission_delete_204_session", "form_delete_204_session", "session", "Session one"],
    ].map(([id, formId, kind, title]) => statement(
      `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, format_id, primary_track_id, origin, wave_id, submitter_person_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'An abstract', 'accepted', 'format_delete_204', 'track_delete_204', 'public', 'wave_delete_204', ?, ?, ?)`,
      id,
      EVENT_ID,
      formId,
      kind,
      title,
      SPEAKER_ID,
      NOW,
      NOW,
    )),
    statement("INSERT INTO submission_answers (id, submission_id, field_id, value_text, created_at, updated_at) VALUES ('answer_delete_204', 'submission_delete_204_abstract_one', 'field_delete_204_abstract', 'A durable answer', ?, ?)", NOW, NOW),
    statement("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('submission_track_delete_204_one', 'submission_delete_204_abstract_one', 'track_delete_204', 1, ?, ?)", NOW, NOW),
    statement("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('submission_track_delete_204_two', 'submission_delete_204_session', 'track_delete_204', 1, ?, ?)", NOW, NOW),
    statement("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES ('participation_delete_204_one', 'submission_delete_204_abstract_one', ?, 'speaker', 0, 'confirmed', ?, ?)", SPEAKER_ID, NOW, NOW),
    statement("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES ('participation_delete_204_two', 'submission_delete_204_session', ?, 'speaker', 0, 'pending', ?, ?)", SPEAKER_ID, NOW, NOW),
    statement("INSERT INTO magic_links (id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at, created_at, updated_at) VALUES (?, 'magic-hash', ?, ?, 'login', '/portal?eventId=evt_delete_204', ?, NULL, ?, ?)", MAGIC_LINK_ID, SPEAKER_ID, EVENT_ID, NOW + 86_400_000, NOW, NOW),
    statement(`INSERT INTO outbox (id, event_id, template_key, person_id, to_email, subject, html, text, ics_uid, ics_body, status, send_policy, idempotency_key, created_at, updated_at, entity_id)
      VALUES ('outbox_delete_204', ?, 'magic_link_login', ?, 'speaker@delete-204.test', 'Portal access', '<p>Portal</p>', 'Portal', 'ics-delete-204', 'BEGIN:VCALENDAR', 'queued', 'demo_safe', 'outbox-delete-204', ?, ?, ?)`, EVENT_ID, SPEAKER_ID, NOW, NOW, MAGIC_LINK_ID),
    statement("INSERT INTO calendar_invites (id, submission_id, person_id, uid, sequence, last_method, status, created_at, updated_at) VALUES ('invite_delete_204', 'submission_delete_204_session', ?, 'uid-delete-204', 0, 'REQUEST', 'queued', ?, ?)", SPEAKER_ID, NOW, NOW),
    statement("INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, outbox_id, created_at, updated_at) VALUES ('decision_delete_204', ?, 'submission_delete_204_abstract_one', 'approve', 'accepted', 'Welcome', ?, ?, 'outbox_delete_204', ?, ?)", EVENT_ID, ACTOR_ID, NOW, NOW, NOW),
    statement("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, status, created_at, updated_at) VALUES ('assignment_delete_204', 'round_delete_204_one', 'submission_delete_204_abstract_one', ?, 'assigned', ?, ?)", REVIEWER_ID, NOW, NOW),
    statement("INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, created_at, updated_at) VALUES ('evaluation_delete_204', 'round_delete_204_one', 'submission_delete_204_abstract_one', ?, 'approve', 5, '{}', 'Good', ?, ?)", REVIEWER_ID, NOW, NOW),
    statement("INSERT INTO comparisons (id, round_id, reviewer_person_id, submission_ids, ranking, created_at, updated_at) VALUES ('comparison_delete_204', 'round_delete_204_one', ?, '[\"submission_delete_204_abstract_one\",\"submission_delete_204_abstract_two\",\"submission_delete_204_session\"]', '[\"submission_delete_204_abstract_one\",\"submission_delete_204_abstract_two\",\"submission_delete_204_session\"]', ?, ?)", REVIEWER_ID, NOW, NOW),
    statement("INSERT INTO round_promotions (id, from_round_id, to_round_id, submission_id, promoted_at, promoted_by, created_at, updated_at) VALUES ('promotion_delete_204', 'round_delete_204_one', 'round_delete_204_two', 'submission_delete_204_abstract_one', ?, ?, ?, ?)", NOW, ACTOR_ID, NOW, NOW),
    statement("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES ('agenda_delete_204', ?, 'submission_delete_204_session', 'session', ?, 30, 'room_delete_204', 'track_delete_204', 1, ?, ?)", EVENT_ID, NOW + 86_400_000, NOW, NOW),
    statement("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at) VALUES (?, ?, ?, 'submission_delete_204_session', 'template_task_delete_204', 'Upload deck', 'file', 'Deck', ?, 'open', NULL, NULL, ?, ?, ?)", TASK_ID, EVENT_ID, SPEAKER_ID, NOW + 86_400_000, EVENT_ATTACHMENT_ID, NOW, NOW),
    statement("INSERT INTO file_comments (id, event_id, owner_type, owner_id, attachment_id, author_person_id, body, created_at) VALUES ('comment_delete_204', ?, 'task_upload', ?, ?, ?, 'Please use the final deck', ?)", EVENT_ID, TASK_ID, EVENT_ATTACHMENT_ID, ACTOR_ID, NOW),
    statement("INSERT INTO import_rows (id, import_id, row_index, entity, outcome, reason, target_id, before_json, after_json, created_at, updated_at) VALUES ('import_row_delete_204', 'import_delete_204', 0, 'submission', 'created', NULL, 'submission_delete_204_abstract_one', '{}', '{}', ?, ?)", NOW, NOW),
    statement("INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, attempts, created_at) VALUES ('delivery_delete_204', 'webhook_delete_204', 'agenda.published', '{}', 'queued', 0, ?)", NOW),
    statement("INSERT INTO mirror_outbox (id, table_name, row_id, op, payload, status, attempts, created_at, updated_at) VALUES ('mirror_delete_204', 'events', ?, 'upsert', ?, 'queued', 0, ?, ?)", EVENT_ID, JSON.stringify({ event_id: EVENT_ID, name: "Delete Me Conference" }), NOW, NOW),
    statement("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES ('audit_delete_204_existing', ?, ?, 'user', 'event.created', 'event', ?, '{}', '{}', ?, 'seed-request')", EVENT_ID, ACTOR_ID, EVENT_ID, NOW),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("AC-305 + AC-306 · the transactional cascade removes every event row and audits its actor", async () => {
  const beforeCounts = await eventScopedCounts();
  for (const [table, count] of Object.entries(beforeCounts)) {
    expect(count, `${table} must be populated before deletion`).toBeGreaterThan(0);
  }

  const peopleBefore = JSON.stringify(await rows("SELECT * FROM people WHERE org_id = ? ORDER BY id", ORG_ID));
  const annotationsBefore = JSON.stringify(await rows("SELECT * FROM person_events WHERE org_id = ? ORDER BY id", ORG_ID));
  const listsBefore = JSON.stringify(await rows("SELECT * FROM person_lists WHERE org_id = ? ORDER BY id", ORG_ID));
  const listMembersBefore = JSON.stringify(await rows("SELECT * FROM person_list_members ORDER BY list_id, person_id"));
  const headshotBefore = await env.DB.prepare("SELECT id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at FROM attachments WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID).first();
  const requestId = "request-delete-204";
  const response = await request(`/api/v1/events/${EVENT_ID}`, {
    method: "DELETE",
    headers: { "x-request-id": requestId },
  });

  const responseText = await response.text();
  expect(response.status, responseText).toBe(200);
  expect(JSON.parse(responseText)).toMatchObject({ ok: true, event_id: EVENT_ID, next_event_id: SIBLING_EVENT_ID });

  const afterCounts = await eventScopedCounts();
  expect(afterCounts).toEqual(Object.fromEntries(Object.keys(beforeCounts).map((table) => [table, 0])));
  expect(await countRows("SELECT COUNT(*) AS total FROM magic_links WHERE id = ?", MAGIC_LINK_ID)).toBe(0);
  expect(await countRows("SELECT COUNT(*) AS total FROM events WHERE id = ?", SIBLING_EVENT_ID)).toBe(1);
  expect(JSON.stringify(await rows("SELECT * FROM people WHERE org_id = ? ORDER BY id", ORG_ID))).toBe(peopleBefore);
  expect(JSON.stringify(await rows("SELECT * FROM person_events WHERE org_id = ? ORDER BY id", ORG_ID))).toBe(annotationsBefore);
  expect(JSON.stringify(await rows("SELECT * FROM person_lists WHERE org_id = ? ORDER BY id", ORG_ID))).toBe(listsBefore);
  expect(JSON.stringify(await rows("SELECT * FROM person_list_members ORDER BY list_id, person_id"))).toBe(listMembersBefore);
  expect(await env.DB.prepare("SELECT id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at, event_id FROM attachments WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID).first()).toMatchObject({ ...headshotBefore, event_id: null });

  const audit = await env.DB.prepare(
    "SELECT event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, request_id FROM audit_log WHERE event_id = ? AND action = 'event.deleted'",
  ).bind(EVENT_ID).first<{ event_id: string; actor_person_id: string; actor_kind: string; action: string; entity_type: string; entity_id: string; before_json: string; after_json: string; request_id: string }>();
  expect(audit).toMatchObject({ event_id: EVENT_ID, actor_person_id: ACTOR_ID, actor_kind: "user", action: "event.deleted", entity_type: "event", entity_id: EVENT_ID, request_id: expect.any(String) });
  expect(JSON.parse(audit?.before_json ?? "{}")) .toMatchObject({ id: EVENT_ID, name: "Delete Me Conference" });
  expect(JSON.parse(audit?.after_json ?? "{}")) .toEqual({ deleted: true });
  expect(await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE id = 'audit_delete_204_existing'")).toBe(1);
  expect(response.headers.get("x-request-id")).toBe(audit?.request_id);
  const multiEventToken = await env.DB.prepare("SELECT event_id, scopes FROM api_tokens WHERE id = ?").bind(MULTI_EVENT_TOKEN_ID).first<{ event_id: string | null; scopes: string }>();
  expect(multiEventToken?.event_id).toBeNull();
  expect(JSON.parse(multiEventToken?.scopes ?? "{}").event_ids).toEqual([SIBLING_EVENT_ID]);
});

test("AC-304 · deletion returns the sibling first and then the fresh-install destination", async () => {
  const first = await request(`/api/v1/events/${EVENT_ID}`, { method: "DELETE" });
  const firstText = await first.text();
  expect(first.status, firstText).toBe(200);
  expect(JSON.parse(firstText)).toMatchObject({ next_event_id: SIBLING_EVENT_ID });

  const second = await request(`/api/v1/events/${SIBLING_EVENT_ID}`, { method: "DELETE" });
  const secondText = await second.text();
  expect(second.status, secondText).toBe(200);
  expect(JSON.parse(secondText)).toMatchObject({ ok: true, event_id: SIBLING_EVENT_ID, next_event_id: null });
  expect(await countRows("SELECT COUNT(*) AS total FROM events WHERE org_id = ?", ORG_ID)).toBe(0);
  expect(await countRows("SELECT COUNT(*) AS total FROM organizations WHERE id = ?", ORG_ID)).toBe(1);
});

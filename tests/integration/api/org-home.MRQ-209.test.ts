import { beforeAll, describe, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq209_home";
const OTHER_ORG_ID = "org_mrq209_other";
const UPCOMING_EVENT_ID = "evt_mrq209_upcoming";
const ENDED_EVENT_ID = "evt_mrq209_ended";
const OTHER_EVENT_ID = "evt_mrq209_other";
const OWNER_ID = "per_mrq209_owner";
const RETURNING_SPEAKER_ID = "per_mrq209_returning";
const SINGLE_SPEAKER_ID = "per_mrq209_single";
const REJECTED_SPEAKER_ID = "per_mrq209_rejected";
const WITHDRAWN_SPEAKER_ID = "per_mrq209_withdrawn";
const DRAFT_SPEAKER_ID = "per_mrq209_draft";
const OTHER_PERSON_ID = "per_mrq209_other";
const OWNER_SESSION_ID = "sess_mrq209_owner";
const SPEAKER_SESSION_ID = "sess_mrq209_speaker";
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

async function ensureMrq205StageColumns(): Promise<void> {
  const columns = await env.DB.prepare("PRAGMA table_info(person_events)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  for (const [name, definition] of [
    ["target_event_id", "target_event_id TEXT"],
    ["next_touch_on", "next_touch_on TEXT"],
  ] as const) {
    if (!existing.has(name)) await env.DB.prepare(`ALTER TABLE person_events ADD COLUMN ${definition}`).run();
  }
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  // MRQ-205 owns these append-only stage columns. Keep this test seam local
  // until that branch lands; do not add a product migration or duplicate
  // outreach table on the MRQ-209 base.
  await ensureMrq205StageColumns();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-209 Home", "mrq-209-home", NOW, NOW),
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(OTHER_ORG_ID, "Other Organization", "mrq-209-other", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'A season', ?, ?, 'America/New_York', 'A venue', 'live', 0, ?, ?)`)
      .bind(UPCOMING_EVENT_ID, ORG_ID, "MRQ-209 2026", "mrq-209-2026", "2026-10-12", "2026-10-14", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'A past season', ?, ?, 'America/New_York', 'A venue', 'live', 0, ?, ?)`)
      .bind(ENDED_EVENT_ID, ORG_ID, "MRQ-209 2025", "mrq-209-2025", "2025-10-12", "2025-10-14", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Other season', ?, ?, 'America/New_York', 'A venue', 'live', 0, ?, ?)`)
      .bind(OTHER_EVENT_ID, OTHER_ORG_ID, "Other 2026", "mrq-209-other-2026", "2026-11-12", "2026-11-14", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(OWNER_ID, ORG_ID, "owner@mrq209.test", "Jordan Home", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(RETURNING_SPEAKER_ID, ORG_ID, "returning@mrq209.test", "Priya Returning", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(SINGLE_SPEAKER_ID, ORG_ID, "single@mrq209.test", "Sam Single", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(REJECTED_SPEAKER_ID, ORG_ID, "rejected@mrq209.test", "Rae Rejected", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(WITHDRAWN_SPEAKER_ID, ORG_ID, "withdrawn@mrq209.test", "Wes Withdrawn", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(DRAFT_SPEAKER_ID, ORG_ID, "draft@mrq209.test", "Drew Draft", NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', 0, 'marquee', ?, ?)`)
      .bind(OTHER_PERSON_ID, OTHER_ORG_ID, "other@mrq209.test", "Other Person", NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)")
      .bind("mem_mrq209_owner", ORG_ID, UPCOMING_EVENT_ID, OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'ops', ?, ?)")
      .bind("mem_mrq209_ops", ORG_ID, ENDED_EVENT_ID, SINGLE_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("mem_mrq209_speaker", ORG_ID, UPCOMING_EVENT_ID, RETURNING_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("mem_mrq209_ended_speaker", ORG_ID, ENDED_EVENT_ID, RETURNING_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("mem_mrq209_other_speaker", OTHER_ORG_ID, OTHER_EVENT_ID, OTHER_PERSON_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)")
      .bind("sub_mrq209_upcoming_returning", UPCOMING_EVENT_ID, "Returning session", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, 'accepted', 'admin', ?, ?, ?)")
      .bind("sub_mrq209_ended_returning", ENDED_EVENT_ID, "Past returning session", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'abstract', ?, 'submitted', 'public', ?, ?, ?)")
      .bind("sub_mrq209_upcoming_single", UPCOMING_EVENT_ID, "Single speaker abstract", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'abstract', ?, 'rejected', 'public', ?, ?, ?)")
      .bind("sub_mrq209_upcoming_rejected", UPCOMING_EVENT_ID, "Rejected speaker abstract", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'abstract', ?, 'withdrawn', 'public', ?, ?, ?)")
      .bind("sub_mrq209_upcoming_withdrawn", UPCOMING_EVENT_ID, "Withdrawn speaker abstract", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'abstract', ?, 'draft', 'public', ?, ?, ?)")
      .bind("sub_mrq209_upcoming_draft", UPCOMING_EVENT_ID, "Draft speaker abstract", OWNER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("part_mrq209_upcoming_single", "sub_mrq209_upcoming_single", SINGLE_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("part_mrq209_upcoming_rejected", "sub_mrq209_upcoming_rejected", REJECTED_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("part_mrq209_upcoming_withdrawn", "sub_mrq209_upcoming_withdrawn", WITHDRAWN_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("part_mrq209_upcoming_draft", "sub_mrq209_upcoming_draft", DRAFT_SPEAKER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at, target_event_id, next_touch_on) VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, ?)")
      .bind("stage_mrq209_returning", ORG_ID, RETURNING_SPEAKER_ID, '{"stage":"contacted"}', OWNER_ID, NOW + 10, UPCOMING_EVENT_ID, "2026-08-12"),
    env.DB.prepare("INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at, target_event_id, next_touch_on) VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, ?)")
      .bind("stage_mrq209_single", ORG_ID, SINGLE_SPEAKER_ID, '{"stage":"identified"}', OWNER_ID, NOW + 11, UPCOMING_EVENT_ID, "2026-08-13"),
    env.DB.prepare("INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at, target_event_id, next_touch_on) VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, ?)")
      .bind("stage_mrq209_terminal", ORG_ID, OWNER_ID, '{"stage":"declined"}', OWNER_ID, NOW + 12, UPCOMING_EVENT_ID, "2026-08-01"),
    env.DB.prepare("INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at, target_event_id, next_touch_on) VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, ?)")
      .bind("stage_mrq209_other", OTHER_ORG_ID, OTHER_PERSON_ID, '{"stage":"contacted"}', OTHER_PERSON_ID, NOW + 13, OTHER_EVENT_ID, "2026-08-01"),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, 'Home Hall', '1 Main St', 0, NULL, NULL, 0, ?, ?)")
      .bind("building_mrq209", UPCOMING_EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, 'Room 1', 100, 0, '[]', NULL, ?, ?)")
      .bind("room_mrq209", UPCOMING_EVENT_ID, "building_mrq209", NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 30, ?, 1, ?, ?)")
      .bind("agenda_mrq209", UPCOMING_EVENT_ID, "sub_mrq209_upcoming_returning", NOW, "room_mrq209", NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'program_lead', ?, 'mrq209', NULL, ?, ?)")
      .bind(OWNER_SESSION_ID, OWNER_ID, Date.now() + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'mrq209', NULL, ?, ?)")
      .bind(SPEAKER_SESSION_ID, RETURNING_SPEAKER_ID, Date.now() + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, ?, 'user', ?, 'member', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_1", UPCOMING_EVENT_ID, OWNER_ID, "invite_created", "entity-1", NOW + 1),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, ?, 'user', ?, 'member', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_2", UPCOMING_EVENT_ID, OWNER_ID, "invite_claimed", "entity-2", NOW + 2),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, ?, 'user', ?, 'token', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_3", UPCOMING_EVENT_ID, OWNER_ID, "api_token_created", "entity-3", NOW + 3),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, NULL, 'system', ?, 'org', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_4", ENDED_EVENT_ID, "default_theme_updated", "entity-4", NOW + 4),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, ?, 'user', ?, 'member', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_5", UPCOMING_EVENT_ID, OWNER_ID, "invite_created", "entity-5", NOW + 5),
    env.DB.prepare("INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id) VALUES (?, ?, ?, 'user', ?, 'member', ?, NULL, NULL, ?, NULL)")
      .bind("audit_mrq209_other", OTHER_EVENT_ID, OTHER_PERSON_ID, "other_org_action", "entity-other", NOW + 99),
  ]);
}

async function request(path: string, sessionId?: string): Promise<Response> {
  return await app.request(`${ORIGIN}${path}`, {
    headers: sessionId ? { cookie: `mq_session=${sessionId}` } : {},
  }, env);
}

describe.sequential("MRQ-209 organization home", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · requires organization program access", async () => {
    expect((await request("/api/v1/org/home")).status).toBe(401);
    expect((await request("/api/v1/org/home", SPEAKER_SESSION_ID)).status).toBe(403);
  });

  test("CONTRACT · composes one org-scoped snapshot with truthful counts and lifecycle", async () => {
    const response = await request("/api/v1/org/home", OWNER_SESSION_ID);
    expect(response.status).toBe(200);
    const body = await response.json<{ data: Record<string, any> }>();

    expect(body.data.organization).toEqual({ id: ORG_ID, name: "MRQ-209 Home" });
    expect(body.data.seasons).toHaveLength(2);
    expect(body.data.seasons[0]).toMatchObject({
      id: UPCOMING_EVENT_ID,
      lifecycle: "upcoming",
      lifecycle_label: "Upcoming",
      submission_count: 5,
      speaker_count: 2,
      session_count: 1,
      links: { dashboard: `/dashboard?event=${UPCOMING_EVENT_ID}` },
    });
    expect(body.data.seasons[1]).toMatchObject({ id: ENDED_EVENT_ID, lifecycle: "ended", lifecycle_label: "Complete", speaker_count: 1 });
    expect(body.data.next_season.id).toBe(UPCOMING_EVENT_ID);
    expect(body.data.create_conference_href).toBe("/conferences/new");
    expect(body.data.relationships.people).toMatchObject({ value: 6, state: "ready" });
    expect(body.data.relationships.returning_speakers).toMatchObject({ value: 1, state: "ready" });
    expect(body.data.relationships.in_outreach).toMatchObject({ value: 2, state: "ready", href: "/pipeline" });
    expect(body.data.relationships.organizers).toMatchObject({ value: 2, state: "ready" });
    expect(body.data.attention.map((slot: { id: string }) => slot.id)).toEqual(["overdue_outreach", "stale_seats", "server_status"]);
    expect(body.data.attention[0]).toMatchObject({
      state: "ready",
      count: 2,
      href: "/pipeline",
      item: { person_name: "Priya Returning", event_name: "MRQ-209 2026", due_at: "2026-08-12" },
    });
    expect(body.data.attention[1]).toMatchObject({
      state: "ready",
      count: 1,
      href: "/org/organizers",
      item: { person_name: "Sam Single", event_name: "MRQ-209 2025", role: "ops" },
    });
  });

  test("CONTRACT · excludes terminal stages and keeps activity to four newest rows", async () => {
    const response = await request("/api/v1/org/home", OWNER_SESSION_ID);
    const body = await response.json<{ data: Record<string, any> }>();

    expect(body.data.relationships.in_outreach.value).toBe(2);
    expect(body.data.attention[0].item.person_name).not.toBe("Jordan Home");
    expect(body.data.recent_activity).toHaveLength(4);
    expect(body.data.recent_activity.map((row: { id: string }) => row.id)).toEqual([
      "audit_mrq209_5",
      "audit_mrq209_4",
      "audit_mrq209_3",
      "audit_mrq209_2",
    ]);
    expect(body.data.recent_activity.every((row: { event_id: string }) => [UPCOMING_EVENT_ID, ENDED_EVENT_ID].includes(row.event_id))).toBe(true);
    expect(body.data.recent_activity[0]).toMatchObject({ actor_name: "Jordan Home", event_name: "MRQ-209 2026", href: "/org/activity" });
  });
});

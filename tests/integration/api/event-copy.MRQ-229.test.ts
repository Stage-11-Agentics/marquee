import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const ORG_ID = "org_mrq229_copy";
const SOURCE_EVENT_ID = "evt_mrq229_copy_source";
const SOURCE_FORM_ID = "form_mrq229_copy_source";
const SOURCE_TRACK_ID = "track_mrq229_copy_source";
const SOURCE_TAG_ID = "tag_mrq229_copy_source";
const SOURCE_LEVEL_ID = "level_mrq229_copy_source";
const SOURCE_RULE_ID = "rule_mrq229_copy_source";
const OWNER_ID = "person_mrq229_copy_owner";

let ownerCookie = "";

interface Envelope<T> {
  data: T;
}

function insert(sql: string, ...bindings: (string | number | null)[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...bindings);
}

async function request(path: string, init: RequestInit = {}, cookie: string | null = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== null) headers.set("cookie", cookie);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function createConference(body: Record<string, unknown>): Promise<Response> {
  return request("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      name: "MRQ-229 Copy Target",
      starts_on: "2027-10-18",
      ends_on: "2027-10-20",
      timezone: "America/New_York",
      ...body,
    }),
  });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    insert("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ORG_ID, "MRQ-229 Copy Org", "mrq229-copy", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)", SOURCE_EVENT_ID, ORG_ID, "MRQ-229 Copy Source", "mrq229-copy-source", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", OWNER_ID, ORG_ID, "owner@mrq229-copy.example", "MRQ-229 Copy Owner", NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)", "membership_mrq229_copy", ORG_ID, OWNER_ID, NOW, NOW),
    insert("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 30, 20, 45, 0, ?, ?)", "format_mrq229_copy_source", SOURCE_EVENT_ID, "Talk", NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, name_key, color, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)", SOURCE_TRACK_ID, SOURCE_EVENT_ID, "Source Track", "source track", "#db4c3f", NOW, NOW),
    insert("INSERT INTO tags (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", SOURCE_TAG_ID, SOURCE_EVENT_ID, "Source Tag", "source tag", NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", SOURCE_LEVEL_ID, SOURCE_EVENT_ID, "Source Level", "source level", NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Source CFP', 'mrq229-copy-cfp', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, SOURCE_FORM_ID, SOURCE_EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
    insert(`INSERT INTO routing_rules
      (id, event_id, name, when_json, then_json, position, enabled, created_at, updated_at)
      VALUES (?, ?, 'Source level route', ?, ?, 0, 1, ?, ?)`, SOURCE_RULE_ID, SOURCE_EVENT_ID,
      JSON.stringify({ all: [{ fieldKey: "audience_level", op: "equals", value: SOURCE_LEVEL_ID }] }),
      JSON.stringify({ track_id: SOURCE_TRACK_ID, add_tag_ids: [SOURCE_TAG_ID], level_id: SOURCE_LEVEL_ID }), NOW, NOW),
  ]);
  await env.DB.batch([
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq229_copy_title', ?, 'title', 'Title', 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq229_copy_level', ?, 'audience_level', 'Audience level', 'single_select', 0, 1, '{"source":"levels"}', NULL, ?, ?)`,
      SOURCE_FORM_ID, NOW, NOW, SOURCE_FORM_ID, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq229-copy" });
  ownerCookie = `mq_session=${session.id}`;
}

beforeEach(seedFixture);

test("AC-373 · MRQ-229 · a levels-bound form cannot be copied without the routing set, and the copy plan says why", async () => {
  const plan = await request(`/api/v1/events/${SOURCE_EVENT_ID}/copy-plan`);
  expect(plan.status).toBe(200);
  const planBody = await json<Envelope<{ requires: Record<string, string[]>; reasons: Record<string, string> }>>(plan);
  expect(planBody.data.requires.forms).toContain("routing");
  expect(planBody.data.reasons.forms).toContain("Audience level is owned by routing");

  const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE org_id = ?").bind(ORG_ID).first<{ total: number }>();
  const illegal = await createConference({
    copy_from: SOURCE_EVENT_ID,
    copy: { forms: true, formats: true, tracks: true, routing: false },
  });
  expect(illegal.status).toBe(422);
  expect((await json<{ error: { message: string } }>(illegal)).error.message).toContain("routing");
  const after = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE org_id = ?").bind(ORG_ID).first<{ total: number }>();
  expect(after?.total).toBe(before?.total);
});

test("AC-373 · MRQ-229 · selected routing copy remaps level conditions, track/tag/level actions, and bound-form metadata", async () => {
  const response = await createConference({
    copy_from: SOURCE_EVENT_ID,
    copy: { forms: true, formats: true, tracks: true, routing: true },
  });
  expect(response.status).toBe(201);
  const body = await json<Envelope<{ event: { id: string }; copied: Record<string, number> }>>(response);
  const targetEventId = body.data.event.id;
  expect(body.data.copied.tracks).toBe(1);
  expect(body.data.copied.tags).toBe(1);
  expect(body.data.copied.levels).toBe(1);
  expect(body.data.copied.routing_rules).toBe(1);

  const targetTrack = await env.DB.prepare("SELECT id FROM tracks WHERE event_id = ?").bind(targetEventId).first<{ id: string }>();
  const targetTag = await env.DB.prepare("SELECT id FROM tags WHERE event_id = ?").bind(targetEventId).first<{ id: string }>();
  const targetLevel = await env.DB.prepare("SELECT id FROM levels WHERE event_id = ?").bind(targetEventId).first<{ id: string }>();
  const targetForm = await env.DB.prepare("SELECT id FROM forms WHERE event_id = ?").bind(targetEventId).first<{ id: string }>();
  expect(targetTrack?.id).toBeTruthy();
  expect(targetTag?.id).toBeTruthy();
  expect(targetLevel?.id).toBeTruthy();
  expect(targetForm?.id).toBeTruthy();
  expect(targetTrack?.id).not.toBe(SOURCE_TRACK_ID);
  expect(targetTag?.id).not.toBe(SOURCE_TAG_ID);
  expect(targetLevel?.id).not.toBe(SOURCE_LEVEL_ID);
  expect(targetForm?.id).not.toBe(SOURCE_FORM_ID);

  const targetField = await env.DB.prepare("SELECT key, config FROM form_fields WHERE form_id = ? AND key = 'audience_level'").bind(targetForm?.id).first<{ key: string; config: string }>();
  expect(targetField).toEqual({ key: "audience_level", config: '{"source":"levels"}' });
  const targetRule = await env.DB.prepare("SELECT when_json, then_json FROM routing_rules WHERE event_id = ?").bind(targetEventId).first<{ when_json: string; then_json: string }>();
  expect(targetRule).toBeTruthy();
  const when = JSON.parse(targetRule!.when_json) as { all: Array<{ value: string }> };
  const then = JSON.parse(targetRule!.then_json) as { track_id: string; add_tag_ids: string[]; level_id: string };
  expect(when.all[0]?.value).toBe(targetLevel?.id);
  expect(then).toEqual({ track_id: targetTrack?.id, add_tag_ids: [targetTag?.id], level_id: targetLevel?.id });
  expect(JSON.stringify({ when, then })).not.toContain(SOURCE_LEVEL_ID);
  expect(JSON.stringify({ when, then })).not.toContain(SOURCE_TRACK_ID);
  expect(JSON.stringify({ when, then })).not.toContain(SOURCE_TAG_ID);
});

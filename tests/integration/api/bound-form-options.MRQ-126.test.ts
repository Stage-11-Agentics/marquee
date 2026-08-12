import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq126_bound_options";
const EVENT_ID = "evt_mrq126_bound_options";
const FORM_ID = "form_mrq126_bound_options";
const OWNER_ID = "person_mrq126_owner";
// Anchored to the real clock. Fixtures here are written as offsets from NOW
// ("expires in a day", "due tomorrow") but the code under test reads the real
// Date.now(), so a hardcoded anchor silently changes what those offsets mean as
// the wall clock passes them — sessions expire and windows close with no commit
// behind the failure. Only the anchor moves.
const NOW = Date.now();

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "Bound Options Org", "mrq126-bound-options", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)").bind(EVENT_ID, ORG_ID, "Bound Options Conference", "mrq126-bound-options", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 30, 15, 60, 0, ?, ?), (?, ?, ?, 90, 60, 120, 1, ?, ?)").bind("format_mrq126_stage", EVENT_ID, "Stage Talk", NOW, NOW, "format_mrq126_workshop", EVENT_ID, "Workshop", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?), (?, ?, ?, ?, 1, ?, ?)").bind("track_mrq126_platform", EVENT_ID, "Platform", "#db4c3f", NOW, NOW, "track_mrq126_ai", EVENT_ID, "AI Engineering", "#247b8f", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, "owner@mrq126.example", "MRQ-126 Owner", NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)").bind("membership_mrq126_owner", ORG_ID, EVENT_ID, OWNER_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Bound options CFP', 'mrq126-bound-cfp', 'abstract', 'open', ?, ?, ?, 3, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), "Choose the live conference settings.", NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq126_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq126_format', ?, 'format', 'Format', NULL, 'single_select', 1, 1, '{"source":"formats"}', NULL, ?, ?),
      ('field_mrq126_tracks', ?, 'tracks', 'Tracks', NULL, 'multi_select', 1, 2, '{"source":"tracks","minItems":1}', NULL, ?, ?),
      ('field_mrq126_name', ?, 'speaker_name', 'Speaker name', NULL, 'short_text', 1, 3, '{}', NULL, ?, ?),
      ('field_mrq126_email', ?, 'speaker_email', 'Speaker email', NULL, 'email', 1, 4, '{}', NULL, ?, ?)`)
      .bind(FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq126-test", now: NOW });
  ownerCookie = `mq_session=${session.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie: string | null = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

describe.sequential("MRQ-126 bound form options", () => {
  beforeEach(seedFixture);

  test("AC-25 · settings renames replace both public option lists immediately", async () => {
    const before = await request(`/api/v1/public/forms/mrq126-bound-cfp`, {}, null);
    expect(before.status).toBe(200);
    const beforeBody = await json<{ fields: Array<{ key: string; config: Record<string, unknown> }> }>(before);
    expect(beforeBody.fields.find((field) => field.key === "format")?.config).toMatchObject({ source: "formats", options: ["Stage Talk", "Workshop"] });
    expect(beforeBody.fields.find((field) => field.key === "tracks")?.config).toMatchObject({ source: "tracks", options: ["Platform", "AI Engineering"] });

    const formatRename = await request(`/api/v1/events/${EVENT_ID}/formats/format_mrq126_stage`, { method: "PATCH", body: JSON.stringify({ name: "Talk (30 min)" }) });
    expect(formatRename.status).toBe(200);
    const trackRename = await request(`/api/v1/events/${EVENT_ID}/tracks/track_mrq126_platform`, { method: "PATCH", body: JSON.stringify({ name: "Platform & Infra" }) });
    expect(trackRename.status).toBe(200);

    const after = await request(`/api/v1/public/forms/mrq126-bound-cfp`, {}, null);
    const afterBody = await json<{ fields: Array<{ key: string; config: Record<string, unknown> }> }>(after);
    expect(afterBody.fields.find((field) => field.key === "format")?.config).toMatchObject({ source: "formats", options: ["Talk (30 min)", "Workshop"] });
    expect(afterBody.fields.find((field) => field.key === "tracks")?.config).toMatchObject({ source: "tracks", options: ["Platform & Infra", "AI Engineering"] });

    const stored = await env.DB.prepare("SELECT key, config FROM form_fields WHERE form_id = ? AND key IN ('format', 'tracks') ORDER BY key").bind(FORM_ID).all<{ key: string; config: string }>();
    expect(stored.results.map((field) => JSON.parse(field.config))).toEqual([
      { source: "formats" },
      { source: "tracks", minItems: 1 },
    ]);
  });

  test("AC-17 · one field request stores custom options or a live bound source", async () => {
    const custom = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "audience_level", label: "Audience level", type: "single_select", required: true, config: { options: ["Beginner", "Advanced"] } }),
    });
    expect(custom.status).toBe(201);
    expect(await json<{ config: Record<string, unknown> }>(custom)).toMatchObject({ config: { options: ["Beginner", "Advanced"] } });

    const bound = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "session_format", label: "Session format", type: "single_select", config: { source: "formats", options: ["stale copy"] } }),
    });
    expect(bound.status).toBe(201);
    expect(await json<{ config: Record<string, unknown> }>(bound)).toMatchObject({ config: { source: "formats", options: ["Stage Talk", "Workshop"] } });

    const stored = await env.DB.prepare("SELECT config FROM form_fields WHERE form_id = ? AND key = 'session_format'").bind(FORM_ID).first<{ config: string }>();
    expect(JSON.parse(stored?.config ?? "{}")).toEqual({ source: "formats" });

    const invalid = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "wrong_source_type", label: "Wrong source type", type: "multi_select", config: { source: "formats" } }),
    });
    expect(invalid.status).toBe(422);
    expect((await json<{ error: { field?: string } }>(invalid)).error.field).toBe("config");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM form_fields WHERE form_id = ? AND key = 'wrong_source_type'").bind(FORM_ID).first<{ total: number }>();
    expect(Number(count?.total ?? 0)).toBe(0);
  });

  test("AC-25 · renamed bound values submit, old values reject without writing rows", async () => {
    const rename = await request(`/api/v1/events/${EVENT_ID}/formats/format_mrq126_stage`, { method: "PATCH", body: JSON.stringify({ name: "Talk (30 min)" }) });
    expect(rename.status).toBe(200);
    const trackRename = await request(`/api/v1/events/${EVENT_ID}/tracks/track_mrq126_platform`, { method: "PATCH", body: JSON.stringify({ name: "Platform & Infra" }) });
    expect(trackRename.status).toBe(200);

    const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM submissions").first<{ total: number }>();
    const rejected = await request(`/api/v1/public/forms/mrq126-bound-cfp/submissions`, {
      method: "POST",
      body: JSON.stringify({ answers: { title: "Old option should fail", format: "Stage Talk", tracks: ["Platform"], speaker_name: "Old Option", speaker_email: "old-option@mrq126.example" } }),
    }, null);
    expect(rejected.status).toBe(422);
    const rejectedBody = await json<{ error: { details: { issues: Array<{ fieldKey: string }> } } }>(rejected);
    expect(new Set(rejectedBody.error.details.issues.map((issue) => issue.fieldKey))).toEqual(new Set(["format", "tracks"]));
    const afterReject = await env.DB.prepare("SELECT COUNT(*) AS total FROM submissions").first<{ total: number }>();
    expect(Number(afterReject?.total ?? 0)).toBe(Number(before?.total ?? 0));

    const accepted = await request(`/api/v1/public/forms/mrq126-bound-cfp/submissions`, {
      method: "POST",
      body: JSON.stringify({ answers: { title: "Live option should land", format: "Talk (30 min)", tracks: ["Platform & Infra"], speaker_name: "Live Option", speaker_email: "live-option@mrq126.example" } }),
    }, null);
    expect(accepted.status).toBe(201);
    const stored = await env.DB.prepare("SELECT format_id, primary_track_id FROM submissions WHERE title = ?").bind("Live option should land").first<{ format_id: string; primary_track_id: string }>();
    expect(stored).toEqual({ format_id: "format_mrq126_stage", primary_track_id: "track_mrq126_platform" });
  });
});

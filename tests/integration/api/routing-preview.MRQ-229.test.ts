import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const ORG_ID = "org_mrq229_preview";
const EVENT_ID = "evt_mrq229_preview";
const FORM_ID = "form_mrq229_preview";
const OTHER_FORM_ID = "form_mrq229_preview_other";
const OWNER_ID = "person_mrq229_preview_owner";
const TRACK_ID = "track_mrq229_preview";
const TAG_ID = "tag_mrq229_preview";
const LEVEL_ID = "level_mrq229_preview";
const DELETED_LEVEL_ID = "level_mrq229_preview_deleted";
const FIELD_NOTES_ID = "field_mrq229_preview_notes";
const FIELD_LEVEL_ID = "field_mrq229_preview_level";
const FIELD_TOMBSTONED_ID = "field_mrq229_preview_tombstoned";
let ownerCookie = "";

interface Envelope<T> {
  data: T;
}

interface PreviewRule {
  rule_id: string;
  state: "matchable" | "skipped" | "dangling" | "invalid";
  would_have_matched: number | null;
  rules_above: number;
  landing: {
    track_id: string | null;
    tag_ids: string[];
    level_id: string | null;
    plan_id: string | null;
    committee_id: string | null;
    round_id: string | null;
  } | null;
  reason: string | null;
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

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    insert("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ORG_ID, "MRQ-229 Preview Org", "mrq229-preview", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)", EVENT_ID, ORG_ID, "MRQ-229 Preview Conference", "mrq229-preview", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", OWNER_ID, ORG_ID, "preview-owner@mrq229.example", "MRQ-229 Preview Owner", NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)", "membership_mrq229_preview_owner", ORG_ID, OWNER_ID, NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, name_key, color, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)", TRACK_ID, EVENT_ID, "MRQ-229 Preview Track", "mrq-229 preview track", "#db4c3f", NOW, NOW),
    insert("INSERT INTO tags (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", TAG_ID, EVENT_ID, "MRQ-229 Preview Tag", "mrq-229 preview tag", NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", LEVEL_ID, EVENT_ID, "Intermediate", "intermediate", NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)", DELETED_LEVEL_ID, EVENT_ID, "Deleted level", "deleted level", NOW, NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-229 Preview Form', 'mrq229-preview', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, FORM_ID, EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-229 Preview Other Form', 'mrq229-preview-other', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, OTHER_FORM_ID, EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES
      (?, ?, 'notes', 'Notes', 'long_text', 0, 0, '{}', NULL, ?, ?),
      (?, ?, 'audience_level', 'Audience level', 'single_select', 0, 1, '{"source":"levels"}', NULL, ?, ?),
      (?, ?, 'audience_legacy', 'Legacy audience level', 'single_select', 0, 2, '{"source":"levels"}', NULL, ?, ?)`,
      FIELD_NOTES_ID, FORM_ID, NOW, NOW,
      FIELD_LEVEL_ID, FORM_ID, NOW, NOW,
      FIELD_TOMBSTONED_ID, FORM_ID, NOW, NOW),
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES ('field_mrq229_preview_other_legacy', ?, 'audience_legacy', 'Legacy audience level', 'single_select', 0, 0, '{"source":"levels"}', NULL, ?, ?)`, OTHER_FORM_ID, NOW, NOW),
    insert(`INSERT INTO routing_rules
      (id, event_id, name, when_json, then_json, position, enabled, deleted_at, created_at, updated_at)
      VALUES
      ('rule_mrq229_preview_old', ?, 'Old arrival is outside the sample', ?, ?, 0, 1, NULL, ?, ?),
      ('rule_mrq229_preview_level', ?, 'Intermediate lands in the preview destination', ?, ?, 1, 1, NULL, ?, ?),
      ('rule_mrq229_preview_skipped', ?, 'Tombstoned question is skipped', ?, ?, 2, 1, NULL, ?, ?),
      ('rule_mrq229_preview_dangling', ?, 'Deleted Level is dangling', ?, ?, 3, 1, NULL, ?, ?)`,
      EVENT_ID, JSON.stringify({ all: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-OLD-MATCH" }] }), JSON.stringify({ add_tag_ids: [TAG_ID] }), NOW, NOW,
      EVENT_ID, JSON.stringify({ all: [{ fieldKey: "audience_level", op: "equals", value: LEVEL_ID }] }), JSON.stringify({ track_id: TRACK_ID, add_tag_ids: [TAG_ID], level_id: LEVEL_ID }), NOW, NOW,
      EVENT_ID, JSON.stringify({ all: [{ fieldKey: "audience_legacy", op: "equals", value: "Tombstoned label" }] }), JSON.stringify({ add_tag_ids: [TAG_ID] }), NOW, NOW,
      EVENT_ID, JSON.stringify({ all: [{ fieldKey: "audience_level", op: "equals", value: DELETED_LEVEL_ID }] }), JSON.stringify({ track_id: TRACK_ID }), NOW, NOW),
  ]);

  const submissionStatements: D1PreparedStatement[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const submissionId = `submission_mrq229_preview_${String(index).padStart(3, "0")}`;
    const submittedAt = NOW + index;
    submissionStatements.push(insert(`INSERT INTO submissions
      (id, event_id, form_id, kind, bypass_evaluation, title, status, origin,
       submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
      VALUES (?, ?, ?, 'abstract', 0, ?, 'submitted', 'public', ?, ?, ?, ?, ?)`,
      submissionId, EVENT_ID, FORM_ID, `Preview arrival ${index}`, OWNER_ID, submittedAt, submittedAt, submittedAt, submittedAt));
    submissionStatements.push(insert(`INSERT INTO submission_answers
      (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      `answer_mrq229_preview_notes_${index}`, submissionId, FIELD_NOTES_ID,
      index === 0 ? "MRQ-229-OLD-MATCH" : "No preview marker", submittedAt, submittedAt));
    if (index === 100) {
      submissionStatements.push(insert(`INSERT INTO submission_answers
        (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        `answer_mrq229_preview_level_${index}`, submissionId, FIELD_LEVEL_ID,
        JSON.stringify({ id: LEVEL_ID, label: "Intermediate" }), submittedAt, submittedAt));
      submissionStatements.push(insert(`INSERT INTO submission_answers
        (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        `answer_mrq229_preview_tombstoned_${index}`, submissionId, FIELD_TOMBSTONED_ID,
        JSON.stringify({ id: DELETED_LEVEL_ID, label: "Tombstoned label" }), submittedAt, submittedAt));
    }
  }
  for (let offset = 0; offset < submissionStatements.length; offset += 50) {
    await env.DB.batch(submissionStatements.slice(offset, offset + 50));
  }
  await env.DB.prepare("UPDATE form_fields SET deleted_at = ? WHERE id = ?").bind(NOW + 1, FIELD_TOMBSTONED_ID).run();
  const owner = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq229-preview" });
  ownerCookie = `mq_session=${owner.id}`;
}

describe.sequential("MRQ-229 historical routing preview", () => {
  beforeEach(seedFixture);

  test("AC-373 · MRQ-229 · preview uses the last 100 public arrivals, preserves order states, resolves Level landing, and redacts answers", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/routing-preview`);
    expect(response.status).toBe(200);
    const body = await json<Envelope<{
      form_id: string;
      sample_size: number;
      last_arrival_at: number | null;
      max_sample_size: number;
      rules: PreviewRule[];
    }>>(response);

    expect(body.data).toMatchObject({ form_id: FORM_ID, sample_size: 100, last_arrival_at: NOW + 100, max_sample_size: 100 });
    expect(body.data.rules).toHaveLength(4);
    expect(body.data.rules[0]).toMatchObject({ rule_id: "rule_mrq229_preview_old", state: "matchable", would_have_matched: 0, rules_above: 0 });
    expect(body.data.rules[1]).toMatchObject({
      rule_id: "rule_mrq229_preview_level",
      state: "matchable",
      would_have_matched: 1,
      rules_above: 1,
      landing: { track_id: TRACK_ID, tag_ids: [TAG_ID], level_id: LEVEL_ID, plan_id: null, committee_id: null, round_id: null },
    });
    expect(body.data.rules[2]).toMatchObject({ rule_id: "rule_mrq229_preview_skipped", state: "skipped", would_have_matched: null, rules_above: 2, landing: null });
    expect(body.data.rules[3]).toMatchObject({ rule_id: "rule_mrq229_preview_dangling", state: "dangling", would_have_matched: null, rules_above: 3, landing: null });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("MRQ-229-OLD-MATCH");
    expect(serialized).not.toContain("Tombstoned label");
    expect((await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/routing-preview`, {}, null)).status).toBe(401);
  });
});

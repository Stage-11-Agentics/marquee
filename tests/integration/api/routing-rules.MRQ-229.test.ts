import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { sha256Hex } from "../../../src/lib/auth/random-token";
import { loadPublicForm } from "../../../src/routes/public-form.shared";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const ORG_ID = "org_mrq229_routing";
const EVENT_ID = "evt_mrq229_routing";
const OTHER_EVENT_ID = "evt_mrq229_other";
const FORM_ID = "form_mrq229_routing";
const SKIP_FORM_ID = "form_mrq229_skip";
const OWNER_ID = "person_mrq229_owner";
const REVIEWER_ID = "person_mrq229_reviewer";
const TRACK_FIRST = "track_mrq229_first";
const TRACK_SECOND = "track_mrq229_second";
const TRACK_OTHER = "track_mrq229_other";
const TAG_FIRST = "tag_mrq229_first";
const TAG_SECOND = "tag_mrq229_second";
const LEVEL_FIRST = "level_mrq229_first";
const LEVEL_SECOND = "level_mrq229_second";
const COMMITTEE_ID = "committee_mrq229";
const PLAN_ID = "plan_mrq229";
const ROUND_ID = "round_mrq229";

let ownerCookie = "";

interface Envelope<T> {
  data: T;
}

interface RuleView {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  dangling_references: string[];
  then_json: Record<string, unknown>;
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

async function createRule(input: {
  name: string;
  when: Array<{ fieldKey: string; op: string; value?: unknown }>;
  then: Record<string, unknown>;
  position?: number;
  enabled?: boolean;
}): Promise<RuleView> {
  const response = await request(`/api/v1/events/${EVENT_ID}/routing-rules`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      when_json: { all: input.when },
      then_json: input.then,
      ...(input.position === undefined ? {} : { position: input.position }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    }),
  });
  if (response.status !== 201) throw new Error(`create routing rule returned ${response.status}: ${await response.text()}`);
  return (await json<Envelope<RuleView>>(response)).data;
}

async function submit(
  title: string,
  email: string,
  notes: string,
  options: { formSlug?: string; outcome?: string; resumeToken?: string } = {},
): Promise<{ response: Response; body: Record<string, any> }> {
  const answers: Record<string, unknown> = {
    title,
    speaker_name: "MRQ-229 Speaker",
    speaker_email: email,
    notes,
  };
  if (options.outcome !== undefined) answers.audience_outcome = options.outcome;
  const response = await request(`/api/v1/public/forms/${options.formSlug ?? "mrq229-routing"}/submissions`, {
    method: "POST",
    body: JSON.stringify({
      answers,
      ...(options.resumeToken ? { resume_token: options.resumeToken } : {}),
    }),
  }, null);
  return { response, body: await json<Record<string, any>>(response) };
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    insert("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ORG_ID, "MRQ-229 Routing Org", "mrq229-routing", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)", EVENT_ID, ORG_ID, "MRQ-229 Routing Conference", "mrq229-routing", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)", OTHER_EVENT_ID, ORG_ID, "MRQ-229 Other Conference", "mrq229-other", "2026-11-12", "2026-11-14", "America/New_York", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", OWNER_ID, ORG_ID, "owner@mrq229.example", "MRQ-229 Owner", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", REVIEWER_ID, ORG_ID, "reviewer@mrq229.example", "MRQ-229 Reviewer", NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)", "membership_mrq229_owner", ORG_ID, OWNER_ID, NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)", "membership_mrq229_reviewer", ORG_ID, EVENT_ID, REVIEWER_ID, NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, name_key, color, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)", TRACK_FIRST, EVENT_ID, "MRQ-229 First Track", "mrq-229 first track", "#db4c3f", NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, name_key, color, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)", TRACK_SECOND, EVENT_ID, "MRQ-229 Second Track", "mrq-229 second track", "#0d9488", NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, name_key, color, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)", TRACK_OTHER, OTHER_EVENT_ID, "Other Track", "other track", "#7c3aed", NOW, NOW),
    insert("INSERT INTO tags (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", TAG_FIRST, EVENT_ID, "MRQ-229 First Tag", "mrq-229 first tag", NOW, NOW),
    insert("INSERT INTO tags (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)", TAG_SECOND, EVENT_ID, "MRQ-229 Second Tag", "mrq-229 second tag", NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", LEVEL_FIRST, EVENT_ID, "MRQ-229 First Level", "mrq-229 first level", NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)", LEVEL_SECOND, EVENT_ID, "MRQ-229 Second Level", "mrq-229 second level", NOW, NOW),
    insert("INSERT INTO evaluation_plans (id, event_id, name, instructions, status, created_at, updated_at) VALUES (?, ?, ?, '', 'open', ?, ?)", PLAN_ID, EVENT_ID, "MRQ-229 Review Plan", NOW, NOW),
    insert("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, ?, 'scorecard', 0, 1, ?, ?)", ROUND_ID, PLAN_ID, "MRQ-229 Round", NOW, NOW),
    insert("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", COMMITTEE_ID, EVENT_ID, "MRQ-229 Committee", NOW, NOW),
    insert("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, 'reviewer', ?, ?)", "committee_member_mrq229", COMMITTEE_ID, REVIEWER_ID, NOW, NOW),
    insert("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "scope_mrq229", EVENT_ID, REVIEWER_ID, TRACK_FIRST, NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-229 Routing Form', 'mrq229-routing', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, FORM_ID, EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-229 Skip Form', 'mrq229-skip', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, SKIP_FORM_ID, EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
  ]);
  await env.DB.batch([
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq229_title', ?, 'title', 'Title', 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq229_name', ?, 'speaker_name', 'Speaker name', 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq229_email', ?, 'speaker_email', 'Speaker email', 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq229_notes', ?, 'notes', 'Notes', 'long_text', 0, 3, '{}', NULL, ?, ?),
      ('field_mrq229_outcome', ?, 'audience_outcome', 'Audience outcome', 'single_select', 0, 4, ?, NULL, ?, ?),
      ('field_mrq229_level', ?, 'audience_level', 'Audience level', 'single_select', 0, 5, '{"source":"levels"}', NULL, ?, ?)`,
      FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW,
      FORM_ID, JSON.stringify({ options: ["Yes", "No"] }), NOW, NOW, FORM_ID, NOW, NOW),
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq229_skip_title', ?, 'title', 'Title', 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq229_skip_name', ?, 'speaker_name', 'Speaker name', 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq229_skip_email', ?, 'speaker_email', 'Speaker email', 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq229_skip_notes', ?, 'notes', 'Notes', 'long_text', 0, 3, '{}', NULL, ?, ?)`,
      SKIP_FORM_ID, NOW, NOW, SKIP_FORM_ID, NOW, NOW, SKIP_FORM_ID, NOW, NOW, SKIP_FORM_ID, NOW, NOW),
  ]);
  const owner = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq229-routing" });
  ownerCookie = `mq_session=${owner.id}`;
}

describe.sequential("MRQ-229 routing rules", () => {
  beforeEach(seedFixture);

  test("CONTRACT · MRQ-229 · CRUD validates taxonomy, soft-disables deleted fields, and archives rules", async () => {
    const createdTag = await request(`/api/v1/events/${EVENT_ID}/tags`, { method: "POST", body: JSON.stringify({ name: "Created tag" }) });
    expect(createdTag.status).toBe(201);
    const tag = (await json<Envelope<{ id: string; name: string }>>(createdTag)).data;
    expect(tag.name).toBe("Created tag");
    expect((await request(`/api/v1/events/${EVENT_ID}/tags`)).status).toBe(200);
    const renamedTag = await request(`/api/v1/events/${EVENT_ID}/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed tag" }) });
    expect(renamedTag.status).toBe(200);
    expect((await json<Envelope<{ name: string }>>(renamedTag)).data.name).toBe("Renamed tag");
    expect((await request(`/api/v1/events/${EVENT_ID}/tags/reorder`, { method: "PATCH", body: JSON.stringify({ tag_id: tag.id, position: 0 }) })).status).toBe(200);
    expect((await request(`/api/v1/events/${EVENT_ID}/tags/${tag.id}`, { method: "DELETE" })).status).toBe(200);

    const createdLevel = await request(`/api/v1/events/${EVENT_ID}/levels`, { method: "POST", body: JSON.stringify({ name: "Created level" }) });
    expect(createdLevel.status).toBe(201);
    const level = (await json<Envelope<{ id: string }>>(createdLevel)).data;
    expect((await request(`/api/v1/events/${EVENT_ID}/levels/${level.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed level" }) })).status).toBe(200);
    expect((await request(`/api/v1/events/${EVENT_ID}/levels/reorder`, { method: "PATCH", body: JSON.stringify({ level_id: level.id, position: 0 }) })).status).toBe(200);
    expect((await request(`/api/v1/events/${EVENT_ID}/levels/${level.id}`, { method: "DELETE" })).status).toBe(200);

    const firstRule = await createRule({
      name: "CRUD first rule",
      when: [{ fieldKey: "notes", op: "answered" }],
      then: { add_tag_ids: [TAG_FIRST] },
    });
    const secondRule = await createRule({
      name: "CRUD second rule",
      when: [{ fieldKey: "notes", op: "contains", value: "reorder" }],
      then: { level_id: LEVEL_FIRST },
    });
    const reorderedRules = await request(`/api/v1/events/${EVENT_ID}/routing-rules/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ rule_id: secondRule.id, position: 0 }),
    });
    expect(reorderedRules.status).toBe(200);
    expect((await json<Envelope<RuleView[]>>(reorderedRules)).data.map((rule) => rule.id)).toEqual([secondRule.id, firstRule.id]);
    const disabled = await request(`/api/v1/events/${EVENT_ID}/routing-rules/${secondRule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "CRUD second rule disabled", enabled: false }),
    });
    expect(disabled.status).toBe(200);
    expect((await json<Envelope<RuleView>>(disabled)).data).toMatchObject({ name: "CRUD second rule disabled", enabled: false });
  });

  test("CONTRACT · MRQ-229 · CRUD rejects a cross-event action and marks a rule dangling until its field returns", async () => {
    const foreign = await request(`/api/v1/events/${EVENT_ID}/routing-rules`, {
      method: "POST",
      body: JSON.stringify({ name: "Foreign destination", when_json: { all: [{ fieldKey: "notes", op: "answered" }] }, then_json: { track_id: TRACK_OTHER } }),
    });
    expect(foreign.status).toBe(422);

    const deletedTaxonomyRule = await createRule({
      name: "Deleted tag action",
      when: [{ fieldKey: "notes", op: "contains", value: "taxonomy" }],
      then: { add_tag_ids: [TAG_SECOND] },
    });
    expect((await request(`/api/v1/events/${EVENT_ID}/tags/${TAG_SECOND}`, { method: "DELETE" })).status).toBe(200);
    const afterTagDelete = await json<Envelope<RuleView[]>>(await request(`/api/v1/events/${EVENT_ID}/routing-rules`));
    expect(afterTagDelete.data.find((rule) => rule.id === deletedTaxonomyRule.id)).toMatchObject({ enabled: false, dangling_references: [`tag:${TAG_SECOND}`] });
    expect((await request(`/api/v1/events/${EVENT_ID}/routing-rules/${deletedTaxonomyRule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })).status).toBe(422);
    expect((await request(`/api/v1/events/${EVENT_ID}/routing-rules`, {
      method: "POST",
      body: JSON.stringify({ name: "Fresh deleted tag rule", when_json: { all: [{ fieldKey: "notes", op: "answered" }] }, then_json: { add_tag_ids: [TAG_SECOND] } }),
    })).status).toBe(422);

    const rule = await createRule({
      name: "Soft disabled outcome rule",
      when: [{ fieldKey: "audience_outcome", op: "equals", value: "Yes" }],
      then: { add_tag_ids: [TAG_FIRST] },
    });
    const deletedField = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields/field_mrq229_outcome`, { method: "DELETE" });
    expect(deletedField.status).toBe(200);
    const listed = await json<Envelope<RuleView[]>>(await request(`/api/v1/events/${EVENT_ID}/routing-rules`));
    const softDisabled = listed.data.find((item) => item.id === rule.id);
    expect(softDisabled).toMatchObject({ id: rule.id, enabled: false });
    expect(softDisabled?.dangling_references).toContain("field:audience_outcome");

    const reenableWhileMissing = await request(`/api/v1/events/${EVENT_ID}/routing-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(reenableWhileMissing.status).toBe(422);
    expect((await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields/field_mrq229_outcome/restore`, { method: "POST" })).status).toBe(200);
    const reenabled = await request(`/api/v1/events/${EVENT_ID}/routing-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(reenabled.status).toBe(200);
    expect((await json<Envelope<RuleView>>(reenabled)).data.enabled).toBe(true);
    expect((await request(`/api/v1/events/${EVENT_ID}/routing-rules/${rule.id}`, { method: "DELETE" })).status).toBe(200);
    const afterArchive = await json<Envelope<RuleView[]>>(await request(`/api/v1/events/${EVENT_ID}/routing-rules`));
    expect(afterArchive.data.some((item) => item.id === rule.id)).toBe(false);
    expect(afterArchive.data.find((item) => item.id === deletedTaxonomyRule.id)).toMatchObject({ enabled: false });
    expect((await request(`/api/v1/events/${EVENT_ID}/routing-rules` , {}, null)).status).toBe(401);
  });

  test("CONTRACT · MRQ-229 · first match wins across track, tag, level, and review actions, while a non-match is inert", async () => {
    const first = await createRule({
      name: "First arbitrary answer landing",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-ARBITRARY-ANSWER" }],
      then: { track_id: TRACK_FIRST, add_tag_ids: [TAG_FIRST], level_id: LEVEL_FIRST, committee_id: COMMITTEE_ID, round_id: ROUND_ID },
    });
    const second = await createRule({
      name: "Second answer landing must lose",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-ARBITRARY-ANSWER" }],
      then: { track_id: TRACK_SECOND, add_tag_ids: [TAG_SECOND], level_id: LEVEL_SECOND },
    });

    const matched = await submit("First match", "first-match@mrq229.example", "MRQ-229-ARBITRARY-ANSWER in an arbitrary answer");
    expect(matched.response.status).toBe(201);
    const matchedRow = await env.DB.prepare("SELECT id, applied_rule_id, primary_track_id, level_id FROM submissions WHERE title = ?").bind("First match").first<{ id: string; applied_rule_id: string; primary_track_id: string; level_id: string }>();
    expect(matchedRow).toMatchObject({ applied_rule_id: first.id, primary_track_id: TRACK_FIRST, level_id: LEVEL_FIRST });
    expect(matchedRow?.applied_rule_id).not.toBe(second.id);
    const tracks = await env.DB.prepare("SELECT track_id, is_primary FROM submission_tracks WHERE submission_id = ?").bind(matchedRow?.id).all<{ track_id: string; is_primary: number }>();
    expect(tracks.results).toEqual([{ track_id: TRACK_FIRST, is_primary: 1 }]);
    const tags = await env.DB.prepare("SELECT tag_id FROM submission_tags WHERE submission_id = ?").bind(matchedRow?.id).all<{ tag_id: string }>();
    expect(tags.results).toEqual([{ tag_id: TAG_FIRST }]);
    const assignment = await env.DB.prepare("SELECT reviewer_person_id FROM round_assignments WHERE submission_id = ?").bind(matchedRow?.id).first<{ reviewer_person_id: string | null }>();
    expect(assignment).toEqual({ reviewer_person_id: REVIEWER_ID });
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'submission.routed'").bind(matchedRow?.id).first<{ total: number }>())?.total)).toBe(1);

    const nonmatch = await submit("No match", "no-match@mrq229.example", "A completely different answer");
    expect(nonmatch.response.status).toBe(201);
    const nonmatchRow = await env.DB.prepare("SELECT id, applied_rule_id, primary_track_id, level_id FROM submissions WHERE title = ?").bind("No match").first<{ id: string; applied_rule_id: string | null; primary_track_id: string | null; level_id: string | null }>();
    expect(nonmatchRow).toMatchObject({ applied_rule_id: null, primary_track_id: null, level_id: null });
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM submission_tags WHERE submission_id = ?").bind(nonmatchRow?.id).first<{ total: number }>())?.total)).toBe(0);
  });

  test("CONTRACT · MRQ-229 · admin creation preserves caller routing and does not evaluate a matching public rule", async () => {
    const publicRule = await createRule({
      name: "Admin must not inherit public routing",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-ADMIN-MATCH" }],
      then: { track_id: TRACK_FIRST, add_tag_ids: [TAG_FIRST], level_id: LEVEL_FIRST },
    });
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "abstract",
        title: "Admin matching answer",
        form_id: FORM_ID,
        submitter_person_id: OWNER_ID,
        answers: [{ field_id: "field_mrq229_notes", value_text: "MRQ-229-ADMIN-MATCH" }],
        track_ids: [TRACK_SECOND],
        primary_track_id: TRACK_SECOND,
        applied_rule_id: publicRule.id,
      }),
    });
    expect(response.status).toBe(201);

    const row = await env.DB.prepare(
      "SELECT id, origin, applied_rule_id, primary_track_id, level_id FROM submissions WHERE title = ?",
    ).bind("Admin matching answer").first<{ id: string; origin: string; applied_rule_id: string | null; primary_track_id: string | null; level_id: string | null }>();
    expect(row).toEqual({ id: expect.any(String), origin: "admin", applied_rule_id: publicRule.id, primary_track_id: TRACK_SECOND, level_id: null });
    const tracks = await env.DB.prepare(
      "SELECT track_id, is_primary FROM submission_tracks WHERE submission_id = ?",
    ).bind(row?.id).all<{ track_id: string; is_primary: number }>();
    expect(tracks.results).toEqual([{ track_id: TRACK_SECOND, is_primary: 1 }]);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM submission_tags WHERE submission_id = ?").bind(row?.id).first<{ total: number }>())?.total)).toBe(0);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM round_assignments WHERE submission_id = ?").bind(row?.id).first<{ total: number }>())?.total)).toBe(0);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'submission.routed'").bind(row?.id).first<{ total: number }>())?.total)).toBe(0);
  });

  test("CONTRACT · MRQ-229 · missing form answers are skipped, and the next rule can still match", async () => {
    await createRule({
      name: "Outcome rule is skipped on this form",
      when: [{ fieldKey: "audience_outcome", op: "not_equals", value: "No" }],
      then: { add_tag_ids: [TAG_FIRST] },
      position: 0,
    });
    const landing = await createRule({
      name: "Notes rule still lands",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-SKIP" }],
      then: { level_id: LEVEL_FIRST },
      position: 1,
    });
    const submitted = await submit("Skipped condition", "skip@mrq229.example", "MRQ-229-SKIP proves the next rule ran", { formSlug: "mrq229-skip" });
    expect(submitted.response.status).toBe(201);
    const row = await env.DB.prepare("SELECT applied_rule_id, level_id FROM submissions WHERE title = ?").bind("Skipped condition").first<{ applied_rule_id: string; level_id: string }>();
    expect(row).toEqual({ applied_rule_id: landing.id, level_id: LEVEL_FIRST });
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM submission_tags st JOIN submissions s ON s.id = st.submission_id WHERE s.title = ?").bind("Skipped condition").first<{ total: number }>())?.total)).toBe(0);
  });

  test("CONTRACT · MRQ-229 · arrival idempotency and apply-once preserve an explicit organizer projection", async () => {
    const first = await createRule({
      name: "Apply once rule",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-APPLY-ONCE" }],
      then: { track_id: TRACK_FIRST, add_tag_ids: [TAG_FIRST], level_id: LEVEL_FIRST },
    });
    const initial = await submit("Apply once", "apply-once@mrq229.example", "MRQ-229-APPLY-ONCE");
    expect(initial.response.status).toBe(201);
    const token = initial.body.resume_token as string;
    const row = await env.DB.prepare("SELECT id, submitted_at FROM submissions WHERE title = ?").bind("Apply once").first<{ id: string; submitted_at: number }>();
    expect(token).toEqual(expect.any(String));
    expect(row).toBeTruthy();
    const arrivalHash = await env.DB.prepare("SELECT resume_token_hash FROM submission_arrivals WHERE submission_id = ?").bind(row?.id).first<{ resume_token_hash: string }>();
    expect(arrivalHash?.resume_token_hash).toBe(await sha256Hex(token));
    expect((await loadPublicForm(env.DB, "mrq229-routing", { resumeToken: token }))?.submission?.id).toBe(row?.id);

    const manual = await request(`/api/v1/events/${EVENT_ID}/submissions/${row?.id}/routing`, {
      method: "PUT",
      body: JSON.stringify({ track_ids: [TRACK_SECOND], primary_track_id: TRACK_SECOND, tag_ids: [TAG_SECOND], level_id: LEVEL_SECOND }),
    });
    expect(manual.status).toBe(200);
    const replay = await submit("Apply once", "apply-once@mrq229.example", "MRQ-229-APPLY-ONCE", { resumeToken: token });
    // The public submit route keeps its 201 response contract even when the
    // handler returns the already-claimed state; the database claims below are
    // what prove this was a replay rather than a second arrival.
    expect(replay.response.status).toBe(201);
    const after = await env.DB.prepare("SELECT id, submitted_at, applied_rule_id, primary_track_id, level_id FROM submissions WHERE title = ?").bind("Apply once").first<{ id: string; submitted_at: number; applied_rule_id: string; primary_track_id: string; level_id: string }>();
    expect(after).toMatchObject({ id: row?.id, submitted_at: row?.submitted_at, applied_rule_id: first.id, primary_track_id: TRACK_SECOND, level_id: LEVEL_SECOND });
    const afterTags = await env.DB.prepare("SELECT tag_id FROM submission_tags WHERE submission_id = ?").bind(row?.id).all<{ tag_id: string }>();
    expect(afterTags.results).toEqual([{ tag_id: TAG_SECOND }]);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM submission_arrivals WHERE submission_id = ?").bind(row?.id).first<{ total: number }>())?.total)).toBe(1);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'submission.routed'").bind(row?.id).first<{ total: number }>())?.total)).toBe(1);
  });

  test("CONTRACT · MRQ-229 · routing preview reports would-land-in counts without exposing answer values", async () => {
    const rule = await createRule({
      name: "Preview arbitrary answer",
      when: [{ fieldKey: "notes", op: "contains", value: "MRQ-229-PREVIEW-MARKER" }],
      then: { track_id: TRACK_FIRST, add_tag_ids: [TAG_FIRST], level_id: LEVEL_FIRST },
    });
    expect((await submit("Preview match", "preview-match@mrq229.example", "MRQ-229-PREVIEW-MARKER" )).response.status).toBe(201);
    expect((await submit("Preview miss", "preview-miss@mrq229.example", "not the marker" )).response.status).toBe(201);

    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/routing-preview`);
    expect(response.status).toBe(200);
    const body = await json<Envelope<{ form_id: string; sample_size: number; max_sample_size: number; rules: Array<{ rule_id: string; state: string; would_have_matched: number | null; landing: Record<string, unknown> | null }> }>>(response);
    expect(body.data).toMatchObject({ form_id: FORM_ID, sample_size: 2, max_sample_size: 100 });
    expect(body.data.rules).toHaveLength(1);
    expect(body.data.rules[0]).toMatchObject({ rule_id: rule.id, state: "matchable", would_have_matched: 1, landing: { track_id: TRACK_FIRST, tag_ids: [TAG_FIRST], level_id: LEVEL_FIRST } });
    expect(JSON.stringify(body)).not.toContain("MRQ-229-PREVIEW-MARKER");
    expect((await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/routing-preview`, {}, null)).status).toBe(401);
  });
});

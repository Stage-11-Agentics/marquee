import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_forms";
const MAIN_FORM_ID = "form_main";
const DRAFT_FORM_ID = "form_draft";

let ownerCookie = "";
let reviewerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind("org_forms", "Forms Org", "forms-org", now, now).run();
  await env.DB.prepare(
    `INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, 'org_forms', 'Forms Conference', 'forms-conference', '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', 1, ?, ?)`,
  ).bind(EVENT_ID, now, now).run();
  for (const [id, email, name] of [
    ["person_owner", "owner@forms.example", "Form Owner"],
    ["person_reviewer", "reviewer@forms.example", "Form Reviewer"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, 'org_forms', ?, ?, ?, ?)",
    ).bind(id, email, name, now, now).run();
  }
  await env.DB.prepare(
    `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
     VALUES ('membership_owner', 'org_forms', NULL, 'person_owner', 'owner', ?, ?),
            ('membership_reviewer', 'org_forms', ?, 'person_reviewer', 'reviewer', ?, ?)`,
  ).bind(now, now, EVENT_ID, now, now).run();
  // clock-check: allow — the form opens_at/closes_at window is compared as exact instants, not event-local calendar days
  await env.DB.prepare(
    `INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       thankyou_template_key, admin_notify_person_ids, turnstile_required, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    MAIN_FORM_ID, EVENT_ID, "Main call for speakers", "main-cfp", "abstract", "open",
    now - 10_000, now + 86_400_000, "Tell the conference what you are building.",
    3, 1, 4, 0, "submission_confirmation", "[]", 1, now, now,
  ).run();
  // clock-check: allow — the form opens_at/closes_at window is compared as exact instants, not event-local calendar days
  await env.DB.prepare(
    `INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       thankyou_template_key, admin_notify_person_ids, turnstile_required, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    DRAFT_FORM_ID, EVENT_ID, "Draft session intake", "draft-session", "session", "draft",
    null, now + 86_400_000, "", 3, 1, 4, 0, null, "[]", 1, now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
     VALUES
      ('field_gate', ?, 'vendor_content', 'Vendor content', NULL, 'single_select', 1, 0, ?, NULL, ?, ?),
      ('field_product', ?, 'vendor_product', 'Product or service', NULL, 'short_text', 1, 1, ?, ?, ?, ?)`,
  ).bind(
    MAIN_FORM_ID, JSON.stringify({ options: ["No", "Yes"] }), now, now,
    MAIN_FORM_ID, JSON.stringify({ minLength: 2 }), JSON.stringify({ all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] }), now, now,
  ).run();
  await env.DB.prepare(
    `INSERT INTO submissions
      (id, event_id, form_id, kind, title, origin, submitter_person_id, created_at, updated_at)
     VALUES ('submission_one', ?, ?, 'abstract', 'Existing response', 'public', 'person_owner', ?, ?)`,
  ).bind(EVENT_ID, MAIN_FORM_ID, now, now).run();
  const owner = await createSession(env.DB, { personId: "person_owner", userAgent: "forms-owner" });
  const reviewer = await createSession(env.DB, { personId: "person_reviewer", userAgent: "forms-reviewer" });
  ownerCookie = `mq_session=${owner.id}`;
  reviewerCookie = `mq_session=${reviewer.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

describe.sequential("MRQ-13 form builder API", () => {
  beforeEach(seedFixture);

  test("AC-17 · field CRUD and reorder preserve the builder order", async () => {
    const created = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "first_question", label: "First question", type: "short_text" }),
    });
    expect(created.status).toBe(201);
    const first = await json<{ id: string }>(created);
    const secondResponse = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "second_question", label: "Second question", type: "long_text" }),
    });
    expect(secondResponse.status).toBe(201);
    const second = await json<{ id: string }>(secondResponse);
    const patch = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/${first.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Renamed first question" }),
    });
    expect(patch.status).toBe(200);
    const reordered = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ field_ids: [second.id, first.id] }),
    });
    expect(reordered.status).toBe(200);
    expect((await json<{ data: Array<{ id: string; position: number; label: string }> }>(reordered)).data.map((field) => [field.id, field.position, field.label])).toEqual([
      [second.id, 0, "Second question"],
      [first.id, 1, "Renamed first question"],
    ]);
    const deleted = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/${second.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  test("CONTRACT · an unpublished form with no responses deletes its child fields and administrators", async () => {
    const addField = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "temporary", label: "Temporary", type: "short_text" }),
    });
    expect(addField.status).toBe(201);
    const addAdmin = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/admins`, {
      method: "POST",
      body: JSON.stringify({ person_id: "person_reviewer" }),
    });
    expect(addAdmin.status).toBe(201);
    const deleted = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const missing = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`);
    expect(missing.status).toBe(404);
  });

  test("AC-18 · the field registry accepts and returns all nine field types", async () => {
    const types = ["short_text", "long_text", "single_select", "multi_select", "url", "email", "file", "number", "date"];
    for (const type of types) {
      const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
        method: "POST",
        body: JSON.stringify({ key: `field_${type}`, label: type, type, config: type.includes("select") ? { options: ["Yes", "No"] } : {} }),
      });
      expect(response.status, type).toBe(201);
    }
    const listed = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`);
    expect((await json<{ data: Array<{ type: string }> }>(listed)).data.map((field) => field.type)).toEqual(types);
  });

  test("AC-19 · the detail preview is deep-equal to the ordered field schema", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`);
    expect(response.status).toBe(200);
    const form = await json<{ fields: Array<Record<string, unknown>>; preview_fields: Array<Record<string, unknown>> }>(response);
    expect(form.preview_fields).toEqual(form.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      position: field.position,
      required: field.required,
      condition: field.condition,
    })));
  });

  test("AC-20 · duplicate copies fields and settings but starts with zero responses", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}/duplicate`, { method: "POST" });
    expect(response.status).toBe(201);
    const copy = await json<{ id: string; name: string; kind: string; per_submitter_limit: number; fields: Array<Record<string, unknown>>; response_count: number }>(response);
    expect(copy.id).not.toBe(MAIN_FORM_ID);
    expect(copy.name).toBe("Main call for speakers copy");
    expect(copy.kind).toBe("abstract");
    expect(copy.per_submitter_limit).toBe(3);
    expect(copy.response_count).toBe(0);
    expect(copy.fields.map((field) => ({ ...field, id: undefined, form_id: undefined, created_at: undefined, updated_at: undefined }))).toEqual([
      { id: undefined, form_id: undefined, key: "vendor_content", label: "Vendor content", help_text: null, type: "single_select", required: true, position: 0, config: { options: ["No", "Yes"] }, condition: null, created_at: undefined, updated_at: undefined },
      { id: undefined, form_id: undefined, key: "vendor_product", label: "Product or service", help_text: null, type: "short_text", required: true, position: 1, config: { minLength: 2 }, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] }, created_at: undefined, updated_at: undefined },
    ]);
  });

  test("AC-21 · the target is selectable in draft and immutable after open", async () => {
    const changed = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ kind: "session" }) });
    expect(changed.status).toBe(200);
    const locked = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ kind: "session" }) });
    expect(locked.status).toBe(409);
    const catalog = await request(`/api/v1/events/${EVENT_ID}/forms?page=1&per_page=20&sort=name`);
    const forms = await json<{ data: Array<{ id: string; kind: string }> }>(catalog);
    expect(forms.data.find((form) => form.id === DRAFT_FORM_ID)?.kind).toBe("session");
  });

  test("AC-24 · per-field validation config and conditional rules round-trip", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}/fields/field_product`, {
      method: "PATCH",
      body: JSON.stringify({ config: { minLength: 4, maxLength: 120, pattern: "^[A-Z]" }, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "No" }] } }),
    });
    expect(response.status).toBe(200);
    expect(await json<{ config: unknown; condition: unknown }>(response)).toMatchObject({
      config: { minLength: 4, maxLength: 120, pattern: "^[A-Z]" },
      condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "No" }] },
    });
  });

  test("AC-27 · participant minimum defaults to one and min/max are configurable", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms`, {
      method: "POST",
      body: JSON.stringify({ name: "Default limits", slug: "default-limits" }),
    });
    expect(response.status).toBe(201);
    expect((await json<{ min_speakers: number; max_speakers: number }>(response))).toMatchObject({ min_speakers: 1, max_speakers: 4 });
  });

  test("AC-28 · maximum sponsors are stored as a form setting", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ max_sponsors: 3 }) });
    expect(response.status).toBe(200);
    expect((await json<{ max_sponsors: number }>(response)).max_sponsors).toBe(3);
  });

  test("AC-29 · participant limits reject an impossible server state", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ min_speakers: 5, max_speakers: 2 }) });
    expect(response.status).toBe(422);
  });

  test("AC-30 · welcome copy round-trips above the form fields", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ welcome_md: "Start with the problem your conference session solves." }) });
    expect(response.status).toBe(200);
    expect((await json<{ welcome_md: string }>(response)).welcome_md).toBe("Start with the problem your conference session solves.");
  });

  test("AC-31 · close and reopen preserve a readable form and public URL state", async () => {
    const opened = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/publish`, { method: "POST" });
    expect(opened.status).toBe(200);
    expect((await json<{ status: string; visibility: string; public_url: string | null }>(opened))).toMatchObject({ status: "open", visibility: "public", public_url: "/f/draft-session" });
    const closed = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/close`, { method: "POST" });
    expect(closed.status).toBe(200);
    expect((await json<{ status: string; visibility: string; public_url: string | null }>(closed))).toMatchObject({ status: "closed", visibility: "public", public_url: "/f/draft-session" });
    const reopened = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/reopen`, { method: "POST" });
    expect(reopened.status).toBe(200);
    expect((await json<{ status: string; public_url: string | null }>(reopened))).toMatchObject({ status: "open", public_url: "/f/draft-session" });
  });

  test("CONTRACT · an elapsed close date is closed in the catalog, detail, and status filters", async () => {
    // clock-check: allow — this is an intentional millisecond boundary transition for an exact-instant form close
    await env.DB.prepare("UPDATE forms SET closes_at = ? WHERE id = ?").bind(Date.now() - 1, MAIN_FORM_ID).run();

    const catalog = await request(`/api/v1/events/${EVENT_ID}/forms?page=1&per_page=20&sort=name`);
    const catalogBody = await json<{ data: Array<{ id: string; status: string; visibility: string; public_url: string | null }> }>(catalog);
    expect(catalogBody.data.find((form) => form.id === MAIN_FORM_ID)).toMatchObject({
      status: "closed",
      visibility: "public",
      public_url: "/f/main-cfp",
    });

    const detail = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`);
    expect((await json<{ status: string }>(detail)).status).toBe("closed");

    const openOnly = await request(`/api/v1/events/${EVENT_ID}/forms?page=1&per_page=20&status=open`);
    expect((await json<{ data: Array<{ id: string }> }>(openOnly)).data.some((form) => form.id === MAIN_FORM_ID)).toBe(false);
    const closedOnly = await request(`/api/v1/events/${EVENT_ID}/forms?page=1&per_page=20&status=closed`);
    expect((await json<{ data: Array<{ id: string }> }>(closedOnly)).data.some((form) => form.id === MAIN_FORM_ID)).toBe(true);
  });

  test("AC-32 · per-form limits are values, not a hard-coded constant", async () => {
    for (const limit of [1, 3, 5]) {
      const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ per_submitter_limit: limit }) });
      expect(response.status).toBe(200);
      expect((await json<{ per_submitter_limit: number; submitter_limit_inherit: boolean; effective_submitter_limit: number }>(response))).toMatchObject({
        per_submitter_limit: limit,
        submitter_limit_inherit: false,
        effective_submitter_limit: limit,
      });
    }
  });

  test("CONTRACT · MRQ-245 · omitted create inherits with a bound dormant value, while whole-object and flag-omitted PATCHes stay observable", async () => {
    const created = await request(`/api/v1/events/${EVENT_ID}/forms`, {
      method: "POST",
      body: JSON.stringify({ name: "Inherited capacity", slug: "inherited-capacity" }),
    });
    expect(created.status).toBe(201);
    expect((await json<{ per_submitter_limit: number; submitter_limit_inherit: boolean; effective_submitter_limit: number }>(created))).toMatchObject({
      per_submitter_limit: 3,
      submitter_limit_inherit: true,
      effective_submitter_limit: 3,
    });

    const changedDefault = await request(`/api/v1/events/${EVENT_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ submission_default_limit: 7 }),
    });
    expect(changedDefault.status).toBe(200);
    const wholeObject = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Builder rename", per_submitter_limit: 3, submitter_limit_inherit: true }),
    });
    expect(wholeObject.status).toBe(200);
    expect((await json<{ name: string; per_submitter_limit: number; submitter_limit_inherit: boolean; effective_submitter_limit: number }>(wholeObject))).toMatchObject({
      name: "Builder rename",
      per_submitter_limit: 3,
      submitter_limit_inherit: true,
      effective_submitter_limit: 7,
    });

    const explicit = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ per_submitter_limit: 5 }),
    });
    expect(explicit.status).toBe(200);
    expect((await json<{ submitter_limit_inherit: boolean; effective_submitter_limit: number }>(explicit))).toMatchObject({
      submitter_limit_inherit: false,
      effective_submitter_limit: 5,
    });
    const missingExplicitNumber = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ submitter_limit_inherit: false }),
    });
    expect(missingExplicitNumber.status).toBe(422);
    const cleared = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ submitter_limit_inherit: true }),
    });
    expect((await json<{ submitter_limit_inherit: boolean; effective_submitter_limit: number }>(cleared))).toMatchObject({
      submitter_limit_inherit: true,
      effective_submitter_limit: 7,
    });
    const zero = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ per_submitter_limit: 0 }),
    });
    expect(zero.status).toBe(400);
  });

  test("CONTRACT · MRQ-245 · a legacy stored zero stays unlimited on the read path without becoming a write affordance", async () => {
    await env.DB.prepare("UPDATE forms SET per_submitter_limit = 0, submitter_limit_inherit = 0 WHERE id = ?").bind(MAIN_FORM_ID).run();
    const detail = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`);
    expect(detail.status).toBe(200);
    expect((await json<{ per_submitter_limit: number; submitter_limit_inherit: boolean; effective_submitter_limit: number }>(detail))).toMatchObject({
      per_submitter_limit: 0,
      submitter_limit_inherit: false,
      effective_submitter_limit: 0,
    });
    const rejected = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ per_submitter_limit: 0 }),
    });
    expect(rejected.status).toBe(400);
  });

  test("AC-33 · thank-you and named-admin settings belong to the form", async () => {
    const addAdmin = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/admins`, { method: "POST", body: JSON.stringify({ person_id: "person_reviewer" }) });
    expect(addAdmin.status).toBe(201);
    const response = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}`, { method: "PATCH", body: JSON.stringify({ thankyou_template_key: "submission_thanks", admin_notify_person_ids: ["person_reviewer"] }) });
    expect(response.status).toBe(200);
    expect((await json<{ thankyou_template_key: string; admin_notify_person_ids: string[] }>(response))).toMatchObject({ thankyou_template_key: "submission_thanks", admin_notify_person_ids: ["person_reviewer"] });
  });

  test("CONTRACT · form administrators can read their form while reviewers without membership cannot", async () => {
    const denied = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`, {}, reviewerCookie);
    expect(denied.status).toBe(403);
    const addAdmin = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}/admins`, { method: "POST", body: JSON.stringify({ person_id: "person_reviewer" }) });
    expect(addAdmin.status).toBe(201);
    const allowed = await request(`/api/v1/events/${EVENT_ID}/forms/${MAIN_FORM_ID}`, {}, reviewerCookie);
    expect(allowed.status).toBe(200);
  });
});

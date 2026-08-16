import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq236";
const EVENT_ID = "evt_mrq236";
const OTHER_EVENT_ID = "evt_mrq236_other";
const DRAFT_FORM_ID = "form_mrq236_draft";
const OPEN_FORM_ID = "form_mrq236_open";
const CLOSED_FORM_ID = "form_mrq236_closed";

let ownerCookie = "";

interface ErrorBody {
  error: { message: string };
}

interface FieldBody {
  id: string;
  form_id: string;
  key: string;
  label: string;
  config: Record<string, unknown>;
  condition: Record<string, unknown> | null;
  library_field_id?: string;
  library_field_version?: number;
  warning?: {
    code: string;
    missing_keys: string[];
    message: string;
  } | null;
}

interface LibraryBody {
  id: string;
  event_id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  config: Record<string, unknown>;
  condition: Record<string, unknown> | null;
  condition_note: string | null;
  version: number;
  used_on_forms: number;
  stale_copy_count: number;
  on_destination_form: boolean;
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(ORG_ID, "MRQ-236 Org", "mrq236-org", now, now).run();
  for (const [id, name, slug] of [
    [EVENT_ID, "Question Library Conference", "mrq236-conference"],
    [OTHER_EVENT_ID, "Other Conference", "mrq236-other"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', 0, ?, ?)`,
    ).bind(id, ORG_ID, name, slug, now, now).run();
  }
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('person_mrq236_owner', ?, 'owner@mrq236.example', 'MRQ-236 Owner', ?, ?)",
  ).bind(ORG_ID, now, now).run();
  await env.DB.prepare(
    `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
     VALUES ('membership_mrq236_owner', ?, NULL, 'person_mrq236_owner', 'owner', ?, ?)`,
  ).bind(ORG_ID, now, now).run();

  for (const [id, eventId, name, slug, status, closesAt] of [
    [DRAFT_FORM_ID, EVENT_ID, "Draft intake", "mrq236-draft", "draft", now + 3 * 86_400_000],
    [OPEN_FORM_ID, EVENT_ID, "Open intake", "mrq236-open", "open", now + 3 * 86_400_000],
    [CLOSED_FORM_ID, EVENT_ID, "Closed intake", "mrq236-closed", "closed", now + 3 * 86_400_000],
  ] as const) {
    // clock-check: allow — open fixtures need an already-started window; every close time remains three days ahead.
    await env.DB.prepare(
      `INSERT INTO forms
        (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
         per_submitter_limit, min_speakers, max_speakers, max_sponsors,
         thankyou_template_key, admin_notify_person_ids, turnstile_required, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'abstract', ?, ?, ?, '', 3, 1, 4, 0, NULL, '[]', 1, ?, ?)`,
    ).bind(id, eventId, name, slug, status, status === "draft" ? null : now - 10_000, closesAt, now, now).run();
  }
  const owner = await createSession(env.DB, {
    personId: "person_mrq236_owner",
    roleHint: "owner",
    userAgent: "mrq236-owner",
    now,
  });
  ownerCookie = `mq_session=${owner.id}`;
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

describe.sequential("MRQ-236 event-scoped question library", () => {
  beforeEach(seedFixture);

  test("creates searchable definitions and excludes participant machinery", async () => {
    const created = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({
        key: "audience_focus",
        label: "Audience focus",
        help_text: "Who should leave knowing what?",
        type: "short_text",
        config: { maxLength: 240 },
        condition: { all: [{ fieldKey: "audience_type", op: "equals", value: "Developers" }] },
      }),
    });
    expect(created.status).toBe(201);
    const library = await json<LibraryBody>(created);
    expect(library).toMatchObject({
      event_id: EVENT_ID,
      key: "audience_focus",
      version: 1,
      used_on_forms: 0,
      stale_copy_count: 0,
      condition_note: "audience_type equals Developers",
    });
    expect(library.config).toEqual({ maxLength: 240 });

    const rejected = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({ key: "speaker_email", label: "Speaker email", type: "email" }),
    });
    expect(rejected.status).toBe(422);
    expect((await json<ErrorBody>(rejected)).error.message).toContain("participant machinery");

    const listed = await request(`/api/v1/events/${EVENT_ID}/field-library?search=FOCUS&form_id=${DRAFT_FORM_ID}`);
    expect(listed.status).toBe(200);
    const rows = await json<{ data: LibraryBody[] }>(listed);
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0]).toMatchObject({ id: library.id, on_destination_form: false });
  });

  test("copies a self-contained snapshot, tracks stale versions, and protects referenced definitions", async () => {
    const created = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({
        key: "audience_focus",
        label: "Audience focus",
        type: "short_text",
        config: { maxLength: 240 },
        condition: { all: [{ fieldKey: "audience_type", op: "equals", value: "Developers" }] },
      }),
    });
    const library = await json<LibraryBody>(created);

    const trigger = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "audience_type", label: "Audience type", type: "single_select", config: { options: ["Developers", "Designers"] } }),
    });
    expect(trigger.status).toBe(201);

    const copiedResponse = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: library.id }),
    });
    expect(copiedResponse.status).toBe(201);
    const copied = await json<FieldBody>(copiedResponse);
    expect(copied).toMatchObject({
      form_id: DRAFT_FORM_ID,
      key: "audience_focus",
      label: "Audience focus",
      config: { maxLength: 240 },
      library_field_id: library.id,
      library_field_version: 1,
      warning: null,
    });
    expect(copied.condition).toEqual({ all: [{ fieldKey: "audience_type", op: "equals", value: "Developers" }] });

    const destinationLibrary = await request(`/api/v1/events/${EVENT_ID}/field-library?form_id=${DRAFT_FORM_ID}`);
    expect((await json<{ data: LibraryBody[] }>(destinationLibrary)).data.find((row) => row.id === library.id)?.on_destination_form).toBe(true);

    const duplicate = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: library.id }),
    });
    expect(duplicate.status).toBe(409);

    const edited = await request(`/api/v1/events/${EVENT_ID}/field-library/${library.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Updated audience focus", config: { maxLength: 220 } }),
    });
    expect(edited.status).toBe(200);
    expect((await json<LibraryBody>(edited))).toMatchObject({ version: 2, stale_copy_count: 1 });

    const fields = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`);
    const copiedAfterEdit = (await json<{ data: FieldBody[] }>(fields)).data.find((field) => field.id === copied.id);
    expect(copiedAfterEdit).toMatchObject({ label: "Audience focus", config: { maxLength: 240 }, library_field_version: 1 });

    const referencedDelete = await request(`/api/v1/events/${EVENT_ID}/field-library/${library.id}`, { method: "DELETE" });
    expect(referencedDelete.status).toBe(409);

    const openCopy = await request(`/api/v1/events/${EVENT_ID}/forms/${OPEN_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: library.id }),
    });
    expect(openCopy.status).toBe(409);
    const closedCopy = await request(`/api/v1/events/${EVENT_ID}/forms/${CLOSED_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: library.id }),
    });
    expect(closedCopy.status).toBe(409);

    const unused = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({ key: "unused_question", label: "Unused question", type: "long_text" }),
    });
    const unusedLibrary = await json<LibraryBody>(unused);
    const deleted = await request(`/api/v1/events/${EVENT_ID}/field-library/${unusedLibrary.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  test("warns when a copied condition has no destination trigger and supports save-to-library", async () => {
    const conditional = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({
        key: "conditional_question",
        label: "Conditional question",
        type: "long_text",
        condition: { all: [{ fieldKey: "missing_trigger", op: "answered" }] },
      }),
    });
    const conditionalLibrary = await json<LibraryBody>(conditional);

    const copiedResponse = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: conditionalLibrary.id }),
    });
    expect(copiedResponse.status).toBe(201);
    const copied = await json<FieldBody>(copiedResponse);
    expect(copied.condition).toBeNull();
    expect(copied.warning).toMatchObject({
      code: "missing_condition_trigger",
      missing_keys: ["missing_trigger"],
    });
    expect(copied.warning?.message).toContain("shows unconditionally until re-pointed");

    const saved = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "saved_question", label: "Saved question", type: "short_text", save_to_library: true }),
    });
    expect(saved.status).toBe(201);
    const savedField = await json<FieldBody>(saved);
    expect(savedField.library_field_id).toBeTruthy();
    expect(savedField.library_field_version).toBe(1);
    const savedLibrary = await request(`/api/v1/events/${EVENT_ID}/field-library?search=saved_question`);
    expect((await json<{ data: LibraryBody[] }>(savedLibrary)).data).toHaveLength(1);

    const participantSave = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "co_speaker_email", label: "Co-speaker email", type: "email", save_to_library: true }),
    });
    expect(participantSave.status).toBe(422);

    const directField = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields`, {
      method: "POST",
      body: JSON.stringify({ key: "manual_question", label: "Manual question", type: "short_text" }),
    });
    expect(directField.status).toBe(201);
    const manualLibrary = await request(`/api/v1/events/${EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({ key: "manual_question", label: "Reusable manual question", type: "short_text" }),
    });
    expect(manualLibrary.status).toBe(201);
    const manual = await json<LibraryBody>(manualLibrary);
    const manualCopy = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: manual.id }),
    });
    expect(manualCopy.status).toBe(409);
    const listed = await request(`/api/v1/events/${EVENT_ID}/field-library?form_id=${DRAFT_FORM_ID}&search=manual_question`);
    expect((await json<{ data: LibraryBody[] }>(listed)).data[0]?.on_destination_form).toBe(true);
  });

  test("keeps definitions event-scoped and requires authoring authentication", async () => {
    const other = await request(`/api/v1/events/${OTHER_EVENT_ID}/field-library`, {
      method: "POST",
      body: JSON.stringify({ key: "other_question", label: "Other question", type: "short_text" }),
    });
    expect(other.status).toBe(201);
    const otherLibrary = await json<LibraryBody>(other);

    const primaryList = await request(`/api/v1/events/${EVENT_ID}/field-library`);
    expect((await json<{ data: LibraryBody[] }>(primaryList)).data).toEqual([]);
    const crossed = await request(`/api/v1/events/${EVENT_ID}/forms/${DRAFT_FORM_ID}/fields/from-library`, {
      method: "POST",
      body: JSON.stringify({ library_field_id: otherLibrary.id }),
    });
    expect(crossed.status).toBe(404);

    const unauthenticated = await request(`/api/v1/events/${EVENT_ID}/field-library`, {}, "");
    expect(unauthenticated.status).toBe(401);
  });
});

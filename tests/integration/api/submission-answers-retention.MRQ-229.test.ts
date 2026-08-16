import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { listFormFields } from "../../../src/routes/forms.queries";
import { replaceProjectedAnswers } from "../../../src/routes/public-form.shared";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const ORG_ID = "org_mrq229_retention";
const EVENT_ID = "evt_mrq229_retention";
const FORM_ID = "form_mrq229_retention";
const OWNER_ID = "person_mrq229_retention_owner";
const LEVEL_ID = "level_mrq229_retention";

let ownerCookie = "";

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
    insert("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ORG_ID, "MRQ-229 Retention Org", "mrq229-retention", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)", EVENT_ID, ORG_ID, "MRQ-229 Retention Conference", "mrq229-retention", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", OWNER_ID, ORG_ID, "owner@mrq229-retention.example", "MRQ-229 Retention Owner", NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)", "membership_mrq229_retention", ORG_ID, OWNER_ID, NOW, NOW),
    insert("INSERT INTO levels (id, event_id, name, name_key, position, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)", LEVEL_ID, EVENT_ID, "Advanced", "advanced", NOW, NOW),
    insert(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-229 Retention Form', 'mrq229-retention', 'abstract', 'open', ?, ?, '', 10, 1, 4, 0, '[]', 0, ?, ?)`, FORM_ID, EVENT_ID, NOW - 10_000, NOW + 86_400_000, NOW, NOW),
    insert(`INSERT INTO form_fields
      (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq229_retention_title', ?, 'title', 'Title', 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq229_retention_name', ?, 'speaker_name', 'Speaker name', 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq229_retention_email', ?, 'speaker_email', 'Speaker email', 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq229_retention_level', ?, 'audience_level', 'Audience level', 'single_select', 0, 3, '{"source":"levels"}', NULL, ?, ?),
      ('field_mrq229_retention_notes', ?, 'notes', 'Notes', 'long_text', 0, 4, '{}', NULL, ?, ?)`,
      FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq229-retention" });
  ownerCookie = `mq_session=${session.id}`;
}

beforeEach(seedFixture);

test("CONTRACT · MRQ-229 · answer edits retain an omitted tombstoned level and explicit removal deletes only that answer", async () => {
  const submitted = await request("/api/v1/public/forms/mrq229-retention/submissions", {
    method: "POST",
    body: JSON.stringify({
      answers: {
        title: "Original retention answer",
        speaker_name: "Retention Speaker",
        speaker_email: "retention@example.test",
        audience_level: "Advanced",
        notes: "Keep this answer too",
      },
    }),
  }, null);
  expect(submitted.status).toBe(201);
  const submittedBody = await json<{ resume_token: string }>(submitted);
  const submission = await env.DB.prepare("SELECT id FROM submissions WHERE title = ?").bind("Original retention answer").first<{ id: string }>();
  expect(submission?.id).toBeTruthy();
  const before = await env.DB.prepare("SELECT field_id, value_text, value_json FROM submission_answers WHERE submission_id = ? AND field_id = 'field_mrq229_retention_level'").bind(submission?.id).first<{ field_id: string; value_text: string; value_json: string }>();
  expect(before).toEqual({ field_id: "field_mrq229_retention_level", value_text: "Advanced", value_json: JSON.stringify({ bound_source: "levels", id: LEVEL_ID, label: "Advanced" }) });

  const archived = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields/field_mrq229_retention_level`, { method: "DELETE" });
  expect(archived.status).toBe(200);
  const edited = await request(`/api/v1/public/forms/mrq229-retention/submissions/${submittedBody.resume_token}`, {
    method: "PATCH",
    body: JSON.stringify({ answers: { title: "Edited without level field" } }),
  }, null);
  expect(edited.status).toBe(200);
  const retained = await env.DB.prepare("SELECT field_id, value_text, value_json FROM submission_answers WHERE submission_id = ? AND field_id = 'field_mrq229_retention_level'").bind(submission?.id).first<{ field_id: string; value_text: string; value_json: string }>();
  expect(retained).toEqual(before);
  const publicAfterArchive = await json<{ fields: Array<{ key: string }> }>(await request("/api/v1/public/forms/mrq229-retention", {}, null));
  expect(publicAfterArchive.fields.some((field) => field.key === "audience_level")).toBe(false);

  const restored = await request(`/api/v1/events/${EVENT_ID}/forms/${FORM_ID}/fields/field_mrq229_retention_level/restore`, { method: "POST" });
  expect(restored.status).toBe(200);
  const publicAfterRestore = await json<{ fields: Array<{ key: string }> }>(await request("/api/v1/public/forms/mrq229-retention", {}, null));
  expect(publicAfterRestore.fields.some((field) => field.key === "audience_level")).toBe(true);

  const fields = await listFormFields(env.DB, FORM_ID);
  await replaceProjectedAnswers(env.DB, submission!.id, fields, {
    title: "Edited without level field",
    speaker_name: "Retention Speaker",
    speaker_email: "retention@example.test",
    notes: "Keep this answer too",
  }, Date.now(), ["field_mrq229_retention_level"]);
  const removed = await env.DB.prepare("SELECT id FROM submission_answers WHERE submission_id = ? AND field_id = 'field_mrq229_retention_level'").bind(submission?.id).first();
  expect(removed).toBeNull();
  const retainedNotes = await env.DB.prepare("SELECT value_text FROM submission_answers WHERE submission_id = ? AND field_id = 'field_mrq229_retention_notes'").bind(submission?.id).first<{ value_text: string }>();
  expect(retainedNotes?.value_text).toBe("Keep this answer too");
});

import { beforeEach, expect, test } from "vitest";

import {
  connectMirror,
  mapMirror,
  type MirrorActionEnvironment,
  type MirrorMappingInput,
} from "../../src/jobs/mirror/actions";
import { currentAirtableRecord, MIRRORED_TABLES, type MirroredTable } from "../../src/jobs/mirror/records";
import { FakeAirtableTransport } from "../../src/jobs/mirror/fake-transport";
import {
  airtableValueMatchesType,
  createFieldPayload,
  createTableFields,
  ensureMirrorSchema,
  MIRROR_FIELD_COUNTS,
  MIRROR_TABLE_SCHEMA,
  mirrorRecordMatchesSchema,
} from "../../src/jobs/mirror/schema";
import { createFetchAirtableTransport, type AirtableTable } from "../../src/jobs/mirror/transport";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const ORG_ID = "org_mrq248";
const PERSON_ID = "per_mrq248";
const EVENT_ID = "evt_mrq248";
const SUBMISSION_ID = "sub_mrq248";
const TASK_ID = "task_mrq248";
const TEMPLATE_ID = "template_mrq248";
const BASE_ID = "app_mrq248_fake";
const TOKEN = "pat_mrq248_fake";
const MIRROR_SECRET = "mrq248-credential-encryption-secret";

function clockAt(start = NOW) {
  let now = start;
  return {
    now: () => now,
    sleep: async (milliseconds: number) => { now += milliseconds; },
  };
}

function actionEnvironment(fake: FakeAirtableTransport): MirrorActionEnvironment {
  return {
    ...env,
    MIRROR_CREDENTIAL_SECRET: MIRROR_SECRET,
    MIRROR_TRANSPORT: fake,
  } as unknown as MirrorActionEnvironment;
}

function tableFor(role: MirroredTable, id: string, name = MIRROR_TABLE_SCHEMA[role].name): AirtableTable {
  const fields = MIRROR_TABLE_SCHEMA[role].fields.map((field, index) => ({
    id: `fld_${id}_${index}`,
    name: field.name,
    type: field.type,
    ...(field.options === undefined ? {} : { options: structuredClone(field.options) }),
  }));
  return {
    id,
    name,
    primaryFieldId: fields[0]?.id,
    fields,
  };
}

function fullTables(
  ids: Partial<Record<MirroredTable, string>> = {},
  names: Partial<Record<MirroredTable, string>> = {},
): AirtableTable[] {
  return MIRRORED_TABLES.map((role) => tableFor(role, ids[role] ?? `tbl_${role}`, names[role] ?? `Organizer ${role}`));
}

function mappingFor(tables: readonly AirtableTable[]): MirrorMappingInput {
  const bySuffix = (suffix: string) => tables.find((table) => table.name.toLocaleLowerCase().endsWith(suffix))?.id ?? "";
  return { submissions: bySuffix("submissions"), speaker_tasks: bySuffix("speaker tasks") || bySuffix("speaker_tasks"), people: bySuffix("people") };
}

async function seedOwner(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'MRQ-248', 'mrq248', ?, ?)",
    ).bind(ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, title, company, social_links, custom_fields, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, 'speaker@mrq248.test', 'MRQ-248 Speaker', 'Title', 'Company', '{"z":1,"a":2}', '{"b":2,"a":1}', 1, 'marquee', ?, ?)`,
    ).bind(PERSON_ID, ORG_ID, NOW, NOW),
  ]);
}

async function seedCurrentRows(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'MRQ-248 Event', 'mrq248-event', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, vendor_affiliation,
         submitter_person_id, decided_at, submitted_at, last_saved_at, is_published, created_at, updated_at)
       VALUES (?, ?, 'session', 1, 'Submission', 'Long abstract', 'submitted', 'admin', 'none', ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, PERSON_ID, NOW - 5_000, NOW - 4_000, NOW - 3_000, NOW - 2_000, NOW - 1_000),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, due_offset_days, position, created_at, updated_at)
       VALUES (?, ?, 'Task', 'acknowledge', 7, 0, ?, ?)`,
    ).bind(TEMPLATE_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO speaker_tasks
        (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, response_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Confirm details', 'acknowledge', 'Long task description', ?, 'open', '{"z":2,"a":1}', ?, ?)`,
    ).bind(TASK_ID, EVENT_ID, PERSON_ID, SUBMISSION_ID, TEMPLATE_ID, NOW + 7 * 86_400_000, NOW, NOW),
  ]);
}

async function verifyConnection(fake: FakeAirtableTransport, intent: "verify" | "provision" = "verify", mapping?: Partial<MirrorMappingInput>, clock = clockAt()) {
  const result = await connectMirror(actionEnvironment(fake), {
    baseId: BASE_ID,
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    intent,
    mapping,
    now: NOW,
    clock,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

async function mapAll(
  fake: FakeAirtableTransport,
  mapping: MirrorMappingInput,
  clock = clockAt(),
  baseId = BASE_ID,
  token = TOKEN,
) {
  let continuation: MirroredTable | null = "submissions";
  let result: Awaited<ReturnType<typeof mapMirror>> | null = null;
  while (continuation) {
    result = await mapMirror(actionEnvironment(fake), {
      mapping,
      orgId: ORG_ID,
      baseId,
      setByPersonId: PERSON_ID,
      token,
      intent: "adopt",
      continuation,
      now: NOW,
      clock,
    });
    if (!result.ok) throw new Error(result.message);
    continuation = result.continuation ?? null;
  }
  if (!result) throw new Error("mapping did not run");
  return result;
}

beforeEach(async () => {
  await applyMigrations();
  await seedOwner();
});

test("MRQ-248 · fetch transport sends canonical metadata paths and bodies", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const isField = url.endsWith("/tables/tbl_sessions/fields");
    return Response.json(isField
      ? { id: "fld_submitted_at", name: "submitted_at", type: "dateTime", options: MIRROR_TABLE_SCHEMA.submissions.fields.find((field) => field.name === "submitted_at")!.options }
      : { id: "tbl_sessions", name: "Submissions", fields: createTableFields("submissions") });
  };
  const transport = createFetchAirtableTransport({
    apiKey: "pat_hermetic",
    baseId: "app base/with slash",
    apiOrigin: "https://airtable.example.test",
    fetcher,
  });
  await transport.createTable({ name: "Submissions", fields: createTableFields("submissions") });
  const submittedAt = MIRROR_TABLE_SCHEMA.submissions.fields.find((field) => field.name === "submitted_at")!;
  await transport.createField({ tableId: "tbl_sessions", ...createFieldPayload(submittedAt) });

  expect(requests.map((request) => request.url)).toEqual([
    "https://airtable.example.test/v0/meta/bases/app%20base%2Fwith%20slash/tables",
    "https://airtable.example.test/v0/meta/bases/app%20base%2Fwith%20slash/tables/tbl_sessions/fields",
  ]);
  expect(requests[0]?.init).toMatchObject({
    method: "POST",
    body: JSON.stringify({ name: "Submissions", fields: createTableFields("submissions") }),
  });
  expect(requests[1]?.init).toMatchObject({
    method: "POST",
    body: JSON.stringify({ name: "submitted_at", type: "dateTime", options: submittedAt.options }),
  });
});

test("MRQ-248 · schema keys, preferred shapes, and canonical record values are exhaustive", async () => {
  expect(MIRROR_FIELD_COUNTS).toEqual({ submissions: 27, speaker_tasks: 19, people: 17 });
  expect(MIRROR_TABLE_SCHEMA.submissions.fields.some((field) => field.name === "reference_code")).toBe(true);
  expect(MIRROR_TABLE_SCHEMA.submissions.fields.find((field) => field.name === "submitted_at")?.options).toEqual({
    timeZone: "utc",
    dateFormat: { name: "iso" },
    timeFormat: { name: "24hour" },
  });
  for (const role of MIRRORED_TABLES) {
    const fields = MIRROR_TABLE_SCHEMA[role].fields;
    expect(fields[0]?.name).toBe("marquee_id");
    expect(new Set(fields.map((field) => field.name)).size).toBe(fields.length);
    for (const field of fields) {
      expect(airtableValueMatchesType(field.type, field.representative), `${role}.${field.name}`).toBe(true);
      expect(field.acceptedTypes.every((type) => airtableValueMatchesType(type, field.representative))).toBe(true);
    }
  }
  const wrongPrimary = tableFor("submissions", "tbl_wrong_primary", "Submissions");
  wrongPrimary.primaryFieldId = wrongPrimary.fields!.find((field) => field.name === "title")?.id;
  expect(ensureMirrorSchema("submissions", wrongPrimary, "adopt").issues[0]).toMatchObject({ code: "primary_field_conflict" });
  expect(airtableValueMatchesType("checkbox", 1)).toBe(false);
  expect(airtableValueMatchesType("dateTime", NOW)).toBe(false);
  expect(airtableValueMatchesType("multipleAttachments", [{ url: "https://example.test", content_type: "text/plain" }])).toBe(false);

  await seedCurrentRows();
  const mirror = { mediaPublicOrigin: "media.example.test", uploadTokenSecret: "upload-secret" };
  const records = await Promise.all(MIRRORED_TABLES.map(async (role) => [
    role,
    await currentAirtableRecord({ DB: env.DB, mirror }, role, role === "submissions" ? SUBMISSION_ID : role === "speaker_tasks" ? TASK_ID : PERSON_ID),
  ] as const));
  for (const [role, record] of records) {
    expect(record).not.toBeNull();
    expect(mirrorRecordMatchesSchema(role, record!.fields)).toBe(true);
    for (const [name, value] of Object.entries(record!.fields)) {
      const field = MIRROR_TABLE_SCHEMA[role].fields.find((candidate) => candidate.name === name);
      expect(field).toBeDefined();
      expect(airtableValueMatchesType(field!.type, value), `${role}.${name}`).toBe(true);
    }
    expect(record!.fields.response_json ?? "").not.toBe("\"{\\\"z\\\":2}\"");
  }
  expect(records.find(([role]) => role === "people")?.[1]?.fields.social_links).toBe('{"a":2,"z":1}');
  expect(records.find(([role]) => role === "submissions")?.[1]?.fields.created_at).toBe(new Date(NOW - 2_000).toISOString());
});

test("MRQ-248 · verify is advisory, fresh/default bases offer explicit provisioning, and organizer Table 1 stays untouched", async () => {
  const clock = clockAt();
  const fake = new FakeAirtableTransport(clock.now, {
    tables: [{ id: "tbl_table_1", name: "Table 1", fields: [] }],
  });
  const verified = await verifyConnection(fake, "verify", undefined, clock);
  expect(verified.needsProvisioning).toBe(true);
  expect(verified.readiness.roles.map((role) => role.state)).toEqual(["missing", "missing", "missing"]);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM mirror_credentials").first<{ count: number }>()).toMatchObject({ count: 0 });
  const beforeProvision = fake.calls.length;
  const provisioned = await verifyConnection(fake, "provision", undefined, clock);
  expect(provisioned.needsProvisioning).toBe(false);
  expect(fake.tables.find((table) => table.id === "tbl_table_1")).toMatchObject({ name: "Table 1", fields: [] });
  const created = fake.calls.filter((call) => call.kind === "create_table");
  expect(created).toHaveLength(3);
  expect(new Set(created.map((call) => call.tableId)).size).toBe(3);
  expect(created.map((call) => call.fields.length)).toEqual([27, 19, 17]);
  expect(created.find((call) => call.name === "Submissions")?.fields.some((field) => field.name === "reference_code")).toBe(true);
  expect(created.every((call) => call.fields[0]?.name === "marquee_id")).toBe(true);
  expect(provisioned.tableActions).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "submissions", outcome: "created" }),
    expect.objectContaining({ role: "speaker_tasks", outcome: "created" }),
    expect.objectContaining({ role: "people", outcome: "created" }),
  ]));
  const metadataCalls = fake.calls.slice(beforeProvision).filter((call) => call.kind === "schema" || call.kind === "create_table");
  expect(metadataCalls.map((call) => call.at).every((at, index, values) => index === 0 || at - values[index - 1] >= 250)).toBe(true);
});

test("MRQ-248 · submitted differently named IDs are authoritative and map without createTable", async () => {
  const tables = fullTables(
    { submissions: "tbl_call_for_papers", speaker_tasks: "tbl_followups", people: "tbl_roster" },
    { submissions: "Sessions", speaker_tasks: "Follow-ups", people: "Humans" },
  );
  const fake = new FakeAirtableTransport(() => NOW, { tables });
  const verified = await verifyConnection(fake);
  expect(verified.needsProvisioning).toBe(false);
  const submittedMapping = {
    submissions: "tbl_call_for_papers",
    speaker_tasks: "tbl_followups",
    people: "tbl_roster",
  };
  const mapped = await mapAll(fake, submittedMapping);
  expect(mapped.complete).toBe(true);
  expect(fake.calls.filter((call) => call.kind === "create_table")).toHaveLength(0);
  expect(await env.DB.prepare("SELECT table_name, airtable_table_id FROM mirror_state ORDER BY table_name").all()).toMatchObject({
    results: [
      { table_name: "people", airtable_table_id: "tbl_roster" },
      { table_name: "speaker_tasks", airtable_table_id: "tbl_followups" },
      { table_name: "submissions", airtable_table_id: "tbl_call_for_papers" },
    ],
  });
  expect(fake.calls.filter((call) => call.kind === "create_webhook")).toHaveLength(1);
});

test("MRQ-248 · partial templates preserve submitted IDs and organizer columns while creating only unfilled roles", async () => {
  const submissions = tableFor("submissions", "tbl_sessions_template", "Sessions");
  submissions.fields = [
    submissions.fields![0],
    { id: "fld_organizer_notes", name: "Organizer notes", type: "multilineText", options: { sentinel: "kept-byte-for-byte" } },
  ];
  const fake = new FakeAirtableTransport(() => NOW, { tables: [submissions] });
  const provisioned = await verifyConnection(fake, "provision", { submissions: submissions.id });
  expect(provisioned.complete).toBe(false);
  expect(provisioned.continuation).toBe("submissions");
  expect(fake.calls.filter((call) => call.kind === "create_table")).toHaveLength(2);
  expect(fake.calls.filter((call) => call.kind === "create_field")).toHaveLength(0);
  expect(provisioned.tableActions).toEqual(expect.arrayContaining([
    { role: "submissions", table_id: submissions.id, outcome: "adopted" },
    expect.objectContaining({ role: "speaker_tasks", outcome: "created" }),
    expect.objectContaining({ role: "people", outcome: "created" }),
  ]));
  expect(provisioned.progress?.find((row) => row.role === "submissions")?.organizer_fields).toEqual(["Organizer notes"]);

  const mapping = Object.fromEntries(provisioned.tableActions!.map((action) => [action.role, action.table_id])) as unknown as MirrorMappingInput;
  const mapped = await mapAll(fake, mapping);
  expect(mapped.complete).toBe(true);
  expect(fake.calls.filter((call) => call.kind === "create_field")).toHaveLength(26);
  expect(fake.calls.some((call) => call.kind === "create_field" && call.field.name === "reference_code")).toBe(true);
  expect(fake.tables.find((table) => table.id === submissions.id)?.fields?.find((field) => field.name === "Organizer notes")).toEqual({
    id: "fld_organizer_notes",
    name: "Organizer notes",
    type: "multilineText",
    options: { sentinel: "kept-byte-for-byte" },
  });
  expect(mapped.progress?.find((row) => row.role === "submissions")?.organizer_fields).toEqual(["Organizer notes"]);
});

test("MRQ-248 · verify never clears the active mapping; replacement state changes only at final adoption", async () => {
  const currentTables = fullTables({ submissions: "tbl_current_submissions", speaker_tasks: "tbl_current_tasks", people: "tbl_current_people" });
  const currentFake = new FakeAirtableTransport(() => NOW, { tables: currentTables });
  await verifyConnection(currentFake);
  await mapAll(currentFake, mappingFor(currentTables));

  const replacementTables = fullTables({ submissions: "tbl_replacement_submissions", speaker_tasks: "tbl_replacement_tasks", people: "tbl_replacement_people" });
  const replacementFake = new FakeAirtableTransport(() => NOW, { tables: replacementTables });
  const verified = await connectMirror(actionEnvironment(replacementFake), {
    baseId: "app_mrq248_replacement",
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: "pat_mrq248_replacement",
    intent: "verify",
    now: NOW,
  });
  expect(verified.ok).toBe(true);
  expect(await env.DB.prepare("SELECT base_id FROM mirror_credentials WHERE org_id = ?").bind(ORG_ID).first()).toMatchObject({ base_id: BASE_ID });
  expect(await env.DB.prepare("SELECT table_name, airtable_table_id FROM mirror_state ORDER BY table_name").all()).toMatchObject({
    results: [
      { table_name: "people", airtable_table_id: "tbl_current_people" },
      { table_name: "speaker_tasks", airtable_table_id: "tbl_current_tasks" },
      { table_name: "submissions", airtable_table_id: "tbl_current_submissions" },
    ],
  });

  await mapAll(replacementFake, mappingFor(replacementTables), clockAt(), "app_mrq248_replacement", "pat_mrq248_replacement");
  expect(await env.DB.prepare("SELECT base_id FROM mirror_credentials WHERE org_id = ?").bind(ORG_ID).first()).toMatchObject({ base_id: "app_mrq248_replacement" });
  expect(await env.DB.prepare("SELECT table_name, airtable_table_id FROM mirror_state ORDER BY table_name").all()).toMatchObject({
    results: [
      { table_name: "people", airtable_table_id: "tbl_replacement_people" },
      { table_name: "speaker_tasks", airtable_table_id: "tbl_replacement_tasks" },
      { table_name: "submissions", airtable_table_id: "tbl_replacement_submissions" },
    ],
  });
});

test("MRQ-248 · adoption is resumable and retry-safe after a rate-limited fifth field call", async () => {
  const submissions = tableFor("submissions", "tbl_partial_submissions", "Organizer submissions");
  submissions.fields = [
    submissions.fields![0],
    { id: "fld_organizer_notes", name: "Organizer notes", type: "multilineText" },
  ];
  const otherTables = fullTables({ speaker_tasks: "tbl_tasks", people: "tbl_people" });
  const tables = [submissions, ...otherTables];
  const fake = new FakeAirtableTransport(() => NOW, {
    tables,
    metadataFailure: { call: 5, status: 429, message: "provider-private-429" },
  });
  await verifyConnection(fake);
  const mapping = mappingFor(tables);
  const clock = clockAt();
  const first = await mapMirror(actionEnvironment(fake), {
    mapping,
    orgId: ORG_ID,
    baseId: BASE_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    intent: "adopt",
    continuation: "submissions",
    now: NOW,
    clock,
  });
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("expected the fifth metadata call to fail");
  expect(first.code).toBe("rate_limited");
  expect(first.retryable).toBe(true);
  expect(first.message).not.toContain("provider-private-429");
  expect(first.details).toMatchObject({ continuation: "submissions" });
  expect((first.details as { progress: Array<{ role: string; organizer_fields: string[] }> }).progress.find((row) => row.role === "submissions")?.organizer_fields).toEqual(["Organizer notes"]);
  const retry = await mapMirror(actionEnvironment(fake), {
    mapping,
    orgId: ORG_ID,
    baseId: BASE_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    intent: "adopt",
    continuation: "submissions",
    now: NOW,
    clock,
  });
  expect(retry.ok).toBe(true);
  if (!retry.ok) throw new Error(retry.message);
  expect(retry.continuation).toBe("speaker_tasks");
  expect(fake.tables.find((table) => table.id === submissions.id)?.fields).toHaveLength(28);
  expect(fake.tables.find((table) => table.id === submissions.id)?.fields?.some((field) => field.name === "Organizer notes")).toBe(true);
  const mapped = await mapAll(fake, mapping, clock);
  expect(mapped.complete).toBe(true);
  expect(fake.calls.filter((call) => call.kind === "create_field")).toHaveLength(26);
  expect(fake.calls.filter((call) => call.kind === "create_webhook")).toHaveLength(1);
  expect(fake.calls.filter((call) => call.kind === "schema").length).toBeGreaterThanOrEqual(6);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM mirror_state").first<{ count: number }>()).toMatchObject({ count: 3 });
});

test("MRQ-248 · the final continuation freshly rejects a previously completed table before the on-switch", async () => {
  const tables = fullTables({ submissions: "tbl_fresh_submissions", speaker_tasks: "tbl_fresh_tasks", people: "tbl_fresh_people" });
  const fake = new FakeAirtableTransport(() => NOW, { tables });
  const mapping = mappingFor(tables);
  for (const continuation of ["submissions", "speaker_tasks"] as const) {
    const step = await mapMirror(actionEnvironment(fake), {
      mapping,
      orgId: ORG_ID,
      baseId: BASE_ID,
      setByPersonId: PERSON_ID,
      token: TOKEN,
      continuation,
    });
    expect(step.ok).toBe(true);
  }
  const prior = fake.tables.find((table) => table.id === mapping.submissions)!;
  prior.fields = prior.fields!.map((field) => field.name === "status" ? { ...field, type: "formula" } : field);
  const final = await mapMirror(actionEnvironment(fake), {
    mapping,
    orgId: ORG_ID,
    baseId: BASE_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    continuation: "people",
  });
  expect(final.ok).toBe(false);
  if (final.ok) throw new Error("expected fresh final validation to fail");
  expect(final.code).toBe("schema_conflict");
  expect(final.message).toContain("status");
  expect(fake.calls.filter((call) => call.kind === "create_webhook")).toHaveLength(0);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM mirror_state").first<{ count: number }>()).toMatchObject({ count: 0 });
});

test("MRQ-248 · unknown provider fields remain unknown instead of becoming an empty schema", async () => {
  const unknown: AirtableTable = { id: "tbl_unknown", name: "Submissions" };
  const fake = new FakeAirtableTransport(() => NOW, { tables: [unknown] });
  const verified = await verifyConnection(fake);
  expect(verified.tables[0]?.fields).toBeUndefined();
  expect(verified.readiness.roles.find((role) => role.role === "submissions")?.state).toBe("unknown");
  expect(ensureMirrorSchema("submissions", unknown, "verify").issues[0]).toMatchObject({ code: "unknown_schema" });
});

test("MRQ-248 · computed and incomplete single-select fields conflict before webhook registration", async () => {
  const computed = tableFor("submissions", "tbl_computed", "Submissions");
  computed.fields = computed.fields!.map((field) => field.name === "status" ? { ...field, type: "formula" } : field);
  const fake = new FakeAirtableTransport(() => NOW, { tables: [computed, ...fullTables({ speaker_tasks: "tbl_tasks", people: "tbl_people" })] });
  await verifyConnection(fake);
  const mapping = mappingFor(fake.tables);
  const result = await mapMirror(actionEnvironment(fake), {
    mapping,
    orgId: ORG_ID,
    baseId: BASE_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    continuation: "submissions",
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected computed field conflict");
  expect(result.code).toBe("schema_conflict");
  expect(result.message).toContain("status");
  expect(fake.calls.filter((call) => call.kind === "create_webhook")).toHaveLength(0);

  const completeSelect = tableFor("submissions", "tbl_select_complete", "Submissions");
  completeSelect.fields = completeSelect.fields!.map((field) => field.name === "status"
    ? { ...field, type: "singleSelect", options: { choices: ["draft", "submitted", "in_review", "accepted", "waitlisted", "rejected", "withdrawn", "scheduled", "published", "open", "done", "cancelled"].map((name) => ({ name })) } }
    : field);
  expect(ensureMirrorSchema("submissions", completeSelect, "adopt").conformant).toBe(true);
  const incompleteSelect = { ...completeSelect, fields: completeSelect.fields!.map((field) => field.name === "status" ? { ...field, options: { choices: [{ name: "draft" }] } } : field) };
  expect(ensureMirrorSchema("submissions", incompleteSelect, "adopt").issues[0]).toMatchObject({ code: "single_select_choices" });
});

test("MRQ-248 · schema.bases:write copy is safe, and exact-name conflicts recover by rename then fresh creation", async () => {
  const partial = tableFor("submissions", "tbl_write_scope", "Organizer submissions");
  partial.fields = [partial.fields![0]];
  const scopeFake = new FakeAirtableTransport(() => NOW, {
    tables: [partial, ...fullTables({ speaker_tasks: "tbl_tasks", people: "tbl_people" })],
    metadataFailure: { call: 1, status: 403, message: "raw provider scope text" },
  });
  await verifyConnection(scopeFake);
  const scopeResult = await mapMirror(actionEnvironment(scopeFake), {
    mapping: mappingFor(scopeFake.tables),
    orgId: ORG_ID,
    baseId: BASE_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    continuation: "submissions",
  });
  expect(scopeResult.ok).toBe(false);
  if (scopeResult.ok) throw new Error("expected scope failure");
  expect(scopeResult.code).toBe("provider_forbidden");
  expect(scopeResult.message).toContain("schema.bases:write");
  expect(scopeResult.message).not.toContain("raw provider scope text");

  const incompatible = tableFor("submissions", "tbl_bad_canonical", "Submissions");
  incompatible.fields = incompatible.fields!.map((field) => field.name === "status" ? { ...field, type: "formula" } : field);
  const renameFake = new FakeAirtableTransport(() => NOW, { tables: [incompatible] });
  await verifyConnection(renameFake);
  const conflict = await connectMirror(actionEnvironment(renameFake), {
    baseId: BASE_ID,
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    intent: "provision",
    now: NOW,
  });
  expect(conflict.ok).toBe(false);
  expect(renameFake.calls.filter((call) => call.kind === "create_table")).toHaveLength(0);
  renameFake.tables[0].name = "Organizer submissions";
  const recovered = await connectMirror(actionEnvironment(renameFake), {
    baseId: BASE_ID,
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: TOKEN,
    intent: "provision",
    now: NOW,
  });
  expect(recovered.ok).toBe(true);
  expect(renameFake.tables.find((table) => table.id === "tbl_bad_canonical")?.name).toBe("Organizer submissions");
  expect(renameFake.calls.filter((call) => call.kind === "create_table")).toHaveLength(3);
});

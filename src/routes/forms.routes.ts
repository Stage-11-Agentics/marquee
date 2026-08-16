import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { createListQuerySchema, createListResponseSchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { FieldLibraryRow, FormFieldRow, FormFieldType, FormRow } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole, roleForEvent, tokenHasGrant } from "../lib/auth/scope-resolution";
import { normalizeFieldConfig, resolveBoundOptions } from "../lib/bound-options";
import { parseFormCondition } from "../lib/form-conditions";
import {
  conditionNote,
  isParticipantMachineryKey,
  materializeLibraryCondition,
} from "../lib/form-field-library";
import {
  FORM_SORTS,
  countFormResponses,
  findForm,
  effectiveFormStatus,
  type FormFieldView,
  listFormAdmins,
  listFormFields,
  listForms,
  normalizeField,
  readFormDetail,
} from "./forms.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const formParams = eventParams.extend({ formId: z.string().min(1) });
const fieldParams = formParams.extend({ fieldId: z.string().min(1) });
const adminParams = formParams.extend({ personId: z.string().min(1) });
const libraryParams = eventParams.extend({ libraryFieldId: z.string().min(1) });
const libraryQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  form_id: z.string().min(1).optional(),
});
const copyLibraryParams = formParams;

const conditionClauseSchema = z.object({
  fieldKey: z.string().min(1).max(120),
  op: z.string().min(1).max(40),
  value: z.unknown().optional(),
});
const conditionSchema = z
  .object({ all: z.array(conditionClauseSchema).max(40) })
  .nullable();
const configSchema = z.record(z.string(), z.unknown()).default({});
const formFieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "url",
  "email",
  "file",
  "number",
  "date",
]);

const formSummarySchema = z
  .object({
    id: z.string(),
    event_id: z.string(),
    name: z.string(),
    slug: z.string(),
    kind: z.enum(["abstract", "session"]),
    status: z.enum(["draft", "open", "closed"]),
    opens_at: z.number().int().nullable(),
    closes_at: z.number().int().nullable(),
    welcome_md: z.string(),
    per_submitter_limit: z.number().int().nonnegative(),
    submitter_limit_inherit: z.boolean(),
    effective_submitter_limit: z.number().int().nonnegative(),
    min_speakers: z.number().int().nonnegative(),
    max_speakers: z.number().int().nonnegative(),
    max_sponsors: z.number().int().nonnegative(),
    response_count: z.number().int().nonnegative(),
    visibility: z.enum(["public", "private"]),
    public_url: z.string().nullable(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
  })
  .openapi("FormSummary");

const formFieldSchema = z
  .object({
    id: z.string(),
    form_id: z.string(),
    key: z.string(),
    label: z.string(),
    help_text: z.string().nullable(),
    type: formFieldTypeSchema,
    required: z.boolean(),
    position: z.number().int().nonnegative(),
    config: configSchema,
    condition: conditionSchema,
    library_field_id: z.string().optional(),
    library_field_version: z.number().int().positive().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
  })
  .openapi("FormField");

const formAdminSchema = z.object({
  id: z.string(),
  person_id: z.string(),
  name: z.string(),
  email: z.string(),
});

const formDetailSchema = formSummarySchema
  .extend({
    reminder_offset_hours: z.number().int().nonnegative().nullable(),
    thankyou_template_key: z.string().nullable(),
    admin_notify_person_ids: z.array(z.string()),
    turnstile_required: z.boolean(),
    fields: z.array(formFieldSchema),
    admins: z.array(formAdminSchema),
    preview_fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.string(),
        position: z.number().int().nonnegative(),
        required: z.boolean(),
        condition: conditionSchema,
      }),
    ),
  })
  .openapi("FormDetail");

const formListQuerySchema = createListQuerySchema(
  {
    status: z.enum(["draft", "open", "closed"]).optional(),
    kind: z.enum(["abstract", "session"]).optional(),
  },
  Object.keys(FORM_SORTS) as [keyof typeof FORM_SORTS, ...(keyof typeof FORM_SORTS)[]],
  { defaultSort: "newest" },
);

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(["abstract", "session"]).default("abstract"),
  opens_at: z.number().int().nullable().optional(),
  closes_at: z.number().int().nullable().optional(),
  welcome_md: z.string().max(50_000).default(""),
  per_submitter_limit: z.number().int().min(1).max(100).optional(),
  submitter_limit_inherit: z.boolean().optional(),
  min_speakers: z.number().int().min(0).max(100).default(1),
  max_speakers: z.number().int().min(0).max(100).default(4),
  max_sponsors: z.number().int().min(0).max(100).default(0),
  reminder_offset_hours: z.number().int().min(0).nullable().optional(),
  thankyou_template_key: z.string().trim().min(1).max(120).nullable().optional(),
  admin_notify_person_ids: z.array(z.string().min(1)).max(100).default([]),
  turnstile_required: z.boolean().default(true),
});

const patchFormSchema = createFormSchema.partial().omit({ kind: true }).extend({
  kind: z.enum(["abstract", "session"]).optional(),
});

const createFieldSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(240),
  help_text: z.string().max(2_000).nullable().optional(),
  type: z.enum([
    "short_text",
    "long_text",
    "single_select",
    "multi_select",
    "url",
    "email",
    "file",
    "number",
    "date",
  ]),
  required: z.boolean().default(false),
  position: z.number().int().min(0).optional(),
  config: configSchema,
  condition: conditionSchema.default(null),
  save_to_library: z.boolean().default(false),
});

const patchFieldSchema = createFieldSchema.partial().omit({ position: true, save_to_library: true });
const fieldLibraryBodySchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(240),
  help_text: z.string().max(2_000).nullable().optional(),
  type: formFieldTypeSchema,
  required: z.boolean().default(false),
  config: configSchema,
  condition: conditionSchema.default(null),
});
const patchFieldLibrarySchema = fieldLibraryBodySchema.partial();
const libraryFieldSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  key: z.string(),
  label: z.string(),
  help_text: z.string().nullable(),
  type: formFieldTypeSchema,
  required: z.boolean(),
  config: configSchema,
  condition: conditionSchema,
  condition_note: z.string().nullable(),
  version: z.number().int().positive(),
  used_on_forms: z.number().int().nonnegative(),
  stale_copy_count: z.number().int().nonnegative(),
  on_destination_form: z.boolean(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
const libraryCopyBodySchema = z.object({
  library_field_id: z.string().min(1),
  position: z.number().int().min(0).optional(),
});
const missingConditionWarningSchema = z.object({
  code: z.literal("missing_condition_trigger"),
  missing_keys: z.array(z.string()),
  message: z.string(),
});
const libraryCopyResponseSchema = formFieldSchema.extend({ warning: missingConditionWarningSchema.nullable() });
const reorderFieldsSchema = z.object({ field_ids: z.array(z.string().min(1)).min(1).max(200) });
const adminBodySchema = z.object({ person_id: z.string().min(1) });

function eventAllowed(auth: Exclude<ReturnType<typeof getAuth>, null>, eventId: string): boolean {
  if (auth.kind === "session") return roleForEvent(auth.memberships, eventId) !== null;
  return auth.eventId === null
    ? auth.eventIds.length === 0 || auth.eventIds.includes(eventId)
    : auth.eventId === eventId;
}

async function isFormAdmin(db: D1Database, formId: string, personId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS present FROM form_admins WHERE form_id = ? AND person_id = ?")
    .bind(formId, personId)
    .first<{ present: number }>();
  return row?.present === 1;
}

async function hasFormAdminAssignment(db: D1Database, eventId: string, personId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS present FROM form_admins fa JOIN forms f ON f.id = fa.form_id WHERE f.event_id = ? AND fa.person_id = ? LIMIT 1")
    .bind(eventId, personId)
    .first<{ present: number }>();
  return row?.present === 1;
}

/** Form authoring uses the canonical credential resolver plus event/form scope. */
async function requireFormAccess(
  context: Context<ApiEnv>,
  eventId: string,
  formId: string | undefined,
  write: boolean,
): Promise<void> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const event = await context.env.DB
    .prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
    .bind(eventId, auth.orgId)
    .first();
  if (!event) throw ApiError.forbidden("credential is not scoped to this conference");
  if (!eventAllowed(auth, eventId)) throw ApiError.forbidden("credential is not scoped to this conference");

  if (auth.kind === "session") {
    if (authHasRole(auth, "ops", eventId)) return;
    if (formId && await isFormAdmin(context.env.DB, formId, auth.personId)) return;
    if (!formId && await hasFormAdminAssignment(context.env.DB, eventId, auth.personId)) return;
    throw ApiError.forbidden(write ? "form authoring requires program staff or a form administrator" : "form access requires program staff or a form administrator");
  }

  const required = write ? "program:write" : "program:read";
  if (tokenHasGrant(auth, required, eventId)) return;
  throw ApiError.forbidden(`form access requires ${required}`);
}

async function getOwnedForm(context: Context<ApiEnv>, eventId: string, formId: string, write = false): Promise<FormRow> {
  await requireFormAccess(context, eventId, formId, write);
  const form = await findForm(context.env.DB, eventId, formId);
  if (!form) throw ApiError.notFound("form not found");
  return form;
}

function validateFormSettings(
  opensAt: number | null | undefined,
  closesAt: number | null | undefined,
  minSpeakers: number,
  maxSpeakers: number,
): void {
  if (opensAt !== null && opensAt !== undefined && closesAt !== null && closesAt !== undefined && opensAt > closesAt) {
    throw ApiError.unprocessable("the close time must be after the open time", "closes_at");
  }
  if (maxSpeakers < minSpeakers) throw ApiError.unprocessable("maximum speakers must be at least the minimum", "max_speakers");
}

function conditionJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (parseFormCondition(value) === null) throw ApiError.badRequest("condition must use the { all: [{ fieldKey, op, value }] } shape", "condition");
  return JSON.stringify(value);
}

/**
 * A bound field stores its source, never a copy of the options. Storing both
 * would reintroduce the snapshot binding exists to remove: the copy survives
 * the next rename in Conference settings and the field starts offering an
 * option the submit path will refuse.
 */
function fieldConfigJson(value: unknown, type: FormFieldType): string {
  const result = normalizeFieldConfig((value ?? {}) as Record<string, unknown>, type);
  if ("error" in result) throw ApiError.unprocessable(result.error, "config");
  return JSON.stringify(result.config);
}

/** Answer with the options a caller will actually be held to at submit time. */
async function fieldResponse(db: D1Database, eventId: string, row: FormFieldRow): Promise<FormFieldView> {
  const [resolved] = await resolveBoundOptions(db, eventId, [normalizeField(row)]);
  return resolved;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return (value as Record<string, unknown> | null) ?? {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

interface FieldLibraryView {
  id: string;
  event_id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FormFieldType;
  required: boolean;
  config: Record<string, unknown>;
  condition: ReturnType<typeof parseFormCondition>;
  condition_note: string | null;
  version: number;
  used_on_forms: number;
  stale_copy_count: number;
  on_destination_form: boolean;
  created_at: number;
  updated_at: number;
}

async function fieldLibraryResponse(
  db: D1Database,
  row: FieldLibraryRow,
  destinationFormId?: string,
): Promise<FieldLibraryView> {
  const usage = await db.prepare(
    `SELECT COUNT(DISTINCT ff.form_id) AS used_on_forms,
            COALESCE(SUM(CASE WHEN ff.library_field_version < fl.version THEN 1 ELSE 0 END), 0) AS stale_copy_count
       FROM field_library fl
       LEFT JOIN form_fields ff ON ff.library_field_id = fl.id
      WHERE fl.id = ?
      GROUP BY fl.id`,
  ).bind(row.id).first<{ used_on_forms: number; stale_copy_count: number }>();
  const destination = destinationFormId
    ? await db.prepare("SELECT 1 AS present FROM form_fields WHERE form_id = ? AND (library_field_id = ? OR key = ?) LIMIT 1")
      .bind(destinationFormId, row.id, row.key)
      .first<{ present: number }>()
    : null;
  const condition = parseFormCondition(row.condition);
  return {
    id: row.id,
    event_id: row.event_id,
    key: row.key,
    label: row.label,
    help_text: row.help_text,
    type: row.type,
    required: row.required === 1,
    config: parseJsonObject(row.config),
    condition,
    condition_note: conditionNote(condition),
    version: Number(row.version),
    used_on_forms: Number(usage?.used_on_forms ?? 0),
    stale_copy_count: Number(usage?.stale_copy_count ?? 0),
    on_destination_form: destination?.present === 1,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

async function getLibraryField(
  context: Context<ApiEnv>,
  eventId: string,
  libraryFieldId: string,
  write = false,
): Promise<FieldLibraryRow> {
  await requireFormAccess(context, eventId, undefined, write);
  const field = await context.env.DB.prepare("SELECT * FROM field_library WHERE id = ? AND event_id = ?")
    .bind(libraryFieldId, eventId)
    .first<FieldLibraryRow>();
  if (!field) throw ApiError.notFound("library question not found");
  return field;
}

function rejectParticipantQuestion(key: string): void {
  if (isParticipantMachineryKey(key)) {
    throw ApiError.unprocessable(
      "participant machinery such as speaker email, co-speakers, and moderator fields is structural and cannot be saved to the question library",
      "key",
    );
  }
}

async function destinationFormForLibrary(
  context: Context<ApiEnv>,
  eventId: string,
  formId: string,
): Promise<FormRow> {
  return getOwnedForm(context, eventId, formId, true);
}

async function normalizeFieldPositions(db: D1Database, formId: string): Promise<void> {
  const fields = await db.prepare("SELECT id FROM form_fields WHERE form_id = ? ORDER BY position ASC, id ASC").bind(formId).all<{ id: string }>();
  if (fields.results.length === 0) return;
  await db.batch(fields.results.map((field, position) =>
    db.prepare("UPDATE form_fields SET position = ?, updated_at = ? WHERE id = ? AND form_id = ?").bind(position, Date.now(), field.id, formId),
  ));
}

async function getField(context: Context<ApiEnv>, eventId: string, formId: string, fieldId: string, write = false): Promise<FormFieldRow> {
  await getOwnedForm(context, eventId, formId, write);
  const field = await context.env.DB.prepare("SELECT * FROM form_fields WHERE id = ? AND form_id = ?").bind(fieldId, formId).first<FormFieldRow>();
  if (!field) throw ApiError.notFound("form field not found");
  return field;
}

const listEventForms = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/forms",
    operationId: "listEventForms",
    summary: "List conference forms",
    description: "The event-scoped form catalog with stable pagination and response counts.",
    tags: ["Forms"],
    request: { params: eventParams, query: formListQuerySchema },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(createListResponseSchema(formSummarySchema, "Form"), "Form catalog"),
      ...errorResponses([400, 401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await requireFormAccess(context, eventId, undefined, false);
    const auth = getAuth(context);
    const personId = auth?.kind === "session" && !authHasRole(auth, "ops", eventId) ? auth.personId : undefined;
    return context.json(await listForms(context.env.DB, { eventId, ...(personId ? { personId } : {}), ...context.req.valid("query") }), 200);
  },
);

const createEventForm = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms",
    operationId: "createEventForm",
    summary: "Create a conference form",
    tags: ["Forms"],
    request: { params: eventParams, body: { content: { "application/json": { schema: createFormSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(formDetailSchema, "Created form"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await requireFormAccess(context, eventId, undefined, true);
    const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) throw ApiError.notFound("conference not found");
    const body = context.req.valid("json");
    validateFormSettings(body.opens_at, body.closes_at, body.min_speakers, body.max_speakers);
    const inherits = body.submitter_limit_inherit ?? body.per_submitter_limit === undefined;
    if (!inherits && body.per_submitter_limit === undefined) {
      throw ApiError.unprocessable("an explicit capacity requires per_submitter_limit", "per_submitter_limit");
    }
    // Omitted create binds body.per_submitter_limit ?? 3 even when the stored
    // value is dormant under inheritance. Writes remain 1–100; legacy stored 0
    // is a read-path-only unlimited state.
    const perSubmitterLimit = body.per_submitter_limit ?? 3;
    const now = Date.now();
    const id = crypto.randomUUID();
    try {
      await context.env.DB.prepare(
        `INSERT INTO forms
          (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
           per_submitter_limit, submitter_limit_inherit, min_speakers, max_speakers, max_sponsors,
           reminder_offset_hours, thankyou_template_key, admin_notify_person_ids,
           turnstile_required, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, eventId, body.name, body.slug, body.kind, body.opens_at ?? null, body.closes_at ?? null,
        body.welcome_md, perSubmitterLimit, inherits ? 1 : 0, body.min_speakers, body.max_speakers, body.max_sponsors,
        body.reminder_offset_hours ?? null, body.thankyou_template_key ?? null,
        JSON.stringify(body.admin_notify_person_ids), body.turnstile_required ? 1 : 0, now, now,
      ).run();
    } catch {
      throw ApiError.conflict("a form with that slug already exists in this conference");
    }
    const form = await findForm(context.env.DB, eventId, id);
    if (!form) throw new Error("created form disappeared");
    return context.json(await readFormDetail(context.env.DB, form), 201);
  },
);

const getEventForm = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/forms/{formId}",
    operationId: "getEventForm",
    summary: "Read a conference form",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(formDetailSchema, "Form detail"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const form = await getOwnedForm(context, eventId, formId);
    return context.json(await readFormDetail(context.env.DB, form), 200);
  },
);

const updateEventForm = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/forms/{formId}",
    operationId: "updateEventForm",
    summary: "Edit a conference form",
    tags: ["Forms"],
    request: { params: formParams, body: { content: { "application/json": { schema: patchFormSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(formDetailSchema, "Updated form"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const current = await getOwnedForm(context, eventId, formId, true);
    const body = context.req.valid("json");
    if (body.kind !== undefined && body.kind !== current.kind && current.status !== "draft") {
      throw ApiError.conflict("the Abstract or Session target is immutable after the form opens");
    }
    const nextOpens = body.opens_at === undefined ? current.opens_at : body.opens_at;
    const nextCloses = body.closes_at === undefined ? current.closes_at : body.closes_at;
    const nextMin = body.min_speakers === undefined ? current.min_speakers : body.min_speakers;
    const nextMax = body.max_speakers === undefined ? current.max_speakers : body.max_speakers;
    validateFormSettings(nextOpens, nextCloses, nextMin, nextMax);
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => { updates.push(`${column} = ?`); values.push(value); };
    if (body.name !== undefined) set("name", body.name);
    if (body.slug !== undefined) set("slug", body.slug);
    if (body.kind !== undefined) set("kind", body.kind);
    if (body.opens_at !== undefined) set("opens_at", body.opens_at);
    if (body.closes_at !== undefined) set("closes_at", body.closes_at);
    if (body.welcome_md !== undefined) set("welcome_md", body.welcome_md);
    if (body.submitter_limit_inherit !== undefined) {
      if (!body.submitter_limit_inherit && body.per_submitter_limit === undefined) {
        throw ApiError.unprocessable("an explicit capacity requires per_submitter_limit", "per_submitter_limit");
      }
      set("submitter_limit_inherit", body.submitter_limit_inherit ? 1 : 0);
      if (!body.submitter_limit_inherit) set("per_submitter_limit", body.per_submitter_limit!);
    } else if (body.per_submitter_limit !== undefined) {
      // A flag-omitted number is an observable explicit override, never a
      // dormant no-op. This keeps older CLI/API callers truthful.
      set("per_submitter_limit", body.per_submitter_limit);
      set("submitter_limit_inherit", 0);
    }
    if (body.min_speakers !== undefined) set("min_speakers", body.min_speakers);
    if (body.max_speakers !== undefined) set("max_speakers", body.max_speakers);
    if (body.max_sponsors !== undefined) set("max_sponsors", body.max_sponsors);
    if (body.reminder_offset_hours !== undefined) set("reminder_offset_hours", body.reminder_offset_hours);
    if (body.thankyou_template_key !== undefined) set("thankyou_template_key", body.thankyou_template_key);
    if (body.admin_notify_person_ids !== undefined) set("admin_notify_person_ids", JSON.stringify(body.admin_notify_person_ids));
    if (body.turnstile_required !== undefined) set("turnstile_required", body.turnstile_required ? 1 : 0);
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(Math.max(Date.now(), current.updated_at + 1));
      try {
        await context.env.DB.prepare(`UPDATE forms SET ${updates.join(", ")} WHERE id = ? AND event_id = ?`).bind(...values, formId, eventId).run();
      } catch {
        throw ApiError.conflict("a form with that slug already exists in this conference");
      }
    }
    const form = await findForm(context.env.DB, eventId, formId);
    if (!form) throw ApiError.notFound("form not found");
    return context.json(await readFormDetail(context.env.DB, form), 200);
  },
);

const deleteEventForm = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/forms/{formId}",
    operationId: "deleteEventForm",
    summary: "Delete an unpublished conference form",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Deleted form"), ...errorResponses([401, 403, 404, 409, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const form = await getOwnedForm(context, eventId, formId, true);
    const responseCount = await countFormResponses(context.env.DB, formId);
    if (form.status !== "draft" || responseCount > 0) throw ApiError.conflict("only an unpublished form with no responses can be deleted");
    try {
      await context.env.DB.batch([
        context.env.DB.prepare("DELETE FROM form_admins WHERE form_id = ?").bind(formId),
        context.env.DB.prepare("DELETE FROM form_fields WHERE form_id = ?").bind(formId),
        context.env.DB.prepare("DELETE FROM forms WHERE id = ? AND event_id = ? AND status = 'draft'").bind(formId, eventId),
      ]);
    } catch {
      throw ApiError.conflict("the form is still referenced by another conference record");
    }
    return context.json({ deleted: true }, 200);
  },
);

const duplicateEventForm = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/duplicate",
    operationId: "duplicateEventForm",
    summary: "Duplicate a conference form without responses",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(formDetailSchema, "Duplicated form"), ...errorResponses([401, 403, 404, 409, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const source = await getOwnedForm(context, eventId, formId, true);
    const fields = await context.env.DB.prepare("SELECT * FROM form_fields WHERE form_id = ? ORDER BY position ASC, id ASC").bind(formId).all<FormFieldRow>();
    const admins = await context.env.DB.prepare("SELECT person_id FROM form_admins WHERE form_id = ? ORDER BY person_id").bind(formId).all<{ person_id: string }>();
    const now = Date.now();
    const id = crypto.randomUUID();
    const slug = `${source.slug}-copy-${id.slice(0, 8)}`;
    const copyName = `${source.name} copy`;
    const statements = [
      context.env.DB.prepare(
        `INSERT INTO forms
          (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
           per_submitter_limit, submitter_limit_inherit, min_speakers, max_speakers, max_sponsors, reminder_offset_hours,
           thankyou_template_key, admin_notify_person_ids, turnstile_required, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, eventId, copyName, slug, source.kind, source.opens_at, source.closes_at, source.welcome_md,
        source.per_submitter_limit, source.submitter_limit_inherit, source.min_speakers, source.max_speakers, source.max_sponsors,
        source.reminder_offset_hours, source.thankyou_template_key, source.admin_notify_person_ids,
        source.turnstile_required, now, now,
      ),
      ...fields.results.map((field) => context.env.DB.prepare(
        `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, library_field_id, library_field_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), id, field.key, field.label, field.help_text, field.type, field.required,
        field.position, field.config, field.condition, field.library_field_id, field.library_field_version, now, now,
      )),
      ...admins.results.map((admin) => context.env.DB.prepare(
        "INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), id, admin.person_id, now, now)),
    ];
    try {
      await context.env.DB.batch(statements);
    } catch {
      throw ApiError.conflict("the form could not be duplicated");
    }
    const form = await findForm(context.env.DB, eventId, id);
    if (!form) throw new Error("duplicated form disappeared");
    return context.json(await readFormDetail(context.env.DB, form), 201);
  },
);

async function setFormLifecycle(context: Context<ApiEnv>, eventId: string, formId: string, status: FormRow["status"]): Promise<Awaited<ReturnType<typeof readFormDetail>>> {
  const current = await getOwnedForm(context, eventId, formId, true);
  const now = Date.now();
  if (status === "open" && current.closes_at !== null && current.closes_at <= now) {
    throw ApiError.unprocessable("choose a future close time before opening this form", "closes_at");
  }
  await context.env.DB.prepare(
    "UPDATE forms SET status = ?, opens_at = CASE WHEN ? = 'open' AND opens_at IS NULL THEN ? ELSE opens_at END, updated_at = ? WHERE id = ? AND event_id = ?",
  ).bind(status, status, now, Math.max(now, current.updated_at + 1), formId, eventId).run();
  const form = await findForm(context.env.DB, eventId, formId);
  if (!form) throw ApiError.notFound("form not found");
  return readFormDetail(context.env.DB, form);
}

/**
 * Opening intake on a mail-less instance.
 *
 * The organizer is warned once, in the words of what it costs — no submission
 * confirmations, no decision mail, no calendar invites — and then allowed to
 * proceed, because they may be handling mail elsewhere and a hard block would
 * be this product deciding it knows better (ruling D8, AC-285). The
 * acknowledgment is recorded with its actor and time so the decision is a
 * matter of record rather than a dialog nobody can prove was shown.
 *
 * Nothing here can refuse a publish. The dialog lives in the UI; this route's
 * only job is to write down what the organizer knew when they pressed it.
 */
const publishAcknowledgement = z.object({
  acknowledge_mail_unconfigured: z.boolean().optional(),
});

const publishEventForm = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/publish",
    operationId: "publishEventForm",
    summary: "Open a conference form",
    tags: ["Forms"],
    request: {
      params: formParams,
      body: {
        required: false,
        content: { "application/json": { schema: publishAcknowledgement } },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(formDetailSchema, "Opened form"), ...errorResponses([401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const detail = await setFormLifecycle(context, eventId, formId, "open");
    const acknowledgement = await context.req
      .json<z.infer<typeof publishAcknowledgement>>()
      .catch(() => null);
    if (acknowledgement?.acknowledge_mail_unconfigured === true) {
      const auth = getAuth(context);
      await writeAudit(context.env.DB, {
        eventId,
        actorKind: auth?.kind === "token" ? "api_token" : "user",
        actorPersonId: auth?.kind === "session" ? auth.personId : null,
        action: "form.published_without_mail",
        entityType: "form",
        entityId: formId,
        after: { acknowledged: true },
        now: Date.now(),
        requestId: context.get("requestId") ?? null,
      });
    }
    return context.json(detail, 200);
  },
);

const closeEventForm = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/close",
    operationId: "closeEventForm",
    summary: "Close a conference form",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(formDetailSchema, "Closed form"), ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => context.json(await setFormLifecycle(context, context.req.valid("param").eventId, context.req.valid("param").formId, "closed"), 200),
);

const reopenEventForm = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/reopen",
    operationId: "reopenEventForm",
    summary: "Reopen a conference form",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(formDetailSchema, "Reopened form"), ...errorResponses([401, 403, 404, 422, 500]) },
  },
  async (context) => context.json(await setFormLifecycle(context, context.req.valid("param").eventId, context.req.valid("param").formId, "open"), 200),
);

const listFieldLibraryRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/field-library",
    operationId: "listFieldLibrary",
    summary: "List reusable form questions",
    description: "Search event-scoped question definitions without exposing participant machinery.",
    tags: ["Forms"],
    request: { params: eventParams, query: libraryQuerySchema },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(libraryFieldSchema) }), "Question library"), ...errorResponses([400, 401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    if (query.form_id) await getOwnedForm(context, eventId, query.form_id, false);
    else await requireFormAccess(context, eventId, undefined, false);
    const pattern = `%${query.search}%`;
    const rows = await context.env.DB.prepare(
      `SELECT * FROM field_library
        WHERE event_id = ?
          AND key NOT LIKE 'speaker_%'
          AND key NOT LIKE 'co_speaker_%'
          AND key NOT LIKE 'moderator_%'
          AND key NOT LIKE 'chairperson_%'
          AND key NOT LIKE 'submitter_%'
          AND key NOT LIKE 'participant_%'
          AND key NOT LIKE 'other_participant_%'
          AND (? = '' OR key LIKE ? COLLATE NOCASE OR label LIKE ? COLLATE NOCASE)
        ORDER BY label COLLATE NOCASE ASC, id ASC
        LIMIT 100`,
    ).bind(eventId, query.search, pattern, pattern).all<FieldLibraryRow>();
    return context.json({
      data: await Promise.all(rows.results.map((row) => fieldLibraryResponse(context.env.DB, row, query.form_id))),
    }, 200);
  },
);

const createFieldLibraryRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/field-library",
    operationId: "createFieldLibraryQuestion",
    summary: "Save a reusable form question",
    tags: ["Forms"],
    request: { params: eventParams, body: { content: { "application/json": { schema: fieldLibraryBodySchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(libraryFieldSchema, "Created library question"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await requireFormAccess(context, eventId, undefined, true);
    const body = context.req.valid("json");
    rejectParticipantQuestion(body.key);
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await context.env.DB.prepare(
        `INSERT INTO field_library
          (id, event_id, key, label, help_text, type, required, config, condition, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        id,
        eventId,
        body.key,
        body.label,
        body.help_text ?? null,
        body.type,
        body.required ? 1 : 0,
        fieldConfigJson(body.config, body.type),
        conditionJson(body.condition),
        now,
        now,
      ).run();
    } catch {
      throw ApiError.conflict("a library question with that key already exists in this conference");
    }
    const row = await context.env.DB.prepare("SELECT * FROM field_library WHERE id = ? AND event_id = ?")
      .bind(id, eventId)
      .first<FieldLibraryRow>();
    if (!row) throw new Error("created library question disappeared");
    return context.json(await fieldLibraryResponse(context.env.DB, row), 201);
  },
);

const updateFieldLibraryRoute = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/field-library/{libraryFieldId}",
    operationId: "updateFieldLibraryQuestion",
    summary: "Edit a reusable form question",
    tags: ["Forms"],
    request: { params: libraryParams, body: { content: { "application/json": { schema: patchFieldLibrarySchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(libraryFieldSchema, "Updated library question"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, libraryFieldId } = context.req.valid("param");
    const current = await getLibraryField(context, eventId, libraryFieldId, true);
    const body = context.req.valid("json");
    if (body.key !== undefined) rejectParticipantQuestion(body.key);
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      updates.push(`${column} = ?`);
      values.push(value);
    };
    const nextType = body.type ?? current.type;
    if (body.key !== undefined) set("key", body.key);
    if (body.label !== undefined) set("label", body.label);
    if (body.help_text !== undefined) set("help_text", body.help_text);
    if (body.type !== undefined) set("type", body.type);
    if (body.required !== undefined) set("required", body.required ? 1 : 0);
    if (body.config !== undefined || body.type !== undefined) {
      set("config", fieldConfigJson(body.config ?? parseJsonObject(current.config), nextType));
    }
    if (body.condition !== undefined) set("condition", conditionJson(body.condition));
    if (updates.length > 0) {
      updates.push("version = version + 1");
      updates.push("updated_at = ?");
      values.push(Math.max(Date.now(), Number(current.updated_at) + 1));
      try {
        await context.env.DB.prepare(`UPDATE field_library SET ${updates.join(", ")} WHERE id = ? AND event_id = ?`)
          .bind(...values, libraryFieldId, eventId)
          .run();
      } catch {
        throw ApiError.conflict("a library question with that key already exists in this conference");
      }
    }
    const updated = await context.env.DB.prepare("SELECT * FROM field_library WHERE id = ? AND event_id = ?")
      .bind(libraryFieldId, eventId)
      .first<FieldLibraryRow>();
    if (!updated) throw ApiError.notFound("library question not found");
    return context.json(await fieldLibraryResponse(context.env.DB, updated), 200);
  },
);

const deleteFieldLibraryRoute = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/field-library/{libraryFieldId}",
    operationId: "deleteFieldLibraryQuestion",
    summary: "Delete an unused reusable form question",
    tags: ["Forms"],
    request: { params: libraryParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Deleted library question"), ...errorResponses([401, 403, 404, 409, 500]) },
  },
  async (context) => {
    const { eventId, libraryFieldId } = context.req.valid("param");
    await getLibraryField(context, eventId, libraryFieldId, true);
    const references = await context.env.DB.prepare("SELECT COUNT(*) AS total FROM form_fields WHERE library_field_id = ?")
      .bind(libraryFieldId)
      .first<{ total: number }>();
    if (Number(references?.total ?? 0) > 0) {
      throw ApiError.conflict("this question has existing form copies; those copies are self-contained and must be removed first");
    }
    await context.env.DB.prepare("DELETE FROM field_library WHERE id = ? AND event_id = ?").bind(libraryFieldId, eventId).run();
    return context.json({ deleted: true }, 200);
  },
);

const copyFieldFromLibraryRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields/from-library",
    operationId: "copyFieldFromLibrary",
    summary: "Materialize a library question on a draft form",
    tags: ["Forms"],
    request: { params: copyLibraryParams, body: { content: { "application/json": { schema: libraryCopyBodySchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(libraryCopyResponseSchema, "Copied library question"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    const form = await destinationFormForLibrary(context, eventId, formId);
    if (effectiveFormStatus(form) !== "draft") {
      throw ApiError.conflict("library questions can only be added to a draft form");
    }
    const body = context.req.valid("json");
    const source = await context.env.DB.prepare("SELECT * FROM field_library WHERE id = ? AND event_id = ?")
      .bind(body.library_field_id, eventId)
      .first<FieldLibraryRow>();
    if (!source) throw ApiError.notFound("library question not found in this conference");
    rejectParticipantQuestion(source.key);
    const fields = await context.env.DB.prepare(
      "SELECT key, library_field_id FROM form_fields WHERE form_id = ? ORDER BY position ASC, id ASC",
    ).bind(formId).all<{ key: string; library_field_id: string | null }>();
    const destinationKeys = new Set(fields.results.map((field) => field.key));
    if (fields.results.some((field) => field.library_field_id === source.id)) {
      throw ApiError.conflict("this question is already On this form");
    }
    if (destinationKeys.has(source.key)) {
      throw ApiError.conflict(`a field with the key ${source.key} already exists on this form`);
    }
    const position = Math.min(body.position ?? fields.results.length, fields.results.length);
    const now = Date.now();
    const { condition, warning } = materializeLibraryCondition(parseFormCondition(source.condition), destinationKeys);
    const id = crypto.randomUUID();
    try {
      await context.env.DB.batch([
        context.env.DB.prepare("UPDATE form_fields SET position = position + 1, updated_at = ? WHERE form_id = ? AND position >= ?")
          .bind(now, formId, position),
        context.env.DB.prepare(
          `INSERT INTO form_fields
            (id, form_id, key, label, help_text, type, required, position, config, condition, library_field_id, library_field_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          formId,
          source.key,
          source.label,
          source.help_text,
          source.type,
          source.required,
          position,
          source.config,
          condition ? JSON.stringify(condition) : null,
          source.id,
          source.version,
          now,
          now,
        ),
      ]);
    } catch {
      throw ApiError.conflict("the library question could not be copied to this form");
    }
    const field = await context.env.DB.prepare("SELECT * FROM form_fields WHERE id = ? AND form_id = ?")
      .bind(id, formId)
      .first<FormFieldRow>();
    if (!field) throw new Error("copied library question disappeared");
    return context.json({ ...(await fieldResponse(context.env.DB, eventId, field)), warning }, 201);
  },
);

const listFormFieldsRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields",
    operationId: "listFormFields",
    summary: "List form fields",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(formFieldSchema) }), "Form fields"), ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId);
    return context.json({ data: await listFormFields(context.env.DB, formId) }, 200);
  },
);

const createFormField = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields",
    operationId: "createFormField",
    summary: "Add a field to a form",
    tags: ["Forms"],
    request: { params: formParams, body: { content: { "application/json": { schema: createFieldSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(formFieldSchema, "Created field"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId, true);
    const body = context.req.valid("json");
    const condition = conditionJson(body.condition);
    if (body.save_to_library) rejectParticipantQuestion(body.key);
    const current = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM form_fields WHERE form_id = ?").bind(formId).first<{ count: number }>();
    const count = Number(current?.count ?? 0);
    const position = Math.min(body.position ?? count, count);
    const now = Date.now();
    const id = crypto.randomUUID();
    const libraryId = body.save_to_library ? crypto.randomUUID() : null;
    try {
      await context.env.DB.batch([
        context.env.DB.prepare("UPDATE form_fields SET position = position + 1, updated_at = ? WHERE form_id = ? AND position >= ?").bind(now, formId, position),
        ...(libraryId ? [context.env.DB.prepare(
          `INSERT INTO field_library
            (id, event_id, key, label, help_text, type, required, config, condition, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).bind(
          libraryId,
          eventId,
          body.key,
          body.label,
          body.help_text ?? null,
          body.type,
          body.required ? 1 : 0,
          fieldConfigJson(body.config, body.type),
          condition,
          now,
          now,
        )] : []),
        context.env.DB.prepare(
          `INSERT INTO form_fields
            (id, form_id, key, label, help_text, type, required, position, config, condition, library_field_id, library_field_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          formId,
          body.key,
          body.label,
          body.help_text ?? null,
          body.type,
          body.required ? 1 : 0,
          position,
          fieldConfigJson(body.config, body.type),
          condition,
          libraryId,
          libraryId ? 1 : null,
          now,
          now,
        ),
      ]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.conflict("a field with that key already exists in this form");
    }
    const field = await context.env.DB.prepare("SELECT * FROM form_fields WHERE id = ? AND form_id = ?").bind(id, formId).first<FormFieldRow>();
    if (!field) throw new Error("created form field disappeared");
    return context.json(await fieldResponse(context.env.DB, eventId, field), 201);
  },
);

const updateFormField = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}",
    operationId: "updateFormField",
    summary: "Edit a form field",
    tags: ["Forms"],
    request: { params: fieldParams, body: { content: { "application/json": { schema: patchFieldSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(formFieldSchema, "Updated field"), ...errorResponses([400, 401, 403, 404, 409, 422, 500]) },
  },
  async (context) => {
    const { eventId, formId, fieldId } = context.req.valid("param");
    const current = await getField(context, eventId, formId, fieldId, true);
    const body = context.req.valid("json");
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => { updates.push(`${column} = ?`); values.push(value); };
    const nextType = body.type ?? current.type;
    if (body.key !== undefined) set("key", body.key);
    if (body.label !== undefined) set("label", body.label);
    if (body.help_text !== undefined) set("help_text", body.help_text);
    if (body.type !== undefined) set("type", body.type);
    if (body.required !== undefined) set("required", body.required ? 1 : 0);
    // A type change is part of the same config contract. Re-normalize the
    // stored config even when the caller omitted it, so a bound select cannot
    // silently become a non-select while retaining an unusable source.
    if (body.config !== undefined || body.type !== undefined) {
      set("config", fieldConfigJson(body.config ?? normalizeField(current).config, nextType));
    }
    if (body.condition !== undefined) set("condition", conditionJson(body.condition));
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(Math.max(Date.now(), current.updated_at + 1));
      try {
        await context.env.DB.prepare(`UPDATE form_fields SET ${updates.join(", ")} WHERE id = ? AND form_id = ?`).bind(...values, fieldId, formId).run();
      } catch {
        throw ApiError.conflict("a field with that key already exists in this form");
      }
    }
    const field = await context.env.DB.prepare("SELECT * FROM form_fields WHERE id = ? AND form_id = ?").bind(fieldId, formId).first<FormFieldRow>();
    if (!field) throw ApiError.notFound("form field not found");
    return context.json(await fieldResponse(context.env.DB, eventId, field), 200);
  },
);

const deleteFormField = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields/{fieldId}",
    operationId: "deleteFormField",
    summary: "Delete a form field",
    tags: ["Forms"],
    request: { params: fieldParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Deleted field"), ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId, formId, fieldId } = context.req.valid("param");
    await getField(context, eventId, formId, fieldId, true);
    await context.env.DB.prepare("DELETE FROM form_fields WHERE id = ? AND form_id = ?").bind(fieldId, formId).run();
    await normalizeFieldPositions(context.env.DB, formId);
    return context.json({ deleted: true }, 200);
  },
);

const reorderFormFields = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/forms/{formId}/fields/reorder",
    operationId: "reorderFormFields",
    summary: "Reorder form fields",
    tags: ["Forms"],
    request: { params: formParams, body: { content: { "application/json": { schema: reorderFieldsSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(formFieldSchema) }), "Reordered fields"), ...errorResponses([400, 401, 403, 404, 409, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId, true);
    const body = context.req.valid("json");
    const existing = await context.env.DB.prepare("SELECT id FROM form_fields WHERE form_id = ? ORDER BY id").bind(formId).all<{ id: string }>();
    const expected = existing.results.map((field) => field.id).sort();
    const received = [...body.field_ids].sort();
    if (expected.length !== received.length || expected.some((id, index) => id !== received[index])) {
      throw ApiError.badRequest("field_ids must contain every field exactly once", "field_ids");
    }
    const now = Date.now();
    await context.env.DB.batch(body.field_ids.map((fieldId: string, position: number) =>
      context.env.DB.prepare("UPDATE form_fields SET position = ?, updated_at = ? WHERE id = ? AND form_id = ?").bind(position, now, fieldId, formId),
    ));
    return context.json({ data: await listFormFields(context.env.DB, formId) }, 200);
  },
);

const listFormAdminsRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/forms/{formId}/admins",
    operationId: "listFormAdmins",
    summary: "List form administrators",
    tags: ["Forms"],
    request: { params: formParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(formAdminSchema) }), "Form administrators"), ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId);
    return context.json({ data: await listFormAdmins(context.env.DB, formId) }, 200);
  },
);

const addFormAdmin = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/forms/{formId}/admins",
    operationId: "addFormAdmin",
    summary: "Add a form administrator",
    tags: ["Forms"],
    request: { params: formParams, body: { content: { "application/json": { schema: adminBodySchema } } } },
    responses: { 201: jsonResponse(formAdminSchema, "Added form administrator"), ...errorResponses([400, 401, 403, 404, 409, 500]) },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
  },
  async (context) => {
    const { eventId, formId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId, true);
    const { person_id: personId } = context.req.valid("json");
    const person = await context.env.DB.prepare(
      "SELECT p.id FROM people p JOIN events e ON e.org_id = p.org_id WHERE p.id = ? AND e.id = ?",
    ).bind(personId, eventId).first();
    if (!person) throw ApiError.badRequest("person is not part of this conference", "person_id");
    const now = Date.now();
    const id = crypto.randomUUID();
    try {
      await context.env.DB.prepare("INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, formId, personId, now, now).run();
    } catch {
      throw ApiError.conflict("this person is already a form administrator");
    }
    const admin = await context.env.DB.prepare(
      `SELECT fa.id, fa.person_id, p.name, p.email FROM form_admins fa JOIN people p ON p.id = fa.person_id WHERE fa.id = ?`,
    ).bind(id).first();
    if (!admin) throw new Error("created form administrator disappeared");
    return context.json(admin, 201);
  },
);

const removeFormAdmin = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/forms/{formId}/admins/{personId}",
    operationId: "removeFormAdmin",
    summary: "Remove a form administrator",
    tags: ["Forms"],
    request: { params: adminParams },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Removed form administrator"), ...errorResponses([401, 403, 404, 500]) },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
  },
  async (context) => {
    const { eventId, formId, personId } = context.req.valid("param");
    await getOwnedForm(context, eventId, formId, true);
    const result = await context.env.DB.prepare("DELETE FROM form_admins WHERE form_id = ? AND person_id = ?").bind(formId, personId).run();
    if ((result.meta.changes ?? 0) === 0) throw ApiError.notFound("form administrator not found");
    return context.json({ deleted: true }, 200);
  },
);

export const apiRoutes = [
  listEventForms,
  createEventForm,
  getEventForm,
  updateEventForm,
  deleteEventForm,
  duplicateEventForm,
  publishEventForm,
  closeEventForm,
  reopenEventForm,
  listFieldLibraryRoute,
  createFieldLibraryRoute,
  updateFieldLibraryRoute,
  deleteFieldLibraryRoute,
  copyFieldFromLibraryRoute,
  listFormFieldsRoute,
  createFormField,
  reorderFormFields,
  updateFormField,
  deleteFormField,
  listFormAdminsRoute,
  addFormAdmin,
  removeFormAdmin,
];

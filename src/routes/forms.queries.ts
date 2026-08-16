import type { D1Database } from "@cloudflare/workers-types";
import { resolveSort, executeListPage, parsePagination, type SortRegistry } from "../api/pagination";
import type { FormFieldRow, FormRow } from "../db/schema";
import { boundSourceOf, resolveBoundOptions } from "../lib/bound-options";
import { fieldPreviewProjection, parseFormCondition } from "../lib/form-conditions";
import { effectiveSubmitterLimit, submissionDefaultFor } from "../lib/submission-capacity";

export const FORM_SORTS = {
  name: { column: "f.name", direction: "asc" as const },
  newest: { column: "f.created_at", direction: "desc" as const },
  responses: { column: "response_count", direction: "desc" as const },
  closes: { column: "f.closes_at", direction: "asc" as const },
} satisfies SortRegistry;

export interface FormListInput {
  eventId: string;
  /** Explicit form admins see only the forms assigned to them. */
  personId?: string;
  page: number;
  per_page: number;
  q?: string;
  sort: string;
  status?: "draft" | "open" | "closed";
  kind?: "abstract" | "session";
}

export interface FormListItem {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  kind: "abstract" | "session";
  status: "draft" | "open" | "closed";
  opens_at: number | null;
  closes_at: number | null;
  welcome_md: string;
  per_submitter_limit: number;
  submitter_limit_inherit: boolean;
  effective_submitter_limit: number;
  min_speakers: number;
  max_speakers: number;
  max_sponsors: number;
  response_count: number;
  visibility: "public" | "private";
  public_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface FormAdminView {
  id: string;
  person_id: string;
  name: string;
  email: string;
}

export interface FormFieldView {
  id: string;
  form_id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FormFieldRow["type"];
  required: boolean;
  position: number;
  config: Record<string, unknown>;
  condition: ReturnType<typeof parseFormCondition>;
  created_at: number;
  updated_at: number;
}

export interface FormDetail extends FormListItem {
  reminder_offset_hours: number | null;
  thankyou_template_key: string | null;
  admin_notify_person_ids: string[];
  turnstile_required: boolean;
  fields: FormFieldView[];
  admins: FormAdminView[];
  preview_fields: ReturnType<typeof fieldPreviewProjection>;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T | undefined) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function formVisibility(status: FormRow["status"]): "public" | "private" {
  return status === "draft" ? "private" : "public";
}

export function effectiveFormStatus(
  row: Pick<FormRow, "status" | "closes_at">,
  now = Date.now(),
): FormRow["status"] {
  return row.status === "open" && row.closes_at !== null && Number(row.closes_at) <= now
    ? "closed"
    : row.status;
}

export function normalizeForm(
  row: FormRow & { response_count?: number | null },
  eventDefault: number,
): FormListItem {
  const responseCount = Number(row.response_count ?? 0);
  const status = effectiveFormStatus(row);
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status,
    opens_at: asNumber(row.opens_at),
    closes_at: asNumber(row.closes_at),
    welcome_md: row.welcome_md,
    per_submitter_limit: Number(row.per_submitter_limit),
    submitter_limit_inherit: Number(row.submitter_limit_inherit) === 1,
    effective_submitter_limit: effectiveSubmitterLimit(
      { submission_default_limit: eventDefault },
      row,
    ),
    min_speakers: Number(row.min_speakers),
    max_speakers: Number(row.max_speakers),
    max_sponsors: Number(row.max_sponsors),
    response_count: responseCount,
    visibility: formVisibility(status),
    public_url: status === "draft" ? null : `/f/${row.slug}`,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export function normalizeField(row: FormFieldRow): FormFieldView {
  return {
    id: row.id,
    form_id: row.form_id,
    key: row.key,
    label: row.label,
    help_text: row.help_text,
    type: row.type,
    required: row.required === 1,
    position: Number(row.position),
    config: parseJson<Record<string, unknown>>(row.config, {}),
    condition: parseFormCondition(row.condition),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export async function listForms(db: D1Database, input: FormListInput) {
  const page = parsePagination(input);
  const sort = resolveSort(FORM_SORTS, input.sort, "newest");
  const where = ["f.event_id = ?"];
  const bindings: (string | number)[] = [input.eventId];
  if (input.status === "draft") {
    where.push("f.status = ?");
    bindings.push("draft");
  } else if (input.status === "open") {
    where.push("f.status = ? AND (f.closes_at IS NULL OR f.closes_at > ?)");
    bindings.push("open", Date.now());
  } else if (input.status === "closed") {
    where.push("(f.status = ? OR (f.status = 'open' AND f.closes_at IS NOT NULL AND f.closes_at <= ?))");
    bindings.push("closed", Date.now());
  }
  if (input.kind) {
    where.push("f.kind = ?");
    bindings.push(input.kind);
  }
  if (input.personId) {
    where.push("EXISTS (SELECT 1 FROM form_admins scoped_admin WHERE scoped_admin.form_id = f.id AND scoped_admin.person_id = ?)");
    bindings.push(input.personId);
  }
  if (input.q) {
    where.push("(f.name LIKE ? OR f.slug LIKE ?)");
    const pattern = `%${input.q}%`;
    bindings.push(pattern, pattern);
  }
  const predicate = where.join(" AND ");
  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM forms f WHERE ${predicate}`)
    .bind(...bindings);
  const data = db
    .prepare(
      `SELECT f.*, COUNT(DISTINCT s.id) AS response_count
       FROM forms f
       LEFT JOIN submissions s ON s.form_id = f.id
       WHERE ${predicate}
       GROUP BY f.id
       ORDER BY ${sort.column} ${sort.direction.toUpperCase()}, f.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, page.limit, page.offset);
  const [eventDefault, result] = await Promise.all([
    submissionDefaultFor(db, input.eventId),
    executeListPage({ count, data, page }),
  ]);
  return { ...result, data: result.data.map((row) => normalizeForm(row as FormRow & { response_count?: number | null }, eventDefault)) };
}

export async function findForm(db: D1Database, eventId: string, formId: string): Promise<FormRow | null> {
  return db
    .prepare("SELECT * FROM forms WHERE id = ? AND event_id = ?")
    .bind(formId, eventId)
    .first<FormRow>();
}

export async function findFormBySlug(db: D1Database, slug: string): Promise<FormRow | null> {
  return db.prepare("SELECT * FROM forms WHERE slug = ?").bind(slug).first<FormRow>();
}

export async function countFormResponses(db: D1Database, formId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM submissions WHERE form_id = ?").bind(formId).first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

/**
 * The one place form fields are read. Bound options are resolved here rather
 * than per-caller so no path — admin detail, the fields list, reorder, the
 * public form, or the submit validation that reads the same fields — can be
 * added later that forgets to, and serve an option list the resolver will
 * reject.
 */
export async function listFormFields(db: D1Database, formId: string): Promise<FormFieldView[]> {
  const rows = await db
    .prepare("SELECT * FROM form_fields WHERE form_id = ? ORDER BY position ASC, id ASC")
    .bind(formId)
    .all<FormFieldRow>();
  const fields = rows.results.map(normalizeField);
  if (!fields.some((field) => boundSourceOf(field))) return fields;
  const form = await db.prepare("SELECT event_id FROM forms WHERE id = ?").bind(formId).first<{ event_id: string }>();
  if (!form) return fields;
  return resolveBoundOptions(db, form.event_id, fields);
}

export async function listFormAdmins(db: D1Database, formId: string): Promise<FormAdminView[]> {
  const rows = await db
    .prepare(
      `SELECT fa.id, fa.person_id, p.name, p.email
       FROM form_admins fa JOIN people p ON p.id = fa.person_id
       WHERE fa.form_id = ? ORDER BY p.name COLLATE NOCASE, fa.person_id ASC`,
    )
    .bind(formId)
    .all<FormAdminView>();
  return rows.results;
}

export async function readFormDetail(db: D1Database, form: FormRow): Promise<FormDetail> {
  const [responseCount, fields, admins, eventDefault] = await Promise.all([
    countFormResponses(db, form.id),
    listFormFields(db, form.id),
    listFormAdmins(db, form.id),
    submissionDefaultFor(db, form.event_id),
  ]);
  const summary = normalizeForm({ ...form, response_count: responseCount }, eventDefault);
  return {
    ...summary,
    reminder_offset_hours: asNumber(form.reminder_offset_hours),
    thankyou_template_key: form.thankyou_template_key,
    admin_notify_person_ids: parseJson<string[]>(form.admin_notify_person_ids, []),
    turnstile_required: form.turnstile_required === 1,
    fields,
    admins,
    preview_fields: fieldPreviewProjection(fields),
  };
}

export function normalizePositions<T extends { position: number }>(rows: T[]): T[] {
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row, index) => ({ ...row, position: index }));
}

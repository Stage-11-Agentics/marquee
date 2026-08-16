import type { AirtableTable, AirtableTableField } from "./transport";
import { MIRRORED_TABLES, type MirroredTable } from "./records";

export type MirrorProviderFieldType =
  | "singleLineText"
  | "multilineText"
  | "richText"
  | "singleSelect"
  | "checkbox"
  | "dateTime"
  | "multipleAttachments"
  | "email"
  | "url";

export type MirrorSchemaOperation = "verify" | "provision" | "adopt";

export interface MirrorSchemaField {
  name: string;
  type: MirrorProviderFieldType;
  options?: Record<string, unknown>;
  acceptedTypes: readonly MirrorProviderFieldType[];
  representative: unknown;
}

export interface MirrorTableDefinition {
  name: string;
  fields: readonly MirrorSchemaField[];
}

const DATE_TIME_OPTIONS = {
  timeZone: "utc",
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
};
const CHECKBOX_OPTIONS = { icon: "check", color: "greenBright" };
const TEXT_TYPES = ["singleLineText", "multilineText", "richText"] as const;
const SELECT_OR_TEXT_TYPES = ["singleLineText", "multilineText", "richText", "singleSelect"] as const;
const TEXT_REPRESENTATIVE = "example";
const ID_REPRESENTATIVE = "rec_mrq248_example";
const ISO_REPRESENTATIVE = "2026-08-15T12:00:00.000Z";
// This is the record-write value, not field configuration: Airtable accepts a
// URL and optional filename for each attachment object. Local metadata keys
// are deliberately absent from the provider payload.
const ATTACHMENT_REPRESENTATIVE = [{ url: "https://media.example.test/file.pdf", filename: "file.pdf" }];

function text(name: string, representative = TEXT_REPRESENTATIVE): MirrorSchemaField {
  return { name, type: "singleLineText", acceptedTypes: TEXT_TYPES, representative };
}

function longText(name: string): MirrorSchemaField {
  return { name, type: "multilineText", acceptedTypes: TEXT_TYPES, representative: TEXT_REPRESENTATIVE };
}

function selectOrText(name: string): MirrorSchemaField {
  return { name, type: "singleLineText", acceptedTypes: SELECT_OR_TEXT_TYPES, representative: TEXT_REPRESENTATIVE };
}

function dateTime(name: string): MirrorSchemaField {
  return {
    name,
    type: "dateTime",
    options: DATE_TIME_OPTIONS,
    acceptedTypes: ["dateTime"],
    representative: ISO_REPRESENTATIVE,
  };
}

function checkbox(name: string): MirrorSchemaField {
  return {
    name,
    type: "checkbox",
    options: CHECKBOX_OPTIONS,
    acceptedTypes: ["checkbox"],
    representative: true,
  };
}

function attachment(name: string): MirrorSchemaField {
  return {
    name,
    type: "multipleAttachments",
    acceptedTypes: ["multipleAttachments"],
    representative: ATTACHMENT_REPRESENTATIVE,
  };
}

function email(name: string): MirrorSchemaField {
  return {
    name,
    type: "email",
    acceptedTypes: ["email", "singleLineText"],
    representative: "speaker@example.test",
  };
}

function url(name: string): MirrorSchemaField {
  return {
    name,
    type: "url",
    acceptedTypes: ["url", "singleLineText"],
    representative: "https://example.test/profile",
  };
}

/**
 * Provider-facing declaration. `records.ts` emits the preferred `type` shape;
 * `acceptedTypes` describes safe existing writable alternates for adoption.
 * The declaration intentionally contains every field currentAirtableRecord can
 * emit. `marquee_id` is first in every table because Airtable's first field is
 * the primary field and this is the only legal primary shape we use.
 *
 * Provider legality is grounded in Airtable's official Metadata API references:
 * https://airtable.com/developers/web/api/get-base-schema.md
 * https://airtable.com/developers/web/api/create-table.md
 * https://airtable.com/developers/web/api/create-field.md
 * https://airtable.com/developers/web/api/field-model.md
 * https://airtable.com/developers/web/api/model/field-type.md
 * The hermetic validator below proves our declared write shapes; it does not
 * replace that vendor documentation or a later operator-approved smoke.
 */
export const MIRROR_TABLE_SCHEMA: Record<MirroredTable, MirrorTableDefinition> = {
  submissions: {
    name: "Submissions",
    fields: [
      text("marquee_id", ID_REPRESENTATIVE),
      text("event_id", ID_REPRESENTATIVE),
      text("reference_code"),
      text("form_id", ID_REPRESENTATIVE),
      selectOrText("kind"),
      checkbox("bypass_evaluation"),
      text("title"),
      longText("abstract"),
      selectOrText("status"),
      text("format_id", ID_REPRESENTATIVE),
      text("primary_track_id", ID_REPRESENTATIVE),
      longText("tracks"),
      text("origin"),
      text("vendor_affiliation"),
      text("wave_id", ID_REPRESENTATIVE),
      text("submitter_person_id", ID_REPRESENTATIVE),
      dateTime("decided_at"),
      text("decided_by_person_id", ID_REPRESENTATIVE),
      dateTime("submitted_at"),
      dateTime("last_saved_at"),
      checkbox("is_published"),
      text("external_ref"),
      text("applied_rule_id", ID_REPRESENTATIVE),
      text("last_write_source"),
      dateTime("created_at"),
      dateTime("updated_at"),
      attachment("attachments"),
    ],
  },
  speaker_tasks: {
    name: "Speaker Tasks",
    fields: [
      text("marquee_id", ID_REPRESENTATIVE),
      text("event_id", ID_REPRESENTATIVE),
      text("person_id", ID_REPRESENTATIVE),
      text("submission_id", ID_REPRESENTATIVE),
      text("template_id", ID_REPRESENTATIVE),
      text("title"),
      selectOrText("kind"),
      longText("description"),
      dateTime("due_at"),
      selectOrText("status"),
      dateTime("completed_at"),
      text("completed_by_person_id", ID_REPRESENTATIVE),
      longText("response_json"),
      dateTime("cancelled_at"),
      text("sponsorship_id", ID_REPRESENTATIVE),
      text("last_write_source"),
      dateTime("created_at"),
      dateTime("updated_at"),
      attachment("attachments"),
    ],
  },
  people: {
    name: "People",
    fields: [
      text("marquee_id", ID_REPRESENTATIVE),
      text("org_id", ID_REPRESENTATIVE),
      email("email"),
      text("name"),
      text("title"),
      text("company"),
      text("company_id", ID_REPRESENTATIVE),
      longText("bio"),
      longText("social_links"),
      longText("custom_fields"),
      checkbox("do_not_contact"),
      checkbox("is_demo"),
      selectOrText("kind"),
      text("last_write_source"),
      dateTime("created_at"),
      dateTime("updated_at"),
      url("headshot_url"),
    ],
  },
};

export const MIRROR_FIELD_COUNTS = Object.fromEntries(
  MIRRORED_TABLES.map((tableName) => [tableName, MIRROR_TABLE_SCHEMA[tableName].fields.length]),
) as Record<MirroredTable, number>;

export const MIRROR_SINGLE_SELECT_VALUES: Readonly<Record<string, readonly string[]>> = {
  status: [
    "draft", "submitted", "in_review", "accepted", "waitlisted", "rejected", "withdrawn",
    "scheduled", "published", "open", "done", "cancelled",
  ],
  kind: [
    "abstract", "session", "acknowledge", "file", "form", "human", "agent",
  ],
};

export interface MirrorSchemaIssue {
  code: "unknown_schema" | "missing_field" | "type_conflict" | "single_select_choices" | "shape_conflict" | "primary_field_conflict";
  operation: MirrorSchemaOperation;
  table: MirroredTable;
  tableId: string;
  tableName: string;
  field?: string;
  expectedTypes?: readonly MirrorProviderFieldType[];
  actualType?: string;
  missingChoices?: readonly string[];
  recovery: string;
}

export interface MirrorTableInspection {
  table: MirroredTable;
  tableId: string;
  tableName: string;
  conformant: boolean;
  missingFields: readonly MirrorSchemaField[];
  issues: readonly MirrorSchemaIssue[];
}

function recoveryForType(field: MirrorSchemaField, actualType: string | undefined, table: AirtableTable, operation: MirrorSchemaOperation): string {
  const actual = actualType ?? "unknown";
  return `Airtable table “${table.name}” field “${field.name}” is ${actual}; use ${field.type} or another writable compatible type before ${operation}.`;
}

function choiceNames(field: AirtableTableField): string[] {
  const choices = field.options?.choices;
  if (!Array.isArray(choices)) return [];
  return choices.flatMap((choice) => {
    if (!choice || typeof choice !== "object" || typeof (choice as { name?: unknown }).name !== "string") return [];
    return [(choice as { name: string }).name];
  });
}

export function airtableValueMatchesType(actualType: string, representative: unknown): boolean {
  if (representative === null || representative === undefined) return true;
  if (actualType === "checkbox") return typeof representative === "boolean";
  if (actualType === "multipleAttachments") {
    return Array.isArray(representative)
      && representative.every((value) => {
        if (!value || typeof value !== "object" || typeof (value as { url?: unknown }).url !== "string") return false;
        return Object.keys(value).every((key) => key === "url" || key === "filename");
      });
  }
  if (actualType === "dateTime") return typeof representative === "string";
  if (["singleLineText", "multilineText", "richText", "singleSelect", "email", "url"].includes(actualType)) {
    return typeof representative === "string";
  }
  return false;
}

function representativeShapeIsLegal(field: MirrorSchemaField, actualType: string): boolean {
  return airtableValueMatchesType(actualType, field.representative);
}

/** Validate one table without rejecting unrelated organizer-owned columns. */
export function ensureMirrorSchema(
  table: MirroredTable,
  candidate: AirtableTable | undefined,
  operation: MirrorSchemaOperation,
): MirrorTableInspection {
  const definition = MIRROR_TABLE_SCHEMA[table];
  const tableId = candidate?.id ?? "unknown-table";
  const tableName = candidate?.name ?? definition.name;
  if (!candidate || candidate.fields === undefined) {
    return {
      table,
      tableId,
      tableName,
      conformant: false,
      missingFields: definition.fields,
      issues: [{
        code: "unknown_schema",
        operation,
        table,
        tableId,
        tableName,
        recovery: `Airtable did not return fields for table “${tableName}” (${tableId}); re-read the base schema before ${operation}.`,
      }],
    };
  }

  const byName = new Map(candidate.fields.map((field) => [field.name, field]));
  const missingFields: MirrorSchemaField[] = [];
  const issues: MirrorSchemaIssue[] = [];
  if (candidate.primaryFieldId !== undefined) {
    const primary = candidate.fields.find((field) => field.id === candidate.primaryFieldId);
    if (primary?.name !== "marquee_id") {
      issues.push({
        code: "primary_field_conflict",
        operation,
        table,
        tableId,
        tableName,
        field: primary?.name ?? "primary field",
        recovery: `Airtable table “${tableName}” must use “marquee_id” as its primary field; choose a table with that primary field or create a new canonical table.`,
      });
    }
  }
  for (const field of definition.fields) {
    const actual = byName.get(field.name);
    if (!actual) {
      missingFields.push(field);
      continue;
    }
    if (!actual.type || !field.acceptedTypes.includes(actual.type as MirrorProviderFieldType)) {
      issues.push({
        code: "type_conflict",
        operation,
        table,
        tableId,
        tableName,
        field: field.name,
        expectedTypes: field.acceptedTypes,
        actualType: actual.type,
        recovery: recoveryForType(field, actual.type, candidate, operation),
      });
      continue;
    }
    if (!representativeShapeIsLegal(field, actual.type)) {
      issues.push({
        code: "shape_conflict",
        operation,
        table,
        tableId,
        tableName,
        field: field.name,
        expectedTypes: field.acceptedTypes,
        actualType: actual.type,
        recovery: `Airtable table “${tableName}” field “${field.name}” cannot accept Marquee’s representative value shape; change it to a writable compatible field.`,
      });
      continue;
    }
    if (actual.type === "singleSelect") {
      const required = MIRROR_SINGLE_SELECT_VALUES[field.name] ?? [];
      const choices = new Set(choiceNames(actual));
      const missingChoices = required.filter((value) => !choices.has(value));
      if (missingChoices.length > 0) {
        issues.push({
          code: "single_select_choices",
          operation,
          table,
          tableId,
          tableName,
          field: field.name,
          actualType: actual.type,
          missingChoices,
          recovery: `Airtable table “${tableName}” field “${field.name}” is single select but is missing choices: ${missingChoices.join(", ")}. Add those choices or change the field to single-line text.`,
        });
      }
    }
  }

  return {
    table,
    tableId,
    tableName,
    conformant: missingFields.length === 0 && issues.length === 0,
    missingFields,
    issues,
  };
}

export function createTableFields(table: MirroredTable): readonly {
  name: string;
  type: MirrorProviderFieldType;
  options?: Record<string, unknown>;
}[] {
  return MIRROR_TABLE_SCHEMA[table].fields.map((field) => ({
    name: field.name,
    type: field.type,
    ...(field.options === undefined ? {} : { options: structuredClone(field.options) }),
  }));
}

export function createFieldPayload(field: MirrorSchemaField): {
  name: string;
  type: MirrorProviderFieldType;
  options?: Record<string, unknown>;
} {
  return {
    name: field.name,
    type: field.type,
    ...(field.options === undefined ? {} : { options: structuredClone(field.options) }),
  };
}

export function mirrorRecordFieldNames(table: MirroredTable): readonly string[] {
  return MIRROR_TABLE_SCHEMA[table].fields.map((field) => field.name);
}

export function mirrorRecordMatchesSchema(table: MirroredTable, fields: Record<string, unknown>): boolean {
  const expected = new Set(mirrorRecordFieldNames(table));
  const actual = Object.keys(fields);
  return actual.length === expected.size && actual.every((name) => expected.has(name));
}

export function normalizeTableName(name: string): string {
  return name.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");
}

export function findExactMirrorTable(tables: readonly AirtableTable[], table: MirroredTable): AirtableTable | undefined {
  const expected = normalizeTableName(MIRROR_TABLE_SCHEMA[table].name);
  return tables.find((candidate) => normalizeTableName(candidate.name) === expected);
}

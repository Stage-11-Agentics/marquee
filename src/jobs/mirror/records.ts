import type { D1Database } from "@cloudflare/workers-types";

import type { AirtableRecord } from "./transport";
import type { MirrorConfig } from "./config";
import { publicMediaUrl } from "../../lib/r2/media-links";

export const MIRRORED_TABLES = ["submissions", "speaker_tasks", "people"] as const;
export type MirroredTable = (typeof MIRRORED_TABLES)[number];

interface MirrorAttachment {
  content_type: string;
  filename: string;
  r2_key: string;
  status: "pending" | "ready";
}

interface MirrorRecordEnv {
  DB: D1Database;
  mirror: MirrorConfig;
}

function isMirroredTable(value: string): value is MirroredTable {
  return (MIRRORED_TABLES as readonly string[]).includes(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [
      key,
      stableJsonValue((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

/** Stable JSON text is the provider shape for JSON-backed mirror fields. */
export function stableJsonStringify(value: unknown): string | null {
  if (value === null || value === undefined) return value === null ? "null" : null;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      // A non-JSON D1 string is still a valid JSON-backed value once quoted.
    }
  }
  return JSON.stringify(stableJsonValue(parsed));
}

/** D1 epoch milliseconds are emitted as Airtable's canonical ISO dateTime text. */
export function toAirtableDateTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return String(value);
}

/** D1's 0/1 representation is converted once to Airtable checkbox booleans. */
export function toAirtableCheckbox(value: unknown): boolean | null | undefined {
  if (value === null || value === undefined) return value;
  return value === true || value === 1 || value === "1";
}

async function readyAttachments(
  db: D1Database,
  ownerType: "person_headshot" | "task_upload" | "submission_file",
  ownerId: string,
): Promise<MirrorAttachment[]> {
  const result = await db.prepare(
    `SELECT r2_key, filename, content_type, status
       FROM attachments
      WHERE owner_type = ? AND owner_id = ? AND status = 'ready'
      ORDER BY created_at ASC, id ASC`,
  ).bind(ownerType, ownerId).all<MirrorAttachment>();
  return result.results;
}

async function attachmentFields(
  env: MirrorRecordEnv,
  attachments: readonly MirrorAttachment[],
): Promise<Array<{ url: string; filename?: string }>> {
  return Promise.all(attachments.map(async (attachment) => {
    const url = await publicMediaUrl(
      env.mirror.mediaPublicOrigin,
      { status: "ready", r2_key: attachment.r2_key },
      env.mirror.uploadTokenSecret,
    );
    return attachment.filename
      ? { url, filename: attachment.filename }
      : { url };
  }));
}

function fieldRecord(row: Record<string, unknown>, fields: Record<string, unknown>): AirtableRecord {
  return { fields: { marquee_id: row.id, ...fields } };
}

async function submissionRecord(env: MirrorRecordEnv, rowId: string): Promise<AirtableRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(rowId).first<Record<string, unknown>>();
  if (!row) return null;
  const tracks = await env.DB.prepare(
    `SELECT GROUP_CONCAT(track.name, ', ') AS names
       FROM submission_tracks submission_track
       JOIN tracks track ON track.id = submission_track.track_id
      WHERE submission_track.submission_id = ?`,
  ).bind(rowId).first<{ names: string | null }>();
  const attachments = await readyAttachments(env.DB, "submission_file", rowId);
  return fieldRecord(row, {
    event_id: row.event_id,
    reference_code: row.reference_code,
    form_id: row.form_id,
    kind: row.kind,
    bypass_evaluation: toAirtableCheckbox(row.bypass_evaluation),
    title: row.title,
    abstract: row.abstract,
    status: row.status,
    format_id: row.format_id,
    primary_track_id: row.primary_track_id,
    tracks: tracks?.names ?? "",
    origin: row.origin,
    vendor_affiliation: row.vendor_affiliation,
    wave_id: row.wave_id,
    submitter_person_id: row.submitter_person_id,
    decided_at: toAirtableDateTime(row.decided_at),
    decided_by_person_id: row.decided_by_person_id,
    submitted_at: toAirtableDateTime(row.submitted_at),
    last_saved_at: toAirtableDateTime(row.last_saved_at),
    is_published: toAirtableCheckbox(row.is_published),
    external_ref: row.external_ref,
    applied_rule_id: row.applied_rule_id,
    last_write_source: row.last_write_source,
    created_at: toAirtableDateTime(row.created_at),
    updated_at: toAirtableDateTime(row.updated_at),
    attachments: await attachmentFields(env, attachments),
  });
}

async function speakerTaskRecord(env: MirrorRecordEnv, rowId: string): Promise<AirtableRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM speaker_tasks WHERE id = ?").bind(rowId).first<Record<string, unknown>>();
  if (!row) return null;
  const attachments = await readyAttachments(env.DB, "task_upload", rowId);
  return fieldRecord(row, {
    event_id: row.event_id,
    person_id: row.person_id,
    submission_id: row.submission_id,
    template_id: row.template_id,
    title: row.title,
    kind: row.kind,
    description: row.description,
    due_at: toAirtableDateTime(row.due_at),
    status: row.status,
    completed_at: toAirtableDateTime(row.completed_at),
    completed_by_person_id: row.completed_by_person_id,
    response_json: stableJsonStringify(row.response_json),
    cancelled_at: toAirtableDateTime(row.cancelled_at),
    sponsorship_id: row.sponsorship_id,
    last_write_source: row.last_write_source,
    created_at: toAirtableDateTime(row.created_at),
    updated_at: toAirtableDateTime(row.updated_at),
    attachments: await attachmentFields(env, attachments),
  });
}

async function personRecord(env: MirrorRecordEnv, rowId: string): Promise<AirtableRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(rowId).first<Record<string, unknown>>();
  if (!row) return null;
  const attachments = row.headshot_attachment_id
    ? await readyAttachments(env.DB, "person_headshot", String(row.id))
    : [];
  const urls = await attachmentFields(env, attachments);
  return fieldRecord(row, {
    org_id: row.org_id,
    email: row.email,
    name: row.name,
    title: row.title,
    company: row.company,
    company_id: row.company_id,
    bio: row.bio,
    social_links: stableJsonStringify(row.social_links),
    custom_fields: stableJsonStringify(row.custom_fields),
    do_not_contact: toAirtableCheckbox(row.do_not_contact),
    is_demo: toAirtableCheckbox(row.is_demo),
    kind: row.kind,
    last_write_source: row.last_write_source,
    created_at: toAirtableDateTime(row.created_at),
    updated_at: toAirtableDateTime(row.updated_at),
    headshot_url: urls[0]?.url ?? null,
  });
}

/** Read current D1 truth only from the queue job, never from a request route. */
export async function currentAirtableRecord(
  env: MirrorRecordEnv,
  tableName: string,
  rowId: string,
): Promise<AirtableRecord | null> {
  if (!isMirroredTable(tableName)) return null;
  if (tableName === "submissions") return submissionRecord(env, rowId);
  if (tableName === "speaker_tasks") return speakerTaskRecord(env, rowId);
  return personRecord(env, rowId);
}

export async function currentRowIds(db: D1Database, tableName: MirroredTable): Promise<string[]> {
  const result = await db.prepare(`SELECT id FROM ${tableName} ORDER BY id ASC`).all<{ id: string }>();
  return result.results.map((row) => row.id);
}

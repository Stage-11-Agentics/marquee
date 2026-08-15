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

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
): Promise<Array<{ url: string; filename: string; content_type: string }>> {
  return Promise.all(attachments.map(async (attachment) => ({
    url: await publicMediaUrl(
      env.mirror.mediaPublicOrigin,
      { status: "ready", r2_key: attachment.r2_key },
      env.mirror.uploadTokenSecret,
    ),
    filename: attachment.filename,
    content_type: attachment.content_type,
  })));
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
    form_id: row.form_id,
    kind: row.kind,
    bypass_evaluation: row.bypass_evaluation,
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
    decided_at: row.decided_at,
    decided_by_person_id: row.decided_by_person_id,
    submitted_at: row.submitted_at,
    last_saved_at: row.last_saved_at,
    is_published: row.is_published,
    external_ref: row.external_ref,
    applied_rule_id: row.applied_rule_id,
    last_write_source: row.last_write_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
    due_at: row.due_at,
    status: row.status,
    completed_at: row.completed_at,
    completed_by_person_id: row.completed_by_person_id,
    response_json: jsonValue(row.response_json),
    cancelled_at: row.cancelled_at,
    sponsorship_id: row.sponsorship_id,
    last_write_source: row.last_write_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
    social_links: jsonValue(row.social_links),
    custom_fields: jsonValue(row.custom_fields),
    do_not_contact: row.do_not_contact,
    is_demo: row.is_demo,
    kind: row.kind,
    last_write_source: row.last_write_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

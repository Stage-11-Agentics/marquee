/**
 * File version lists, derived — never stored.
 *
 * Versioning already exists in storage and needs no schema of its own: every
 * presign mints a fresh `attachments` row with a unique `r2_key`
 * (`lib/r2/keys.ts`), so a re-upload never overwrites its predecessor. What
 * "current" means is the owner's *pointer* — `speaker_tasks.attachment_id` for
 * a deliverable, `people.headshot_attachment_id` for a headshot — and that
 * pointer is the single definition of latest for every surface: the portal
 * version list, the organizer library, the speaker files panel, and the
 * latest-only bulk export.
 *
 * `is_latest` is therefore computed against that pointer on every read. A
 * stored flag is the failure this module exists to prevent: it drifts from the
 * pointer the portal actually writes, and the AV team stages last week's deck
 * while every screen reports the new one.
 *
 * Only `ready` attachments are versions. A presign whose upload never
 * completed leaves a `pending` row behind; counting it would inflate the
 * version number a human reads and claim a file that is not in the bucket.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { publicMediaUrl } from "../r2/keys";

/** Attachment owners this module can version. Mirrors the `attachments.owner_type` CHECK. */
export type VersionedOwnerType =
  | "task_upload"
  | "person_headshot"
  | "submission_file"
  | "draft_file"
  | "event_logo"
  | "import_file";

export interface FileVersion {
  attachment_id: string;
  /** 1 is the oldest upload; gapless, so "v2 of 2" reads the way a human means it. */
  version: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** ms epoch — the attachment row's `created_at`, i.e. when the upload was presigned. */
  uploaded_at: number;
  /** Derived from the owner pointer on every read. Never persisted. */
  is_latest: boolean;
  /**
   * Separate-origin media URL. This is an unauthenticated capability URL:
   * anyone holding it can fetch the object. Surfaces that expose it must say so.
   */
  url: string;
}

export interface FileVersionList {
  owner_type: VersionedOwnerType;
  owner_id: string;
  /** Newest first — the order every surface renders. */
  versions: FileVersion[];
  latest: FileVersion | null;
  version_count: number;
  /**
   * `pointer` when the owner has a real latest-pointer column; `recency` when
   * it does not and the newest ready upload had to stand in. A caller that
   * cares about the difference (an export claiming "latest only") can tell.
   */
  latest_source: "pointer" | "recency";
}

/** Owner types whose "current" is a real column rather than an inference. */
const POINTER_SOURCES: Partial<Record<VersionedOwnerType, { table: string; column: string }>> = {
  task_upload: { table: "speaker_tasks", column: "attachment_id" },
  person_headshot: { table: "people", column: "headshot_attachment_id" },
};

/** D1's bind limit is finite; the owner sets here are small, and chunking keeps them safe as they grow. */
const OWNER_CHUNK = 80;

interface AttachmentRow {
  id: string;
  owner_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: number;
  r2_key: string;
  version: number;
}

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

function emptyList(ownerType: VersionedOwnerType, ownerId: string): FileVersionList {
  return {
    owner_type: ownerType,
    owner_id: ownerId,
    versions: [],
    latest: null,
    version_count: 0,
    latest_source: POINTER_SOURCES[ownerType] ? "pointer" : "recency",
  };
}

async function readPointers(
  db: D1Database,
  ownerType: VersionedOwnerType,
  ownerIds: readonly string[],
): Promise<Map<string, string | null>> {
  const source = POINTER_SOURCES[ownerType];
  const pointers = new Map<string, string | null>();
  if (!source) return pointers;
  for (const chunk of chunked(ownerIds, OWNER_CHUNK)) {
    const rows = await db
      .prepare(
        `SELECT id AS owner_id, ${source.column} AS attachment_id
         FROM ${source.table} WHERE id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<{ owner_id: string; attachment_id: string | null }>();
    for (const row of rows.results) pointers.set(row.owner_id, row.attachment_id);
  }
  return pointers;
}

async function readAttachments(
  db: D1Database,
  ownerType: VersionedOwnerType,
  ownerIds: readonly string[],
): Promise<AttachmentRow[]> {
  const rows: AttachmentRow[] = [];
  for (const chunk of chunked(ownerIds, OWNER_CHUNK)) {
    // ROW_NUMBER partitions per owner so a batched read numbers every owner's
    // versions independently, exactly as a single-owner read would.
    const result = await db
      .prepare(
        `SELECT id, owner_id, filename, content_type, size_bytes, created_at, r2_key,
                ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS version
         FROM attachments
         WHERE owner_type = ? AND status = 'ready' AND owner_id IN (${chunk.map(() => "?").join(",")})
         ORDER BY owner_id, created_at, id`,
      )
      .bind(ownerType, ...chunk)
      .all<AttachmentRow>();
    rows.push(...result.results);
  }
  return rows;
}

/**
 * Version lists for many owners of one type in a single pass.
 *
 * Every requested id appears in the result — an owner with no ready upload
 * gets an empty list rather than a missing key, so a caller rendering a row
 * per expected deliverable never has to distinguish "no uploads" from "not
 * asked about".
 */
export async function listVersionsForOwners(
  db: D1Database,
  ownerType: VersionedOwnerType,
  ownerIds: readonly string[],
  mediaPublicOrigin: string,
): Promise<Map<string, FileVersionList>> {
  const unique = [...new Set(ownerIds.filter((id) => id.length > 0))];
  const lists = new Map<string, FileVersionList>(unique.map((id) => [id, emptyList(ownerType, id)]));
  if (unique.length === 0) return lists;

  const [pointers, rows] = await Promise.all([
    readPointers(db, ownerType, unique),
    readAttachments(db, ownerType, unique),
  ]);

  const grouped = new Map<string, AttachmentRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.owner_id);
    if (bucket) bucket.push(row);
    else grouped.set(row.owner_id, [row]);
  }

  for (const [ownerId, ownerRows] of grouped) {
    const pointer = pointers.get(ownerId) ?? null;
    // The pointer decides which row is current. It is honoured even when it
    // names an older upload — that is the state the portal actually wrote, and
    // hiding it behind "newest wins" is how a version list starts lying.
    const pointerMatches = pointer !== null && ownerRows.some((row) => row.id === pointer);
    const newest = ownerRows[ownerRows.length - 1];
    const latestId = pointerMatches ? pointer : newest?.id ?? null;
    const versions = ownerRows
      .map((row) => ({
        attachment_id: row.id,
        version: row.version,
        filename: row.filename,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        uploaded_at: row.created_at,
        is_latest: row.id === latestId,
        url: publicMediaUrl(mediaPublicOrigin, { status: "ready", r2_key: row.r2_key }),
      }))
      .reverse();
    lists.set(ownerId, {
      owner_type: ownerType,
      owner_id: ownerId,
      versions,
      latest: versions.find((version) => version.is_latest) ?? null,
      version_count: versions.length,
      latest_source: pointerMatches ? "pointer" : "recency",
    });
  }

  return lists;
}

/** One owner's version list. The batch call is the implementation; this is the single-owner door. */
export async function listVersionsFor(
  db: D1Database,
  ownerType: VersionedOwnerType,
  ownerId: string,
  mediaPublicOrigin: string,
): Promise<FileVersionList> {
  const lists = await listVersionsForOwners(db, ownerType, [ownerId], mediaPublicOrigin);
  return lists.get(ownerId) ?? emptyList(ownerType, ownerId);
}

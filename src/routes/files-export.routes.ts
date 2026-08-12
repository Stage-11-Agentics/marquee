import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { listVersionsForOwners, type FileVersion } from "../lib/files/versions";
import { createZipStoreStream, type ZipStoreEntry } from "../lib/zip-store";

interface ExportEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_PUBLIC_ORIGIN?: string;
}

interface ExportTaskRow {
  id: string;
  event_id: string;
  person_id: string;
  speaker_name: string;
  submission_id: string | null;
  session_title: string | null;
  starts_at: number | null;
  room_name: string | null;
  timezone: string;
  title: string;
}

interface AttachmentObjectRow {
  id: string;
  r2_key: string;
  r2_etag: string | null;
}

const exportParams = z.object({ eventId: z.string().min(1) });
const exportRequest = z.object({
  task_ids: z.array(z.string().min(1).max(200)).min(1).max(200),
  grouping: z.enum(["session", "speaker"]).default("session"),
}).refine((value: { task_ids: string[] }) => new Set(value.task_ids).size === value.task_ids.length, {
  message: "task_ids must not contain duplicates",
  path: ["task_ids"],
});
type ExportRequest = z.infer<typeof exportRequest>;

const QUERY_CHUNK_SIZE = 80;
// STORE/CRC plus a browser Blob is intentionally capped below ZIP32's hard
// limit. This leaves a practical single-Worker/browser ceiling instead of
// starting a multi-gigabyte export that cannot finish honestly.
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

function bindings(context: { env: ApiEnv["Bindings"] }): ExportEnv {
  return context.env as unknown as ExportEnv;
}

function safeSegment(value: string | null | undefined, fallback: string): string {
  const segment = (value ?? fallback)
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 96);
  return segment || fallback;
}

function safeFilename(value: string | null | undefined): string {
  const raw = (value ?? "deliverable")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, "_");
  const dot = raw.lastIndexOf(".");
  const extension = dot > 0 ? raw.slice(dot).replace(/[^a-z0-9.]/gi, "_").slice(0, 24) : "";
  const stem = safeSegment(dot > 0 ? raw.slice(0, dot) : raw, "deliverable");
  return `${stem.slice(0, Math.max(1, 96 - extension.length))}${extension}`;
}

function sessionFolder(row: ExportTaskRow): string {
  const speaker = safeSegment(row.speaker_name, "Unknown_Speaker");
  if (row.starts_at === null) return `Unscheduled_${speaker}`;
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: row.timezone,
  }).formatToParts(new Date(row.starts_at));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("weekday")}-${value("hour")}${value("minute")}-${safeSegment(row.room_name, "Room")}_${speaker}`;
}

function archivePath(row: ExportTaskRow, grouping: "session" | "speaker", filename: string): string {
  const session = sessionFolder(row);
  const safeFile = safeFilename(filename);
  return grouping === "speaker"
    ? `${safeSegment(row.speaker_name, "Unknown_Speaker")}/${session}/${safeFile}`
    : `${session}/${safeFile}`;
}

function missingLine(row: ExportTaskRow, reason: string): string {
  return `${sessionFolder(row)} · ${row.title} — ${reason}`;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push([...values.slice(index, index + size)]);
  return result;
}

async function taskRowsFor(
  db: D1Database,
  eventId: string,
  taskIds: readonly string[],
): Promise<ExportTaskRow[]> {
  const rows: ExportTaskRow[] = [];
  for (const chunk of chunks(taskIds, QUERY_CHUNK_SIZE)) {
    const result = await db.prepare(
      `SELECT task.id, task.event_id, task.person_id, person.name AS speaker_name,
              task.submission_id, submission.title AS session_title,
              agenda.starts_at, room.name AS room_name, event.timezone,
              task.title
         FROM speaker_tasks task
         JOIN events event ON event.id = task.event_id
         JOIN people person ON person.id = task.person_id
         LEFT JOIN submissions submission
           ON submission.id = task.submission_id AND submission.event_id = task.event_id
         LEFT JOIN agenda_items agenda
           ON agenda.submission_id = task.submission_id AND agenda.event_id = task.event_id
         LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = task.event_id
        WHERE task.event_id = ? AND task.kind = 'file'
          AND task.id IN (${chunk.map(() => "?").join(",")})
        ORDER BY task.id`,
    ).bind(eventId, ...chunk).all<ExportTaskRow>();
    rows.push(...result.results);
  }
  if (rows.length !== taskIds.length) throw ApiError.notFound("one or more selected deliverables are unavailable");
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

async function attachmentObjectsFor(db: D1Database, eventId: string, attachmentIds: readonly string[]): Promise<Map<string, AttachmentObjectRow>> {
  if (attachmentIds.length === 0) return new Map();
  const rows: AttachmentObjectRow[] = [];
  for (const chunk of chunks(attachmentIds, QUERY_CHUNK_SIZE)) {
    const result = await db.prepare(
      `SELECT id, r2_key, r2_etag FROM attachments
        WHERE event_id = ? AND status = 'ready' AND id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(eventId, ...chunk).all<AttachmentObjectRow>();
    rows.push(...result.results);
  }
  return new Map(rows.map((row) => [row.id, row]));
}

function latestFor(taskId: string, versions: Map<string, { versions: FileVersion[] }>): FileVersion | null {
  // Do not use versions[0]. MRQ-115's is_latest is derived from the pointer
  // the portal writes, including the rare case where an older version is
  // deliberately current again.
  return versions.get(taskId)?.versions.find((version) => version.is_latest) ?? null;
}

async function handleExport(context: Context<ApiEnv>): Promise<Response> {
  const eventId = (context.req.valid("param" as never) as { eventId?: string }).eventId;
  if (!eventId) throw ApiError.badRequest("conference id is required");
  const request = context.req.valid("json" as never) as ExportRequest;
  const env = bindings(context);
  const taskIds = [...new Set(request.task_ids as string[])];
  const rows = await taskRowsFor(env.DB, eventId, taskIds);
  const versionLists = await listVersionsForOwners(
    env.DB,
    "task_upload",
    taskIds,
    env.MEDIA_PUBLIC_ORIGIN ?? "",
  );
  const latest = new Map<string, FileVersion | null>(rows.map((row) => [row.id, latestFor(row.id, versionLists)]));
  const attachmentIds = rows.flatMap((row) => {
    const version = latest.get(row.id);
    return version ? [version.attachment_id] : [];
  });
  const objects = await attachmentObjectsFor(env.DB, eventId, attachmentIds);
  const estimatedBytes = rows.reduce((total, row) => {
    const version = latest.get(row.id);
    return version && objects.has(version.attachment_id) ? total + version.size_bytes : total;
  }, 0);
  if (estimatedBytes > MAX_ZIP_BYTES) {
    throw ApiError.unprocessable("this selection is too large for one ZIP; export it in two passes");
  }
  const manifest: string[] = [];
  const entries = (async function* (): AsyncGenerator<ZipStoreEntry> {
    for (const row of rows) {
      const version = latest.get(row.id);
      if (!version) {
        manifest.push(missingLine(row, "no completed upload"));
        continue;
      }
      const attachment = objects.get(version.attachment_id);
      if (!attachment) {
        manifest.push(missingLine(row, "the latest upload record is unavailable"));
        continue;
      }
      let object: R2ObjectBody | null = null;
      try {
        object = await env.MEDIA.get(attachment.r2_key);
      } catch {
        object = null;
      }
      if (!object || (attachment.r2_etag !== null && object.etag !== attachment.r2_etag)) {
        manifest.push(missingLine(row, "the latest upload bytes are unavailable"));
        continue;
      }
      if (!object.body) {
        manifest.push(missingLine(row, "the latest upload has no readable body"));
        continue;
      }
      yield { path: archivePath(row, request.grouping, version.filename), body: object.body };
    }
  })();

  const timezone = rows[0]?.timezone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(new Date());
  const filename = `deliverables-${request.grouping}-${today}.zip`;
  const response = new Response(createZipStoreStream(entries, { missing: manifest }), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    },
  });
  return response;
}

const exportFiles = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/files/export",
    operationId: "exportDeliverableFiles",
    summary: "Stream a latest-only deliverables ZIP",
    description: "Streams selected current deliverables from MEDIA as a ZIP-STORE archive and includes missing deliverables in manifest.txt.",
    tags: ["Files"],
    request: {
      params: exportParams,
      body: { content: { "application/json": { schema: exportRequest } } },
    },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "import" }, concurrency: "none" },
    responses: {
      200: { content: { "application/zip": { schema: z.any() } }, description: "A streamed ZIP-STORE archive of current deliverables." },
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  handleExport as never,
);

export const apiRoutes = [exportFiles];

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import {
  manifestPreview,
  normalizeMapping,
  readImportManifest,
  runSessionizeImport,
  SessionizeImportBlockedError,
  speakerEmailMappingError,
  undoSessionizeImport,
  type ImportRunCounts,
  type SessionizeManifest,
  type SessionizeMapping,
} from "../lib/sessionize-import";

const eventParams = z.object({ eventId: z.string().min(1) });
const importParams = eventParams.extend({ importId: z.string().min(1) });
const mappingSchema = z.object({
  sessions: z.record(z.string(), z.string().nullable()),
  speakers: z.record(z.string(), z.string().nullable()),
});
const uploadSchema = z.object({
  source: z.literal("sessionize").default("sessionize"),
  sessions_csv: z.string().max(5_000_000).optional(),
  speakers_csv: z.string().min(1).max(5_000_000),
});
const previewSchema = z.object({
  headers: z.array(z.string()),
  mapped: z.record(z.string(), z.string().nullable()),
  rows: z.array(z.record(z.string(), z.string())),
  missing: z.array(z.string()),
});
const importSummarySchema = z.object({
  id: z.string(),
  event_id: z.string(),
  source: z.string(),
  file_key: z.string(),
  status: z.string(),
  undone_at: z.number().int().nullable(),
  mapping: mappingSchema,
  preview: z.object({ sessions: previewSchema, speakers: previewSchema }).optional(),
});
const countsSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  speakers: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
});
const importRowSchema = z.object({
  row_index: z.number().int().nonnegative(),
  entity: z.string(),
  outcome: z.enum(["created", "updated", "skipped", "failed"]),
  reason: z.string().nullable(),
  target_id: z.string().nullable(),
});

interface ImportEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
}

interface ImportRecord {
  id: string;
  event_id: string;
  source: string;
  file_key: string;
  mapping: string;
  status: string;
  undone_at: number | null;
}

function bindings(context: { env: ApiEnv["Bindings"] }): ImportEnv {
  return context.env as unknown as ImportEnv;
}

async function requireConference(context: { env: ApiEnv["Bindings"] }, eventId: string): Promise<void> {
  const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
  if (!event) throw ApiError.notFound("conference not found");
}

async function readImport(context: { env: ApiEnv["Bindings"] }, eventId: string, importId: string): Promise<ImportRecord> {
  const record = await context.env.DB.prepare("SELECT * FROM imports WHERE id = ? AND event_id = ?")
    .bind(importId, eventId).first<ImportRecord>();
  if (!record) throw ApiError.notFound("import not found");
  return record;
}

function parsedMapping(record: ImportRecord): SessionizeMapping {
  return JSON.parse(record.mapping) as SessionizeMapping;
}

function summary(record: ImportRecord, preview?: { sessions: ReturnType<typeof manifestPreview>["sessions"]; speakers: ReturnType<typeof manifestPreview>["speakers"] }) {
  return {
    id: record.id,
    event_id: record.event_id,
    source: record.source,
    file_key: record.file_key,
    status: record.status,
    undone_at: record.undone_at,
    mapping: parsedMapping(record),
    ...(preview ? { preview } : {}),
  };
}

const createImport = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/imports",
    operationId: "createSessionizeImport",
    summary: "Upload a Sessionize export for mapping",
    description: "Stores the sessions and speakers CSV manifest and returns a write-free mapping preview.",
    tags: ["Imports"],
    request: { params: eventParams, body: { content: { "application/json": { schema: uploadSchema } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(importSummarySchema, "Uploaded Sessionize export"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await requireConference(context, eventId);
    const body = context.req.valid("json");
    const importId = crypto.randomUUID();
    const fileKey = `imports/${eventId}/${importId}.json`;
    const manifest: SessionizeManifest = { ...(body.sessions_csv === undefined ? {} : { sessions_csv: body.sessions_csv }), speakers_csv: body.speakers_csv };
    const mapping = normalizeMapping(undefined, body.sessions_csv, body.speakers_csv);
    await bindings(context).MEDIA.put(fileKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
    const now = Date.now();
    await context.env.DB.prepare(
      `INSERT INTO imports (id, event_id, source, file_key, mapping, status, created_at, updated_at)
       VALUES (?, ?, 'sessionize', ?, ?, 'uploaded', ?, ?)`,
    ).bind(importId, eventId, fileKey, JSON.stringify(mapping), now, now).run();
    const record: ImportRecord = {
      id: importId, event_id: eventId, source: "sessionize", file_key: fileKey,
      mapping: JSON.stringify(mapping), status: "uploaded", undone_at: null,
    };
    return context.json(summary(record, manifestPreview(manifest, mapping)), 201);
  },
);

const mapImport = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/imports/{importId}/mapping",
    operationId: "mapSessionizeImport",
    summary: "Preview a Sessionize mapping",
    description: "Persists column choices and returns sample rows without writing conference data.",
    tags: ["Imports"],
    request: { params: importParams, body: { content: { "application/json": { schema: mappingSchema } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(importSummarySchema, "Mapped Sessionize preview"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, importId } = context.req.valid("param");
    const record = await readImport(context, eventId, importId);
    if (record.undone_at !== null) throw ApiError.conflict("an undone import cannot be remapped");
    const manifest = await readImportManifest(bindings(context).MEDIA, record.file_key);
    const mapping = normalizeMapping(context.req.valid("json"), manifest.sessions_csv, manifest.speakers_csv);
    const mappingError = speakerEmailMappingError(mapping, manifest.speakers_csv);
    if (mappingError) throw ApiError.unprocessable(mappingError, "speakers.email");
    await context.env.DB.prepare("UPDATE imports SET mapping = ?, status = 'mapped', updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(JSON.stringify(mapping), Date.now(), importId, eventId).run();
    const updated = await readImport(context, eventId, importId);
    return context.json(summary(updated, manifestPreview(manifest, mapping)), 200);
  },
);

const runImport = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/imports/{importId}/run",
    operationId: "runSessionizeImport",
    summary: "Run a Sessionize import",
    description: "Reconciles sessions, speakers, relationships, evaluation results, statuses, and closed custom fields idempotently.",
    tags: ["Imports"],
    request: { params: importParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(z.object({ import: importSummarySchema, counts: countsSchema, rows: z.array(importRowSchema) }), "Import outcomes"),
      ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, importId } = context.req.valid("param");
    const record = await readImport(context, eventId, importId);
    if (record.undone_at !== null) throw ApiError.conflict("an undone import cannot be run");
    const manifest = await readImportManifest(bindings(context).MEDIA, record.file_key);
    const result = await runSessionizeImport(context.env.DB, eventId, importId, manifest, parsedMapping(record));
    const updated = await readImport(context, eventId, importId);
    const rows = result.rows.map((row) => ({ row_index: row.row_index, entity: row.entity, outcome: row.outcome, reason: row.reason, target_id: row.target_id }));
    return context.json({ import: summary(updated), counts: result.counts satisfies ImportRunCounts, rows }, 200);
  },
);

const undoImport = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/imports/{importId}/undo",
    operationId: "undoSessionizeImport",
    summary: "Undo a Sessionize import",
    description: "Reverses the import's own rows from durable snapshots while retaining the manifest for audit.",
    tags: ["Imports"],
    request: { params: importParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ undone: z.number().int().nonnegative(), retained_manifest: z.literal(true) }), "Undo outcome"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, importId } = context.req.valid("param");
    await readImport(context, eventId, importId);
    try {
      return context.json(await undoSessionizeImport(context.env.DB, eventId, importId), 200);
    } catch (error) {
      if (error instanceof SessionizeImportBlockedError) {
        throw ApiError.conflict(error.message, {
          code: error.code,
          merge_id: error.mergeId,
          person_id: error.personId,
          survivor_id: error.survivorId,
          retained_manifest: true,
        });
      }
      throw error;
    }
  },
);

export const apiRoutes = [createImport, mapImport, runImport, undoImport];

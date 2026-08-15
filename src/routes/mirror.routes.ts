import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import {
  connectMirror,
  disconnectMirror,
  mapMirror,
  queueMirrorSync,
  readMirrorStatus,
  type MirrorActionEnvironment,
  type MirrorMappingInput,
} from "../jobs/mirror/actions";

const errors = errorResponses([400, 401, 403, 422, 429, 500]);

const connectInput = z.object({
  token: z.string().trim().min(1),
  base_id: z.string().trim().min(1),
}).strict();

const mappingInput = z.object({
  people: z.string().trim().min(1),
  submissions: z.string().trim().min(1),
  speaker_tasks: z.string().trim().min(1),
}).strict();

const airtableField = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
});

const airtableTable = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(airtableField),
});

const connectionResponse = z.object({
  data: z.object({
    base_id: z.string(),
    tables: z.array(airtableTable),
  }),
});

const mappingResponse = z.object({
  data: z.object({
    base_id: z.string(),
    mapped: z.boolean(),
    tables: z.array(airtableTable),
  }),
});

const statusTable = z.object({
  airtable_table_id: z.string().nullable(),
  local_row_count: z.number().int().nonnegative(),
  last_sync_at: z.number().nullable(),
  name: z.enum(["submissions", "speaker_tasks", "people"]),
  remote_row_count: z.number().int().nonnegative(),
});

const statusResponse = z.object({
  data: z.object({
    base_id: z.string().nullable(),
    base_url: z.string().nullable(),
    configured: z.boolean(),
    last_error: z.string().nullable(),
    last_sync_at: z.number().nullable(),
    last_verified_at: z.number().nullable(),
    mapped: z.boolean(),
    queued: z.number().int().nonnegative(),
    set_at: z.number().nullable(),
    stuck: z.number().int().nonnegative(),
    tables: z.array(statusTable),
    token_fingerprint: z.string().nullable(),
    traffic_assisted: z.boolean(),
    webhook_expires_at: z.number().nullable(),
  }),
});

const syncResponse = z.object({ data: z.object({ queued: z.boolean() }) });
const disconnectResponse = z.object({ data: z.object({ disconnected: z.boolean(), warning: z.string().nullable() }) });

function environment(context: Parameters<typeof requireOrgAdmin>[0]): MirrorActionEnvironment {
  return context.env as unknown as MirrorActionEnvironment;
}

function tableSummaries(tables: readonly { id: string; name: string; fields?: readonly { id: string; name: string; type?: string }[] }[]) {
  return tables.map((table) => ({
    id: table.id,
    name: table.name,
    fields: [...table.fields ?? []],
  }));
}

async function actorPersonId(
  context: Parameters<typeof requireOrgAdmin>[0],
  auth: ReturnType<typeof requireOrgAdmin>,
): Promise<string> {
  if (auth.kind === "session") return auth.personId;
  if (auth.actingPersonId) return auth.actingPersonId;
  const row = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!row?.created_by) throw ApiError.forbidden("this credential has no human owner");
  return row.created_by;
}

function throwActionFailure(result: { ok: false; field: string; message: string }): never {
  throw ApiError.unprocessable(result.message, result.field);
}

const connect = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/mirror/connect",
    operationId: "connectMirror",
    summary: "Connect an Airtable base",
    description: "Verify the token and base schema before persisting an encrypted Airtable credential.",
    tags: ["Mirror"],
    request: { body: { content: { "application/json": { schema: connectInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(connectionResponse, "Airtable connection and available tables"), ...errors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "mirror:write");
    const body = context.req.valid("json");
    const result = await connectMirror(environment(context), {
      baseId: body.base_id,
      orgId: auth.orgId,
      setByPersonId: await actorPersonId(context, auth),
      token: body.token,
    });
    if (!result.ok) throwActionFailure(result);
    return context.json({ data: { base_id: body.base_id, tables: tableSummaries(result.tables) } }, 200);
  },
);

const mapping = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/mirror/mapping",
    operationId: "mapMirrorTables",
    summary: "Map Airtable tables to Marquee records",
    description: "Verify the selected tables and register the inbound webhook; this is the mirror on-switch.",
    tags: ["Mirror"],
    request: { body: { content: { "application/json": { schema: mappingInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(mappingResponse, "Airtable mapping"), ...errors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "mirror:write");
    const body = context.req.valid("json");
    const result = await mapMirror(environment(context), {
      mapping: body as MirrorMappingInput,
      orgId: auth.orgId,
    });
    if (!result.ok) throwActionFailure(result);
    const status = await readMirrorStatus(context.env.DB, environment(context), auth.orgId);
    return context.json({
      data: {
        base_id: status.baseId!,
        mapped: status.mapped,
        tables: tableSummaries(result.tables),
      },
    }, 200);
  },
);

const status = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/mirror/status",
    operationId: "getMirrorStatus",
    summary: "Read Airtable mirror status",
    description: "Read connection, mapping, sync, queue, and webhook health without exposing provider secrets.",
    tags: ["Mirror"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(statusResponse, "Airtable mirror status"), ...errors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "program:read");
    const value = await readMirrorStatus(context.env.DB, environment(context), auth.orgId);
    return context.json({
      data: {
        base_id: value.baseId,
        base_url: value.baseUrl,
        configured: value.configured,
        last_error: value.lastError,
        last_sync_at: value.lastSyncAt,
        last_verified_at: value.lastVerifiedAt,
        mapped: value.mapped,
        queued: value.queued,
        set_at: value.setAt,
        stuck: value.stuck,
        tables: value.tables.map((table) => ({
          airtable_table_id: table.airtableTableId,
          local_row_count: table.localRowCount,
          last_sync_at: table.lastSyncAt,
          name: table.name,
          remote_row_count: table.remoteRowCount,
        })),
        token_fingerprint: value.tokenFingerprint,
        traffic_assisted: value.trafficAssisted,
        webhook_expires_at: value.webhookExpiresAt,
      },
    }, 200);
  },
);

const sync = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/mirror/sync",
    operationId: "queueMirrorSync",
    summary: "Queue an Airtable mirror sync",
    description: "Queue a reconcile run without opening a provider screen or exposing a provider secret.",
    tags: ["Mirror"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(syncResponse, "Mirror sync request"), ...errors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "mirror:write");
    const result = await queueMirrorSync(environment(context), auth.orgId);
    return context.json({ data: result }, 200);
  },
);

const disconnect = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/mirror/disconnect",
    operationId: "disconnectMirror",
    summary: "Disconnect Airtable",
    description: "Delete the provider webhook, clear the pending feed, and remove the encrypted credential.",
    tags: ["Mirror"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(disconnectResponse, "Airtable disconnected"), ...errors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "mirror:write");
    const result = await disconnectMirror(environment(context), auth.orgId);
    return context.json({ data: { disconnected: true, warning: result.warning } }, 200);
  },
);

export const apiRoutes = [connect, mapping, status, sync, disconnect];

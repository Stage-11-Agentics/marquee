import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { newUlid } from "../api/ids";
import { getAuth } from "../lib/auth/auth-middleware";
import { auditStatement } from "../lib/audit";
import { EMBED_KINDS, EMBED_OUTPUT_FORMATS, type EmbedKind } from "../db/schema";
import { defaultEmbedFields, normalizeEmbedFields, parseEmbedConfig } from "../lib/public-site";

const eventParams = z.object({ eventId: z.string().min(1) });
const embedParams = eventParams.extend({ embedId: z.string().min(1) });
const embedOutput = z.enum(EMBED_OUTPUT_FORMATS);
const embedKind = z.enum(EMBED_KINDS);
const embedLayout = z.enum(["cards", "list"]);
const embedFields = z.array(z.string().trim().min(1).max(40)).max(20);
const embedRow = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: embedKind,
  output_format: embedOutput,
  enabled: z.boolean(),
  track: z.string().nullable(),
  status: z.string().nullable(),
  layout: embedLayout.nullable(),
  accent: z.string().nullable(),
  fields: z.array(z.string()),
  snippet: z.string(),
  updated_at: z.number(),
});
const response = z.object({ data: z.array(embedRow) });
const singleResponse = z.object({ data: embedRow });
const body = z.object({
  name: z.string().trim().min(1).max(120),
  kind: embedKind,
  output_format: embedOutput,
  track: z.string().trim().max(120).nullable().optional(),
  status: z.string().trim().max(40).nullable().optional(),
  layout: embedLayout.nullable().optional(),
  accent: z.string().regex(/^#[0-9a-f]{3,8}$/i).nullable().optional(),
  fields: embedFields.optional(),
});
const patch = body.partial().extend({ enabled: z.boolean().optional() });

type SavedEmbed = {
  accent: string | null;
  config: string;
  enabled: number;
  event_id: string;
  id: string;
  kind: EmbedKind;
  name: string;
  slug: string;
  updated_at: number;
};

function eventIdFromAuth(context: Parameters<typeof getAuth>[0]): void {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
}

function actorPersonId(context: Parameters<typeof getAuth>[0]): string | null {
  const auth = getAuth(context);
  return auth?.kind === "session" ? auth.personId : null;
}

function actorKind(context: Parameters<typeof getAuth>[0]): "user" | "api_token" {
  return getAuth(context)?.kind === "token" ? "api_token" : "user";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function savedEmbedSnippet(row: SavedEmbed, origin: string): string {
  const config = parseEmbedConfig(row.config, row.kind);
  const params = new URLSearchParams();
  if (config.tracks[0]) params.set("track", config.tracks[0]);
  if (config.statuses[0]) params.set("status", config.statuses[0]);
  if (config.layout === "list") params.set("layout", "list");
  if (config.accent) params.set("accent", config.accent);
  if (config.fields.length > 0) params.set("fields", config.fields.join(","));
  const path = config.output === "json"
    ? `/api/v1/public/embeds/${encodeURIComponent(row.slug)}`
    : config.output === "xml"
      ? `/api/v1/public/embeds/${encodeURIComponent(row.slug)}/xml`
    : config.output === "ical"
      ? `/embed/${encodeURIComponent(row.slug)}.ics`
      : `/embed/${encodeURIComponent(row.slug)}`;
  if (config.output === "basic") params.set("style", "basic");
  const finalQuery = params.toString();
  const source = `${origin.replace(/\/+$/, "")}${path}${finalQuery ? `?${finalQuery}` : ""}`;
  if (config.output === "json" || config.output === "xml" || config.output === "basic") return source;
  if (config.output === "ical") return `<a href="${source}">Add ${escapeHtml(row.name)} to calendar</a>`;
  return `<iframe src="${source}" title="${escapeHtml(row.name)}" loading="lazy" style="width:100%;border:0"></iframe>`;
}

function rowView(row: SavedEmbed, origin: string) {
  const config = parseEmbedConfig(row.config, row.kind);
  return {
    data: {
      id: row.id,
      event_id: row.event_id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      output_format: config.output,
      enabled: row.enabled === 1,
      track: config.tracks[0] ?? null,
      status: config.statuses[0] ?? null,
      layout: config.layout,
      accent: config.accent,
      fields: config.fields,
      snippet: savedEmbedSnippet(row, origin),
      updated_at: row.updated_at,
    },
  };
}

async function embedFor(db: D1Database, eventId: string, embedId: string): Promise<SavedEmbed> {
  const row = await db.prepare(
    "SELECT id, event_id, name, slug, kind, config, enabled, updated_at FROM embeds WHERE id = ? AND event_id = ?",
  ).bind(embedId, eventId).first<SavedEmbed>();
  if (!row) throw ApiError.notFound("saved embed not found");
  return row;
}

async function eventExists(db: D1Database, eventId: string): Promise<void> {
  const row = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
  if (!row) throw ApiError.notFound("conference not found");
}

const listEmbeds = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/embeds",
    operationId: "listSavedEmbeds",
    summary: "List saved public embeds",
    tags: ["Embeds"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(response, "Saved public embeds"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    eventIdFromAuth(context);
    await eventExists(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      "SELECT id, event_id, name, slug, kind, config, enabled, updated_at FROM embeds WHERE event_id = ? ORDER BY created_at DESC, id DESC",
    ).bind(eventId).all<SavedEmbed>();
    return context.json({ data: rows.results.map((row) => rowView(row, new URL(context.req.url).origin).data) }, 200);
  },
);

const createEmbed = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/embeds",
    operationId: "createSavedEmbed",
    summary: "Save a public embed",
    tags: ["Embeds"],
    request: { params: eventParams, body: { content: { "application/json": { schema: body } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(singleResponse, "Saved public embed"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    eventIdFromAuth(context);
    await eventExists(context.env.DB, eventId);
    const input = context.req.valid("json");
    const now = Date.now();
    const id = newUlid(now);
    const slug = `embed-${id.toLowerCase()}`;
    const fields = input.fields === undefined ? defaultEmbedFields(input.kind) : normalizeEmbedFields(input.fields, input.kind);
    const config = JSON.stringify({ tracks: input.track ? [input.track] : [], statuses: input.status ? [input.status] : [], accent: input.accent ?? null, layout: input.layout ?? null, output: input.output_format, fields });
    const row: SavedEmbed = { id, event_id: eventId, name: input.name, slug, kind: input.kind, config, enabled: 1, updated_at: now, accent: input.accent ?? null };
    await context.env.DB.batch([
      context.env.DB.prepare("INSERT INTO embeds (id, event_id, kind, slug, config, created_at, updated_at, name, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)").bind(id, eventId, input.kind, slug, config, now, now, input.name),
      auditStatement(context.env.DB, { eventId, actorKind: actorKind(context), actorPersonId: actorPersonId(context), action: "embed.created", entityType: "embed", entityId: id, after: { name: input.name, slug, kind: input.kind, config }, now, requestId: context.get("requestId") ?? null }),
    ]);
    return context.json(rowView(row, new URL(context.req.url).origin), 201);
  },
);

const updateEmbed = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/embeds/{embedId}",
    operationId: "updateSavedEmbed",
    summary: "Update or enable a saved public embed",
    tags: ["Embeds"],
    request: { params: embedParams, body: { content: { "application/json": { schema: patch } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(singleResponse, "Updated public embed"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, embedId } = context.req.valid("param");
    eventIdFromAuth(context);
    const current = await embedFor(context.env.DB, eventId, embedId);
    const input = context.req.valid("json");
    const currentConfig = parseEmbedConfig(current.config, current.kind);
    const kind = input.kind ?? current.kind;
    const output = input.output_format ?? currentConfig.output;
    const fields = input.fields === undefined
      ? kind === current.kind ? currentConfig.fields : defaultEmbedFields(kind)
      : normalizeEmbedFields(input.fields, kind);
    const config = JSON.stringify({ tracks: input.track === undefined ? currentConfig.tracks : input.track ? [input.track] : [], statuses: input.status === undefined ? currentConfig.statuses : input.status ? [input.status] : [], accent: input.accent === undefined ? currentConfig.accent : input.accent, layout: input.layout === undefined ? currentConfig.layout : input.layout, output, fields });
    const now = Date.now();
    const updated: SavedEmbed = { ...current, name: input.name ?? current.name, kind, config, enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0, updated_at: now };
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE embeds SET name = ?, kind = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ? AND event_id = ?").bind(updated.name, updated.kind, updated.config, updated.enabled, now, embedId, eventId),
      auditStatement(context.env.DB, { eventId, actorKind: actorKind(context), actorPersonId: actorPersonId(context), action: "embed.updated", entityType: "embed", entityId: embedId, before: { name: current.name, kind: current.kind, config: current.config, enabled: current.enabled }, after: { name: updated.name, kind: updated.kind, config: updated.config, enabled: updated.enabled }, now, requestId: context.get("requestId") ?? null }),
    ]);
    return context.json(rowView(updated, new URL(context.req.url).origin), 200);
  },
);

const deleteEmbed = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/embeds/{embedId}",
    operationId: "deleteSavedEmbed",
    summary: "Delete a saved public embed",
    tags: ["Embeds"],
    request: { params: embedParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 204: { description: "Saved embed deleted" }, ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, embedId } = context.req.valid("param");
    eventIdFromAuth(context);
    const current = await embedFor(context.env.DB, eventId, embedId);
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM embeds WHERE id = ? AND event_id = ?").bind(embedId, eventId),
      auditStatement(context.env.DB, { eventId, actorKind: actorKind(context), actorPersonId: actorPersonId(context), action: "embed.deleted", entityType: "embed", entityId: embedId, before: { name: current.name, slug: current.slug, kind: current.kind, config: current.config, enabled: current.enabled }, now, requestId: context.get("requestId") ?? null }),
    ]);
    return new Response(null, { status: 204 });
  },
);

export const apiRoutes = [listEmbeds, createEmbed, updateEmbed, deleteEmbed];

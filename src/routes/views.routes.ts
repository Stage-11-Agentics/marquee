import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  BUILT_IN_SAVED_VIEWS,
  builtInSavedView,
  normalizeSavedViewConfig,
  type SavedViewConfig,
} from "../lib/saved-views";
import { SUBMISSION_COLUMN_IDS } from "../lib/submission-columns";
import { requireSubmissionRead } from "../lib/auth/program-access";
import { getAuth } from "../lib/auth/auth-middleware";
import { listSubmissions, submissionFilterSchema } from "./submissions.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const viewParams = eventParams.extend({ viewId: z.string().min(1) });
// Saved views deliberately reuse the submissions list vocabulary; only q is
// lifted to the config root so the wire shape mirrors the list query.
const viewFiltersSchema = submissionFilterSchema.omit({ q: true });
const viewConfigSchema = z.object({
  q: z.string().trim().max(200).default(""),
  filters: viewFiltersSchema.default({}),
  sort: z.enum(["newest", "updated", "title", "score", "score_asc", "agent_score"]).default("newest"),
  columns: z.array(z.enum(SUBMISSION_COLUMN_IDS)).min(1).max(SUBMISSION_COLUMN_IDS.length),
});
const viewInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: viewConfigSchema.optional(),
  q: z.string().trim().max(200).optional(),
  filters: viewFiltersSchema.optional(),
  sort: z.enum(["newest", "updated", "title", "score", "score_asc", "agent_score"]).optional(),
  columns: z.array(z.enum(SUBMISSION_COLUMN_IDS)).min(1).max(SUBMISSION_COLUMN_IDS.length).optional(),
});

const viewConfigResponse = viewConfigSchema.extend({
  columns: z.array(z.enum(SUBMISSION_COLUMN_IDS)),
});
const viewResponse = z.object({
  id: z.string(),
  name: z.string(),
  built_in: z.boolean(),
  config: viewConfigResponse,
  count: z.number().int().nonnegative().nullable()
    .describe("Records matching this view's own config; null when the view is not counted."),
  created_at: z.number().int().nullable(),
  updated_at: z.number().int().nullable(),
}).openapi("SavedView");
const viewListResponse = z.object({ data: z.array(viewResponse) }).openapi("SavedViewList");

interface SavedViewRow {
  id: string;
  event_id: string;
  person_id: string;
  name: string;
  config_json: string;
  created_at: number;
  updated_at: number;
}

function parseConfig(value: string): SavedViewConfig {
  try {
    const parsed = JSON.parse(value) as Partial<SavedViewConfig>;
    return normalizeSavedViewConfig(parsed);
  } catch {
    return normalizeSavedViewConfig({});
  }
}

function rowResponse(row: SavedViewRow) {
  return {
    id: row.id,
    name: row.name,
    built_in: false,
    config: parseConfig(row.config_json),
    count: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * A view's badge has to count that view, not whatever list happens to be on
 * screen — so the count is resolved from the view's own config through the
 * same query the list uses, and the two can never disagree. Only the
 * narrowing built-ins are counted: "All submissions" is the unfiltered total
 * the page header already states, and personal views are unbounded in number.
 */
function countsRecords(config: SavedViewConfig): boolean {
  return Boolean(config.q) || Object.values(config.filters).some(Boolean);
}

async function builtInViewCount(
  db: D1Database,
  eventId: string,
  config: SavedViewConfig,
): Promise<number | null> {
  if (!countsRecords(config)) return null;
  try {
    const envelope = await listSubmissions(db, {
      eventId,
      ...config.filters,
      ...(config.q ? { q: config.q } : {}),
      page: 1,
      per_page: 1,
    });
    return envelope.total;
  } catch {
    // A badge is an aid, not the page. If its count cannot be read, the strip
    // still renders and the view still opens — it just shows no number.
    return null;
  }
}

function inputConfig(body: z.infer<typeof viewInputSchema>, current?: SavedViewConfig): SavedViewConfig {
  const source = body.config ?? {
    q: body.q ?? current?.q ?? "",
    filters: body.filters ?? current?.filters ?? {},
    sort: body.sort ?? current?.sort ?? "newest",
    columns: body.columns ?? current?.columns ?? undefined,
  };
  return normalizeSavedViewConfig(source);
}

async function ownedView(db: D1Database, eventId: string, viewId: string, personId: string): Promise<SavedViewRow> {
  const row = await db
    .prepare("SELECT * FROM saved_views WHERE id = ? AND event_id = ? AND person_id = ?")
    .bind(viewId, eventId, personId)
    .first<SavedViewRow>();
  if (!row) throw new Error("not_found");
  return row;
}

const listViews = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/views",
    operationId: "listSavedViews",
    summary: "List conference submission views",
    description: "Immutable built-ins plus the current operator's personal event-scoped views.",
    tags: ["Views"],
    request: { params: eventParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(viewListResponse, "Saved views"), ...errorResponses([401, 403, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const auth = await requireSubmissionRead(context, eventId);
    const [personal, builtInCounts] = await Promise.all([
      auth.kind === "session"
        ? context.env.DB.prepare("SELECT * FROM saved_views WHERE event_id = ? AND person_id = ? ORDER BY name COLLATE NOCASE, id ASC").bind(eventId, auth.personId).all<SavedViewRow>()
        : Promise.resolve({ results: [] as SavedViewRow[] }),
      Promise.all(BUILT_IN_SAVED_VIEWS.map((view) => builtInViewCount(context.env.DB, eventId, view.config))),
    ]);
    return context.json({
      data: [
        ...BUILT_IN_SAVED_VIEWS.map((view, index) => ({ ...view, count: builtInCounts[index] ?? null })),
        ...personal.results.map(rowResponse),
      ],
    }, 200);
  },
);

const createView = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/views",
    operationId: "createSavedView",
    summary: "Create a personal conference submission view",
    tags: ["Views"],
    request: { params: eventParams, body: { content: { "application/json": { schema: viewInputSchema.required({ name: true }) } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(viewResponse, "Created saved view"), ...errorResponses([400, 401, 403, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const auth = await requireSubmissionRead(context, eventId);
    if (auth.kind !== "session") throw ApiError.forbidden("personal saved views require a session credential");
    const body = context.req.valid("json");
    const now = Date.now();
    const id = newUlid();
    const config = inputConfig(body);
    const duplicate = await context.env.DB.prepare("SELECT id FROM saved_views WHERE event_id = ? AND person_id = ? AND name = ?")
      .bind(eventId, auth.personId, body.name)
      .first<{ id: string }>();
    if (duplicate) throw ApiError.conflict("a personal view with that name already exists in this conference");
    try {
      await context.env.DB.prepare(
        "INSERT INTO saved_views (id, event_id, person_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, eventId, auth.personId, body.name, JSON.stringify(config), now, now).run();
    } catch {
      throw ApiError.conflict("a personal view with that name already exists in this conference");
    }
    const row = await context.env.DB.prepare("SELECT * FROM saved_views WHERE id = ?").bind(id).first<SavedViewRow>();
    if (!row) throw new Error("created_view_disappeared");
    return context.json(rowResponse(row), 201);
  },
);

const updateView = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/views/{viewId}",
    operationId: "updateSavedView",
    summary: "Update a personal conference submission view",
    tags: ["Views"],
    request: { params: viewParams, body: { content: { "application/json": { schema: viewInputSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(viewResponse, "Updated saved view"), ...errorResponses([400, 401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, viewId } = context.req.valid("param");
    const auth = await requireSubmissionRead(context, eventId);
    if (builtInSavedView(viewId)) throw ApiError.conflict("built-in views are immutable");
    if (auth.kind !== "session") throw ApiError.forbidden("personal saved views require a session credential");
    const current = await ownedView(context.env.DB, eventId, viewId, auth.personId).catch((error: unknown) => {
      if (error instanceof Error && error.message === "not_found") throw ApiError.notFound("saved view not found");
      throw error;
    });
    const body = context.req.valid("json");
    const name = body.name ?? current.name;
    const config = inputConfig(body, parseConfig(current.config_json));
    const updatedAt = Math.max(Date.now(), current.updated_at + 1);
    const duplicate = await context.env.DB.prepare("SELECT id FROM saved_views WHERE event_id = ? AND person_id = ? AND name = ? AND id <> ?")
      .bind(eventId, auth.personId, name, viewId)
      .first<{ id: string }>();
    if (duplicate) throw ApiError.conflict("a personal view with that name already exists in this conference");
    try {
      await context.env.DB.prepare("UPDATE saved_views SET name = ?, config_json = ?, updated_at = ? WHERE id = ? AND event_id = ? AND person_id = ?")
        .bind(name, JSON.stringify(config), updatedAt, viewId, eventId, auth.personId).run();
    } catch {
      throw ApiError.conflict("a personal view with that name already exists in this conference");
    }
    return context.json({ ...rowResponse(current), name, config, updated_at: updatedAt }, 200);
  },
);

const deleteView = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/views/{viewId}",
    operationId: "deleteSavedView",
    summary: "Delete a personal conference submission view",
    tags: ["Views"],
    request: { params: viewParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Deleted saved view"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, viewId } = context.req.valid("param");
    const auth = await requireSubmissionRead(context, eventId);
    if (builtInSavedView(viewId)) throw ApiError.conflict("built-in views are immutable");
    if (auth.kind !== "session") throw ApiError.forbidden("personal saved views require a session credential");
    const current = await ownedView(context.env.DB, eventId, viewId, auth.personId).catch((error: unknown) => {
      if (error instanceof Error && error.message === "not_found") throw ApiError.notFound("saved view not found");
      throw error;
    });
    await context.env.DB.prepare("DELETE FROM saved_views WHERE id = ? AND event_id = ? AND person_id = ?").bind(current.id, eventId, auth.personId).run();
    return context.json({ deleted: true }, 200);
  },
);

export const apiRoutes = [listViews, createView, updateView, deleteView];

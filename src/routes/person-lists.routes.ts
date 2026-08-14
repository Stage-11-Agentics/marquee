/**
 * Lists — a named group of people an organizer addresses more than once.
 *
 * Two kinds, and the difference is the whole feature:
 *
 *   - **Live** — a saved filter. Anyone who newly matches joins it, so
 *     "returning keynoters" stays true next year without anyone maintaining it.
 *     Its members are resolved by re-running the saved filter through the one
 *     people query.
 *   - **Fixed** — exactly the people who were put in it, held in
 *     `person_list_members`.
 *
 * A List is reusable as an email audience and as a pipeline source. Opening one
 * for navigation returns its metadata; member rows stay on the people endpoint.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAccess } from "../lib/auth/org-access";
import {
  buildPeopleQuery,
  configFilters,
  LIVE_LIST_COUNT_SQL,
  listConfigSchema,
  parseListConfig,
  type PersonListConfig,
} from "./people.queries";

const listParams = z.object({ listId: z.string().min(1) });

const listSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["live", "fixed"]),
  config: listConfigSchema,
  member_count: z.number().int().nonnegative(),
  created_by_name: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
}).openapi("PersonList");

const openListSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["live", "fixed"]),
  member_count: z.number().int().nonnegative(),
  created_by_name: z.string().nullable(),
  created_at: z.number().int(),
}).openapi("PersonListDetail");

interface PersonListRecord {
  id: string;
  name: string;
  kind: "live" | "fixed";
  config_json: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  member_count: number;
}

function recordResponse(row: PersonListRecord) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config: parseListConfig(row.config_json),
    member_count: Number(row.member_count ?? 0),
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function openRecordResponse(row: PersonListRecord) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    member_count: Number(row.member_count ?? 0),
    created_by_name: row.created_by_name,
    created_at: row.created_at,
  };
}

const FIXED_LIST_COUNT_SQL = `(SELECT COUNT(*) FROM person_list_members member
         JOIN people member_person ON member_person.id = member.person_id
         WHERE member.list_id = saved.id AND member_person.org_id = saved.org_id)`;

const LIST_SELECT = `SELECT saved.id, saved.name, saved.kind, saved.config_json, saved.created_by,
         author.name AS created_by_name, saved.created_at, saved.updated_at,
         ${FIXED_LIST_COUNT_SQL} AS member_count
  FROM person_lists saved
  LEFT JOIN people author ON author.id = saved.created_by`;

const OPEN_LIST_SELECT = `SELECT saved.id, saved.name, saved.kind, saved.config_json, saved.created_by,
         author.name AS created_by_name, saved.created_at, saved.updated_at,
         CASE WHEN saved.kind = 'live' THEN ${LIVE_LIST_COUNT_SQL}
           ELSE ${FIXED_LIST_COUNT_SQL}
         END AS member_count
  FROM person_lists saved
  LEFT JOIN people author ON author.id = saved.created_by`;

/**
 * A Live list's count has to be the count of its own filter, not of whatever
 * list happened to be on screen when it was saved — so it is resolved through
 * the same query the People page runs.
 */
async function liveCount(db: D1Database, orgId: string, config: PersonListConfig): Promise<number> {
  const built = buildPeopleQuery({ orgId, ...configFilters(config) });
  const row = await db.prepare(built.countSql).bind(...built.countBindings).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

const listLists = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/lists",
    operationId: "listPersonLists",
    summary: "List the organization's saved people Lists",
    tags: ["People"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(listSummary) }), "Lists"), ...errorResponses([401, 403, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const rows = await context.env.DB
      .prepare(`${LIST_SELECT} WHERE saved.org_id = ? ORDER BY saved.created_at DESC, saved.id DESC`)
      .bind(access.orgId)
      .all<PersonListRecord>();
    const data = await Promise.all(rows.results.map(async (row) => {
      const response = recordResponse(row);
      return row.kind === "live"
        ? { ...response, member_count: await liveCount(context.env.DB, access.orgId, response.config) }
        : response;
    }));
    return context.json({ data }, 200);
  },
);

const createList = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/lists",
    operationId: "createPersonList",
    summary: "Save a filter, or a selection, as a List",
    description:
      "Live saves the filter and picks up anyone who newly matches; Fixed saves exactly the people named in person_ids.",
    tags: ["People"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().trim().min(1).max(120),
              kind: z.enum(["live", "fixed"]),
              config: listConfigSchema.optional(),
              person_ids: z.array(z.string().min(1)).max(1000).optional(),
            }),
          },
        },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(z.object({ list: listSummary }), "List"), ...errorResponses([400, 401, 403, 409, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const config = listConfigSchema.parse(body.config ?? {});
    if (body.kind === "fixed" && (body.person_ids ?? []).length === 0) {
      throw ApiError.badRequest("a fixed list needs the people it holds", "person_ids");
    }
    const now = Date.now();
    const id = newUlid(now);
    const duplicate = await context.env.DB
      .prepare("SELECT id FROM person_lists WHERE org_id = ? AND name = ?")
      .bind(access.orgId, body.name)
      .first<{ id: string }>();
    if (duplicate) throw ApiError.conflict("a list with that name already exists");
    await context.env.DB.prepare(
      `INSERT INTO person_lists (id, org_id, name, kind, config_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, access.orgId, body.name, body.kind, JSON.stringify(config), access.personId, now, now).run();
    if (body.kind === "fixed") {
      // Members are filtered through the org so a stray id from another
      // organization cannot be smuggled into a list by naming it.
      // One binding for the whole membership, not one per person: a thousand-row
      // list would otherwise expand past D1's binding cap.
      const owned = await context.env.DB
        .prepare("SELECT id FROM people WHERE org_id = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))")
        .bind(access.orgId, JSON.stringify([...new Set(body.person_ids ?? [])]))
        .all<{ id: string }>();
      if (owned.results.length > 0) {
        await context.env.DB.batch(owned.results.map((row) =>
          context.env.DB
            .prepare("INSERT OR IGNORE INTO person_list_members (list_id, person_id, created_at) VALUES (?, ?, ?)")
            .bind(id, row.id, now)));
      }
    }
    const row = await context.env.DB.prepare(`${LIST_SELECT} WHERE saved.id = ?`).bind(id).first<PersonListRecord>();
    if (!row) throw new Error("created_list_disappeared");
    const response = recordResponse(row);
    return context.json({
      list: body.kind === "live"
        ? { ...response, member_count: await liveCount(context.env.DB, access.orgId, config) }
        : response,
    }, 201);
  },
);

const openList = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/lists/{listId}",
    operationId: "getPersonList",
    summary: "Read one saved people List",
    description: "Returns the List's metadata without loading its member rows.",
    tags: ["People"],
    request: { params: listParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(z.object({ list: openListSummary }), "List metadata"),
      ...errorResponses([401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const { listId } = context.req.valid("param");
    const row = await context.env.DB
      .prepare(`${OPEN_LIST_SELECT} WHERE saved.id = ? AND saved.org_id = ?`)
      .bind(listId, access.orgId)
      .first<PersonListRecord>();
    if (!row) throw ApiError.notFound("list not found");
    return context.json({ list: openRecordResponse(row) }, 200);
  },
);

const deleteList = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/org/lists/{listId}",
    operationId: "deletePersonList",
    summary: "Delete a List",
    description: "Deletes the list, never the people in it.",
    tags: ["People"],
    request: { params: listParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ deleted: z.boolean() }), "Deleted"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { listId } = context.req.valid("param");
    const row = await context.env.DB
      .prepare("SELECT id FROM person_lists WHERE id = ? AND org_id = ?")
      .bind(listId, access.orgId)
      .first<{ id: string }>();
    if (!row) throw ApiError.notFound("list not found");
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM person_list_members WHERE list_id = ?").bind(listId),
      context.env.DB.prepare("DELETE FROM person_lists WHERE id = ? AND org_id = ?").bind(listId, access.orgId),
    ]);
    return context.json({ deleted: true }, 200);
  },
);

export const apiRoutes = [listLists, createList, openList, deleteList];

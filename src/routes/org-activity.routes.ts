import { z } from "@hono/zod-openapi";

import { LIST_DEFAULTS } from "../api/list";
import { parseKeysetPagination, totalPages } from "../api/pagination";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { orgActivityPage } from "../lib/org-activity";

/**
 * Lens one: the organization's own log.
 *
 * There is one `audit_log` and three lenses over it. This one answers "who
 * changed how this instance is run" — invites, organizer access, tokens,
 * defaults, ownership — and it reads by scope rather than by a list of action
 * names, so an action a later ticket adds appears here the day it ships.
 *
 * Read authority is `program:read` at organization level: the design ruling is
 * that organization settings are the Owner's and org-wide Organizers' surface,
 * and the log is one of its tabs.
 */

const activityQuery = z.object({
  // Pasted and hand-edited like every list URL here, so navigation degrades to
  // the default rather than 400-ing the log away.
  page: z.coerce.number().int().min(1).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1 }),
  per_page: z.coerce.number().int().min(1).max(LIST_DEFAULTS.maxPerPage).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1, maximum: LIST_DEFAULTS.maxPerPage }),
  cursor: z.string().min(1).optional().catch(undefined)
    .openapi({ type: "string" }),
});

export const activityEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  /** The fact in the organizer's language, composed server-side for every reader. */
  summary: z.string(),
  detail: z.string().nullable(),
  actor_kind: z.string().nullable(),
  actor_person_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  entity_type: z.string(),
  entity_id: z.string(),
  event_id: z.string().nullable(),
  event_name: z.string().nullable(),
  created_at: z.number().int(),
}).openapi("ActivityEvent");

const activityListResponse = z.object({
  data: z.array(activityEventSchema),
  page: z.number().int(),
  per_page: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
}).openapi("ActivityEventList");

const listOrgActivity = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/activity",
    operationId: "listOrgActivity",
    summary: "The organization's activity log",
    description:
      "Every administrative action on this instance, newest first: invites minted, claimed and revoked, organizer access ended, API tokens issued and revoked, organization defaults, ownership transfers. One append-only log read three ways — this lens, the person record's feed, and the submission record's timeline.",
    tags: ["Organizers"],
    request: { query: activityQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(activityListResponse, "Organization activity"),
      ...errorResponses([400, 401, 403, 429, 500]),
    },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "program:read");
    const query = context.req.valid("query");
    const page = parseKeysetPagination(query);
    const { rows, total, nextCursor, hasMore } = await orgActivityPage(context.env.DB, auth.orgId, page);
    return context.json(
      {
        data: rows,
        page: page.page,
        per_page: page.perPage,
        total,
        total_pages: totalPages(total, page.perPage),
        next_cursor: nextCursor,
        has_more: hasMore,
      },
      200,
    );
  },
);

export const apiRoutes = [listOrgActivity];

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { EventRow } from "../db/schema";
import type { Env } from "../index";
import { deletionActorForAuth, deleteEventCascade } from "../lib/events/delete-event";
import { getAuth } from "../lib/auth/auth-middleware";

const eventParams = z.object({ eventId: z.string().min(1) });
const deletedEventResponse = z.object({
  ok: z.literal(true),
  event_id: z.string(),
  next_event_id: z.string().nullable(),
  removed_objects: z.number().int().nonnegative(),
});

const deleteEvent = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}",
    operationId: "deleteEvent",
    summary: "Permanently delete a conference",
    description:
      "Organizer-only, irreversible deletion of one conference and every row scoped to it. Organization-level people, notes, tags, and headshot subjects survive.",
    tags: ["Event settings"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(deletedEventResponse, "The conference was deleted."),
      ...errorResponses([401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const auth = getAuth(context);
    if (!auth) throw ApiError.unauthenticated();
    const event = await context.env.DB
      .prepare("SELECT * FROM events WHERE id = ? AND org_id = ?")
      .bind(eventId, auth.orgId)
      .first<EventRow>();
    if (!event) throw ApiError.notFound("conference not found");

    const next = await context.env.DB
      .prepare(
        `SELECT id FROM events
         WHERE org_id = ? AND id <> ?
         ORDER BY starts_on DESC, id DESC
         LIMIT 1`,
      )
      .bind(auth.orgId, eventId)
      .first<{ id: string }>();
    const actor = await deletionActorForAuth(
      context.env.DB,
      auth,
      context.get("requestId") ?? null,
    );
    const environment = context.env as unknown as Env;
    const result = await deleteEventCascade(
      context.env.DB,
      [event],
      actor,
      { preserveOrgAttachments: true },
      environment.MEDIA,
    );
    context.header("Cache-Control", "no-store");
    return context.json({
      ok: true as const,
      event_id: eventId,
      next_event_id: next?.id ?? null,
      removed_objects: result.removedObjects,
    }, 200);
  },
);

export const apiRoutes = [deleteEvent];

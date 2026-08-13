import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { FILE_STATES, listFiles } from "./files.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const filesQuery = z.object({
  state: z.enum(FILE_STATES).default("all"),
  task_type: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

/**
 * The media origin is a Worker binding rather than an API binding, exactly as
 * `uploads.routes.ts` treats it. Reading it through a narrow local view keeps
 * `ApiBindings` the shared contract it is.
 */
function mediaOrigin(context: Context<ApiEnv>): string {
  return (context.env as unknown as { MEDIA_PUBLIC_ORIGIN?: string }).MEDIA_PUBLIC_ORIGIN ?? "";
}

function mediaSigningSecret(context: Context<ApiEnv>): string {
  return (context.env as unknown as { UPLOAD_TOKEN_SECRET: string }).UPLOAD_TOKEN_SECRET;
}

const listFilesRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/files",
    operationId: "listConferenceFiles",
    summary: "Read the conference files library",
    description:
      "One row per requested deliverable — filled or empty — with the speaker, session, upload date, size, and full version history of each file. Version numbers and the current version are derived from the deliverable's latest-pointer, never stored. Every returned file URL is a short-lived signed capability on the separate media origin; it expires 24 hours after it is issued and is invalidated immediately when its attachment or owning participation is revoked.",
    tags: ["Files"],
    request: { params: eventParams, query: filesQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Files library snapshot"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
    if (!event) throw ApiError.notFound("conference not found");
    const snapshot = await listFiles(context.env.DB, eventId, mediaOrigin(context), mediaSigningSecret(context), {
      state: query.state,
      taskType: query.task_type,
      search: query.q,
    });
    return context.json({ data: snapshot }, 200);
  },
);

export const apiRoutes = [listFilesRoute];

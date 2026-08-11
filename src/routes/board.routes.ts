import { z } from "@hono/zod-openapi";

import { listBoard, BOARD_SORTS } from "../api/board";
import { createListQuerySchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";

const eventParams = z.object({ eventId: z.string().min(1) });
const boardQuery = createListQuerySchema(
  {
    kind: z.enum(["abstract", "session"]).optional(),
    track: z.string().min(1).max(100).optional(),
    format: z.string().min(1).max(100).optional(),
    wave: z.string().min(1).max(100).optional(),
  },
  Object.keys(BOARD_SORTS) as [keyof typeof BOARD_SORTS, ...(keyof typeof BOARD_SORTS)[]],
  { defaultSort: "newest" },
);

const listProgramBoard = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/board",
    operationId: "listProgramBoard",
    summary: "Read the program board projection",
    description: "A virtualizer-friendly, read-only projection of every non-draft submission across the seven program stages.",
    tags: ["Program board"],
    request: { params: eventParams, query: boardQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Program board page"), ...errorResponses([400, 401, 403, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    return context.json(await listBoard(context.env.DB, { eventId, ...query }), 200);
  },
);

export const apiRoutes = [listProgramBoard];

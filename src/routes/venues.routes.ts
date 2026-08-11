import { z } from "@hono/zod-openapi";

import { errorResponses, defineApiRoute } from "../api/route";
import { ApiError } from "../api/errors";
import { readVenueModel, writeVenueModel, type VenueModel } from "../lib/venues";

const eventParams = z.object({ eventId: z.string().min(1) });
const buildingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  address: z.string(),
  position: z.number().int().nonnegative(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  access_minutes: z.number().int().nonnegative(),
  access_note: z.string().nullable(),
});
const roomSchema = z.object({
  id: z.string().min(1),
  building_id: z.string().min(1),
  name: z.string(),
  capacity: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  av_capabilities: z.array(z.string()),
  notes: z.string().nullable(),
});
const venueResponse = z.object({ buildings: z.array(buildingSchema), rooms: z.array(roomSchema) });
const venueBody = venueResponse;

const listVenues = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/venues",
    operationId: "listVenues",
    summary: "List event buildings and rooms",
    tags: ["Venues"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: venueResponse } }, description: "Venue model" }, ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) throw ApiError.notFound("event not found");
    return context.json(await readVenueModel(context.env.DB, eventId), 200);
  },
);

const saveVenues = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/venues",
    operationId: "saveVenues",
    summary: "Replace an event's buildings and rooms atomically",
    tags: ["Venues"],
    request: { params: eventParams, body: { content: { "application/json": { schema: venueBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: venueResponse } }, description: "Saved venue model" }, ...errorResponses([400, 401, 403, 404, 409, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) throw ApiError.notFound("event not found");
    try {
      return context.json(await writeVenueModel(context.env.DB, eventId, context.req.valid("json") as VenueModel), 200);
    } catch (error) {
      throw ApiError.badRequest(error instanceof Error ? error.message : "invalid venue model");
    }
  },
);

export const apiRoutes = [listVenues, saveVenues];

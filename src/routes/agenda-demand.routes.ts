/**
 * The demand board: what the organizer gets back for having let attendees
 * star things.
 *
 * It reads as a room-planning instrument rather than a popularity chart, and
 * every choice here serves that. Exact counts, including the small ones —
 * "nobody has starred this yet" is a real thing to know when a room is being
 * assigned. Ranked, because the top of the list is where the decisions are.
 * And measured against room capacity, because the question an organizer
 * actually has is not "which session is most popular" but "which room is
 * going to overflow".
 *
 * It is a panel of the Agenda module (round-4 ruling): demand is agenda-shaped
 * data — sessions against rooms — and it belongs beside the board that assigns
 * them, not in an analytics screen nobody opens.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  demandStats,
  normalizeThreshold,
  publicStarCountSetting,
  sessionDemandCounts,
  writePublicStarCountSetting,
} from "../lib/star-beacons";

const eventParams = z.object({ eventId: z.string().min(1) });

const demandRow = z.object({
  session_id: z.string(),
  title: z.string(),
  starts_at: z.number().nullable(),
  duration_min: z.number().int().nonnegative().nullable(),
  room: z.string().nullable(),
  /** Null where the room carries no capacity: the count still shows, the ratio does not. */
  capacity: z.number().int().nonnegative().nullable(),
  count: z.number().int().nonnegative(),
});

const demandResponse = z.object({
  data: z.object({
    sessions: z.array(demandRow),
    stats: z.object({
      imported: z.number().int().nonnegative(),
      synced: z.number().int().nonnegative(),
      via_agents: z.number().int().nonnegative(),
      claimed: z.number().int().nonnegative(),
      advance_picks: z.number().int().nonnegative(),
    }),
    public_counts: z.object({
      enabled: z.boolean(),
      threshold: z.number().int().min(1).max(99),
    }),
  }),
}).openapi("AgendaDemand");

const settingsBody = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1).max(99),
});

const errors = errorResponses([400, 401, 403, 404, 422, 429, 500]);

async function eventOrNotFound(database: D1Database, eventId: string): Promise<void> {
  const row = await database.prepare("SELECT id FROM events WHERE id = ? LIMIT 1").bind(eventId).first<{ id: string }>();
  if (!row) throw ApiError.notFound("conference not found");
}

interface PublishedSessionRow {
  session_id: string;
  title: string;
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
  capacity: number | null;
}

const readAgendaDemand = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/agenda/demand",
    operationId: "readAgendaDemand",
    summary: "Advance demand for every published session, against room capacity",
    description:
      "Exact counts, including sessions below the public threshold — the organizer's numbers are always their own. A count is distinct anonymous devices plus distinct agent-built schedules containing the session. It is a signal, not a vote.",
    tags: ["Agenda"],
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    request: { params: eventParams },
    responses: { 200: jsonResponse(demandResponse, "Demand by session"), ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventOrNotFound(context.env.DB, eventId);

    const published = await context.env.DB
      .prepare(
        // The same population the public agenda draws: a published session
        // item whose submission has not been rejected or withdrawn. Reading it
        // any other way would put a session on the demand board that no
        // attendee could ever have starred.
        `SELECT submission.id AS session_id,
                submission.title AS title,
                item.starts_at AS starts_at,
                item.duration_min AS duration_min,
                room.name AS room,
                room.capacity AS capacity
           FROM agenda_items item
           JOIN submissions submission
             ON submission.id = item.submission_id AND submission.event_id = item.event_id
           JOIN rooms room ON room.id = item.room_id AND room.event_id = item.event_id
          WHERE item.event_id = ?
            AND item.kind = 'session'
            AND item.is_published = 1
            AND submission.status NOT IN ('rejected', 'withdrawn')`,
      )
      .bind(eventId)
      .all<PublishedSessionRow>();

    const counts = await sessionDemandCounts(context.env.DB, eventId);
    const sessions = (published.results ?? [])
      .map((row) => ({
        session_id: row.session_id,
        title: row.title,
        starts_at: row.starts_at,
        duration_min: row.duration_min,
        room: row.room,
        // Zero is "unknown" in this schema, not "a room that holds nobody":
        // capacity is NOT NULL and defaults to nothing meaningful, so a ratio
        // built on it would be a fabricated number on the one screen that
        // exists to prevent fabricated room decisions.
        capacity: row.capacity && row.capacity > 0 ? row.capacity : null,
        count: counts.get(row.session_id) ?? 0,
      }))
      .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));

    const stats = await demandStats(context.env.DB, eventId);
    const setting = await publicStarCountSetting(context.env.DB, eventId);
    return context.json({
      data: {
        sessions,
        stats: {
          imported: stats.imported,
          synced: stats.synced,
          via_agents: stats.viaAgents,
          claimed: stats.claimed,
          advance_picks: stats.advancePicks,
        },
        public_counts: setting,
      },
    }, 200);
  },
);

const updatePublicStarCounts = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/agenda/demand/settings",
    operationId: "updatePublicStarCounts",
    summary: "Choose whether attendees see star counts, and from what number",
    description:
      "Ships off. A popularity display carries speaker feelings and rich-get-richer dynamics, so showing one is the organizer's decision rather than the product's. The threshold floors at 1 — publishing \"0 schedules include this session\" is the worst number a session can carry.",
    tags: ["Agenda"],
    policy: { auth: { kind: "grants", grants: ["agenda:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    request: { params: eventParams, body: { content: { "application/json": { schema: settingsBody } } } },
    responses: {
      200: jsonResponse(z.object({ data: z.object({ enabled: z.boolean(), threshold: z.number().int() }) }), "The setting as stored"),
      ...errors,
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventOrNotFound(context.env.DB, eventId);
    const body = context.req.valid("json");
    const stored = await writePublicStarCountSetting(
      context.env.DB,
      eventId,
      { enabled: body.enabled, threshold: normalizeThreshold(body.threshold) },
      Date.now(),
    );
    return context.json({ data: stored }, 200);
  },
);

export const apiRoutes = [readAgendaDemand, updatePublicStarCounts];

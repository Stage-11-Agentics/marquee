import { z } from "@hono/zod-openapi";

import type { EventRow, FormatRow, TrackRow } from "../db/schema";
import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";

const eventParams = z.object({ eventId: z.string().min(1) });
const formatParams = eventParams.extend({ formatId: z.string().min(1) });
const trackParams = eventParams.extend({ trackId: z.string().min(1) });

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use an ISO calendar date");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a six-digit hex color");

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  starts_on: z.string(),
  ends_on: z.string(),
  timezone: z.string(),
  venue: z.string().nullable(),
  logo_key: z.string().nullable(),
  accent: z.string().nullable(),
  updated_at: z.number(),
});
const formatSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  default_duration_min: z.number().int().nonnegative(),
  min_duration_min: z.number().int().nonnegative(),
  max_duration_min: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  updated_at: z.number(),
});
const trackSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  color: z.string(),
  position: z.number().int().nonnegative(),
  updated_at: z.number(),
});
const settingsResponse = z.object({
  data: z.object({ event: eventSchema, formats: z.array(formatSchema), tracks: z.array(trackSchema) }),
});
const formatResponse = jsonResponse(z.object({ data: formatSchema }), "Conference format");
const trackResponse = jsonResponse(z.object({ data: trackSchema }), "Conference track");

const eventPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tagline: z.string().max(500).nullable().optional(),
  starts_on: date.optional(),
  ends_on: date.optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  venue: z.string().max(300).nullable().optional(),
  logo_key: z.string().max(500).nullable().optional(),
  accent: color.nullable().optional(),
});
const formatInput = z.object({
  name: z.string().trim().min(1).max(160),
  default_duration_min: z.number().int().nonnegative(),
  min_duration_min: z.number().int().nonnegative(),
  max_duration_min: z.number().int().nonnegative(),
  position: z.number().int().nonnegative().optional(),
});
const formatPatch = formatInput.partial();
const trackInput = z.object({
  name: z.string().trim().min(1).max(160),
  color,
  position: z.number().int().nonnegative().optional(),
});
const trackPatch = trackInput.partial();

type PublicEvent = Pick<EventRow, "id" | "name" | "tagline" | "starts_on" | "ends_on" | "timezone" | "venue" | "logo_key" | "accent" | "updated_at">;

async function eventFor(db: D1Database, eventId: string): Promise<PublicEvent> {
  const event = await db.prepare(
    `SELECT id, name, tagline, starts_on, ends_on, timezone, venue, logo_key, accent, updated_at
     FROM events WHERE id = ?`,
  ).bind(eventId).first<PublicEvent>();
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

async function settingsFor(db: D1Database, eventId: string): Promise<{ event: PublicEvent; formats: FormatRow[]; tracks: TrackRow[] }> {
  const [event, formats, tracks] = await Promise.all([
    eventFor(db, eventId),
    db.prepare(
      `SELECT id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at
       FROM formats WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<FormatRow>(),
    db.prepare(
      `SELECT id, event_id, name, color, position, created_at, updated_at
       FROM tracks WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<TrackRow>(),
  ]);
  return { event, formats: formats.results, tracks: tracks.results };
}

function assertDateOrder(startsOn: string, endsOn: string): void {
  for (const [field, value] of [["starts_on", startsOn], ["ends_on", endsOn]] as const) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw ApiError.unprocessable("use a real ISO calendar date", field);
    }
  }
  if (startsOn > endsOn) throw ApiError.unprocessable("the conference end date cannot be before its start date", "ends_on");
}

function assertTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw ApiError.unprocessable("timezone must be a valid IANA timezone", "timezone");
  }
}

function assertDurationRange(minimum: number, defaultDuration: number, maximum: number): void {
  if (minimum > defaultDuration || defaultDuration > maximum) {
    throw ApiError.unprocessable("duration must satisfy minimum ≤ default ≤ maximum", "default_duration_min");
  }
}

async function formatFor(db: D1Database, eventId: string, formatId: string): Promise<FormatRow> {
  const format = await db.prepare(
    `SELECT id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at
     FROM formats WHERE id = ? AND event_id = ?`,
  ).bind(formatId, eventId).first<FormatRow>();
  if (!format) throw ApiError.notFound("format not found");
  return format;
}

async function trackFor(db: D1Database, eventId: string, trackId: string): Promise<TrackRow> {
  const track = await db.prepare(
    `SELECT id, event_id, name, color, position, created_at, updated_at
     FROM tracks WHERE id = ? AND event_id = ?`,
  ).bind(trackId, eventId).first<TrackRow>();
  if (!track) throw ApiError.notFound("track not found");
  return track;
}

async function normalizePositions(db: D1Database, table: "formats" | "tracks", eventId: string): Promise<void> {
  const rows = await db.prepare(`SELECT id FROM ${table} WHERE event_id = ? ORDER BY position, id`).bind(eventId).all<{ id: string }>();
  await assignPositions(db, table, eventId, rows.results.map((row) => row.id));
}

async function assignPositions(db: D1Database, table: "formats" | "tracks", eventId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const updatedAt = Date.now();
  await db.batch(ids.map((id, position) => db.prepare(
    `UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ? AND event_id = ?`,
  ).bind(position, updatedAt, id, eventId)));
}

async function reorderPosition(
  db: D1Database,
  table: "formats" | "tracks",
  eventId: string,
  id: string,
  requestedPosition: number,
): Promise<void> {
  const rows = await db.prepare(`SELECT id FROM ${table} WHERE event_id = ? ORDER BY position, id`).bind(eventId).all<{ id: string }>();
  const ordered = rows.results.map((row) => row.id);
  const currentIndex = ordered.indexOf(id);
  if (currentIndex < 0) throw ApiError.notFound(`${table.slice(0, -1)} not found`);
  ordered.splice(currentIndex, 1);
  ordered.splice(Math.min(Math.max(requestedPosition, 0), ordered.length), 0, id);
  await assignPositions(db, table, eventId, ordered);
}

const getSettings = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}",
    operationId: "getEventSettings",
    summary: "Read conference details, formats, and tracks",
    tags: ["Event settings"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(settingsResponse, "Conference settings"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => context.json({ data: await settingsFor(context.env.DB, context.req.valid("param").eventId) }, 200),
);

const updateSettings = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}",
    operationId: "updateEventSettings",
    summary: "Update conference details",
    tags: ["Event settings"],
    request: { params: eventParams, body: { content: { "application/json": { schema: eventPatch } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(settingsResponse, "Updated conference settings"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const current = await eventFor(context.env.DB, eventId);
    const body = context.req.valid("json");
    const startsOn = body.starts_on ?? current.starts_on;
    const endsOn = body.ends_on ?? current.ends_on;
    assertDateOrder(startsOn, endsOn);
    if (body.timezone !== undefined) assertTimezone(body.timezone);
    const now = Date.now();
    await context.env.DB.prepare(
      `UPDATE events SET name = ?, tagline = ?, starts_on = ?, ends_on = ?, timezone = ?, venue = ?, logo_key = ?, accent = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      body.name ?? current.name,
      body.tagline === undefined ? current.tagline : body.tagline,
      startsOn,
      endsOn,
      body.timezone ?? current.timezone,
      body.venue === undefined ? current.venue : body.venue,
      body.logo_key === undefined ? current.logo_key : body.logo_key,
      body.accent === undefined ? current.accent : body.accent,
      now,
      eventId,
    ).run();
    return context.json({ data: await settingsFor(context.env.DB, eventId) }, 200);
  },
);

const listFormats = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/formats",
    operationId: "listEventFormats",
    summary: "List conference formats",
    tags: ["Event settings"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(formatSchema) }), "Conference formats"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      `SELECT id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at
       FROM formats WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<FormatRow>();
    return context.json({ data: rows.results }, 200);
  },
);

const createFormat = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/formats",
    operationId: "createEventFormat",
    summary: "Create a conference format",
    tags: ["Event settings"],
    request: { params: eventParams, body: { content: { "application/json": { schema: formatInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: formatResponse, ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const body = context.req.valid("json");
    assertDurationRange(body.min_duration_min, body.default_duration_min, body.max_duration_min);
    const id = crypto.randomUUID();
    const now = Date.now();
    const existing = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM formats WHERE event_id = ?").bind(eventId).first<{ count: number }>();
    const desiredPosition = body.position ?? Number(existing?.count ?? 0);
    try {
      await context.env.DB.prepare(
        `INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, eventId, body.name, body.default_duration_min, body.min_duration_min, body.max_duration_min, desiredPosition, now, now).run();
      await reorderPosition(context.env.DB, "formats", eventId, id, desiredPosition);
    } catch (error) {
      if (error instanceof Error && /constraint|unique/i.test(error.message)) throw ApiError.conflict("format position is already in use");
      throw error;
    }
    return context.json({ data: await formatFor(context.env.DB, eventId, id) }, 201);
  },
);

const updateFormat = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/formats/{formatId}",
    operationId: "updateEventFormat",
    summary: "Update a conference format",
    tags: ["Event settings"],
    request: { params: formatParams, body: { content: { "application/json": { schema: formatPatch } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: formatResponse, ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, formatId } = context.req.valid("param");
    const current = await formatFor(context.env.DB, eventId, formatId);
    const body = context.req.valid("json");
    const minimum = body.min_duration_min ?? current.min_duration_min;
    const defaultDuration = body.default_duration_min ?? current.default_duration_min;
    const maximum = body.max_duration_min ?? current.max_duration_min;
    assertDurationRange(minimum, defaultDuration, maximum);
    await context.env.DB.prepare(
      `UPDATE formats SET name = ?, default_duration_min = ?, min_duration_min = ?, max_duration_min = ?, position = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`,
    ).bind(body.name ?? current.name, defaultDuration, minimum, maximum, current.position, Date.now(), formatId, eventId).run();
    if (body.position !== undefined) await reorderPosition(context.env.DB, "formats", eventId, formatId, body.position);
    return context.json({ data: await formatFor(context.env.DB, eventId, formatId) }, 200);
  },
);

const deleteFormat = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/formats/{formatId}",
    operationId: "deleteEventFormat",
    summary: "Delete a conference format",
    tags: ["Event settings"],
    request: { params: formatParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(formatSchema) }), "Remaining conference formats"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, formatId } = context.req.valid("param");
    await formatFor(context.env.DB, eventId, formatId);
    try {
      await context.env.DB.prepare("DELETE FROM formats WHERE id = ? AND event_id = ?").bind(formatId, eventId).run();
    } catch {
      throw ApiError.conflict("format is still used by a conference record");
    }
    await normalizePositions(context.env.DB, "formats", eventId);
    const rows = await context.env.DB.prepare(
      "SELECT id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at FROM formats WHERE event_id = ? ORDER BY position, id",
    ).bind(eventId).all<FormatRow>();
    return context.json({ data: rows.results }, 200);
  },
);

const listTracks = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/tracks",
    operationId: "listEventTracks",
    summary: "List conference tracks",
    tags: ["Event settings"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(trackSchema) }), "Conference tracks"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      "SELECT id, event_id, name, color, position, created_at, updated_at FROM tracks WHERE event_id = ? ORDER BY position, id",
    ).bind(eventId).all<TrackRow>();
    return context.json({ data: rows.results }, 200);
  },
);

const createTrack = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/tracks",
    operationId: "createEventTrack",
    summary: "Create a conference track",
    tags: ["Event settings"],
    request: { params: eventParams, body: { content: { "application/json": { schema: trackInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: trackResponse, ...errorResponses([400, 401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const body = context.req.valid("json");
    const id = crypto.randomUUID();
    const now = Date.now();
    const existing = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM tracks WHERE event_id = ?").bind(eventId).first<{ count: number }>();
    const desiredPosition = body.position ?? Number(existing?.count ?? 0);
    await context.env.DB.prepare(
      "INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, eventId, body.name, body.color, desiredPosition, now, now).run();
    await reorderPosition(context.env.DB, "tracks", eventId, id, desiredPosition);
    return context.json({ data: await trackFor(context.env.DB, eventId, id) }, 201);
  },
);

const updateTrack = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/tracks/{trackId}",
    operationId: "updateEventTrack",
    summary: "Update a conference track",
    tags: ["Event settings"],
    request: { params: trackParams, body: { content: { "application/json": { schema: trackPatch } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: trackResponse, ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, trackId } = context.req.valid("param");
    const current = await trackFor(context.env.DB, eventId, trackId);
    const body = context.req.valid("json");
    await context.env.DB.prepare(
      "UPDATE tracks SET name = ?, color = ?, position = ?, updated_at = ? WHERE id = ? AND event_id = ?",
    ).bind(body.name ?? current.name, body.color ?? current.color, current.position, Date.now(), trackId, eventId).run();
    if (body.position !== undefined) await reorderPosition(context.env.DB, "tracks", eventId, trackId, body.position);
    return context.json({ data: await trackFor(context.env.DB, eventId, trackId) }, 200);
  },
);

const deleteTrack = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/tracks/{trackId}",
    operationId: "deleteEventTrack",
    summary: "Delete a conference track",
    tags: ["Event settings"],
    request: { params: trackParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.array(trackSchema) }), "Remaining conference tracks"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, trackId } = context.req.valid("param");
    await trackFor(context.env.DB, eventId, trackId);
    try {
      await context.env.DB.prepare("DELETE FROM tracks WHERE id = ? AND event_id = ?").bind(trackId, eventId).run();
    } catch {
      throw ApiError.conflict("track is still used by a conference record");
    }
    await normalizePositions(context.env.DB, "tracks", eventId);
    const rows = await context.env.DB.prepare(
      "SELECT id, event_id, name, color, position, created_at, updated_at FROM tracks WHERE event_id = ? ORDER BY position, id",
    ).bind(eventId).all<TrackRow>();
    return context.json({ data: rows.results }, 200);
  },
);

export const apiRoutes = [
  getSettings,
  updateSettings,
  listFormats,
  createFormat,
  updateFormat,
  deleteFormat,
  listTracks,
  createTrack,
  updateTrack,
  deleteTrack,
];

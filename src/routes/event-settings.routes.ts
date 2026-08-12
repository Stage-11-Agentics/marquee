import { z } from "@hono/zod-openapi";

import type { EventRow, FormatRow, TrackRow } from "../db/schema";
import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { SHIPPED_DEMO_ORGANIZATION_ID } from "../lib/reset-demo/demo-fixture";

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
const eventInput = z.object({
  name: z.string().trim().min(1).max(200),
  starts_on: date,
  ends_on: date,
  timezone: z.string().trim().min(1).max(100),
  venue: z.string().max(300).nullable().optional(),
  tagline: z.string().max(500).nullable().optional(),
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

/**
 * A conference's slug is derived from its name, never typed: it is a URL
 * segment, and an organizer creating "AI Engineer New York 2027" should not
 * have to know that. Collisions get a numeric suffix rather than a rejection —
 * next year's conference is often last year's name.
 *
 * Uniqueness is scoped to the organization, matching the index that actually
 * enforces it (`uq_events_org_slug`). A global lookup would let one org's slug
 * block every other org's, which is precisely wrong for the self-host cold
 * start: two instances of this software should be able to run a conference of
 * the same name without one of them getting `-2` for no reason it can see.
 */
export async function uniqueEventSlug(
  db: D1Database,
  orgId: string,
  name: string,
  now: number,
): Promise<string> {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60);
  const stem = base.length > 0 ? base : `conference-${newUlid(now).toLowerCase().slice(0, 8)}`;
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? stem : `${stem}-${suffix + 1}`;
    const taken = await db
      .prepare("SELECT 1 AS present FROM events WHERE org_id = ? AND slug = ?")
      .bind(orgId, candidate)
      .first();
    if (!taken) return candidate;
  }
  return `${stem}-${newUlid(now).toLowerCase().slice(0, 8)}`;
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

/**
 * The one endpoint that creates a conference — the screen at
 * `/conferences/new`, the `＋` beside the switcher, and the CLI's
 * `event create` all land here, so there is no path by which a conference can
 * exist that an agent could not have made (AC-279, AC-280).
 *
 * Authority is organization-wide, so it is answered here rather than by the
 * pipeline's `{eventId}` grant check: there is no event yet to be scoped to.
 */
const createEvent = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events",
    operationId: "createEvent",
    summary: "Create a conference on this instance",
    tags: ["Event settings"],
    request: { body: { content: { "application/json": { schema: eventInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      201: jsonResponse(settingsResponse, "The created conference"),
      ...errorResponses([400, 401, 403, 422, 429, 500]),
    },
  },
  async (context) => {
    const auth = requireOrgAdmin(context);
    const body = context.req.valid("json");
    assertDateOrder(body.starts_on, body.ends_on);
    assertTimezone(body.timezone);
    const now = Date.now();
    const id = newUlid(now);
    const slug = await uniqueEventSlug(context.env.DB, auth.orgId, body.name, now);
    // `demo_mode` is inherited, never asked for. Mail suppression rides this
    // column (`demoMailWouldBeSuppressed`), so a conference created inside the
    // demo organization that stored a 0 would send live mail to whatever
    // address a judge or a demo visitor typed. It is deliberately absent from
    // `eventInput`: a client that could set it could turn suppression off.
    //
    // Inheritance is not total containment, and the carve-out is on purpose:
    // `always_live` senders (the public form's confirmation, the smoke
    // harness) short-circuit before this column is read. Forms arriving closed
    // is the other half of that guard — do not "simplify" either one away.
    const demoMode = auth.orgId === SHIPPED_DEMO_ORGANIZATION_ID ? 1 : 0;
    await context.env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(
      id,
      auth.orgId,
      body.name,
      slug,
      body.tagline ?? null,
      body.starts_on,
      body.ends_on,
      body.timezone,
      body.venue ?? null,
      demoMode,
      now,
      now,
    ).run();
    return context.json({ data: await settingsFor(context.env.DB, id) }, 201);
  },
);

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
  createEvent,
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

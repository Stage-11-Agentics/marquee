import { ApiError } from "../api/errors";
import { assertCasUpdated, compareAndSwapResource, requireIfMatch, strongEtag } from "../api/concurrency";
import {
  SCHEDULABLE_STATUS_OPTIONS,
  normalizeSchedulableStatuses,
  type AgendaSnapshot,
  type SchedulableStatus,
} from "../api/agenda";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { z } from "@hono/zod-openapi";
import {
  SETTINGS_KEY,
  hasAgendaItem,
  placementDuration,
  readAgendaItemVersion,
  readAgendaSnapshot,
  readPlacementSubmission,
  roomBelongsToEvent,
  trackBelongsToEvent,
} from "./agenda.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const itemParams = eventParams.extend({ itemId: z.string().min(1) });

const speakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullable(),
});

const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  is_primary: z.boolean().optional(),
});

const buildingSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  access_minutes: z.number().int().nonnegative(),
});

const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  capacity: z.number().int().nonnegative(),
  building: buildingSchema,
  av_capabilities: z.array(z.string()),
  notes: z.string().nullable(),
});

const formatSchema = z.object({
  id: z.string(),
  name: z.string(),
  default_duration_min: z.number().int().positive(),
  min_duration_min: z.number().int().positive(),
  max_duration_min: z.number().int().positive(),
});

const agendaSessionSchema = z.object({
  id: z.string(),
  submission_id: z.string().nullable(),
  kind: z.enum(["session", "break"]),
  title: z.string(),
  starts_at: z.number().int(),
  duration_min: z.number().int().positive(),
  room_id: z.string(),
  room: z.string(),
  building: z.string(),
  track_id: z.string().nullable(),
  track: z.string().nullable(),
  tracks: z.array(trackSchema),
  speakers: z.array(speakerSchema),
  format_id: z.string().nullable(),
  format: z.string().nullable(),
  status: z.string(),
  is_published: z.boolean(),
  updated_at: z.number().int(),
  etag: z.string(),
});

const poolItemSchema = z.object({
  submission_id: z.string(),
  kind: z.enum(["abstract", "session"]),
  title: z.string(),
  status: z.enum(SCHEDULABLE_STATUS_OPTIONS),
  format_id: z.string().nullable(),
  format: z.string().nullable(),
  default_duration_min: z.number().int().positive(),
  min_duration_min: z.number().int().positive(),
  max_duration_min: z.number().int().positive(),
  speakers: z.array(speakerSchema),
  tracks: z.array(trackSchema),
  updated_at: z.number().int(),
});

const conflictSchema = z.object({
  kind: z.enum(["room", "person", "transit"]),
  message: z.string(),
  session_ids: z.tuple([z.string(), z.string()]),
  person_id: z.string().optional(),
  label: z.literal("Transit").optional(),
});

const agendaSnapshotSchema = z.object({
  event: z.object({
    id: z.string(),
    name: z.string(),
    starts_on: z.string(),
    ends_on: z.string(),
    timezone: z.string(),
  }),
  schedulable_statuses: z.array(z.enum(SCHEDULABLE_STATUS_OPTIONS)),
  rooms: z.array(roomSchema),
  formats: z.array(formatSchema),
  tracks: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  sessions: z.array(agendaSessionSchema),
  unscheduled: z.array(poolItemSchema),
  conflicts: z.array(conflictSchema),
});

const mutationResultSchema = z.object({
  id: z.string(),
  submission_id: z.string().nullable(),
  starts_at: z.number().int(),
  duration_min: z.number().int().positive(),
  room_id: z.string(),
  track_id: z.string().nullable(),
  is_published: z.boolean(),
  updated_at: z.number().int(),
  etag: z.string(),
});

const placementBody = z.object({
  submission_id: z.string().min(1),
  starts_at: z.number().int(),
  room_id: z.string().min(1),
  duration_min: z.number().int().positive().optional(),
  track_id: z.string().min(1).nullable().optional(),
});

const updateBody = z.object({
  starts_at: z.number().int().optional(),
  room_id: z.string().min(1).optional(),
  duration_min: z.number().int().positive().optional(),
  track_id: z.string().min(1).nullable().optional(),
});

const settingsBody = z.object({
  schedulable_statuses: z.array(z.enum(SCHEDULABLE_STATUS_OPTIONS)).min(1),
});

const errors = errorResponses([400, 401, 403, 404, 409, 422, 429, 500]);

function resultFromItem(item: {
  id: string;
  submission_id: string | null;
  starts_at: number;
  duration_min: number;
  room_id: string;
  track_id: string | null;
  is_published: number;
  updated_at: number;
}) {
  return {
    id: item.id,
    submission_id: item.submission_id,
    starts_at: item.starts_at,
    duration_min: item.duration_min,
    room_id: item.room_id,
    track_id: item.track_id,
    is_published: item.is_published === 1,
    updated_at: item.updated_at,
    etag: strongEtag(item.id, item.updated_at),
  };
}

async function snapshotOrNotFound(database: D1Database, eventId: string): Promise<AgendaSnapshot> {
  const snapshot = await readAgendaSnapshot(database, eventId);
  if (!snapshot) throw ApiError.notFound();
  return snapshot;
}

const listAgenda = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/agenda",
    operationId: "getAgenda",
    summary: "Read the conference agenda builder snapshot",
    description: "Returns scheduled sessions, the status-derived unscheduled pool, rooms, formats, tracks, and warnings.",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: { params: eventParams },
    responses: { 200: jsonResponse(agendaSnapshotSchema, "Agenda builder snapshot"), ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    return context.json(await snapshotOrNotFound(context.env.DB, eventId), 200);
  },
);

const placeAgendaItem = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/agenda/items",
    operationId: "placeAgendaItem",
    summary: "Place a schedulable submission on the agenda",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["agenda:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    request: { params: eventParams, body: { content: { "application/json": { schema: placementBody } } } },
    responses: { 201: jsonResponse(mutationResultSchema, "Placed agenda item"), ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const snapshot = await snapshotOrNotFound(context.env.DB, eventId);
    const submission = await readPlacementSubmission(context.env.DB, eventId, body.submission_id);
    if (!submission) throw ApiError.notFound();
    if (!snapshot.schedulable_statuses.includes(submission.status as SchedulableStatus)) {
      throw ApiError.unprocessable("Only submissions in a configured schedulable status can be placed", "submission_id");
    }
    if (await hasAgendaItem(context.env.DB, eventId, submission.id)) {
      throw ApiError.conflict("This submission is already placed on the agenda");
    }
    if (!await roomBelongsToEvent(context.env.DB, eventId, body.room_id)) {
      throw ApiError.unprocessable("Room does not belong to this conference", "room_id");
    }
    const trackId = body.track_id === undefined ? submission.primary_track_id : body.track_id;
    if (trackId !== null && trackId !== undefined && !await trackBelongsToEvent(context.env.DB, eventId, trackId)) {
      throw ApiError.unprocessable("Track does not belong to this conference", "track_id");
    }
    let duration: number;
    try {
      duration = placementDuration(body.duration_min, submission);
    } catch (error) {
      throw ApiError.unprocessable(error instanceof Error ? error.message : "Duration is not allowed", "duration_min");
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    await context.env.DB.prepare(`
      INSERT INTO agenda_items
        (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
      VALUES (?, ?, ?, 'session', NULL, ?, ?, ?, ?, 0, ?, ?)
    `).bind(id, eventId, submission.id, body.starts_at, duration, body.room_id, trackId ?? null, now, now).run();
    const item = await readAgendaItemVersion(context.env.DB, eventId, id);
    if (!item) throw new Error("placed agenda item disappeared after insert");
    return context.json(resultFromItem({ ...item, is_published: 0 }), 201);
  },
);

const updateAgendaItem = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/agenda/items/{itemId}",
    operationId: "updateAgendaItem",
    summary: "Move or resize an agenda item",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["agenda:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "if-match",
    },
    request: { params: itemParams, body: { content: { "application/json": { schema: updateBody } } } },
    responses: { 200: jsonResponse(mutationResultSchema, "Updated agenda item"), ...errors },
  },
  async (context) => {
    const { eventId, itemId } = context.req.valid("param");
    const body = context.req.valid("json");
    const expected = requireIfMatch(context.req.raw, itemId);
    const current = await readAgendaItemVersion(context.env.DB, eventId, itemId);
    if (!current) throw ApiError.notFound();
    const submission = current.submission_id === null
      ? null
      : await readPlacementSubmission(context.env.DB, eventId, current.submission_id);
    if (current.kind === "session" && !submission) throw ApiError.notFound();
    if (body.room_id !== undefined && !await roomBelongsToEvent(context.env.DB, eventId, body.room_id)) {
      throw ApiError.unprocessable("Room does not belong to this conference", "room_id");
    }
    if (body.track_id !== undefined && body.track_id !== null && !await trackBelongsToEvent(context.env.DB, eventId, body.track_id)) {
      throw ApiError.unprocessable("Track does not belong to this conference", "track_id");
    }
    let duration = body.duration_min;
    if (duration !== undefined && submission) {
      try {
        duration = placementDuration(duration, submission);
      } catch (error) {
        throw ApiError.unprocessable(error instanceof Error ? error.message : "Duration is not allowed", "duration_min");
      }
    }
    const outcome = await compareAndSwapResource({
      expected,
      now: Date.now(),
      prepareWrite: ({ expectedUpdatedAt, nextUpdatedAt }) => context.env.DB.prepare(`
        UPDATE agenda_items
        SET starts_at = COALESCE(?, starts_at),
            duration_min = COALESCE(?, duration_min),
            room_id = COALESCE(?, room_id),
            track_id = CASE WHEN ? THEN ? ELSE track_id END,
            updated_at = ?
        WHERE id = ? AND event_id = ? AND updated_at = ?
      `).bind(
        body.starts_at ?? null,
        duration ?? null,
        body.room_id ?? null,
        body.track_id !== undefined ? 1 : 0,
        body.track_id ?? null,
        nextUpdatedAt,
        itemId,
        eventId,
        expectedUpdatedAt,
      ),
      readCurrent: () => readAgendaItemVersion(context.env.DB, eventId, itemId),
      versionOf: (item) => ({ id: item.id, updatedAt: item.updated_at }),
    });
    const updated = assertCasUpdated(outcome);
    const item = await readAgendaItemVersion(context.env.DB, eventId, itemId);
    if (!item) throw new Error("updated agenda item disappeared after write");
    return context.json({ ...resultFromItem(item), etag: updated.etag }, 200);
  },
);

const removeAgendaItem = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/agenda/items/{itemId}",
    operationId: "removeAgendaItem",
    summary: "Return an agenda session to the unscheduled pool",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["agenda:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "if-match",
    },
    request: { params: itemParams },
    responses: { 204: { description: "Agenda item removed" }, ...errors },
  },
  async (context) => {
    const { eventId, itemId } = context.req.valid("param");
    const expected = requireIfMatch(context.req.raw, itemId);
    const outcome = await compareAndSwapResource({
      expected,
      now: Date.now(),
      prepareWrite: ({ expectedUpdatedAt }) => context.env.DB.prepare(
        "DELETE FROM agenda_items WHERE id = ? AND event_id = ? AND updated_at = ?",
      ).bind(itemId, eventId, expectedUpdatedAt),
      readCurrent: () => readAgendaItemVersion(context.env.DB, eventId, itemId),
      versionOf: (item) => ({ id: item.id, updatedAt: item.updated_at }),
    });
    assertCasUpdated(outcome);
    return context.body(null, 204);
  },
);

const updateAgendaSettings = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/agenda/settings",
    operationId: "updateAgendaSettings",
    summary: "Configure which conference statuses enter the agenda pool",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["agenda:write"] },
      rateLimit: { bucket: "write" },
      // Settings are an event-scoped command, not a user-visible agenda item.
      // The item mutations above carry the required resource CAS.
      concurrency: "none",
    },
    request: { params: eventParams, body: { content: { "application/json": { schema: settingsBody } } } },
    responses: {
      200: jsonResponse(z.object({ schedulable_statuses: z.array(z.enum(SCHEDULABLE_STATUS_OPTIONS)) }), "Agenda settings"),
      ...errors,
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await snapshotOrNotFound(context.env.DB, eventId);
    const body = context.req.valid("json");
    const statuses = normalizeSchedulableStatuses(body.schedulable_statuses);
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).bind(`agenda-settings-${eventId}`, eventId, SETTINGS_KEY, JSON.stringify(statuses), now, now).run();
    return context.json({ schedulable_statuses: statuses }, 200);
  },
);

export const apiRoutes = [
  listAgenda,
  placeAgendaItem,
  updateAgendaItem,
  removeAgendaItem,
  updateAgendaSettings,
];

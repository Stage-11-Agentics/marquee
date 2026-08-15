import { ApiError } from "../api/errors";
import { assertCasUpdated, compareAndSwapResource, requireIfMatch, strongEtag } from "../api/concurrency";
import {
  MAX_BATCH_PUBLISH_IDS,
  SCHEDULABLE_STATUS_OPTIONS,
  normalizeSchedulableStatuses,
  type AgendaSnapshot,
  type SchedulableStatus,
} from "../api/agenda";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { auditStatementFromSelect } from "../lib/audit";
import { purgePublicEmbedCache } from "../lib/public-site";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";
import type { Context } from "hono";
import { z } from "@hono/zod-openapi";
import {
  SETTINGS_KEY,
  hasAgendaItem,
  placementDuration,
  readAgendaItemVersion,
  readAgendaPublication,
  readAgendaSnapshot,
  readPlacementSubmission,
  roomBelongsToEvent,
  trackBelongsToEvent,
} from "./agenda.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const itemParams = eventParams.extend({ itemId: z.string().min(1) });
const ifMatchHeaders = z.object({
  "if-match": z.string().min(1).describe("The agenda item's current strong ETag."),
});

const speakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  confirmation_status: z.enum(["pending", "confirmed", "declined"]).optional(),
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
  position: z.number().int().nonnegative(),
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
  has_declined_participant: z.boolean(),
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
    slug: z.string().optional(),
    starts_on: z.string(),
    ends_on: z.string(),
    timezone: z.string(),
  }),
  schedule_window: z.object({
    outside_window_session_count: z.number().int().nonnegative(),
  }),
  venue: z.object({
    pinned_building_count: z.number().int().nonnegative(),
    primary_building_name: z.string().nullable(),
  }),
  publication: z.object({
    live: z.number().int().nonnegative(),
    not_yet_public: z.number().int().nonnegative(),
    candidates: z.array(z.object({
      agenda_item_id: z.string().nullable(),
      submission_id: z.string(),
      title: z.string(),
      starts_at: z.number().int().nullable(),
      duration_min: z.number().int().positive().nullable(),
      room: z.string().nullable(),
      building: z.string().nullable(),
      scheduled: z.boolean(),
      can_publish: z.boolean(),
      blocked_reason: z.string().nullable(),
      speakers: z.array(speakerSchema),
    })),
    public_agenda_url: z.string(),
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

const batchPublishBody = z.object({
  submission_ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH_PUBLISH_IDS),
});

const batchPublishResponse = z.object({
  published_count: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  not_yet_public: z.number().int().nonnegative(),
  public_agenda_url: z.string(),
});

const batchPublishRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/agenda/publish",
    operationId: "batchPublishAgenda",
    summary: "Publish selected scheduled Sessions to the public agenda",
    description: "Publishes a selected batch only when every Session is scheduled, stored as accepted, and not yet public.",
    tags: ["Agenda"],
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    request: {
      params: eventParams,
      body: { content: { "application/json": { schema: batchPublishBody } } },
    },
    responses: { 200: jsonResponse(batchPublishResponse, "Batch publication result"), ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const { submission_ids: submissionIds } = context.req.valid("json") as { submission_ids: string[] };
    if (new Set(submissionIds).size !== submissionIds.length) {
      throw ApiError.unprocessable("choose each Session only once", "submission_ids");
    }
    const current = await snapshotOrNotFound(context.env.DB, eventId);
    const candidates = new Map(current.publication.candidates.map((candidate) => [candidate.submission_id, candidate]));
    if (submissionIds.some((submissionId) => !candidates.get(submissionId)?.can_publish)) {
      throw ApiError.conflict("one or more selected Sessions are no longer ready to publish; refresh the agenda and try again");
    }

    const actor = await publicationActor(context);
    const now = Date.now();
    // One JSON binding keeps a real program under D1's binding limit. The
    // statement-count cap above is for the per-record audit rows in this
    // transaction, not for SQL placeholder expansion.
    const submissionIdsJson = JSON.stringify(submissionIds);
    const database = context.env.DB;
    // The count guard makes the agenda update all-or-nothing when a reversal
    // wins the race between the preview read and this command. It also keeps
    // foreign-event IDs from producing a partial batch.
    const agendaUpdate = database.prepare(`
      UPDATE agenda_items AS item
      SET is_published = 1, updated_at = ?
      WHERE item.event_id = ? AND item.kind = 'session' AND item.is_published = 0
        AND item.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        AND (
          SELECT COUNT(DISTINCT candidate.submission_id)
          FROM agenda_items candidate
          JOIN submissions candidate_submission
            ON candidate_submission.id = candidate.submission_id
           AND candidate_submission.event_id = candidate.event_id
          WHERE candidate.event_id = ?
            AND candidate.kind = 'session'
            AND candidate.is_published = 0
            AND candidate_submission.status = 'accepted'
            AND candidate_submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        ) = ?
    `).bind(now, eventId, submissionIdsJson, eventId, submissionIdsJson, submissionIds.length);
    // The first update marks the exact agenda rows. The second mirrors the
    // per-record publisher's dual-table write, but only for rows stamped by
    // this batch, so a rejected/withdrawn record cannot become public.
    const submissionUpdate = database.prepare(`
      UPDATE submissions AS submission
      SET is_published = 1, updated_at = ?
      WHERE submission.event_id = ?
        AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        AND EXISTS (
          SELECT 1 FROM agenda_items item
          WHERE item.event_id = submission.event_id
            AND item.submission_id = submission.id
            AND item.kind = 'session'
            AND item.is_published = 1
            AND item.updated_at = ?
        )
    `).bind(now, eventId, submissionIdsJson, now);
    // Keep one audit row per submission while retaining one D1 batch call.
    // Each helper-built INSERT ... SELECT has predicates that make audit
    // output conditional on both writes having actually landed.
    const auditStatements = submissionIds.map((submissionId) => {
      const candidate = candidates.get(submissionId)!;
      return auditStatementFromSelect(database, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "published",
        entityType: "submission",
        entityId: submissionId,
        after: { agenda_item_id: candidate.agenda_item_id, is_published: true },
        now,
        requestId: actor.requestId,
      }, `
        FROM agenda_items item
        JOIN submissions submission ON submission.id = item.submission_id AND submission.event_id = item.event_id
        WHERE item.event_id = ? AND item.submission_id = ? AND item.kind = 'session'
          AND item.is_published = 1 AND item.updated_at = ?
          AND submission.status = 'accepted' AND submission.is_published = 1 AND submission.updated_at = ?
      `, eventId, submissionId, now, now);
    });
    const results = await database.batch([agendaUpdate, submissionUpdate, ...auditStatements]);
    await purgePublicEmbedCache(context.env.CACHE, { eventId });
    const publishedCount = Number(results[0]?.meta?.changes ?? 0);
    const submissionChanges = Number(results[1]?.meta?.changes ?? 0);
    if (publishedCount !== submissionIds.length || submissionChanges !== submissionIds.length) {
      throw ApiError.conflict("the selected Sessions changed while publishing; refresh the agenda before trying again");
    }
    const publication = await readAgendaPublication(database, eventId, current.event.slug);
    return context.json({
      published_count: publishedCount,
      live: publication.live,
      not_yet_public: publication.not_yet_public,
      public_agenda_url: publication.public_agenda_url,
    }, 200);
  },
);

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

async function publicationActor(context: Context<ApiEnv>): Promise<DecisionActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?").bind(auth.tokenId).first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { kind: "api_token", personId: token.created_by, requestId };
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
    request: {
      params: itemParams,
      headers: ifMatchHeaders,
      body: { content: { "application/json": { schema: updateBody } } },
    },
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
    request: { params: itemParams, headers: ifMatchHeaders },
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
  batchPublishRoute,
  placeAgendaItem,
  updateAgendaItem,
  removeAgendaItem,
  updateAgendaSettings,
];

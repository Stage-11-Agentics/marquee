import { z } from "@hono/zod-openapi";

import type { EventRow, FormatRow, TrackRow } from "../db/schema";
import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { getAuth } from "../lib/auth/auth-middleware";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { roleForEvent, tokenEventAllowed } from "../lib/auth/scope-resolution";
import { COPY_SET_KEYS } from "../lib/events/copy-manifest";
import { planEventCopy, readCopyPlan } from "../lib/events/copy-event";
import { countOutsideConferenceWindow } from "../lib/conference-dates";
import { SHIPPED_DEMO_ORGANIZATION_ID } from "../lib/reset-demo/demo-fixture";
import { SOCIAL_PLATFORM_IDS, type SocialPlatformId } from "../lib/social-links";
import { enabledSocialPlatformsFor, writeEnabledSocialPlatforms } from "../lib/social-platform-setting";

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
const socialPlatformId = z.enum(SOCIAL_PLATFORM_IDS as unknown as [SocialPlatformId, ...SocialPlatformId[]]);
const settingsResponse = z.object({
  data: z.object({
    event: eventSchema,
    formats: z.array(formatSchema),
    tracks: z.array(trackSchema),
    /** Which social profiles this conference asks its speakers for. */
    speaker_social_platforms: z.array(socialPlatformId),
    schedule_window: z.object({
      outside_window_session_count: z.number().int().nonnegative(),
    }),
  }),
});

const copySetSchema = z.object(
  Object.fromEntries(COPY_SET_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
    (typeof COPY_SET_KEYS)[number],
    z.ZodOptional<z.ZodBoolean>
  >,
);

const listedEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  demo_mode: z.number().int(),
  starts_on: z.string(),
  ends_on: z.string(),
  timezone: z.string(),
  venue: z.string().nullable(),
  role: z.string(),
  submission_count: z.number().int().nonnegative(),
  past: z.boolean(),
});
const eventListResponse = z.object({ data: z.array(listedEventSchema) });

const copyPlanResponse = z.object({
  data: z.object({
    event: z.object({ id: z.string(), name: z.string() }),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    task_templates_skipped_fixed_due: z.number().int().nonnegative(),
    requires: z.record(z.string(), z.array(z.string())),
    reasons: z.record(z.string(), z.string()),
  }),
});

const createdEventResponse = z.object({
  data: z.object({
    event: eventSchema,
    formats: z.array(formatSchema),
    tracks: z.array(trackSchema),
    copied: z.record(z.string(), z.number().int().nonnegative()).optional(),
    copied_from: z.string().nullable().optional(),
    task_templates_skipped_fixed_due: z.number().int().nonnegative().optional(),
  }),
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
  /**
   * Which social profiles speakers are asked for. An empty array is a real
   * choice — "this conference does not collect them" — which is why it is
   * distinct from omitting the field, meaning "leave the setting alone".
   */
  speaker_social_platforms: z.array(socialPlatformId).max(SOCIAL_PLATFORM_IDS.length).optional(),
});
const eventInput = z.object({
  name: z.string().trim().min(1).max(200),
  starts_on: date,
  ends_on: date,
  timezone: z.string().trim().min(1).max(100),
  venue: z.string().max(300).nullable().optional(),
  tagline: z.string().max(500).nullable().optional(),
  /**
   * Next year's conference, made from this year's. Absent, the conference is
   * created empty; present, the selected structure sets travel with it and the
   * response reports what did — see `src/lib/events/copy-manifest.ts`.
   */
  copy_from: z.string().min(1).optional(),
  copy: copySetSchema.optional(),
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

async function settingsFor(db: D1Database, eventId: string): Promise<{ event: PublicEvent; formats: FormatRow[]; tracks: TrackRow[]; speaker_social_platforms: SocialPlatformId[]; schedule_window: { outside_window_session_count: number } }> {
  const [event, formats, tracks, socialPlatforms, scheduledItems] = await Promise.all([
    eventFor(db, eventId),
    db.prepare(
      `SELECT id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at
       FROM formats WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<FormatRow>(),
    db.prepare(
      `SELECT id, event_id, name, color, position, created_at, updated_at
       FROM tracks WHERE event_id = ? ORDER BY position, id`,
    ).bind(eventId).all<TrackRow>(),
    enabledSocialPlatformsFor(db, eventId),
    db.prepare("SELECT starts_at FROM agenda_items WHERE event_id = ? AND kind = 'session'").bind(eventId).all<{ starts_at: number }>(),
  ]);
  return {
    event,
    formats: formats.results,
    tracks: tracks.results,
    speaker_social_platforms: socialPlatforms,
    schedule_window: {
      outside_window_session_count: countOutsideConferenceWindow(
        scheduledItems.results.map((item) => Number(item.starts_at)),
        event.starts_on,
        event.ends_on,
        event.timezone,
      ),
    },
  };
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

interface ListedEventRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  demo_mode: number;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue: string | null;
}

/** Today in UTC, in the calendar-date shape `starts_on` and `ends_on` are stored in. */
function todayIso(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Every conference in this organization the caller can actually read — the list
 * the switcher, the create screen's source picker, and `marquee event list` all
 * render.
 *
 * `authenticated` rather than `grants`, and not for convenience: a collection
 * route has no `{eventId}` segment, and the pipeline resolves a grant against
 * that parameter (`principalHasGrant`), so a `grants` policy would answer 403
 * for every caller including the ones who own the place. Authority is therefore
 * answered here, per row, which is also the only place it can be: the whole
 * point of this route is that different callers see different conferences.
 */
const listEvents = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events",
    operationId: "listEvents",
    summary: "List the conferences this credential can read",
    tags: ["Event settings"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(eventListResponse, "Conferences in this organization"), ...errorResponses([401, 429, 500]) },
  },
  async (context) => {
    const auth = getAuth(context);
    if (!auth) throw ApiError.unauthenticated();
    const rows = await context.env.DB.prepare(
      `SELECT id, name, slug, status, demo_mode, starts_on, ends_on, timezone, venue
       FROM events WHERE org_id = ? ORDER BY starts_on DESC, id`,
    ).bind(auth.orgId).all<ListedEventRow>();

    const visible = rows.results.flatMap((row) => {
      // A reviewer's membership never inherits across conferences, so this is
      // where a reviewer of one event stops seeing the other seven.
      const role = roleForEvent(auth.memberships, row.id) ?? (auth.kind === "token" ? auth.legacyRole ?? null : null);
      if (role === null) return [];
      // An event-restricted token sees only the events it was issued for, even
      // when the person who issued it can see the whole organization.
      if (auth.kind === "token" && !tokenEventAllowed(auth, row.id)) return [];
      return [{ row, role }];
    });

    // Tallied through the organization rather than through a list of ids: one
    // bound parameter regardless of how many conferences an organization runs,
    // where a placeholder per id would meet D1's 100-binding cap eventually and
    // silently.
    const counts = new Map<string, number>();
    if (visible.length > 0) {
      const tallies = await context.env.DB.prepare(
        `SELECT event_id, COUNT(*) AS total FROM submissions
         WHERE event_id IN (SELECT id FROM events WHERE org_id = ?) GROUP BY event_id`,
      ).bind(auth.orgId).all<{ event_id: string; total: number }>();
      for (const tally of tallies.results) counts.set(tally.event_id, Number(tally.total));
    }

    // Upcoming ascending, then past descending: the organizer's next conference
    // is the one they mean, and last year's is the one they look up.
    const today = todayIso(Date.now());
    const data = visible
      .map((entry) => ({
        ...entry.row,
        demo_mode: Number(entry.row.demo_mode),
        role: entry.role,
        submission_count: counts.get(entry.row.id) ?? 0,
        past: entry.row.ends_on < today,
      }))
      .sort((left, right) => {
        if (left.past !== right.past) return left.past ? 1 : -1;
        const order = left.starts_on < right.starts_on ? -1 : left.starts_on > right.starts_on ? 1 : 0;
        return left.past ? -order : order;
      });
    return context.json({ data }, 200);
  },
);

/**
 * What would travel, before anything does. The create screen renders this as
 * the copy checklist: real per-set counts, the prerequisites the schema and the
 * submit path impose on this particular source conference, and the templates
 * that will be declined because their deadline is a fixed date belonging to the
 * conference it was set for.
 */
const getCopyPlan = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/copy-plan",
    operationId: "getEventCopyPlan",
    summary: "Preview what copying this conference would carry",
    tags: ["Event settings"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(copyPlanResponse, "The copy contract for this conference"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const plan = await readCopyPlan(context.env.DB, context.req.valid("param").eventId);
    return context.json({
      data: {
        event: plan.event,
        counts: plan.counts,
        task_templates_skipped_fixed_due: plan.taskTemplatesSkippedFixedDue,
        requires: plan.requires,
        reasons: plan.reasons,
      },
    }, 200);
  },
);

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
      201: jsonResponse(createdEventResponse, "The created conference"),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
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
    // A source conference is addressed by id, and an id from another
    // organization is not a permission error to explain — it is a conference
    // this caller has no way of knowing exists.
    if (body.copy_from !== undefined) {
      const source = await context.env.DB
        .prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
        .bind(body.copy_from, auth.orgId)
        .first();
      if (!source) throw ApiError.notFound("conference not found");
    }
    const copy = body.copy_from === undefined
      ? null
      : await planEventCopy(context.env.DB, body.copy_from, id, body.copy, now);
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
    const insertEvent = context.env.DB.prepare(
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
    );
    // The conference and everything copied into it commit together: a partly
    // copied conference is worse than none, because it looks finished.
    await context.env.DB.batch([insertEvent, ...(copy?.statements ?? [])]);
    return context.json({
      data: {
        ...await settingsFor(context.env.DB, id),
        ...(copy
          ? {
            copied: copy.counts,
            copied_from: body.copy_from ?? null,
            task_templates_skipped_fixed_due: copy.taskTemplatesSkippedFixedDue,
          }
          : {}),
      },
    }, 201);
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
    if (body.speaker_social_platforms !== undefined) {
      await writeEnabledSocialPlatforms(context.env.DB, eventId, body.speaker_social_platforms, now);
    }
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
  listEvents,
  createEvent,
  getCopyPlan,
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

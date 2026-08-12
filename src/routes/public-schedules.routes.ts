/**
 * The anonymous schedule API — the whole loop an agent can run for its human:
 * read the agenda, POST a set of sessions, hand back a link and a calendar
 * feed. No account, no key exchange, no browser required.
 *
 * Read is the code; write is the key. The code alone gets you the JSON, the
 * feed, and a share link; only the key that was returned once at creation can
 * change what the code points at.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { publicSessionCalendar } from "../lib/public-calendar";
import { clientIp } from "../api/rate-limit";
import {
  CODE_PATTERN,
  MAX_SESSIONS,
  checkScheduleCreateLimit,
  computeOverlaps,
  hashWriteKey,
  loadScheduleView,
  newScheduleCode,
  newWriteKey,
  readSchedule,
  resolveSessionIds,
  scheduleUrls,
  timingSafeEqual,
} from "../lib/public-schedules";
import { loadPublicAgenda } from "../lib/public-site";

const WRITE_KEY_HEADER = "X-Schedule-Write-Key";

/**
 * A session an attendee starred can be pulled from the programme while their
 * star sits in localStorage — routine at a live conference. The refusal names
 * the ids MACHINE-READABLY as well as in prose, so the caller (the site's own
 * module, or an agent) can drop exactly those and try again rather than being
 * told "something in your list is wrong" forever.
 */
function unknownSessions(eventSlug: string, unknown: readonly string[]): ApiError {
  return ApiError.unprocessable(
    `these sessions are not published on ${eventSlug}: ${unknown.slice(0, 10).join(", ")}`,
    "sessionIds",
    { unknownSessionIds: [...unknown] },
  );
}

const sessionIdList = z.array(z.string().min(1).max(240)).max(MAX_SESSIONS);
const createBody = z.object({
  eventSlug: z.string().min(1).max(120).optional(),
  event: z.string().min(1).max(120).optional(),
  sessionIds: sessionIdList.min(1),
});
const updateBody = z.object({ sessionIds: sessionIdList });
const codeParams = z.object({ code: z.string().regex(CODE_PATTERN) });
const schedulePayload = z.any();

/** One shape for every response that describes a schedule. */
async function scheduleResponse(database: Parameters<typeof readSchedule>[0], code: string, origin: string) {
  const row = await readSchedule(database, code);
  if (!row) throw ApiError.notFound("schedule not found");
  const view = await loadScheduleView(database, row);
  if (!view) throw ApiError.notFound("schedule not found");
  return {
    code: view.code,
    event: view.event,
    sessions: view.sessions,
    overlaps: view.overlaps,
    updatedAt: view.updatedAt,
    urls: scheduleUrls(view.code, view.event.slug, origin),
  };
}

const createPublicSchedule = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/schedules",
    operationId: "createPublicSchedule",
    summary: "Promote a set of published sessions to a shareable short code",
    description:
      "Anonymous. Returns the code, a write key shown exactly once, and every URL the code powers — share, sync, webcal, ics, json — so a caller never has to build one by hand. Session ids may be given as ids or slugs.",
    tags: ["Public"],
    request: { body: { content: { "application/json": { schema: createBody } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      201: jsonResponse(schedulePayload, "The new schedule code and its URLs"),
      ...errorResponses([400, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const limit = await checkScheduleCreateLimit(
      context.env.CACHE as unknown as Parameters<typeof checkScheduleCreateLimit>[0],
      clientIp(context.req.raw),
      Date.now(),
    );
    if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

    const body = context.req.valid("json");
    const agenda = await loadPublicAgenda(context.env.DB, {
      eventSlug: body.eventSlug ?? body.event,
      allDays: true,
    });
    if (!agenda) throw ApiError.notFound("public agenda not found");

    const { resolved, unknown } = resolveSessionIds(agenda.sessions, body.sessionIds);
    if (unknown.length > 0) throw unknownSessions(agenda.event.slug, unknown);

    const code = newScheduleCode();
    const writeKey = newWriteKey();
    const now = Date.now();
    await context.env.DB
      .prepare(
        `INSERT INTO public_schedules (code, event_id, session_ids, write_key_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(code, agenda.event.id, JSON.stringify(resolved), await hashWriteKey(writeKey), now, now)
      .run();

    const sessions = agenda.sessions
      .filter((session) => resolved.includes(session.id))
      .sort((left, right) => left.startsAt - right.startsAt || left.id.localeCompare(right.id));
    return context.json({
      code,
      // The one time this is ever readable. It is stored as a SHA-256 and
      // cannot be recovered — losing it means the schedule becomes read-only.
      writeKey,
      urls: scheduleUrls(code, agenda.event.slug, new URL(context.req.url).origin, writeKey),
      event: agenda.event,
      sessions,
      overlaps: computeOverlaps(sessions),
      updatedAt: now,
    }, 201);
  },
);

const getPublicSchedule = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/schedules/{code}",
    operationId: "getPublicSchedule",
    summary: "Read a schedule by its short code",
    description:
      "Anonymous. The set with full public session objects embedded and computed overlap pairs, so a caller gets the whole answer in one call and never re-derives interval maths.",
    tags: ["Public"],
    request: { params: codeParams },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(schedulePayload, "The schedule and its sessions"),
      ...errorResponses([400, 404, 429, 500]),
    },
  },
  async (context) => {
    const payload = await scheduleResponse(context.env.DB, context.req.valid("param").code, new URL(context.req.url).origin);
    context.header("Cache-Control", "no-store");
    return context.json(payload, 200);
  },
);

const updatePublicSchedule = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/public/schedules/{code}",
    operationId: "updatePublicSchedule",
    summary: "Replace the sessions a schedule points at",
    description:
      "Anonymous, but requires the write key returned once when the code was created, in the X-Schedule-Write-Key header. An empty list is legal: it means everything was unstarred.",
    tags: ["Public"],
    request: {
      params: codeParams,
      headers: z.object({ "x-schedule-write-key": z.string().min(1).max(200) }),
      body: { content: { "application/json": { schema: updateBody } } },
    },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(schedulePayload, "The updated schedule"),
      ...errorResponses([400, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const code = context.req.valid("param").code;
    const row = await readSchedule(context.env.DB, code);
    if (!row) throw ApiError.notFound("schedule not found");

    const presented = context.req.header(WRITE_KEY_HEADER) ?? "";
    if (!timingSafeEqual(await hashWriteKey(presented), row.write_key_hash)) {
      throw ApiError.forbidden("that write key does not open this schedule");
    }

    // Scoped to the code's own event: a schedule cannot be made to point at
    // sessions from a different conference by presenting their ids.
    const eventRow = await context.env.DB
      .prepare("SELECT slug FROM events WHERE id = ? LIMIT 1")
      .bind(row.event_id)
      .first<{ slug: string }>();
    const scoped = eventRow ? await loadPublicAgenda(context.env.DB, { eventSlug: eventRow.slug, allDays: true }) : null;
    if (!scoped) throw ApiError.notFound("public agenda not found");

    const { resolved, unknown } = resolveSessionIds(scoped.sessions, context.req.valid("json").sessionIds);
    if (unknown.length > 0) throw unknownSessions(scoped.event.slug, unknown);

    await context.env.DB
      .prepare("UPDATE public_schedules SET session_ids = ?, updated_at = ? WHERE code = ?")
      .bind(JSON.stringify(resolved), Date.now(), code)
      .run();

    const payload = await scheduleResponse(context.env.DB, code, new URL(context.req.url).origin);
    context.header("Cache-Control", "no-store");
    return context.json(payload, 200);
  },
);

/**
 * The live feed. `webcal://` is this same URL with a different scheme, which is
 * the whole reason the share mechanism is a server-side code rather than state
 * packed into a link: restar a session on a laptop and the phone's subscribed
 * calendar catches up on its own.
 *
 * The extension is on a static final segment — a documented `{code}.ics` would
 * register as a Hono parameter named "code.ics" that swallows the JSON route
 * beside it.
 */
const getPublicScheduleCalendar = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/schedules/{code}/calendar.ics",
    operationId: "getPublicScheduleCalendar",
    summary: "Subscribe to a schedule as a calendar feed",
    description: "Anonymous live VCALENDAR of the code's current set. The same URL under webcal:// is the subscription.",
    tags: ["Public"],
    request: { params: codeParams },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: { content: { "text/calendar": { schema: z.string() } }, description: "The schedule as a VCALENDAR" },
      ...errorResponses([400, 404, 429, 500]),
    },
  },
  async (context) => {
    const code = context.req.valid("param").code;
    const row = await readSchedule(context.env.DB, code);
    // An unknown code is a 404, never an empty calendar: a feed that answers
    // "here is your schedule: nothing" is indistinguishable from one that
    // works, and a subscriber would never learn the link was wrong.
    if (!row) throw ApiError.notFound("schedule not found");
    const view = await loadScheduleView(context.env.DB, row);
    if (!view) throw ApiError.notFound("schedule not found");

    const body = publicSessionCalendar({
      calendarName: `My ${view.event.name} schedule`,
      event: view.event,
      now: Date.now(),
      origin: new URL(context.req.url).origin,
      sessions: view.sessions,
    });
    return context.body(body, 200, {
      // Short, because the point of the feed is that it changes.
      "Cache-Control": "public, max-age=60",
      "Content-Disposition": `inline; filename="${code}.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
    }) as never;
  },
);

export const apiRoutes = [
  createPublicSchedule,
  getPublicSchedule,
  updatePublicSchedule,
  getPublicScheduleCalendar,
];

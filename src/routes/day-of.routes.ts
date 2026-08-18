/**
 * The day of the show, as operations.
 *
 * Three surfaces read from here — the green room on a crew phone, the
 * volunteer's check-in link, the organizer's slides board — and so does any
 * agent or CLI caller, because they are the same operations. Nothing on this
 * day is UI-only: the run of show is a GET, an arrival is a POST, and taking a
 * mark back is a DELETE.
 *
 * Two doors reach the writes. An organizer arrives with a session or a scoped
 * token and is authorized the ordinary way. A volunteer arrives holding a
 * named link and nothing else — no account, no person row, no seat — and the
 * link IS their standing. That second door is why the arrival routes declare a
 * `public` policy and do their own authorization: the pipeline's principals
 * are people and tokens, and this credential is deliberately neither.
 *
 * What the link door cannot do is the part worth stating: it is accepted on
 * these arrival routes and nowhere else in the product, it is checked against
 * the conference in the path, and only the `checkin` kind may write at all.
 */
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { DAY_OF_LINK_KINDS } from "../db/schema";
import { auditStatement } from "../lib/audit";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole, tokenHasGrant } from "../lib/auth/scope-resolution";
import {
  markArrival,
  speaksAtSession,
  unmarkArrival,
  type DayOfWriteActor,
} from "../lib/day-of/checkins";
import {
  canMarkArrivals,
  dayOfLinkPath,
  listDayOfLinks,
  mintDayOfLink,
  resolveDayOfLink,
  revokeAllDayOfLinksStatement,
  revokeDayOfLinkStatement,
  summarizeDayOfLink,
} from "../lib/day-of/links";
import { readRunOfShow, readRunOfShowEvent } from "../lib/day-of/run-of-show";
import { slidesBoard, SLIDES_BOARD_STATES } from "../lib/day-of/slides-board";

/** The header a link-holding client presents. Never a query parameter: URLs are logged. */
export const DAY_OF_KEY_HEADER = "x-marquee-day-of-key";

const eventParams = z.object({ eventId: z.string().min(1) });
const itemParams = eventParams.extend({ itemId: z.string().min(1) });
const arrivalParams = itemParams.extend({ personId: z.string().min(1) });
const linkParams = eventParams.extend({ linkId: z.string().min(1) });

const dayQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .openapi({ description: "A conference-local calendar day. Defaults to the conference's own today." }),
});
const slidesQuery = dayQuery.extend({
  room_id: z.string().trim().min(1).optional(),
  state: z.enum(SLIDES_BOARD_STATES).default("all"),
});

const linkSummary = z.object({
  id: z.string(),
  kind: z.enum(DAY_OF_LINK_KINDS),
  name: z.string(),
  created_at: z.number(),
  created_by_person_id: z.string().nullable(),
  last_used_at: z.number().nullable(),
  revoked_at: z.number().nullable(),
}).openapi("DayOfLink");

const linkListResponse = z.object({ data: z.array(linkSummary) });
const linkCreateResponse = z.object({
  data: linkSummary,
  /** The path is returned once, with the token in it. It is never readable again. */
  url: z.string(),
});
const arrivalResponse = z.object({
  data: z.object({
    agenda_item_id: z.string(),
    person_id: z.string(),
    arrived_at: z.number().nullable(),
    marked_by_name: z.string().nullable(),
    changed: z.boolean(),
  }),
});

const linkInput = z.object({
  kind: z.enum(DAY_OF_LINK_KINDS),
  name: z.string().trim().min(1).max(120),
}).strict();
const arrivalInput = z.object({ person_id: z.string().trim().min(1) }).strict();

async function requireEvent(context: Context<ApiEnv>, eventId: string) {
  const event = await readRunOfShowEvent(context.env.DB, eventId);
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

/**
 * Day-of administration is an ops act: minting a credential that opens the
 * whole run of show, and killing one. A speaker's own seat does not reach it.
 */
function requireDayOfAdmin(context: Context<ApiEnv>, eventId: string) {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (!authHasRole(auth, "ops", eventId)) {
    throw ApiError.forbidden("day-of links require an ops role at this conference");
  }
  return auth;
}

/**
 * Who is making this write, in the terms the audit log records.
 *
 * A link-held write has no person behind it, so it is recorded as a system
 * actor carrying the link's id and name — which is the honest answer to "who
 * marked this": a post, not a human. The name is copied onto the check-in row
 * too, so the green room can say "Sam, front door · 08:41" without a join to a
 * credential that may later be revoked.
 *
 * A wrong, revoked, or other-conference key is refused as `not found`, the same
 * answer the page above gives. Telling a holder that their key is real but
 * scoped elsewhere is information they have no use for and an attacker does.
 */
async function dayOfWriteActor(
  context: Context<ApiEnv>,
  eventId: string,
): Promise<DayOfWriteActor> {
  const requestId = context.get("requestId") ?? null;
  const key = context.req.header(DAY_OF_KEY_HEADER);
  if (key !== undefined && key.length > 0) {
    const link = await resolveDayOfLink(context.env.DB, key);
    if (!link || link.event_id !== eventId || !canMarkArrivals(link)) {
      throw ApiError.notFound("that link does not open this conference");
    }
    return {
      actorKind: "system",
      actorPersonId: null,
      name: link.name,
      linkId: link.id,
      requestId,
    };
  }
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (!authHasRole(auth, "ops", eventId)) {
    throw ApiError.forbidden("marking arrivals requires an ops role or a check-in link");
  }
  if (auth.kind === "token" && !tokenHasGrant(auth, "speaker:write", eventId)) {
    throw ApiError.forbidden("marking arrivals requires the speaker:write grant");
  }
  const personId = auth.kind === "session" ? auth.personId : auth.actingPersonId;
  const name = personId === null
    ? "API token"
    : (await context.env.DB.prepare("SELECT name FROM people WHERE id = ?").bind(personId).first<{ name: string }>())?.name
      ?? "An organizer";
  return {
    actorKind: auth.kind === "session" ? "user" : "api_token",
    actorPersonId: personId,
    name,
    linkId: null,
    requestId,
  };
}

const getRunOfShow = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/run-of-show",
    operationId: "getRunOfShow",
    summary: "Read one day of the conference as it will be run",
    description:
      "Every room with something on it that day, each session in start order with its speakers, who has been marked arrived and by whom, the state of that session's slides, and the room's AV and day-of notes. Defaults to the conference's own today, falling back to the first day when the conference is not running.",
    tags: ["Day of"],
    request: { params: eventParams, query: dayQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.unknown() }), "Run of show"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const { day } = context.req.valid("query");
    const event = await requireEvent(context, eventId);
    return context.json({ data: await readRunOfShow(context.env.DB, event, { day }) }, 200);
  },
);

const getSlidesBoard = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/slides-board",
    operationId: "getSlidesBoard",
    summary: "Read the slides readiness board for one day",
    description:
      "One row per scheduled session in start order: what the session is, who is on it, and whether the deck is in. Counts are taken before the state filter, so a count always matches the set that clicking it produces. A session nobody was asked for a deck for says so rather than reading as missing.",
    tags: ["Day of"],
    request: { params: eventParams, query: slidesQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: z.unknown() }), "Slides readiness board"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    const event = await requireEvent(context, eventId);
    const runOfShow = await readRunOfShow(context.env.DB, event, { day: query.day });
    return context.json({ data: slidesBoard(runOfShow, { roomId: query.room_id, state: query.state }) }, 200);
  },
);

const listLinks = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/day-of/links",
    operationId: "listDayOfLinks",
    summary: "List the day-of links for a conference",
    description: "Names, kinds, and when each was last used. Revoked links stay listed — what happened to a credential is part of its record. The token itself is never readable again.",
    tags: ["Day of"],
    request: { params: eventParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(linkListResponse, "Day-of link metadata"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireDayOfAdmin(context, eventId);
    await requireEvent(context, eventId);
    const rows = await listDayOfLinks(context.env.DB, eventId);
    return context.json({ data: rows.map(summarizeDayOfLink) }, 200);
  },
);

const createLink = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/day-of/links",
    operationId: "createDayOfLink",
    summary: "Mint a named day-of link",
    description:
      "A `checkin` link is one volunteer's standing — it opens the run of show and may mark speakers arrived. A `green_room` link only looks, and there is one at a time: minting another rotates it, which revokes every copy of the previous URL. The token is in the returned path and is never readable again.",
    tags: ["Day of"],
    request: { params: eventParams, body: { content: { "application/json": { schema: linkInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(linkCreateResponse, "The link is shown once"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const auth = requireDayOfAdmin(context, eventId);
    await requireEvent(context, eventId);
    const body = context.req.valid("json");
    const now = Date.now();
    const actorPersonId = auth.kind === "session" ? auth.personId : auth.actingPersonId;
    const requestId = context.get("requestId") ?? null;
    // Rotation is the whole point of the share link, so it happens before the
    // mint and in the same breath: an organizer who rotates has to be able to
    // say the old URL is dead, and a mint that leaves its predecessor alive has
    // revoked nothing.
    if (body.kind === "green_room") {
      await context.env.DB.batch([
        auditStatement(context.env.DB, {
          eventId,
          actorKind: auth.kind === "session" ? "user" : "api_token",
          actorPersonId,
          action: "day_of_link_rotated",
          entityType: "day_of_link",
          entityId: eventId,
          after: { kind: body.kind, name: body.name },
          now,
          requestId,
        }),
        revokeAllDayOfLinksStatement(context.env.DB, { eventId, kind: "green_room", now }),
      ]);
    }
    const minted = await mintDayOfLink(context.env.DB, {
      eventId,
      kind: body.kind,
      name: body.name,
      createdByPersonId: actorPersonId,
      now,
    });
    await context.env.DB.batch([
      auditStatement(context.env.DB, {
        eventId,
        actorKind: auth.kind === "session" ? "user" : "api_token",
        actorPersonId,
        action: "day_of_link_created",
        entityType: "day_of_link",
        entityId: minted.id,
        after: { kind: body.kind, name: body.name },
        now,
        requestId,
      }),
    ]);
    return context.json(
      { data: summarizeDayOfLink(minted.row), url: dayOfLinkPath(minted.token) },
      201,
    );
  },
);

const revokeLink = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/day-of/links/{linkId}",
    operationId: "revokeDayOfLink",
    summary: "Revoke a day-of link",
    description: "Takes effect on the next request the holder makes, and on every copy of the URL at once. Revoking an already-revoked link changes nothing and records nothing.",
    tags: ["Day of"],
    request: { params: linkParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: linkSummary }), "Revoked link metadata"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, linkId } = context.req.valid("param");
    const auth = requireDayOfAdmin(context, eventId);
    const existing = await context.env.DB
      .prepare("SELECT * FROM day_of_links WHERE id = ? AND event_id = ?")
      .bind(linkId, eventId)
      .first<import("../db/schema").DayOfLinkRow>();
    if (!existing) throw ApiError.notFound("day-of link not found");
    const now = Date.now();
    if (existing.revoked_at === null) {
      await context.env.DB.batch([
        auditStatement(context.env.DB, {
          eventId,
          actorKind: auth.kind === "session" ? "user" : "api_token",
          actorPersonId: auth.kind === "session" ? auth.personId : auth.actingPersonId,
          action: "day_of_link_revoked",
          entityType: "day_of_link",
          entityId: linkId,
          before: { kind: existing.kind, name: existing.name },
          now,
          requestId: context.get("requestId") ?? null,
        }),
        revokeDayOfLinkStatement(context.env.DB, { linkId, eventId, now }),
      ]);
    }
    const revoked = await context.env.DB
      .prepare("SELECT * FROM day_of_links WHERE id = ?")
      .bind(linkId)
      .first<import("../db/schema").DayOfLinkRow>();
    if (!revoked) throw new Error("revoked_day_of_link_disappeared");
    return context.json({ data: summarizeDayOfLink(revoked) }, 200);
  },
);

const markArrivalRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/agenda-items/{itemId}/arrivals",
    operationId: "markSpeakerArrived",
    summary: "Mark a speaker arrived for one session",
    description:
      "The grain is one speaker on one session, so a panel of four reads honestly. Marking twice is the same as marking once — the second request changes nothing and records nothing. Authorized either by an ops session or scoped token, or by a named check-in link presented in the `x-marquee-day-of-key` header; that link is accepted here and on the matching delete, and on no other route.",
    tags: ["Day of"],
    request: { params: itemParams, body: { content: { "application/json": { schema: arrivalInput } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(arrivalResponse, "The arrival as it now stands"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, itemId } = context.req.valid("param");
    const body = context.req.valid("json");
    const actor = await dayOfWriteActor(context, eventId);
    const target = { eventId, agendaItemId: itemId, personId: body.person_id };
    if (!(await speaksAtSession(context.env.DB, target))) {
      throw ApiError.notFound("that speaker is not on this session");
    }
    const result = await markArrival(context.env.DB, target, actor, Date.now());
    return context.json({
      data: {
        agenda_item_id: itemId,
        person_id: body.person_id,
        arrived_at: result.checkin?.marked_at ?? null,
        marked_by_name: result.checkin?.marked_by_name ?? null,
        changed: result.changed,
      },
    }, 200);
  },
);

const clearArrivalRoute = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/agenda-items/{itemId}/arrivals/{personId}",
    operationId: "clearSpeakerArrival",
    summary: "Take back an arrival mark",
    description: "Removes the mark and records who removed it. A mark that was never there is not an error — the answer is the same either way.",
    tags: ["Day of"],
    request: { params: arrivalParams },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(arrivalResponse, "The arrival as it now stands"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, itemId, personId } = context.req.valid("param");
    const actor = await dayOfWriteActor(context, eventId);
    const result = await unmarkArrival(
      context.env.DB,
      { eventId, agendaItemId: itemId, personId },
      actor,
      Date.now(),
    );
    return context.json({
      data: {
        agenda_item_id: itemId,
        person_id: personId,
        arrived_at: null,
        marked_by_name: null,
        changed: result.changed,
      },
    }, 200);
  },
);

export const apiRoutes = [
  getRunOfShow,
  getSlidesBoard,
  listLinks,
  createLink,
  revokeLink,
  markArrivalRoute,
  clearArrivalRoute,
];

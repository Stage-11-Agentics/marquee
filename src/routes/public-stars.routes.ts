/**
 * The anonymous star beacon — one endpoint, both directions.
 *
 * A star is a demand signal an organizer can act on weeks before the doors
 * open: which sessions are going to overflow their room. It costs the attendee
 * nothing to give, because there is nothing in it to give away — a random
 * handle the browser minted for itself, and a session id.
 *
 * `starred` is a field rather than two verbs because the write is idempotent
 * in both directions and a caller re-syncing its whole set should not have to
 * reason about which requests are creates and which are deletes.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { clientIp } from "../api/rate-limit";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { DEVICE_HASH_PATTERN, checkStarBeaconLimit, writeStarBeacon } from "../lib/star-beacons";
import { loadPublicAgenda } from "../lib/public-site";

const starBody = z.object({
  eventSlug: z.string().min(1).max(120).optional(),
  event: z.string().min(1).max(120).optional(),
  sessionId: z.string().min(1).max(240).describe("A published session's id or slug."),
  deviceHash: z.string().regex(DEVICE_HASH_PATTERN)
    .describe("A random handle this browser minted for itself. Not a person, not derived from one."),
  starred: z.boolean().describe("true records the star, false removes it. Either is idempotent."),
});

const starResponse = z.object({
  sessionId: z.string(),
  starred: z.boolean(),
}).openapi("PublicStarBeaconResult");

const recordStarBeacon = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/stars",
    operationId: "recordPublicStarBeacon",
    summary: "Record or remove one device's star on a published session",
    description:
      "Anonymous. Feeds the organizer's advance-demand signal and nothing else: the row is (event, session, device) and carries no person. Idempotent in both directions — starring twice is starring once. Session ids may be given as ids or slugs.",
    tags: ["Public"],
    request: { body: { content: { "application/json": { schema: starBody } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(starResponse, "The star as it now stands"),
      ...errorResponses([400, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const body = context.req.valid("json");
    const limit = await checkStarBeaconLimit(
      context.env.CACHE as unknown as Parameters<typeof checkStarBeaconLimit>[0],
      { clientIp: clientIp(context.req.raw), deviceHash: body.deviceHash, now: Date.now() },
    );
    if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

    const agenda = await loadPublicAgenda(context.env.DB, {
      eventSlug: body.eventSlug ?? body.event,
      allDays: true,
    });
    if (!agenda) throw ApiError.notFound("public agenda not found");
    const session = agenda.sessions.find(
      (candidate) => candidate.id === body.sessionId || candidate.slug === body.sessionId,
    );
    // A star on something that is not published would be a count nobody can
    // read back, so it is refused by name rather than absorbed.
    if (!session) {
      throw ApiError.unprocessable(
        `this session is not published on ${agenda.event.slug}: ${body.sessionId}`,
        "sessionId",
        { unknownSessionIds: [body.sessionId] },
      );
    }

    await writeStarBeacon(context.env.DB, {
      eventId: agenda.event.id,
      sessionId: session.id,
      deviceHash: body.deviceHash,
      starred: body.starred,
      now: Date.now(),
    });
    context.header("Cache-Control", "no-store");
    return context.json({ sessionId: session.id, starred: body.starred }, 200);
  },
);

export const apiRoutes = [recordStarBeacon];

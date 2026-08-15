import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { getOnboardingSpeaker, listOnboarding, ONBOARDING_FILTERS } from "./onboarding.queries";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";

const eventParams = z.object({ eventId: z.string().min(1) });
const speakerParams = eventParams.extend({ personId: z.string().min(1) });
const onboardingQuery = z.object({
  filter: z.enum(ONBOARDING_FILTERS).default("all"),
  task_type: z.string().trim().min(1).max(100).optional(),
  track: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

const listOnboardingRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/onboarding",
    operationId: "getOnboardingBoard",
    summary: "Read the speaker onboarding chase board",
    description: "Returns the accepted-speaker task projection, live counts, facets, and state glyphs used by the organizer chase board.",
    tags: ["Speaker onboarding"],
    request: { params: eventParams, query: onboardingQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Onboarding board snapshot"), ...errorResponses([400, 401, 403, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    return context.json(await listOnboarding(context.env.DB, eventId, {
      filter: query.filter,
      taskType: query.task_type,
      track: query.track,
      search: query.q,
      page: query.page,
      perPage: query.per_page,
    }), 200);
  },
);

const getOnboardingSpeakerRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/onboarding/speakers/{personId}",
    operationId: "getOnboardingSpeaker",
    summary: "Read a speaker's onboarding context",
    description: "Returns the speaker profile, tasks, accepted Sessions, and rendered outbox message history for the chase drawer.",
    tags: ["Speaker onboarding"],
    request: { params: speakerParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Speaker onboarding context"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const mediaEnv = context.env as unknown as { MEDIA_PUBLIC_ORIGIN?: string; UPLOAD_TOKEN_SECRET: string };
    const detail = await getOnboardingSpeaker(context.env.DB, eventId, personId, Date.now(), mediaEnv.MEDIA_PUBLIC_ORIGIN ?? "", mediaEnv.UPLOAD_TOKEN_SECRET);
    if (!detail) throw ApiError.notFound("speaker not found");
    return context.json(detail, 200);
  },
);

export const apiRoutes = [getOnboardingSpeakerRoute, listOnboardingRoute];

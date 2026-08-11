import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  loadPublicAgenda,
  loadPublicEmbed,
  loadPublicSession,
  loadPublicSpeaker,
  publicEmbedCacheKey,
  readPublicEmbedCache,
  resolvePublicEmbed,
  writePublicEmbedCache,
} from "../lib/public-site";

const publicQuery = z.object({
  event: z.string().min(1).max(120).optional(),
  event_slug: z.string().min(1).max(120).optional(),
  day: z.string().min(1).max(40).optional(),
  track: z.string().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  status: z.string().min(1).max(40).optional(),
  accent: z.string().regex(/^#[0-9a-f]{3,8}$/i).optional(),
  layout: z.enum(["cards", "list"]).optional(),
});

const publicPayload = z.any();
const publicSlugParams = z.object({ slug: z.string().min(1).max(240) });

const getPublicAgenda = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/agenda",
    operationId: "getPublicAgenda",
    summary: "Read the published public agenda",
    description: "Anonymous published-only agenda data with day, track, and search filters.",
    tags: ["Public"],
    request: { query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(publicPayload, "Published agenda"), ...errorResponses([404, 429, 500]) },
  },
  async (context) => {
    const query = context.req.valid("query");
    const data = await loadPublicAgenda(context.env.DB, {
      eventSlug: query.event ?? query.event_slug,
      day: query.day,
      track: query.track,
      q: query.q,
      status: query.status,
    });
    if (!data) throw ApiError.notFound("public agenda not found");
    return context.json(data, 200);
  },
);

const getPublicSession = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/sessions/{slug}",
    operationId: "getPublicSession",
    summary: "Read a published session permalink",
    tags: ["Public"],
    request: { params: publicSlugParams, query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(publicPayload, "Published session"), ...errorResponses([404, 429, 500]) },
  },
  async (context) => {
    const query = context.req.valid("query");
    const result = await loadPublicSession(
      context.env.DB,
      context.req.valid("param").slug,
      query.event ?? query.event_slug,
    );
    if (!result) throw ApiError.notFound("public session not found");
    return context.json(result, 200);
  },
);

const getPublicSpeaker = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/speakers/{slug}",
    operationId: "getPublicSpeaker",
    summary: "Read a speaker attached to a published session",
    tags: ["Public"],
    request: { params: publicSlugParams, query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(publicPayload, "Published speaker"), ...errorResponses([404, 429, 500]) },
  },
  async (context) => {
    const query = context.req.valid("query");
    const result = await loadPublicSpeaker(
      context.env.DB,
      context.req.valid("param").slug,
      query.event ?? query.event_slug,
    );
    if (!result) throw ApiError.notFound("public speaker not found");
    return context.json(result, 200);
  },
);

const getPublicEmbed = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/embeds/{slug}",
    operationId: "getPublicEmbed",
    summary: "Read a published agenda or speaker embed",
    description: "Anonymous-only, identity-free embed data with published-only track/status filtering.",
    tags: ["Public"],
    request: { params: publicSlugParams, query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(publicPayload, "Published embed"), ...errorResponses([404, 429, 500]) },
  },
  async (context) => {
    const query = context.req.valid("query");
    const slug = context.req.valid("param").slug;
    const resolved = await resolvePublicEmbed(context.env.DB, {
      slug,
      eventSlug: query.event ?? query.event_slug,
    });
    if (!resolved) throw ApiError.notFound("public embed not found");
    const filters = { track: query.track ?? null, status: query.status ?? null, accent: query.accent ?? null, layout: query.layout ?? null };
    const key = publicEmbedCacheKey(resolved.event.id, resolved.slug, filters);
    const cached = await readPublicEmbedCache(context.env.CACHE, key);
    if (cached) {
      context.header("Cache-Control", "public, max-age=30, s-maxage=30");
      return context.json(cached, 200);
    }
    const data = await loadPublicEmbed(context.env.DB, resolved, filters);
    await writePublicEmbedCache(context.env.CACHE, key, data);
    context.header("Cache-Control", "public, max-age=30, s-maxage=30");
    return context.json(data, 200);
  },
);

export const apiRoutes = [getPublicAgenda, getPublicSession, getPublicSpeaker, getPublicEmbed];

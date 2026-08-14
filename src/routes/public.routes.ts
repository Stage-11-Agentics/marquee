import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { publicSessionCalendar } from "../lib/public-calendar";
import { buildPublicXml } from "../lib/public-xml";
import {
  loadPublicAgenda,
  loadPublicEmbed,
  loadPublicSession,
  loadPublicSpeaker,
  publicEmbedPayload,
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
  format: z.string().min(1).max(120).optional(),
  room: z.string().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  status: z.string().min(1).max(40).optional(),
  accent: z.string().regex(/^#[0-9a-f]{3,8}$/i).optional(),
  layout: z.enum(["cards", "list"]).optional(),
  fields: z.string().max(300).optional(),
  preview: z.string().max(20).optional(),
});

const publicPayload = z.any();
const publicSlugParams = z.object({ slug: z.string().min(1).max(240) });

const getPublicAgenda = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/agenda",
    operationId: "getPublicAgenda",
    summary: "Read the published public agenda",
    description: "Anonymous published-only agenda data; omitted day and day=all return the whole program, while day, track, format, location, and search filter it.",
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
      format: query.format,
      room: query.room,
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

/**
 * The extension sits on a STATIC final segment, not on the parameter.
 * `{slug}.ics` would be registered as the Hono pattern `:slug.ics`, which is a
 * parameter literally named `slug.ics` that matches any single segment — it
 * would shadow `GET /api/v1/public/sessions/{slug}` above and fail its own
 * parameter validation. `/{slug}/calendar.ics` is unambiguous, and calendar
 * clients still get the extension they sniff for.
 */
const getPublicSessionCalendar = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/sessions/{slug}/calendar.ics",
    operationId: "getPublicSessionCalendar",
    summary: "Download a published session as a calendar file",
    description: "Anonymous single-session VCALENDAR (METHOD:PUBLISH) for the published session permalink.",
    tags: ["Public"],
    request: { params: publicSlugParams, query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: { content: { "text/calendar": { schema: z.string() } }, description: "The session as a VCALENDAR" },
      ...errorResponses([404, 429, 500]),
    },
  },
  async (context) => {
    const query = context.req.valid("query");
    const result = await loadPublicSession(
      context.env.DB,
      context.req.valid("param").slug,
      query.event ?? query.event_slug,
    );
    if (!result) throw ApiError.notFound("public session not found");
    const body = publicSessionCalendar({
      calendarName: result.session.title,
      event: result.event,
      now: Date.now(),
      origin: new URL(context.req.url).origin,
      sessions: [result.session],
    });
    return context.body(body, 200, {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.session.slug)}.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
    }) as never;
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
    const filters = {
      track: query.track ?? null,
      format: query.format ?? null,
      room: query.room ?? null,
      status: query.status ?? null,
      accent: query.accent ?? null,
      layout: query.layout ?? null,
      fields: query.fields ?? null,
    };
    const key = publicEmbedCacheKey(resolved.event.id, resolved.slug, filters);
    const cached = await readPublicEmbedCache(context.env.CACHE, key);
    if (cached) {
      context.header("Cache-Control", "public, max-age=30, s-maxage=30");
      return context.json(cached, 200);
    }
    const data = await loadPublicEmbed(context.env.DB, resolved, filters);
    await writePublicEmbedCache(context.env.CACHE, key, data);
    context.header("Cache-Control", "public, max-age=30, s-maxage=30");
    return context.json(publicEmbedPayload(data), 200);
  },
);

const getPublicEmbedXml = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/embeds/{slug}/xml",
    operationId: "getPublicEmbedXml",
    summary: "Read a published embed as XML",
    description: "Anonymous-only XML representation of a published embed with the selected fields.",
    tags: ["Public"],
    request: { params: publicSlugParams, query: publicQuery },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: { content: { "application/xml": { schema: z.string() } }, description: "Published embed XML" },
      ...errorResponses([404, 429, 500]),
    },
  },
  async (context) => {
    const query = context.req.valid("query");
    const slug = context.req.valid("param").slug;
    const resolved = await resolvePublicEmbed(context.env.DB, {
      slug,
      eventSlug: query.event ?? query.event_slug,
    });
    if (!resolved) throw ApiError.notFound("public embed not found");
    const filters = {
      track: query.track ?? null,
      format: query.format ?? null,
      room: query.room ?? null,
      status: query.status ?? null,
      accent: query.accent ?? null,
      layout: query.layout ?? null,
      fields: query.fields ?? null,
    };
    const key = publicEmbedCacheKey(resolved.event.id, resolved.slug, filters);
    const cached = await readPublicEmbedCache(context.env.CACHE, key);
    const data = cached ?? await loadPublicEmbed(context.env.DB, resolved, filters);
    if (!cached) await writePublicEmbedCache(context.env.CACHE, key, data);
    return context.body(buildPublicXml(data), 200, {
      "Cache-Control": "public, max-age=30, s-maxage=30",
      "Content-Type": "application/xml; charset=utf-8",
    }) as never;
  },
);

export const apiRoutes = [
  getPublicAgenda,
  getPublicSession,
  getPublicSessionCalendar,
  getPublicSpeaker,
  getPublicEmbed,
  getPublicEmbedXml,
];

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { getAuth } from "../lib/auth/auth-middleware";
import { enqueueAuthMail, renderPortalInviteMail } from "../lib/auth/auth-mail";
import { mintPortalMagicLink } from "../lib/auth/magic-links";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../jobs/mail/idempotency";
import {
  addSpeakerHelper,
  listSpeakerHelpers,
  normalizeHelperEmail,
  normalizeHelperName,
  removeSpeakerHelper,
  type SpeakerHelperView,
} from "../lib/speaker-helpers";

const eventParams = z.object({ eventId: z.string().min(1) });
const speakerParams = eventParams.extend({ personId: z.string().min(1) });
const helperParams = speakerParams.extend({ helperId: z.string().min(1) });
const helperQuery = z.object({ eventId: z.string().min(1) });
const helperBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
}).strict();

const helperSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  speaker_person_id: z.string(),
  speaker_name: z.string(),
  helper_person_id: z.string(),
  helper_name: z.string(),
  helper_email: z.string(),
  added_at: z.number(),
  removed_at: z.number().nullable(),
});
const helperResponseSchema = z.object({ helper: helperSchema, invite: z.object({ outbox_id: z.string(), magic_link: z.string().optional() }).optional() });
const helperListSchema = z.object({ helpers: z.array(helperSchema) });

function sessionPersonId(context: import("hono").Context<ApiEnv>): string {
  const auth = getAuth(context);
  if (!auth || auth.kind !== "session") throw ApiError.forbidden("helper changes require a browser session");
  return auth.personId;
}

async function actorPersonId(context: import("hono").Context<ApiEnv>): Promise<string> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return auth.personId;
  const row = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId).first<{ created_by: string }>();
  if (!row?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return row.created_by;
}

function publicHelper(helper: SpeakerHelperView) {
  return helper;
}

async function queueHelperInvite(
  context: import("hono").Context<ApiEnv>,
  helper: SpeakerHelperView,
): Promise<{ outbox_id: string; magic_link?: string }> {
  const event = await context.env.DB.prepare("SELECT demo_mode FROM events WHERE id = ?")
    .bind(helper.event_id).first<{ demo_mode: number }>();
  if (!event) throw ApiError.notFound("conference not found");
  const link = await mintPortalMagicLink(context.env.DB, {
    personId: helper.helper_person_id,
    eventId: helper.event_id,
    redirectTo: `/portal?eventId=${encodeURIComponent(helper.event_id)}`,
    now: Date.now(),
  });
  const origin = new URL(context.req.url).origin;
  const magicLink = `${origin}/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`;
  const mail = renderPortalInviteMail(magicLink);
  const outboxId = await enqueueAuthMail(context.env.DB, {
    eventId: helper.event_id,
    personId: helper.helper_person_id,
    toEmail: normalizeHelperEmail(helper.helper_email),
    templateKey: "portal_invite",
    entityId: IDEMPOTENCY_REGISTRY.authLink(link.id),
    ...mail,
    now: Date.now(),
  });
  await enqueueMailMessage(context.env.MAIL_QUEUE, outboxId);
  return { outbox_id: outboxId, ...(event.demo_mode === 1 ? { magic_link: magicLink } : {}) };
}

const listOwnHelpers = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/helpers",
    operationId: "listSpeakerHelpers",
    summary: "List the authenticated speaker's helpers",
    description: "Returns active event-scoped helper relationships using the names the speaker entered.",
    tags: ["Speaker portal"],
    request: { query: helperQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(helperListSchema, "Speaker helpers"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const personId = sessionPersonId(context);
    const { eventId } = context.req.valid("query");
    return context.json({ helpers: await listSpeakerHelpers(context.env.DB, eventId, [personId]) }, 200);
  },
);

async function addForSpeaker(context: import("hono").Context<ApiEnv>, eventId: string, speakerPersonId: string, body: z.infer<typeof helperBody>) {
  const auth = getAuth(context);
  const actor = await actorPersonId(context);
  if (auth?.kind === "session" && auth.personId !== speakerPersonId) {
    throw ApiError.forbidden("a speaker may add helpers only for their own seat");
  }
  const helper = await addSpeakerHelper(context.env.DB, {
    eventId,
    speakerPersonId,
    helperName: normalizeHelperName(body.name),
    helperEmail: normalizeHelperEmail(body.email),
    actorKind: auth?.kind === "token" ? "api_token" : "user",
    actorPersonId: actor,
    requestId: context.get("requestId") ?? null,
  });
  const invite = await queueHelperInvite(context, helper);
  return context.json({ helper: publicHelper(helper), invite }, 200);
}

const addOwnHelper = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/helpers",
    operationId: "addSpeakerHelper",
    summary: "Invite a helper for the authenticated speaker",
    description: "Finds or creates the organization person, records the event-scoped helper seat, and queues the existing reusable portal invite.",
    tags: ["Speaker portal"],
    request: { query: eventQueryRequired(), body: { content: { "application/json": { schema: helperBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(helperResponseSchema, "Helper invited"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const personId = sessionPersonId(context);
    return addForSpeaker(context, context.req.valid("query").eventId, personId, context.req.valid("json"));
  },
);

const listEventHelpers = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/speakers/{personId}/helpers",
    operationId: "listEventSpeakerHelpers",
    summary: "List helpers for one speaker",
    description: "Organizer-facing helper list; helper_name remains the name typed into the relationship.",
    tags: ["Speakers"],
    request: { params: speakerParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(helperListSchema, "Speaker helper list"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const helpers = await listSpeakerHelpers(context.env.DB, eventId, [personId]);
    return context.json({ helpers }, 200);
  },
);

const addEventHelper = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/speakers/{personId}/helpers",
    operationId: "addEventSpeakerHelper",
    summary: "Invite a helper for a speaker",
    description: "Organizer-side parity for the speaker helper relationship and portal invitation.",
    tags: ["Speakers"],
    request: { params: speakerParams, body: { content: { "application/json": { schema: helperBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(helperResponseSchema, "Helper invited"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    return addForSpeaker(context, eventId, personId, context.req.valid("json"));
  },
);

const removeOwnHelper = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/me/helpers/{helperId}",
    operationId: "removeSpeakerHelper",
    summary: "Remove one helper from the authenticated speaker seat",
    description: "Timestamps the relationship inactive and consumes this event's reusable invite when the helper has no other standing here.",
    tags: ["Speaker portal"],
    request: { params: z.object({ helperId: z.string().min(1) }), query: eventQueryRequired() },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ helper: helperSchema }), "Helper removed"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const personId = sessionPersonId(context);
    const auth = getAuth(context);
    const removed = await removeSpeakerHelper(context.env.DB, {
      eventId: context.req.valid("query").eventId,
      speakerPersonId: personId,
      helperPersonId: context.req.valid("param").helperId,
      actorKind: "user",
      actorPersonId: personId,
      requestId: context.get("requestId") ?? null,
    });
    void auth;
    return context.json({ helper: removed }, 200);
  },
);

const removeEventHelper = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/speakers/{personId}/helpers/{helperId}",
    operationId: "removeEventSpeakerHelper",
    summary: "Remove a helper from a speaker record",
    description: "Organizer removal uses the same event-scoped revocation and keeps the relationship row as history.",
    tags: ["Speakers"],
    request: { params: helperParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ helper: helperSchema }), "Helper removed"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId, helperId } = context.req.valid("param");
    const auth = getAuth(context);
    const removed = await removeSpeakerHelper(context.env.DB, {
      eventId,
      speakerPersonId: personId,
      helperPersonId: helperId,
      actorKind: auth?.kind === "token" ? "api_token" : "user",
      actorPersonId: await actorPersonId(context),
      requestId: context.get("requestId") ?? null,
    });
    return context.json({ helper: removed }, 200);
  },
);

function eventQueryRequired() {
  return z.object({ eventId: z.string().min(1) });
}

export const apiRoutes = [listOwnHelpers, addOwnHelper, listEventHelpers, addEventHelper, removeOwnHelper, removeEventHelper];

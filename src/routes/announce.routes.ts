import { z } from "@hono/zod-openapi";

import { BULK_ID_LIMIT } from "../api/bulk";
import { ApiError } from "../api/errors";
import { decisionPlanResponseSchema } from "../api/decision-plan";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import {
  applyAnnounceMail,
  buildAnnouncePlan,
} from "../jobs/cascade/decision-plan-service";
import { readAnnounceSnapshot } from "./announce.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const announceSpeakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  do_not_contact: z.boolean(),
  public_link: z.string(),
  talk_title: z.string(),
  talk_titles: z.array(z.string()),
  talk_summary: z.string(),
});
const announceSnapshotSchema = z.object({
  event: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    starts_on: z.string(),
    ends_on: z.string(),
    timezone: z.string(),
    venue: z.string().nullable(),
    status: z.string(),
  }),
  publication: z.object({
    live: z.number().int().nonnegative(),
    session_count: z.number().int().nonnegative(),
    speaker_count: z.number().int().nonnegative(),
    public_agenda_url: z.string(),
  }),
  urls: z.object({ agenda: z.string(), speakers: z.string(), cfp: z.string() }),
  cfp: z.object({ url: z.string(), status: z.enum(["open", "closed"]) }).nullable(),
  announcement_copy: z.string().nullable(),
  mail: z.object({ subject: z.string(), body: z.string() }),
  embed: z.object({ source: z.string(), snippet: z.string(), configure_url: z.string() }).nullable(),
  speakers: z.array(announceSpeakerSchema),
}).openapi("AnnounceSnapshot");

const announceSelectorSchema = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(BULK_ID_LIMIT) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
const announceMailBodySchema = z.object({
  selector: announceSelectorSchema,
  subject: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).max(50_000).optional(),
}).strict();
const announceMailResultSchema = z.object({
  selected: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  state: z.enum(["completed", "completed_with_failures"]),
  outbox_enqueued: z.number().int().nonnegative(),
  outbox_ids: z.array(z.string()),
  results: z.array(z.object({ id: z.string(), outcome: z.enum(["succeeded", "failed"]), error: z.string().optional() })),
});

function originFor(context: { req: { url: string } }): string {
  return new URL(context.req.url).origin;
}

async function selectedSpeakerIds(
  database: ApiEnv["Bindings"]["DB"],
  eventId: string,
  origin: string,
  selector: z.infer<typeof announceSelectorSchema>,
): Promise<{ ids: string[]; subject: string; body: string }> {
  const snapshot = await readAnnounceSnapshot(database, eventId, origin);
  if (!snapshot) throw ApiError.notFound("conference not found");
  const ids: string[] = "all" in selector
    ? snapshot.speakers.map((speaker) => speaker.id)
    : [...new Set((selector.ids as string[]))];
  if (ids.length === 0) throw ApiError.conflict("Nothing is public yet, so there are no speaker links to announce.");
  if (ids.length > BULK_ID_LIMIT) throw ApiError.unprocessable(`announce selection is capped at ${BULK_ID_LIMIT} speakers`, "selector");
  return { ids, subject: snapshot.mail.subject, body: snapshot.mail.body };
}

const getAnnounce = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/announce",
    operationId: "getAnnounceSnapshot",
    summary: "Read the event's ready-to-announce kit",
    description: "Read the publication-gated public links, canonical embed snippet, share copy, and published speaker audience.",
    tags: ["Announce"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(announceSnapshotSchema, "The current Announce kit."), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const snapshot = await readAnnounceSnapshot(context.env.DB, eventId, originFor(context));
    if (!snapshot) throw ApiError.notFound("conference not found");
    return context.json(snapshot, 200);
  },
);

const planAnnounceMail = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/announce/mail-plan",
    operationId: "planAnnounceMail",
    summary: "Preview speaker share-link mail",
    description: "Build the bounded MRQ-234 decision-plan contract for one or all currently published speakers.",
    tags: ["Announce"],
    request: { params: eventParams, body: { content: { "application/json": { schema: announceMailBodySchema } } } },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(decisionPlanResponseSchema, "The current speaker share-link mail plan."), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const origin = originFor(context);
    const selection = await selectedSpeakerIds(context.env.DB, eventId, origin, body.selector);
    const subject = body.subject ?? selection.subject;
    const mailBody = body.body ?? selection.body;
    try {
      return context.json(await buildAnnouncePlan({ db: context.env.DB, eventId, personIds: selection.ids, origin, subject, body: mailBody }), 200);
    } catch (error) {
      if (error instanceof Error && error.message === "event not found") throw ApiError.notFound("conference not found");
      throw error;
    }
  },
);

const applyAnnounceMailRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/announce/mail",
    operationId: "applyAnnounceMail",
    summary: "Queue reviewed speaker share-link mail",
    description: "Rebuild and apply a current Announce plan only when its strong ETag and fingerprint still match.",
    tags: ["Announce"],
    request: {
      params: eventParams,
      headers: z.object({ "if-match": z.string().min(1).describe("The Announce mail plan's current strong ETag.") }),
      body: { content: { "application/json": { schema: announceMailBodySchema.extend({ plan_fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }) } } },
    },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "if-match" },
    responses: { 202: jsonResponse(announceMailResultSchema, "Speaker share-link mail queue result."), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const origin = originFor(context);
    const selection = await selectedSpeakerIds(context.env.DB, eventId, origin, body.selector);
    const subject = body.subject ?? selection.subject;
    const mailBody = body.body ?? selection.body;
    const result = await applyAnnounceMail({
      db: context.env.DB,
      queue: context.env.MAIL_QUEUE,
      eventId,
      personIds: selection.ids,
      origin,
      subject,
      body: mailBody,
      request: context.req.raw,
      planFingerprint: body.plan_fingerprint,
    });
    return context.json(result, 202);
  },
);

export const apiRoutes = [getAnnounce, planAnnounceMail, applyAnnounceMailRoute];

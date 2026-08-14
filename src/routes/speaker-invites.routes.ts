import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { enqueueAuthMail, renderPortalInviteMail } from "../lib/auth/auth-mail";
import { mintPortalMagicLink } from "../lib/auth/magic-links";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole } from "../lib/auth/scope-resolution";
import { enqueueMailMessage } from "../jobs/mail/consumer";

const eventParams = z.object({ eventId: z.string().min(1) });
const speakerParams = eventParams.extend({ personId: z.string().min(1) });
const inviteBody = z.object({
  person_ids: z.array(z.string().min(1)).min(1).max(100),
});
const inviteResult = z.object({
  person_id: z.string(),
  name: z.string(),
  email: z.string(),
  invited_at: z.number().int(),
  outbox_id: z.string(),
  outbox_inserted: z.boolean(),
  magic_link: z.string().optional(),
});
const inviteResponse = z.object({
  ok: z.literal(true),
  message: z.string(),
  invites: z.array(inviteResult),
});
const portalPreviewResponse = z.object({ url: z.string().url(), person_id: z.string() });

const inviteSpeakers = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/speakers/invite",
    operationId: "inviteSpeakersToPortal",
    summary: "Invite speakers to the portal",
    description: "Queues reusable, demo-safe portal invitations valid for 15 days for speakers belonging to this conference.",
    tags: ["Speaker roster"],
    request: { params: eventParams, body: { content: { "application/json": { schema: inviteBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(inviteResponse, "Portal invitations queued"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json") as z.infer<typeof inviteBody>;
    const event = await context.env.DB.prepare("SELECT id, org_id, demo_mode FROM events WHERE id = ?")
      .bind(eventId)
      .first<{ id: string; org_id: string; demo_mode: number }>();
    if (!event) throw ApiError.notFound("conference not found");

    const personIds: string[] = [...new Set<string>(body.person_ids as string[])];
    const speakers = await context.env.DB.prepare(
      `SELECT p.id, p.name, p.email
       FROM people p
       WHERE p.org_id = ? AND p.id IN (SELECT value FROM json_each(?))
         AND (
           EXISTS (
             SELECT 1 FROM memberships m
             WHERE m.org_id = p.org_id AND m.event_id = ? AND m.person_id = p.id AND m.role = 'speaker'
           )
           OR EXISTS (
             SELECT 1 FROM participations pa
             JOIN submissions s ON s.id = pa.submission_id
             WHERE s.event_id = ? AND pa.person_id = p.id
           )
         )
       ORDER BY p.id`,
    )
      .bind(event.org_id, JSON.stringify(personIds), eventId, eventId)
      .all<{ id: string; name: string; email: string }>();
    const speakerById = new Map(speakers.results.map((speaker) => [speaker.id, speaker]));
    if (speakers.results.length !== personIds.length) {
      throw ApiError.notFound("one or more speakers do not belong to this conference");
    }

    const now = Date.now();
    const origin = new URL(context.req.url).origin;
    const invites = [];
    for (const personId of personIds) {
      const speaker = speakerById.get(personId);
      if (!speaker) throw ApiError.notFound("speaker not found");
      const link = await mintPortalMagicLink(context.env.DB, {
        personId: speaker.id,
        eventId,
        redirectTo: "/portal",
        now,
      });
      const magicLink = `${origin}/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`;
      const mail = renderPortalInviteMail(magicLink);
      const outboxId = await enqueueAuthMail(context.env.DB, {
        eventId,
        personId: speaker.id,
        toEmail: speaker.email,
        templateKey: "portal_invite",
        entityId: link.id,
        ...mail,
        now,
      });
      await enqueueMailMessage(context.env.MAIL_QUEUE, outboxId);
      await context.env.DB.prepare(
        `UPDATE participations SET invited_at = ?, updated_at = ?
         WHERE person_id = ? AND submission_id IN (SELECT id FROM submissions WHERE event_id = ?)`,
      ).bind(now, now, speaker.id, eventId).run();
      invites.push({
        person_id: speaker.id,
        name: speaker.name,
        email: speaker.email,
        invited_at: now,
        outbox_id: outboxId,
        outbox_inserted: true,
        ...(event.demo_mode === 1 ? { magic_link: magicLink } : {}),
      });
    }

    return context.json({
      ok: true as const,
      message: `${invites.length} portal invitation${invites.length === 1 ? "" : "s"} queued in the demo-safe outbox.`,
      invites,
    }, 200);
  },
);

const previewSpeakerPortal = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/speakers/{personId}/portal-preview",
    operationId: "previewSpeakerPortal",
    summary: "Open a speaker portal preview",
    description: "Mints a one-time organizer-only portal link without notifying the speaker or changing conference status.",
    tags: ["Speaker roster"],
    request: { params: speakerParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(portalPreviewResponse, "A one-time portal preview URL"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const auth = getAuth(context);
    if (!auth || !authHasRole(auth, "ops", eventId)) throw ApiError.forbidden("portal previews are for organizers only");
    const speaker = await context.env.DB.prepare(
      `SELECT person.id
       FROM people person
       JOIN events conference ON conference.id = ? AND conference.org_id = person.org_id
       WHERE person.id = ?
         AND (
           EXISTS (
             SELECT 1 FROM memberships membership
             WHERE membership.org_id = person.org_id AND membership.event_id = conference.id
               AND membership.person_id = person.id AND membership.role = 'speaker'
           )
           OR EXISTS (
             SELECT 1 FROM participations participation
             JOIN submissions submission ON submission.id = participation.submission_id
             WHERE submission.event_id = conference.id AND participation.person_id = person.id
           )
         )
       LIMIT 1`,
    ).bind(eventId, personId).first<{ id: string }>();
    if (!speaker) throw ApiError.notFound("speaker not found");

    const link = await mintPortalMagicLink(context.env.DB, {
      personId: speaker.id,
      eventId,
      purpose: "login",
      redirectTo: "/portal?viewing_as=speaker",
      now: Date.now(),
    });
    const url = `${new URL(context.req.url).origin}/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`;
    return context.json({ url, person_id: speaker.id }, 200);
  },
);

export const apiRoutes = [inviteSpeakers, previewSpeakerPortal];

/**
 * The submitter's door — "email me a link to my proposals".
 *
 * A public submission is anonymous, and the only handle it leaves behind is one
 * private resume link per abstract. Somebody who sent three proposals therefore
 * holds three unrelated links and no place that shows them their three
 * proposals. This is the one address that answer lives at, and it opens with an
 * email address and nothing else.
 *
 * **No password and no account.** The magic link that already carries every
 * other seat carries this one too; nothing new is minted, no second identity
 * system appears. `roleHome([])` already resolves a person holding no
 * membership to `/portal`, and the portal already answers that person with the
 * submitter seat, so the whole of this route is: prove the address, then mail
 * the link the product already knows how to make.
 *
 * **Request → verify, the same rule the attendee claim follows.** Typing an
 * address does exactly one thing — sends mail to it. Nothing is written, and
 * nothing about that address is revealed, until the person who can read that
 * mailbox opens the link. That is what stops "type a stranger's email" from
 * being a way to enumerate somebody else's proposals, and it is why the
 * response below is byte-identical whether the address has three proposals or
 * has never been seen.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { enqueueAuthMail, renderProposalsLinkMail } from "../lib/auth/auth-mail";
import { mintMagicLink } from "../lib/auth/magic-links";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../jobs/mail/idempotency";
import { loadPublicEvent } from "../lib/public-site";
import { publicTurnstileExempt } from "./public-form.shared";
import { verifyTurnstile } from "../lib/r2/turnstile";

/**
 * The one sentence this route ever says. It names the conference — which the
 * caller already chose — and asserts nothing whatever about the address.
 */
export const PROPOSALS_LINK_ACKNOWLEDGEMENT =
  "If that address has proposals for this conference, a link to them is on its way to it.";

const requestSchema = z.object({
  email: z.string().trim().min(3).max(320),
  /** Which conference. Omitted resolves to the live one, as every public surface does. */
  event: z.string().trim().max(200).optional(),
  turnstileToken: z.string().optional(),
  turnstile_token: z.string().optional(),
});

const responseSchema = z.object({ ok: z.literal(true), message: z.string() });

/**
 * Six mails an hour to one address.
 *
 * Keyed on the ADDRESS, not the IP, for the reason the attendee claim spells
 * out at length: a conference is one NAT, so an IP ceiling low enough to bound
 * the damage is low enough to be an outage. A ceiling on the address bounds
 * exactly what can be abused here — a resend loop aimed at one mailbox — and
 * leaves every other submitter on the venue wifi untouched.
 */
const LINK_LIMIT = 6;
const LINK_WINDOW_SECONDS = 3600;

async function withinLinkLimit(
  store: KVNamespace | undefined,
  email: string,
  now: number,
): Promise<boolean> {
  if (!store) return true;
  const windowStart = Math.floor(now / (LINK_WINDOW_SECONDS * 1000)) * LINK_WINDOW_SECONDS * 1000;
  const key = `proposals-link:${email}:${windowStart}`;
  const seen = await store.get(key, "json").catch(() => null);
  const count = typeof seen === "number" ? seen : 0;
  if (count >= LINK_LIMIT) return false;
  await store
    .put(key, JSON.stringify(count + 1), { expirationTtl: LINK_WINDOW_SECONDS * 2 })
    .catch(() => { /* an uncounted request beats a refused one */ });
  return true;
}

/**
 * The person this address names at this conference, and only if they actually
 * submitted something to it.
 *
 * Event-scoped on purpose. A submitter who has sent proposals to two
 * conferences must get a link to the one they asked about, and must not be told
 * anything at all about the other — the person is org-scoped, the participation
 * is not, and this query is where that distinction is kept honest.
 */
async function submitterAtEvent(
  database: D1Database,
  eventId: string,
  email: string,
): Promise<{ id: string } | null> {
  return database
    .prepare(
      `SELECT DISTINCT person.id
         FROM people person
         JOIN participations participation ON participation.person_id = person.id
         JOIN submissions submission
           ON submission.id = participation.submission_id AND submission.event_id = ?
         JOIN events event ON event.id = submission.event_id AND event.org_id = person.org_id
        WHERE lower(person.email) = ?
        LIMIT 1`,
    )
    .bind(eventId, email.trim().toLowerCase())
    .first<{ id: string }>();
}

/**
 * Which conference this request is about.
 *
 * A named slug is matched whatever the conference's status, because a call for
 * speakers routinely opens months before the event site goes live — and a
 * submitter who has just sent an abstract to it must be able to ask about that
 * abstract. Only the unnamed case falls back to the live conference, which is
 * what every other public surface does.
 */
export async function resolveProposalsEvent(
  database: D1Database,
  slug: string | null | undefined,
): Promise<{ id: string; name: string; slug: string } | null> {
  if (slug) {
    const named = await database
      .prepare("SELECT id, name, slug FROM events WHERE slug = ? LIMIT 1")
      .bind(slug)
      .first<{ id: string; name: string; slug: string }>();
    if (named) return named;
  }
  const live = await loadPublicEvent(database, null);
  return live ? { id: live.id, name: live.name, slug: live.slug } : null;
}

const requestProposalsLink = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/proposals/link",
    operationId: "requestProposalsLink",
    summary: "Email a submitter a link to every proposal they have sent this conference",
    description:
      "Sends one sign-in link and writes nothing else. The answer is identical whether or not the address has proposals here, so the route can never be used to find out whether somebody submitted. No password and no account: the link lands on the submitter's own page, which lists their proposals and each one's status.",
    tags: ["Public"],
    request: { body: { content: { "application/json": { schema: requestSchema } } } },
    // `send` is the bucket that means "this route puts mail in a queue", and it
    // is what stops the door being a mail cannon aimed at a guessed address.
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "send" }, concurrency: "none" },
    responses: {
      200: jsonResponse(responseSchema, "The request was accepted."),
      ...errorResponses([400, 403, 422, 429, 500]),
    },
  },
  async (context) => {
    const body = context.req.valid("json");
    const now = Date.now();
    const event = await resolveProposalsEvent(context.env.DB, body.event ?? null);

    // Every branch below falls through to the same acknowledgement. Nothing may
    // differ by a byte on whether the conference exists, whether the address is
    // known, or whether a link was minted just now.
    if (event) {
      // The same exemption the public call for speakers takes, for the same
      // reason: a demo conference is driven by walkthroughs and tests with no
      // human to solve a challenge, and gating it would make the demo the one
      // place the product cannot be seen working.
      if (!(await publicTurnstileExempt(context.env.DB, event.id))) {
        const turnstile = await verifyTurnstile({
          secretKey: (context.env as unknown as { TURNSTILE_SECRET_KEY: string }).TURNSTILE_SECRET_KEY,
          token: body.turnstileToken ?? body.turnstile_token,
          remoteIp: context.req.header("cf-connecting-ip"),
        });
        // The one refusal that is not the generic answer, and it says nothing
        // about the address: a failed challenge is a fact about this request.
        if (!turnstile.ok) {
          throw ApiError.forbidden("Complete the security check, then choose Send again.");
        }
      }

      const person = await submitterAtEvent(context.env.DB, event.id, body.email);
      if (person && (await withinLinkLimit(context.env.CACHE, body.email.trim().toLowerCase(), now))) {
        // The conference is named in the redirect rather than left to a later
        // fallback ordering, so a submitter at two conferences lands on the one
        // they asked about.
        const link = await mintMagicLink(context.env.DB, {
          personId: person.id,
          eventId: event.id,
          purpose: "login",
          redirectTo: `/portal?eventId=${encodeURIComponent(event.id)}`,
          now,
        });
        const origin = new URL(context.req.url).origin;
        const mail = renderProposalsLinkMail({
          eventName: event.name,
          link: `${origin}/api/v1/auth/exchange?token=${link.token}`,
        });
        const outboxId = await enqueueAuthMail(context.env.DB, {
          eventId: event.id,
          personId: person.id,
          entityId: IDEMPOTENCY_REGISTRY.authLink(link.id),
          toEmail: body.email.trim(),
          templateKey: "magic_link_login",
          ...mail,
        });
        // Writing the outbox row is not sending: the consumer only ever acts on
        // an explicit queue message. Without this the mail sits in D1 forever
        // and the endpoint still answers 200 — a submitter waiting on a link
        // that was never going to arrive.
        await enqueueMailMessage(context.env.MAIL_QUEUE, outboxId);
      }
    }

    context.header("Cache-Control", "no-store");
    return context.json({ ok: true as const, message: PROPOSALS_LINK_ACKNOWLEDGEMENT }, 200);
  },
);

export const apiRoutes = [requestProposalsLink];

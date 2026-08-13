import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { EventRow, MembershipRow, PersonRow } from "../db/schema";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import { enqueueAuthMail, renderMagicLinkLoginMail } from "../lib/auth/auth-mail";
import { getAuth, unauthorized } from "../lib/auth/auth-middleware";
import { consumeMagicLink, mintMagicLink } from "../lib/auth/magic-links";
import { createSession, revokeSession, SESSION_TTL_MS } from "../lib/auth/auth-sessions";
import { loadMembershipsForOrg } from "../lib/auth/scope-resolution";
import { pickOutboxEventId, rolesOf, signinRedirect } from "../lib/auth/signin-destination";
import type { DemoRole } from "../lib/auth/demo-seat";
import { DEMO_ROLE_TO_MEMBERSHIP, demoRoleForEmail, findDemoPersona } from "../lib/auth/demo-seat";
import { findDemoEvent } from "../lib/demo-event";
import { enqueueMailMessage } from "../jobs/mail/consumer";

/**
 * Auth still sets and clears the session cookie in its handlers. It is a
 * manifest module now, so the generated API router supplies the same D1-backed
 * credential context while OpenAPI documents every auth operation.
 */

/**
 * The sign-in doors are `public` routes, so the pipeline hands them a stale or
 * tampered credential as anonymous rather than a 401 — but it also tells them
 * the credential is a corpse. A success replaces the cookie on its own; a
 * failure is the only moment left to drop it, because the cookie is HttpOnly
 * and nothing on the page can. Without this, a browser that fails to sign in
 * keeps re-presenting a dead session on every later request.
 */
function dropRejectedSessionCookie(context: Context<ApiEnv>): void {
  if (context.get("credentialRejected")) clearSessionCookie(context);
}

/**
 * A spent magic link, answered in the shape the caller can read.
 *
 * Every emailed sign-in link is opened by a browser navigation, and a browser
 * given `{"error":{"code":"magic_link_invalid",…}}` renders that JSON to a
 * human — which is what marquee.stage11.dev did to anyone who clicked a link
 * sixteen minutes late. A navigation therefore lands on the door instead, with
 * a reason it can state. API clients keep the 401 envelope byte-for-byte: they
 * are the callers for whom a redirect would be the unreadable answer.
 */
function rejectMagicLink(context: Context<ApiEnv>, message: string): Response {
  dropRejectedSessionCookie(context);
  context.header("Cache-Control", "no-store");
  if ((context.req.header("accept") ?? "").includes("text/html")) {
    return context.redirect("/signin?reason=expired", 302);
  }
  return context.json({ error: { code: "magic_link_invalid", message } }, 401);
}

const roleSchema = z.enum(["organizer", "reviewer", "speaker"]);
const authErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const demoRequestSchema = z.object({ role: roleSchema });
const demoResponseSchema = z.object({
  ok: z.literal(true),
  role: roleSchema,
  event_id: z.string(),
  person: z.object({ id: z.string(), name: z.string() }),
});
const magicLinkRequestSchema = z.object({
  email: z.string().min(1),
  /**
   * Optional: `/signin` is a universal door and its visitor has no event in
   * hand. Absent, the person is resolved by email across `people` — the
   * deliberate single-org shortcut this deployment already takes for org-level
   * writes (MRQ-131). Multi-org disambiguation is explicitly a later ticket.
   */
  event_id: z.string().min(1).optional(),
  redirect_to: z.string().optional(),
});
const magicLinkResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  magic_link: z.string().optional(),
  /**
   * Present only when a demo address opened a demo seat: the session cookie is
   * already set and this says where that seat lives. Absent on every other
   * instance and every other address, so its absence is never an oracle.
   */
  demo_seat: z.object({ role: roleSchema, redirect_to: z.string() }).optional(),
});
const authMeResponseSchema = z.object({
  kind: z.enum(["session", "api_token"]),
  person_id: z.string().optional(),
  token_id: z.string().optional(),
  org_id: z.string(),
  event_id: z.string().nullable().optional(),
  memberships: z.array(z.object({ event_id: z.string().nullable(), role: z.string() })).optional(),
  scopes: z.object({ permissions: z.array(z.string()), event_ids: z.array(z.string()) }).optional(),
  demo_event_id: z.string().nullable(),
  demo_event_name: z.string().nullable(),
  // Who the session belongs to, in the operator's own words. The shell has the
  // person id already; an id is not an answer to "which hat am I wearing", and
  // that is the question a judge asks after switching demo personas.
  person_name: z.string().nullable().optional(),
  person_email: z.string().nullable().optional(),
});

const demoLogin = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/auth/demo",
    operationId: "demoLogin",
    summary: "Sign in to the demo as an organizer, reviewer, or speaker",
    description:
      "Creates a demo session only when a demo-mode event and matching demo persona exist. A non-staff role never resolves to a persona holding a program-staff seat.",
    tags: ["Auth"],
    request: { body: { content: { "application/json": { schema: demoRequestSchema } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(demoResponseSchema, "The demo session was created."),
      400: jsonResponse(authErrorSchema, "The role is not supported."),
      403: jsonResponse(authErrorSchema, "Demo mode is disabled or incomplete."),
      ...errorResponses([401, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const body = await context.req.json<z.infer<typeof demoRequestSchema>>();
    const role = body.role as DemoRole;
    const membershipRole = DEMO_ROLE_TO_MEMBERSHIP[role];
    const event = await findDemoEvent(context.env.DB);
    if (!event) {
      dropRejectedSessionCookie(context);
      return context.json(
        { error: { code: "demo_disabled", message: "Demo login is only available in demo mode" } },
        403,
      );
    }

    const persona = await findDemoPersona(context.env.DB, event.id, role, membershipRole);
    if (!persona) {
      dropRejectedSessionCookie(context);
      return context.json(
        { error: { code: "demo_persona_missing", message: "No demo persona for this role" } },
        403,
      );
    }

    const session = await createSession(context.env.DB, {
      personId: persona.id,
      roleHint: membershipRole,
      userAgent: context.req.header("user-agent") ?? "",
    });
    setSessionCookie(context, session.id, SESSION_TTL_MS / 1000);
    context.header("Cache-Control", "no-store");
    return context.json({
      ok: true as const,
      role,
      event_id: event.id,
      person: { id: persona.id, name: persona.name },
    }, 200);
  }) as never,
);

const requestMagicLink = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/auth/magic-link",
    operationId: "requestMagicLink",
    summary: "Request a magic-link sign-in email",
    description:
      "Always returns a generic response; demo mode additionally returns the link on screen.",
    tags: ["Auth"],
    request: { body: { content: { "application/json": { schema: magicLinkRequestSchema } } } },
    // This route sends mail. `send` is the bucket that means that, and it is
    // the one that stops the door being a mail cannon aimed at any address
    // someone can guess.
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "send" }, concurrency: "none" },
    responses: {
      200: jsonResponse(magicLinkResponseSchema, "The request was accepted."),
      400: jsonResponse(authErrorSchema, "The request is missing required fields."),
      ...errorResponses([401, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const body = await context.req.json<z.infer<typeof magicLinkRequestSchema>>();
    const now = Date.now();

    // A demo address typed into the form is the same request as clicking the
    // matching door, so it gets the same session rather than a mail round-trip
    // to an address no mailbox will ever hold. Off a demo instance this returns
    // null and the address falls through to the generic answer below, which is
    // what every unknown address gets — the door must not become an oracle for
    // "is this deployment the demo".
    const demoSeat = await openDemoSeatForEmail(context, body.email, body.redirect_to);
    if (demoSeat) return demoSeat;

    const person = await findPersonForSignin(context.env.DB, body.email, body.event_id);
    let onScreenLink: string | undefined;

    // Every branch below falls through to the same generic acknowledgement. No
    // path may differ by a byte on whether the address exists, whether the
    // instance has an event, or whether a link was minted just now — the answer
    // is an acknowledgement, never an oracle.
    // A seeded demo persona is exempt: on a demo instance the on-screen link IS
    // the delivery channel, and the raw token of the first link is unrecoverable
    // (only its hash is stored), so a cooled second submit would leave a judge
    // holding an acknowledgement and no link for a minute. The cooldown exists
    // to stop a mail cannon, and demo mail is never sent.
    if (person && (person.is_demo === 1 || !(await hasFreshLoginLink(context.env.DB, person.id, now)))) {
      const memberships = await loadMembershipsForOrg(context.env.DB, person.id, person.org_id);
      const event = await attributionEvent(context.env.DB, person, memberships, body.event_id);
      // `outbox.event_id` is NOT NULL. An org with no event at all therefore has
      // nowhere to file the mail, so nothing is minted and nothing is enqueued —
      // and no link appears on screen to compensate for the mail that is not
      // coming.
      if (event) {
        const link = await mintMagicLink(context.env.DB, {
          personId: person.id,
          purpose: "login",
          redirectTo: signinRedirect(body.redirect_to, rolesOf(memberships)),
          now,
        });
        const url = new URL(context.req.url);
        const absoluteLink = `${url.origin}/api/v1/auth/exchange?token=${link.token}`;
        const mail = renderMagicLinkLoginMail(absoluteLink);
        const outboxId = await enqueueAuthMail(context.env.DB, {
          eventId: event.id,
          personId: person.id,
          entityId: link.id,
          toEmail: person.email,
          templateKey: "magic_link_login",
          ...mail,
        });
        await enqueueMailMessage(context.env.MAIL_QUEUE, outboxId);
        // The person, not just the event. A claim-created owner is a `people`
        // row in the same organization as the demo event — `resolveOrganization`
        // reuses the oldest org — and holds an org-wide membership with a null
        // event, so the attribution fallback resolves them to the demo event.
        // Keying the on-screen link on the event alone would hand a real
        // owner's 15-minute sign-in link to anyone who knows their address.
        // Seeded personas carry `is_demo = 1`; claimed people carry 0.
        if (event.demo_mode === 1 && person.is_demo === 1) onScreenLink = absoluteLink;
      }
    }

    context.header("Cache-Control", "no-store");
    return context.json({
      ok: true as const,
      message: "If that address is registered, a sign-in link is on its way.",
      ...(onScreenLink ? { magic_link: onScreenLink } : {}),
    }, 200);
  }) as never,
);

const exchangeMagicLink = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/auth/exchange",
    operationId: "exchangeMagicLink",
    summary: "Exchange a magic link for a session",
    tags: ["Auth"],
    request: { query: z.object({ token: z.string().min(1) }) },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      302: {
        description:
          "Redirects to the magic link's requested destination — or, for a browser navigation with a spent link, to /signin?reason=expired.",
      },
      401: jsonResponse(authErrorSchema, "The magic link is missing, expired, or already used."),
      ...errorResponses([429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const token = context.req.query("token");
    if (!token) return rejectMagicLink(context, "Missing token");
    // Sign-in exchanges only person-bound links. `claim` and `org_invite` have
    // no person yet and are exchanged at `/api/v1/claim`, which is the one
    // place a session is minted from a token that predates its owner.
    const link = await consumeMagicLink(context.env.DB, token, Date.now(), {
      purposes: ["login", "draft_resume", "cospeaker_profile", "task_link"],
    });
    if (!link || link.person_id === null) {
      return rejectMagicLink(context, "This sign-in link has expired or was already used");
    }
    const roleHint = (() => {
      if (link.purpose !== "cospeaker_profile") return "login";
      try {
        const participationId = new URL(link.redirect_to, context.req.url).searchParams.get("participation");
        return participationId && /^[A-Za-z0-9_-]+$/.test(participationId)
          ? `cospeaker_profile:${participationId}`
          : "login";
      } catch {
        return "login";
      }
    })();
    const session = await createSession(context.env.DB, {
      personId: link.person_id,
      roleHint,
      userAgent: context.req.header("user-agent") ?? "",
    });
    setSessionCookie(context, session.id, SESSION_TTL_MS / 1000);
    return context.redirect(link.redirect_to, 302);
  }) as never,
);

const logout = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/auth/logout",
    operationId: "logout",
    summary: "End the current session",
    tags: ["Auth"],
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(z.object({ ok: z.literal(true) }), "The session was cleared."),
      ...errorResponses([401, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const auth = getAuth(context);
    if (auth?.kind === "session") {
      await revokeSession(context.env.DB, auth.sessionId);
    }
    clearSessionCookie(context);
    return context.json({ ok: true as const }, 200);
  }) as never,
);

const getCurrentAuth = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/auth/me",
    operationId: "getCurrentAuth",
    summary: "Read the current authentication context",
    tags: ["Auth"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(authMeResponseSchema, "The current session or token context."),
      ...errorResponses([401, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const auth = getAuth(context);
    if (!auth) return unauthorized(context);
    const demoEvent = await findDemoEvent(context.env.DB);
    if (auth.kind === "session") {
      const person = await context.env.DB
        .prepare("SELECT name, email FROM people WHERE id = ?")
        .bind(auth.personId)
        .first<{ name: string | null; email: string | null }>();
      return context.json({
        kind: "session" as const,
        person_id: auth.personId,
        org_id: auth.orgId,
        memberships: auth.memberships.map((membership) => ({
          event_id: membership.event_id,
          role: membership.role,
        })),
        demo_event_id: demoEvent?.id ?? null,
        demo_event_name: demoEvent?.name ?? null,
        person_name: person?.name ?? null,
        person_email: person?.email ?? null,
      }, 200);
    }
    return context.json({
      kind: "api_token" as const,
      token_id: auth.tokenId,
      org_id: auth.orgId,
      event_id: auth.eventId,
      scopes: { permissions: auth.permissions, event_ids: auth.eventIds },
      demo_event_id: demoEvent?.id ?? null,
      demo_event_name: demoEvent?.name ?? null,
    }, 200);
  }) as never,
);

/**
 * The seat a demo address opens, or null when this instance has none.
 *
 * Null is the important half. Everything here gates on a live demo event and a
 * seeded persona for the role, so on a self-hosted instance `organizer@demo.com`
 * is exactly as unremarkable as any other address nobody registered: the caller
 * falls through to the generic acknowledgement, mints nothing, and sets no
 * cookie. Nothing about the reply tells a stranger which kind of deployment
 * they are talking to.
 */
async function openDemoSeatForEmail(
  context: Context<ApiEnv>,
  email: string,
  redirectTo: string | undefined,
): Promise<Response | null> {
  const role: DemoRole | null = demoRoleForEmail(email);
  if (!role) return null;
  const event = await findDemoEvent(context.env.DB);
  if (!event) return null;
  const membershipRole = DEMO_ROLE_TO_MEMBERSHIP[role];
  const persona = await findDemoPersona(context.env.DB, event.id, role, membershipRole);
  if (!persona) return null;

  const session = await createSession(context.env.DB, {
    personId: persona.id,
    roleHint: membershipRole,
    userAgent: context.req.header("user-agent") ?? "",
  });
  setSessionCookie(context, session.id, SESSION_TTL_MS / 1000);
  context.header("Cache-Control", "no-store");
  return context.json({
    ok: true as const,
    message: `Demo mode · signing you in as ${persona.name}.`,
    demo_seat: { role, redirect_to: signinRedirect(redirectTo, [membershipRole]) },
  }, 200);
}

/** One unused, unexpired login link per person per minute. */
const LOGIN_LINK_COOLDOWN_MS = 60_000;

/**
 * Who is asking, when the caller may not have said which conference.
 *
 * With an `event_id` the lookup stays scoped to that event's organization,
 * exactly as it always has. Without one — the universal `/signin` door — the
 * oldest matching row wins, which is the single-org shortcut this deployment
 * already takes elsewhere and the only answer that is stable under a retry.
 */
async function findPersonForSignin(
  db: D1Database,
  email: string,
  eventId: string | undefined,
): Promise<PersonRow | null> {
  const address = email.trim().toLowerCase();
  if (eventId !== undefined) {
    const event = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
    if (!event) return null;
    const scoped = await db
      .prepare("SELECT * FROM people WHERE org_id = ? AND email = ?")
      .bind(event.org_id, address)
      .first<PersonRow>();
    return scoped ?? null;
  }
  const person = await db
    .prepare("SELECT * FROM people WHERE email = ? ORDER BY created_at ASC, id ASC LIMIT 1")
    .bind(address)
    .first<PersonRow>();
  return person ?? null;
}

/**
 * A live link already in flight means this request mints nothing.
 *
 * The response is identical either way, so a caller learns nothing from the
 * cooldown; what it stops is a public route with an email field turning into a
 * way to post sixty messages a minute into somebody's inbox.
 */
async function hasFreshLoginLink(db: D1Database, personId: string, now: number): Promise<boolean> {
  const recent = await db
    .prepare(
      `SELECT id FROM magic_links
        WHERE person_id = ? AND purpose = 'login' AND used_at IS NULL
          AND expires_at > ? AND created_at > ?
        LIMIT 1`,
    )
    .bind(personId, now, now - LOGIN_LINK_COOLDOWN_MS)
    .first<{ id: string }>();
  return recent !== null;
}

/** Which conference the mail is filed against; see `pickOutboxEventId`. */
async function attributionEvent(
  db: D1Database,
  person: PersonRow,
  memberships: readonly MembershipRow[],
  requestedEventId: string | undefined,
): Promise<EventRow | null> {
  if (requestedEventId !== undefined) {
    return (await db.prepare("SELECT * FROM events WHERE id = ?").bind(requestedEventId).first<EventRow>()) ?? null;
  }
  const orgEvents = await db
    .prepare("SELECT id, created_at FROM events WHERE org_id = ?")
    .bind(person.org_id)
    .all<{ id: string; created_at: number }>();
  const eventId = pickOutboxEventId(memberships, orgEvents.results);
  if (!eventId) return null;
  return (await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>()) ?? null;
}

export const apiRoutes = [
  demoLogin,
  requestMagicLink,
  exchangeMagicLink,
  logout,
  getCurrentAuth,
];

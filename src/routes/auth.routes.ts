import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { EventRow, MembershipRole, PersonRow } from "../db/schema";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import { enqueueAuthMail, renderMagicLinkLoginMail } from "../lib/auth/auth-mail";
import { getAuth, unauthorized } from "../lib/auth/auth-middleware";
import { consumeMagicLink, mintMagicLink } from "../lib/auth/magic-links";
import { createSession, revokeSession, SESSION_TTL_MS } from "../lib/auth/auth-sessions";
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

const roleSchema = z.enum(["organizer", "speaker"]);
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
  event_id: z.string().min(1),
  redirect_to: z.string().optional(),
});
const magicLinkResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  magic_link: z.string().optional(),
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
    summary: "Sign in to the demo as an organizer or speaker",
    description:
      "Creates a demo session only when a demo-mode event and matching demo persona exist.",
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
    const membershipRole = DEMO_ROLE_TO_MEMBERSHIP[body.role];
    const event = await findDemoEvent(context.env.DB);
    if (!event) {
      dropRejectedSessionCookie(context);
      return context.json(
        { error: { code: "demo_disabled", message: "Demo login is only available in demo mode" } },
        403,
      );
    }

    const persona = await context.env.DB.prepare(
      `SELECT p.* FROM people p
       JOIN memberships m ON m.person_id = p.id
       WHERE p.is_demo = 1 AND m.event_id = ? AND m.role = ?
       LIMIT 1`,
    )
      .bind(event.id, membershipRole)
      .first<PersonRow>();
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
      role: body.role,
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
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(magicLinkResponseSchema, "The request was accepted."),
      400: jsonResponse(authErrorSchema, "The request is missing required fields."),
      ...errorResponses([401, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const body = await context.req.json<z.infer<typeof magicLinkRequestSchema>>();
    const event = await context.env.DB.prepare("SELECT * FROM events WHERE id = ?")
      .bind(body.event_id)
      .first<EventRow>();
    let onScreenLink: string | undefined;

    if (event) {
      const person = await context.env.DB.prepare(
        "SELECT * FROM people WHERE org_id = ? AND email = ?",
      )
        .bind(event.org_id, body.email.trim().toLowerCase())
        .first<PersonRow>();
      if (person) {
        const link = await mintMagicLink(context.env.DB, {
          personId: person.id,
          purpose: "login",
          redirectTo: body.redirect_to ?? "/",
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
        if (event.demo_mode === 1) onScreenLink = absoluteLink;
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
      302: { description: "Redirects to the magic link's requested destination." },
      401: jsonResponse(authErrorSchema, "The magic link is missing, expired, or already used."),
      ...errorResponses([429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const token = context.req.query("token");
    if (!token) {
      dropRejectedSessionCookie(context);
      return context.json(
        { error: { code: "magic_link_invalid", message: "Missing token" } },
        401,
      );
    }
    const link = await consumeMagicLink(context.env.DB, token);
    if (!link) {
      dropRejectedSessionCookie(context);
      return context.json(
        {
          error: {
            code: "magic_link_invalid",
            message: "This sign-in link has expired or was already used",
          },
        },
        401,
      );
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

const DEMO_ROLE_TO_MEMBERSHIP: Record<string, MembershipRole> = {
  organizer: "owner",
  speaker: "speaker",
};

async function findDemoEvent(db: D1Database): Promise<EventRow | null> {
  const event = await db
    .prepare("SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC LIMIT 1")
    .first<EventRow>();
  return event ?? null;
}

export const apiRoutes = [
  demoLogin,
  requestMagicLink,
  exchangeMagicLink,
  logout,
  getCurrentAuth,
];

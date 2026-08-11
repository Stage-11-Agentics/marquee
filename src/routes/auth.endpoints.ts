import { Hono } from "hono";

import type { Env } from "../index";
import type { EventRow, MembershipRole, PersonRow } from "../db/schema";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import { enqueueAuthMail, renderMagicLinkLoginMail } from "../lib/auth/auth-mail";
import { getAuth, unauthorized } from "../lib/auth/auth-middleware";
import { consumeMagicLink, mintMagicLink } from "../lib/auth/magic-links";
import { createSession, revokeSession, SESSION_TTL_MS } from "../lib/auth/auth-sessions";

const DEMO_ROLE_TO_MEMBERSHIP: Record<string, MembershipRole> = {
  organizer: "owner",
  speaker: "speaker",
};

export const authRoutes = new Hono<{ Bindings: Env }>();

/**
 * The one-click demo login is a demo affordance, not an auth mode, and it
 * fails closed (AC-2, G6/A-5): unless an event with `demo_mode = 1` exists
 * and carries a demo persona with the requested membership, the route answers
 * 403 and sets no cookie.
 */
authRoutes.post("/demo", async (context) => {
  const body = await context.req.json<{ role?: string }>().catch(() => ({}) as { role?: string });
  const membershipRole = body.role ? DEMO_ROLE_TO_MEMBERSHIP[body.role] : undefined;
  if (!membershipRole) {
    return context.json(
      { error: { code: "bad_request", message: "role must be organizer or speaker" } },
      400,
    );
  }

  const event = await findDemoEvent(context.env.DB);
  if (!event) {
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
    ok: true,
    role: body.role,
    event_id: event.id,
    person: { id: persona.id, name: persona.name },
  });
});

/**
 * Always answers 200 with a generic message — the response must not reveal
 * whether the address exists. Auth mail enqueues an outbox row under
 * `magic_link_login` and never calls a provider directly (G3/A-3). Only in
 * demo mode is the link also returned on screen (SPEC §4.1).
 */
authRoutes.post("/magic-link", async (context) => {
  const body = await context.req
    .json<{ email?: string; event_id?: string; redirect_to?: string }>()
    .catch(() => ({}) as { email?: string; event_id?: string; redirect_to?: string });
  if (!body.email || !body.event_id) {
    return context.json(
      { error: { code: "bad_request", message: "email and event_id are required" } },
      400,
    );
  }

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
      await enqueueAuthMail(context.env.DB, {
        eventId: event.id,
        personId: person.id,
        toEmail: person.email,
        templateKey: "magic_link_login",
        ...mail,
      });
      if (event.demo_mode === 1) onScreenLink = absoluteLink;
    }
  }

  context.header("Cache-Control", "no-store");
  return context.json({
    ok: true,
    message: "If that address is registered, a sign-in link is on its way.",
    ...(onScreenLink ? { magic_link: onScreenLink } : {}),
  });
});

authRoutes.get("/exchange", async (context) => {
  const token = context.req.query("token");
  if (!token) {
    return context.json(
      { error: { code: "magic_link_invalid", message: "Missing token" } },
      401,
    );
  }
  const link = await consumeMagicLink(context.env.DB, token);
  if (!link) {
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
  const session = await createSession(context.env.DB, {
    personId: link.person_id,
    roleHint: "login",
    userAgent: context.req.header("user-agent") ?? "",
  });
  setSessionCookie(context, session.id, SESSION_TTL_MS / 1000);
  return context.redirect(link.redirect_to, 302);
});

authRoutes.post("/logout", async (context) => {
  const auth = getAuth(context);
  if (auth?.kind === "session") {
    await revokeSession(context.env.DB, auth.sessionId);
  }
  clearSessionCookie(context);
  return context.json({ ok: true });
});

authRoutes.get("/me", async (context) => {
  const auth = getAuth(context);
  if (!auth) return unauthorized(context);
  const demoEvent = await findDemoEvent(context.env.DB);
  if (auth.kind === "session") {
    return context.json({
      kind: "session",
      person_id: auth.personId,
      org_id: auth.orgId,
      memberships: auth.memberships.map((membership) => ({
        event_id: membership.event_id,
        role: membership.role,
      })),
      demo_event_id: demoEvent?.id ?? null,
    });
  }
  return context.json({
    kind: "api_token",
    token_id: auth.tokenId,
    org_id: auth.orgId,
    event_id: auth.eventId,
    scopes: { permissions: auth.permissions, event_ids: auth.eventIds },
    demo_event_id: demoEvent?.id ?? null,
  });
});

async function findDemoEvent(db: D1Database): Promise<EventRow | null> {
  const event = await db
    .prepare("SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC LIMIT 1")
    .first<EventRow>();
  return event ?? null;
}

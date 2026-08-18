/** @jsxImportSource preact */

import { Hono } from "hono";
import type { Context } from "hono";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import { errorFields, loggerForEnv } from "../lib/observability/log";
import { resolveAuth } from "../lib/auth/auth-middleware";
import { authHasRole } from "../lib/auth/scope-resolution";
import { canMarkArrivals, resolveDayOfLink, touchDayOfLinkStatement } from "../lib/day-of/links";
import { readRunOfShow, readRunOfShowEvent, type RunOfShowEvent } from "../lib/day-of/run-of-show";
import { GREEN_ROOM_STYLES, GreenRoomPage } from "../ui/day-of/GreenRoom";
import { renderNotFoundDocument } from "./not-found.route";
import { DAY_OF_KEY_HEADER } from "./day-of.routes";

/**
 * The green room, served two ways.
 *
 * `/green-room` is the organizer's own door: a session, an ops seat, their
 * conference. `/green-room/k/<token>` is the crew's, and the token is the whole
 * of the standing behind it — no account, no person, no seat. The two produce
 * the same markup, because the run of show is the same run of show; only the
 * one control on each speaker row differs.
 *
 * It is server-rendered rather than a screen in the admin bundle for the same
 * reason `/signin` is: it is opened with no session at all, on a phone, on the
 * venue's wifi, by somebody who has forty seconds. What arrives is finished.
 *
 * A wrong, revoked, or foreign token gets `renderNotFoundDocument` — the same
 * 404 the site gives any address it does not serve. That is deliberate: a
 * revoked link must be indistinguishable from a URL that never existed, or
 * revocation leaks the fact that something was there.
 */

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Green room · Marquee</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

async function assetShell(assets: Fetcher | undefined, request: Request): Promise<string> {
  if (!assets || typeof assets.fetch !== "function") return FALLBACK_DOCUMENT;
  try {
    const response = await assets.fetch(new Request(new URL("/index.html", request.url), { method: "GET" }));
    return response.ok ? await response.text() : FALLBACK_DOCUMENT;
  } catch {
    return FALLBACK_DOCUMENT;
  }
}

/**
 * The page drives the same API every other caller does, so there is exactly one
 * writer for an arrival. The key travels in a header rather than in the request
 * URL: URLs land in access logs, and this one is a live credential.
 */
const GREEN_ROOM_SCRIPT = `
(() => {
  // The conference and the key live on the page container this route injects,
  // NOT on the run-of-show markup inside it — the credential is a property of
  // the door that was opened, not of the schedule being shown through it.
  const page = document.querySelector('[data-marquee-page="green-room"]');
  const shell = page && page.querySelector("[data-green-room]");
  if (!page || !shell) return;
  const eventId = page.getAttribute("data-event");
  const key = page.getAttribute("data-key") || "";
  // Without a conference there is no request worth sending. Refusing here means
  // a markup change that loses the attribute shows as a dead button, rather than
  // as a page that quietly asks the API about an event called "null".
  if (!eventId) return;
  const status = shell.querySelector("[data-status]");
  const say = (message, bad) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(bad));
  };
  const arrivedTotal = shell.querySelector("[data-count-arrived]");

  const recount = (card) => {
    const rows = card.querySelectorAll(".gr-speaker");
    const here = card.querySelectorAll(".gr-speaker.is-here").length;
    const label = card.querySelector("[data-arrived-count]");
    if (label && rows.length > 0) label.textContent = here + " of " + rows.length + " here";
    if (arrivedTotal) {
      const allHere = shell.querySelectorAll(".gr-speaker.is-here").length;
      const parts = arrivedTotal.textContent.split(" of ");
      if (parts.length === 2) arrivedTotal.textContent = allHere + " of " + parts[1];
    }
  };

  shell.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-mark]");
    if (!button) return;
    const row = button.closest(".gr-speaker");
    const card = button.closest("[data-session-card]");
    if (!row || !card) return;
    const sessionId = row.getAttribute("data-session");
    const personId = row.getAttribute("data-person");
    const here = button.getAttribute("data-state") === "here";
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    say(here ? "Taking that back…" : "Marking in…", false);
    try {
      const base = "/api/v1/events/" + encodeURIComponent(eventId) + "/agenda-items/" + encodeURIComponent(sessionId) + "/arrivals";
      const headers = { "content-type": "application/json" };
      if (key) headers[${JSON.stringify(DAY_OF_KEY_HEADER)}] = key;
      const response = await fetch(here ? base + "/" + encodeURIComponent(personId) : base, {
        method: here ? "DELETE" : "POST",
        headers: headers,
        body: here ? undefined : JSON.stringify({ person_id: personId })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error && body.error.message) || "That did not save. Try again.");
      const data = (body && body.data) || {};
      const nowHere = Boolean(data.arrived_at);
      button.setAttribute("data-state", nowHere ? "here" : "away");
      button.setAttribute("aria-pressed", nowHere ? "true" : "false");
      button.textContent = nowHere ? "Here" : "Mark in";
      row.classList.toggle("is-here", nowHere);
      const stamp = row.querySelector("[data-stamp]");
      if (stamp) {
        stamp.textContent = nowHere
          ? "Here · " + (data.marked_by_name || "an organizer") + " · " + new Date(data.arrived_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : (stamp.getAttribute("data-phone") || "Not marked in yet");
      }
      recount(card);
      say(nowHere ? "Marked in." : "Mark removed.", false);
    } catch (error) {
      say(error instanceof Error ? error.message : "That did not save. Try again.", true);
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
  });
})();
`;

interface GreenRoomView {
  event: RunOfShowEvent;
  canMark: boolean;
  markerName: string | null;
  basePath: string;
  key: string | null;
}

async function renderGreenRoom(
  context: Context<{ Bindings: Env }>,
  view: GreenRoomView,
): Promise<Response> {
  const url = new URL(context.req.url);
  const runOfShow = await readRunOfShow(context.env.DB, view.event, {
    day: url.searchParams.get("day")?.slice(0, 10) ?? undefined,
  });
  const markup = renderToString(
    <GreenRoomPage
      runOfShow={runOfShow}
      basePath={view.basePath}
      canMark={view.canMark}
      markerName={view.markerName}
    />,
  );
  const attributes = [
    'id="app"',
    'data-marquee-page="green-room"',
    `data-event="${escapeAttribute(view.event.id)}"`,
    view.key === null ? "" : `data-key="${escapeAttribute(view.key)}"`,
  ].filter((entry) => entry.length > 0).join(" ");
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  const inject = () => `<div ${attributes}>${markup}</div>`;
  const document = (shell.includes('<div id="app"></div>') ? shell : FALLBACK_DOCUMENT)
    .replace('<div id="app"></div>', inject)
    .replace("</head>", `<style data-marquee-green-room>${GREEN_ROOM_STYLES}</style></head>`)
    .replace("</body>", `<script data-marquee-green-room>${GREEN_ROOM_SCRIPT}</script></body>`);
  context.header("Cache-Control", "no-store");
  // A credential in the URL must not be handed to whatever the crew taps next.
  context.header("Referrer-Policy", "no-referrer");
  return context.html(document);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The conference an organizer means when they say "the green room".
 *
 * Today's, if one is running; otherwise the next one to open, and failing that
 * the most recent — the answer someone asks this question on a show morning
 * expects, in that order. An explicit `?event=` beats all of it.
 */
async function organizerEvent(
  db: D1Database,
  orgId: string,
  requested: string | null,
  today: string,
): Promise<RunOfShowEvent | null> {
  if (requested) {
    const row = await db
      .prepare(
        `SELECT id, name, slug, timezone, starts_on, ends_on FROM events
          WHERE org_id = ? AND (id = ? OR slug = ?) LIMIT 1`,
      )
      .bind(orgId, requested, requested)
      .first<RunOfShowEvent>();
    return row ?? null;
  }
  const row = await db
    .prepare(
      `SELECT id, name, slug, timezone, starts_on, ends_on FROM events
        WHERE org_id = ?
        ORDER BY CASE WHEN ? BETWEEN starts_on AND ends_on THEN 0
                      WHEN starts_on > ? THEN 1
                      ELSE 2 END ASC,
                 CASE WHEN starts_on > ? THEN starts_on ELSE '' END ASC,
                 ends_on DESC
        LIMIT 1`,
    )
    .bind(orgId, today, today, today)
    .first<RunOfShowEvent>();
  return row ?? null;
}

export const greenRoomRoutes = new Hono<{ Bindings: Env }>();

greenRoomRoutes.get("/green-room", async (context) => {
  const url = new URL(context.req.url);
  const auth = await resolveAuth(context).catch(() => null);
  if (!auth) {
    return context.redirect(`/signin?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  const today = new Date().toISOString().slice(0, 10);
  const event = await organizerEvent(
    context.env.DB,
    auth.orgId,
    url.searchParams.get("event")?.slice(0, 200) ?? null,
    today,
  );
  if (!event || !authHasRole(auth, "ops", event.id)) {
    return renderNotFoundDocument(await assetShell(context.env.ASSETS, context.req.raw));
  }
  const name = auth.kind === "session"
    ? (await context.env.DB.prepare("SELECT name FROM people WHERE id = ?").bind(auth.personId).first<{ name: string }>())?.name ?? "An organizer"
    : "An organizer";
  return renderGreenRoom(context, {
    event,
    canMark: true,
    markerName: name,
    basePath: "/green-room",
    key: null,
  });
});

greenRoomRoutes.get("/green-room/k/:token", async (context) => {
  const token = context.req.param("token");
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  try {
    const link = await resolveDayOfLink(context.env.DB, token);
    if (!link) return renderNotFoundDocument(shell);
    const event = await readRunOfShowEvent(context.env.DB, link.event_id);
    if (!event) return renderNotFoundDocument(shell);
    // "Last used" is what tells an organizer whether a link in the list is one
    // the crew is actually holding. Stamping it is throttled, so a phone
    // refreshing all morning costs one write an hour.
    await touchDayOfLinkStatement(context.env.DB, link, Date.now()).run();
    return await renderGreenRoom(context, {
      event,
      canMark: canMarkArrivals(link),
      markerName: canMarkArrivals(link) ? link.name : null,
      basePath: `/green-room/k/${token}`,
      key: canMarkArrivals(link) ? token : null,
    });
  } catch (error) {
    loggerForEnv(context.env).emit("worker_error", "error", {
      source: "greenRoomLink",
      ...errorFields(error),
    });
    throw error;
  }
});

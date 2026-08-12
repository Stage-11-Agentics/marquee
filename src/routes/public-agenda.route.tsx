/** @jsxImportSource preact */
import { Hono } from "hono";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import {
  loadPublicAgenda,
  loadPublicSession,
  loadPublicSpeaker,
  loadPublicSpeakerDirectory,
} from "../lib/public-site";
import {
  PUBLIC_AGENDA_SCRIPT,
  PUBLIC_SITE_STYLES,
  PublicAgendaPage,
  PublicNotFoundPage,
  PublicSessionPage,
  PublicSpeakerPage,
  PublicSpeakerDirectoryPage,
} from "../ui/public/agenda/PublicAgendaPage";

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Public program</title>${ICON_LINKS}</head><body><div id="app"></div><script type="module" src="/src/ui/app.tsx"></script></body></html>`;

async function assetShell(assets: Fetcher | undefined, request: Request): Promise<string> {
  if (!assets || typeof assets.fetch !== "function") return FALLBACK_DOCUMENT;
  const url = new URL("/index.html", request.url);
  const response = await assets.fetch(new Request(url, { method: "GET" }));
  return response.ok ? response.text() : FALLBACK_DOCUMENT;
}

export function renderPublicDocument(
  shell: string,
  markup: string,
  options: { title?: string; script?: string } = {},
): string {
  const document = shell.includes('<div id="app"></div>')
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  const titled = options.title
    ? document.replace(/<title>[^<]*<\/title>/i, `<title>${options.title} · Marquee</title>`)
    : document;
  const responsive = /<meta\s+[^>]*name=["']viewport["']/i.test(titled)
    ? titled
    : titled.replace("</head>", '<meta name="viewport" content="width=device-width, initial-scale=1"> </head>');
  return responsive
    .replace("</head>", `<style data-marquee-public>${PUBLIC_SITE_STYLES}</style></head>`)
    .replace("</body>", options.script ? `<script data-marquee-public>${options.script}</script></body>` : "</body>");
}

/**
 * The one branded public 404. Every public route renders through this, so a
 * bad slug on any of them lands on the same card with the same way back —
 * a raw `notFound()` on one route is the inconsistency this exists to prevent.
 */
export function notFoundDocument(shell: string): Response {
  return new Response(
    renderPublicDocument(shell, renderToString(<PublicNotFoundPage />), { title: "Unavailable" }),
    { status: 404, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" } },
  );
}

export const publicAgendaRoutes = new Hono<{ Bindings: Env }>();

/**
 * "The conference site" is what people call this page, and /site is the address
 * they try — including anyone reading it off our own published route list.
 * Without this it falls through to the app shell, whose router has no /site and
 * renders "Route not found": a dead end on a page that is very much alive at
 * /agenda. Redirect rather than double-render, so the agenda keeps one address.
 */
publicAgendaRoutes.get("/site", (context) => {
  const url = new URL(context.req.url);
  return context.redirect(`/agenda${url.search}`, 302);
});

publicAgendaRoutes.get("/agenda", async (context) => {
  const query = context.req.query();
  const data = await loadPublicAgenda(context.env.DB, {
    eventSlug: query.event ?? query.event_slug,
    day: query.day,
    track: query.track,
    format: query.format,
    room: query.room,
    q: query.q,
  });
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!data) return notFoundDocument(shell);
  context.header("Cache-Control", "no-store");
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicAgendaPage data={data} />),
    { title: "Agenda", script: PUBLIC_AGENDA_SCRIPT },
  ));
});

publicAgendaRoutes.get("/speakers", async (context) => {
  const query = context.req.query();
  const data = await loadPublicSpeakerDirectory(context.env.DB, {
    eventSlug: query.event ?? query.event_slug,
    q: query.q,
  });
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!data) return notFoundDocument(shell);
  context.header("Cache-Control", "no-store");
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSpeakerDirectoryPage data={data} />),
    { title: "Speakers" },
  ));
});

publicAgendaRoutes.get("/s/:slug", async (context) => {
  const query = context.req.query();
  const result = await loadPublicSession(context.env.DB, context.req.param("slug"), query.event ?? query.event_slug);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!result) return notFoundDocument(shell);
  context.header("Cache-Control", "no-store");
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSessionPage event={result.event} venue={result.venue} session={result.session} />),
    { title: result.session.title },
  ));
});

publicAgendaRoutes.get("/p/:slug", async (context) => {
  const query = context.req.query();
  const result = await loadPublicSpeaker(context.env.DB, context.req.param("slug"), query.event ?? query.event_slug);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!result) return notFoundDocument(shell);
  context.header("Cache-Control", "no-store");
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSpeakerPage event={result.event} venue={result.venue} speaker={result.speaker} />),
    { title: result.speaker.name },
  ));
});

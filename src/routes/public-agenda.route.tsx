/** @jsxImportSource preact */
import { Hono } from "hono";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import { escapeHtml } from "../jobs/mail/render";
import {
  loadPublicAgenda,
  publicAbstractSnippet,
  loadPublicEvent,
  loadPublicSession,
  loadPublicSpeaker,
  loadPublicSpeakerDirectory,
} from "../lib/public-site";
import { publishableStarCounts } from "../lib/star-beacons";
import { claimMailEnabled } from "../lib/attendee-claim-mail";
import { publicTurnstileExempt } from "./public-form.shared";
import { PUBLIC_SCHEDULE_SCRIPT } from "../ui/public/agenda/schedule-script";
import {
  PUBLIC_AGENDA_SCRIPT,
  PUBLIC_SITE_STYLES,
  PUBLIC_SPEAKER_SCRIPT,
  PublicAgendaPage,
  PublicAgentsPage,
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
  options: {
    title?: string;
    /** Public speaker permalinks use the exact event-facing title contract. */
    appendBrandToTitle?: boolean;
    script?: string;
    metadata?: {
      title: string;
      description: string;
      url: string;
      image: string;
      type?: "website" | "article" | "profile";
    };
  } = {},
): string {
  const document = shell.includes('<div id="app"></div>')
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  const titled = options.title
    ? document.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(options.title)}${options.appendBrandToTitle === false ? "" : " · Marquee"}</title>`,
    )
    : document;
  const metadata = options.metadata
    ? `<meta property="og:title" content="${escapeHtml(options.metadata.title)}"><meta property="og:description" content="${escapeHtml(options.metadata.description)}"><meta property="og:type" content="${options.metadata.type ?? "website"}"><meta property="og:url" content="${escapeHtml(options.metadata.url)}"><meta property="og:image" content="${escapeHtml(options.metadata.image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(options.metadata.title)}"><meta name="twitter:description" content="${escapeHtml(options.metadata.description)}"><meta name="twitter:image" content="${escapeHtml(options.metadata.image)}">`
    : "";
  const responsive = /<meta\s+[^>]*name=["']viewport["']/i.test(titled)
    ? titled
    : titled.replace("</head>", '<meta name="viewport" content="width=device-width, initial-scale=1"> </head>');
  return (metadata ? responsive.replace("</head>", `${metadata}</head>`) : responsive)
    .replace("</head>", `<style data-marquee-public>${PUBLIC_SITE_STYLES}</style></head>`)
    .replace("</body>", options.script ? `<script data-marquee-public>${options.script}</script></body>` : "</body>");
}

const PUBLIC_PAGE_CACHE_CONTROL = "public, max-age=300";

function agendaDescription(eventName: string, titles: readonly string[]): string {
  const visible = titles.filter(Boolean).slice(0, 3).join(" · ");
  return visible
    ? `${eventName}'s published program: ${visible}${titles.length > 3 ? " and more" : ""}.`
    : `${eventName}'s published program and speaker lineup.`;
}

function sessionDescription(title: string, abstract: string | null, speakers: readonly string[]): string {
  const snippet = publicAbstractSnippet(abstract)?.head;
  const speakerLine = speakers.filter(Boolean).join(" · ");
  return [snippet ?? title, speakerLine ? `Featuring ${speakerLine}.` : null].filter(Boolean).join(" ");
}

function publicPageMetadata(
  requestUrl: string,
  metadata: { title: string; description: string; type?: "website" | "article" | "profile" },
) {
  const url = new URL(requestUrl);
  return {
    ...metadata,
    url: url.toString(),
    image: `${url.origin}/marquee-share-card.svg`,
  };
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

/**
 * `?view=mine` is the same page with a different question asked of it, so it is
 * a URL rather than a client-only mode: linkable, back-button-correct, and
 * server-rendered with the WHOLE program. The starred set is on the device, so
 * the server cannot filter it — and a facet-filtered itinerary would count and
 * chart a fraction of the attendee's picks while claiming to be their schedule.
 */
publicAgendaRoutes.get("/agenda", async (context) => {
  const query = context.req.query();
  const view = query.view === "mine" ? "mine" : "agenda";
  const data = await loadPublicAgenda(context.env.DB, {
    eventSlug: query.event ?? query.event_slug,
    day: view === "mine" ? undefined : query.day,
    allDays: view === "mine",
    track: view === "mine" ? undefined : query.track,
    format: view === "mine" ? undefined : query.format,
    room: view === "mine" ? undefined : query.room,
    q: view === "mine" ? undefined : query.q,
  });
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!data) return notFoundDocument(shell);
  // A server aggregate, read at render. Deliberately not a live tally: the
  // number is session metadata an organizer chose to publish, not a counter
  // that ticks while you look at it (round-2 review ruling).
  const starCounts = await publishableStarCounts(context.env.DB, data.event.id);
  const turnstileSiteKey = (await publicTurnstileExempt(context.env.DB, data.event.id))
    ? null
    : context.env.TURNSTILE_SITE_KEY ?? null;
  context.header("Cache-Control", PUBLIC_PAGE_CACHE_CONTROL);
  const metadata = publicPageMetadata(context.req.url, {
    title: `${data.event.name} — public agenda`,
    description: agendaDescription(data.event.name, data.sessions.map((session) => session.title)),
  });
  return context.html(renderPublicDocument(
    shell,
    renderToString(
      <PublicAgendaPage
        data={data}
        view={view}
        starCounts={starCounts}
        claimEnabled={claimMailEnabled(context.env)}
        turnstileSiteKey={turnstileSiteKey}
      />,
    ),
    { title: view === "mine" ? "My schedule" : "Agenda", metadata, script: `${PUBLIC_AGENDA_SCRIPT}\n${PUBLIC_SCHEDULE_SCRIPT}` },
  ));
});

publicAgendaRoutes.get("/agenda/agents", async (context) => {
  const query = context.req.query();
  const event = await loadPublicEvent(context.env.DB, query.event ?? query.event_slug);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!event) return notFoundDocument(shell);
  context.header("Cache-Control", "public, max-age=300");
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicAgentsPage event={event} origin={new URL(context.req.url).origin} />),
    { title: "For agents", script: PUBLIC_SCHEDULE_SCRIPT },
  ));
});

publicAgendaRoutes.get("/speakers", async (context) => {
  const query = context.req.query();
  const data = await loadPublicSpeakerDirectory(context.env.DB, {
    eventSlug: query.event ?? query.event_slug,
    q: query.q,
    view: query.view,
  });
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!data) return notFoundDocument(shell);
  context.header("Cache-Control", PUBLIC_PAGE_CACHE_CONTROL);
  const metadata = publicPageMetadata(context.req.url, {
    title: `${data.event.name} — speakers`,
    description: `${data.event.name}'s published speaker directory.`,
  });
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSpeakerDirectoryPage data={data} />),
    { title: "Speakers", metadata, script: PUBLIC_SCHEDULE_SCRIPT },
  ));
});

publicAgendaRoutes.get("/s/:slug", async (context) => {
  const query = context.req.query();
  const result = await loadPublicSession(context.env.DB, context.req.param("slug"), query.event ?? query.event_slug);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!result) return notFoundDocument(shell);
  context.header("Cache-Control", PUBLIC_PAGE_CACHE_CONTROL);
  const metadata = publicPageMetadata(context.req.url, {
    title: `${result.session.title} — ${result.event.name}`,
    description: sessionDescription(result.session.title, result.session.abstract, result.session.speakers.map((speaker) => speaker.name)),
    type: "article",
  });
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSessionPage event={result.event} venue={result.venue} session={result.session} origin={new URL(context.req.url).origin} starCounts={await publishableStarCounts(context.env.DB, result.event.id)} />),
    { title: result.session.title, metadata, script: PUBLIC_SCHEDULE_SCRIPT },
  ));
});

publicAgendaRoutes.get("/p/:slug", async (context) => {
  const query = context.req.query();
  const result = await loadPublicSpeaker(context.env.DB, context.req.param("slug"), query.event ?? query.event_slug);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (!result) return notFoundDocument(shell);
  context.header("Cache-Control", PUBLIC_PAGE_CACHE_CONTROL);
  const metadata = publicPageMetadata(context.req.url, {
    title: `${result.speaker.name} — speaking at ${result.event.name}`,
    description: `${result.speaker.name}'s published talks at ${result.event.name}: ${result.speaker.sessions.map((session) => session.title).join(" · ")}.`,
    type: "profile",
  });
  return context.html(renderPublicDocument(
    shell,
    renderToString(<PublicSpeakerPage event={result.event} venue={result.venue} speaker={result.speaker} />),
    { title: metadata.title, appendBrandToTitle: false, metadata, script: `${PUBLIC_SCHEDULE_SCRIPT}\n${PUBLIC_SPEAKER_SCRIPT}` },
  ));
});

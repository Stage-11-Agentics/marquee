/** @jsxImportSource preact */
import { Hono } from "hono";
import { renderToString } from "preact-render-to-string";

import { EMBED_KINDS, EMBED_OUTPUT_FORMATS, type EmbedKind, type EmbedOutputFormat } from "../db/schema";
import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import {
  loadPublicEmbed,
  loadPublicEvent,
  publicEmbedCacheKey,
  type PublicEmbedCache,
  readPublicEmbedCache,
  resolvePublicEmbed,
  writePublicEmbedCache,
} from "../lib/public-site";
import {
  EMBED_CONFIG_SCRIPT,
  EMBED_STYLES,
  EmbedConfigPage,
  EmbedPage,
} from "../ui/embeds/EmbedPage";
import { buildPublicCalendarFeed } from "../lib/public-ics";
import { PUBLIC_SITE_STYLES } from "../ui/public/agenda/PublicAgendaPage";
import { renderPublicDocument } from "./public-agenda.route";

export const embedRoutes = new Hono<{ Bindings: Env }>();

function safeAccent(value: string | undefined): string | null {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : null;
}

async function readEmbed(
  database: D1Database,
  cache: PublicEmbedCache | undefined,
  request: { slug: string; eventSlug?: string | null; kind?: EmbedKind; track?: string | null; format?: string | null; room?: string | null; status?: string | null; accent?: string | null; layout?: string | null; fields?: string | null },
) {
  const resolved = await resolvePublicEmbed(database, request);
  if (!resolved) return null;
  const filters = {
    track: request.track ?? null,
    format: request.format ?? null,
    room: request.room ?? null,
    status: request.status ?? null,
    accent: safeAccent(request.accent ?? undefined),
    layout: request.layout === "list" ? "list" : null,
    fields: request.fields ?? null,
  };
  const key = publicEmbedCacheKey(resolved.event.id, resolved.slug, filters);
  const cached = await readPublicEmbedCache(cache, key);
  if (cached) return { data: cached, key };
  const data = await loadPublicEmbed(database, resolved, filters);
  await writePublicEmbedCache(cache, key, data);
  return { data, key };
}

function embedDocumentStyles(): string {
  return `${PUBLIC_SITE_STYLES}\n${EMBED_STYLES}`;
}

function renderEmbedDocument(shell: string, markup: string, script?: string): string {
  return renderPublicDocument(shell, markup, { title: "Embed", script })
    .replace("</style>", "</style>")
    .replace(PUBLIC_SITE_STYLES, embedDocumentStyles());
}

function renderBasicEmbedDocument(markup: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Basic embed</title></head><body data-embed-output="basic">${markup}</body></html>`;
}

async function shellFor(context: { env: Env; req: { raw: Request } }): Promise<string> {
  const response = await context.env.ASSETS.fetch(new Request(new URL("/index.html", context.req.raw.url), { method: "GET" }));
  if (response.ok) return response.text();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Embed</title>${ICON_LINKS}</head><body><div id="app"></div><script type="module" src="/src/ui/app.tsx"></script></body></html>`;
}

embedRoutes.get("/embed/config", async (context) => {
  const query = context.req.query();
  const kind: EmbedKind = EMBED_KINDS.includes(query.kind as EmbedKind) ? (query.kind as EmbedKind) : "agenda";
  const output: EmbedOutputFormat = EMBED_OUTPUT_FORMATS.includes(query.output as EmbedOutputFormat) ? (query.output as EmbedOutputFormat) : "html";
  const event = await loadPublicEvent(context.env.DB, query.event ?? query.event_slug);
  if (!event) return context.notFound();
  const track = query.track ?? "";
  const format = query.format ?? "";
  const room = query.room ?? "";
  const status = query.status ?? "";
  const layout = query.layout === "list" ? "list" : "cards";
  const accent = safeAccent(query.accent) ?? event.accent ?? "#0b6a72";
  const resolved = await resolvePublicEmbed(context.env.DB, {
    slug: `${event.slug}-${kind}`,
    eventSlug: event.slug,
    kind,
  });
  if (!resolved) return context.notFound();
  const preview = await loadPublicEmbed(context.env.DB, resolved, { track, format, room, status, accent, layout, fields: query.fields ?? null });
  const shell = await shellFor(context);
  const markup = renderToString(<EmbedConfigPage event={event} tracks={preview.tracks} kind={kind} track={track} status={status} layout={layout} accent={accent} output={output} fields={preview.config.fields} preview={preview} />);
  return context.html(renderEmbedDocument(shell, markup, EMBED_CONFIG_SCRIPT));
});

embedRoutes.get("/embed/:slug", async (context) => {
  const query = context.req.query();
  const rawSlug = context.req.param("slug") ?? "";
  const isCalendarFeed = rawSlug.endsWith(".ics");
  const slug = isCalendarFeed ? rawSlug.slice(0, -4) : rawSlug;
  const result = await readEmbed(context.env.DB, context.env.CACHE, {
    slug,
    eventSlug: query.event ?? query.event_slug,
    track: query.track,
    format: query.format,
    room: query.room,
    status: query.status,
    accent: query.accent,
    layout: query.layout,
    fields: query.fields,
  });
  if (!result) return context.notFound();
  context.header("Cache-Control", "public, max-age=30, s-maxage=30");
  if (isCalendarFeed) {
    context.header("Content-Type", "text/calendar; charset=utf-8");
    context.header("Content-Disposition", `inline; filename="${encodeURIComponent(slug)}.ics"`);
    return context.body(buildPublicCalendarFeed(result.data, new URL(context.req.url).origin));
  }
  if (query.style === "basic") {
    return context.html(renderBasicEmbedDocument(renderToString(<EmbedPage data={result.data} basic />)));
  }
  const shell = await shellFor(context);
  return context.html(renderEmbedDocument(shell, renderToString(<EmbedPage data={result.data} />)));
});

// The prototype's copyable snippet used /{event}/{kind}/embed. Keep that URL
// working while the canonical public contract remains /embed/{slug}.
embedRoutes.get("/:eventSlug/:kind/embed", async (context) => {
  const kindParam = context.req.param("kind");
  const kind: EmbedKind | null = EMBED_KINDS.includes(kindParam as EmbedKind) ? (kindParam as EmbedKind) : null;
  if (!kind) return context.notFound();
  const query = context.req.query();
  const result = await readEmbed(context.env.DB, context.env.CACHE, {
    slug: `${context.req.param("eventSlug")}-${kind}`,
    eventSlug: context.req.param("eventSlug"),
    kind,
    track: query.track,
    format: query.format,
    room: query.room,
    status: query.status,
    accent: query.accent,
    layout: query.layout,
    fields: query.fields,
  });
  if (!result) return context.notFound();
  context.header("Cache-Control", "public, max-age=30, s-maxage=30");
  if (query.style === "basic") {
    return context.html(renderBasicEmbedDocument(renderToString(<EmbedPage data={result.data} basic />)));
  }
  const shell = await shellFor(context);
  return context.html(renderEmbedDocument(shell, renderToString(<EmbedPage data={result.data} />)));
});

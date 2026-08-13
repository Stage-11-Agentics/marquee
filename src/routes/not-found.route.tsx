/** @jsxImportSource preact */

import type { Context } from "hono";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import { renderPublicDocument } from "./public-agenda.route";
import { PublicNotFoundPage } from "../ui/public/agenda/PublicAgendaPage";
import { matchRoute } from "../ui/shell/route-table";

/**
 * The site's last word.
 *
 * Everything the Worker does not claim, and everything the assets router cannot
 * find, arrives here. Two answers live at this junction and they are not the
 * same answer:
 *
 *   - A path the SPA's own router will resolve — `/submissions/abc`, `/board`,
 *     `/settings/venues` — is a real page whose HTML happens to be the shared
 *     shell. It gets the shell and a 200.
 *   - Anything else is not a page. It gets a 404 and a page that says so.
 *
 * The line between them is `matchRoute`, imported from the SPA's own route
 * table — the same function `AppShell` calls to decide what to draw. A
 * hand-written list here would be a second answer to a question that already
 * has one, and it would rot the first time someone added a screen.
 *
 * Before this existed, every unmatched path returned 200 with a byte-identical
 * 3,375-byte shell: a dead README link looked alive to curl, a mistyped URL
 * gave a visitor "Route not found" under a session-expired modal, and a browsing
 * agent spent a turn discovering that a plausible URL was nothing at all.
 */

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Marquee</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

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
 * True when the SPA router owns this URL. `matchRoute` already understands the
 * table's parameter segments (`/submissions/:id`) and its query-bearing rows
 * (`/submissions?status=submitted`), so this adds nothing to it but a name.
 */
export function isClientRoute(pathname: string, search = ""): boolean {
  return matchRoute(pathname, search) !== undefined;
}

/**
 * The shell is stamped `data-marquee-page="not-found"` so `app.tsx` leaves it
 * alone. Without the mark the bundle boots, mounts `AppShell` over the card,
 * finds no session, and draws "Your session ended — Sign in" on top of a page
 * a logged-out stranger is entitled to read.
 */
export function renderNotFoundDocument(shell: string): Response {
  const markup = renderToString(
    <PublicNotFoundPage
      heading="That page does not exist."
      detail="The address is not one Marquee serves. It may have been mistyped, or it may have moved."
      actionLabel="Go to the conference site"
      actionHref="/agenda"
    />,
  );
  const document = renderPublicDocument(shell, markup, { title: "Not found" })
    .replace('<div id="app">', '<div id="app" data-marquee-page="not-found">');
  return new Response(document, {
    status: 404,
    headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" },
  });
}

/**
 * The `app.all("*")` terminal. Assets answer first when they can; a real client
 * route gets the shell; everything else gets an honest 404.
 */
export async function serveAssetOrNotFound(context: Context<{ Bindings: Env }>): Promise<Response> {
  const assetResponse = await context.env.ASSETS.fetch(context.req.raw);
  if (assetResponse.status !== 404) return assetResponse;

  const url = new URL(context.req.url);
  const shell = await assetShell(context.env.ASSETS, context.req.raw);
  if (isClientRoute(url.pathname, url.search)) {
    return new Response(shell, {
      // The shell carries no route-specific content, so it is the one document
      // the SPA is allowed to reuse — but it must not be cached as if it were
      // the page the reader asked for.
      headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" },
    });
  }
  return renderNotFoundDocument(shell);
}

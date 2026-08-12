/** @jsxImportSource preact */

import { Hono } from "hono";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { notFoundDocument } from "./public-agenda.route";
import { loadPublicForm, toPublicFormState } from "./public-form.shared";
import { PublicForm } from "../ui/public/form/PublicForm";
import { PUBLIC_FORM_STYLES } from "../ui/public/form/styles";

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Call for speakers</title></head><body><div id="app"></div></body></html>`;

async function assetShell(assets: Fetcher, request: Request): Promise<string> {
  if (!assets || typeof assets.fetch !== "function") return FALLBACK_DOCUMENT;
  const url = new URL("/index.html", request.url);
  const response = await assets.fetch(new Request(url, { method: "GET" }));
  return response.ok ? response.text() : FALLBACK_DOCUMENT;
}

function safeStateJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderPublicDocument(shell: string, state: ReturnType<typeof toPublicFormState>): string {
  const markup = renderToString(<PublicForm initial={state} />);
  const document = shell.includes('<div id="app"></div>')
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  return document
    .replace("</head>", `<style data-marquee-public-form>${PUBLIC_FORM_STYLES}</style></head>`)
    .replace("</body>", `<script type="application/json" id="public-form-state">${safeStateJson(state)}</script></body>`);
}

export const publicFormRoutes = new Hono<{ Bindings: Env }>();

publicFormRoutes.get("/f/:slug", async (context) => {
  const query = new URL(context.req.url).searchParams;
  const record = await loadPublicForm(context.env.DB, context.req.param("slug"), {
    resumeToken: query.get("resume") ?? undefined,
    email: query.get("email") ?? undefined,
  });
  // A slug that resolves to no form is a public dead end, so it gets the same
  // branded card as a bad session or speaker slug rather than a bare 404.
  if (!record) return notFoundDocument(await assetShell(context.env.ASSETS, context.req.raw));
  const state = toPublicFormState(record, {
    origin: new URL(context.req.url).origin,
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
  });
  context.header("Cache-Control", "no-store");
  return context.html(renderPublicDocument(await assetShell(context.env.ASSETS, context.req.raw), state));
});

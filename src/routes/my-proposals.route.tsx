import { Hono } from "hono";
import type { Context } from "hono";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { ICON_LINKS } from "../lib/head-icons";
import { errorFields, loggerForEnv } from "../lib/observability/log";
import { publicTurnstileExempt } from "./public-form.shared";
import { PROPOSALS_LINK_ACKNOWLEDGEMENT, resolveProposalsEvent } from "./public-proposals.routes";

/**
 * The submitter's front door.
 *
 * Everything else the conference sends a submitter is about one abstract — a
 * resume link, a confirmation, a decision. This is the only address that is
 * about the *person*: every proposal they have sent this conference, and where
 * each one stands. It asks for an email and nothing else, because the product's
 * promise to a submitter is that there is no password to create and no account
 * to keep.
 *
 * It is server-rendered rather than part of the admin bundle for the same
 * reason `/signin` is: it is reached with no session at all, and it is what
 * gets one.
 *
 * The page never tells the visitor anything about the address they typed. The
 * acknowledgement is the same sentence whether that address has three proposals
 * or has never been seen here — which is what makes typing somebody else's
 * address useless rather than informative.
 */

export interface MyProposalsPageState {
  /** Null when this deployment has no live conference yet; the form still opens. */
  event: { name: string; slug: string } | null;
  /** Empty when the conference is exempt (demo mode); the page then mounts no widget. */
  turnstileSiteKey: string;
}

function MyProposalsBody({ state }: { state: MyProposalsPageState }): JSX.Element {
  const conference = state.event?.name ?? "this conference";
  return (
    <div class="proposals-body">
      <div class="eyebrow">Your proposals</div>
      <h1>Every proposal you have sent</h1>
      <p class="proposals-lede">
        One page for everything you have sent to {conference}, each with where it stands.
        <strong> No password and no account.</strong> Give the address you submitted with and a
        link arrives by email.
      </p>
      <form class="proposals-form" id="proposals-form" method="post" action="/api/v1/public/proposals/link">
        <input type="hidden" name="event" value={state.event?.slug ?? ""} />
        <label class="proposals-field" for="proposals-email">
          <span>The email you submitted with</span>
          <input
            id="proposals-email"
            name="email"
            type="email"
            autocomplete="email"
            inputMode="email"
            required
          />
        </label>
        <div class="proposals-security" data-proposals-turnstile data-sitekey={state.turnstileSiteKey}>
          {state.turnstileSiteKey ? <span data-proposals-security-copy>Complete the security check before sending.</span> : null}
        </div>
        <div class="proposals-actions">
          {/* The status line holds its height whether or not it has anything to
              say, so the button never moves under the pointer mid-submit. The
              acknowledgement wraps to two lines at this card width. */}
          <span class="proposals-status" id="proposals-status" role="status" aria-live="polite"></span>
          <button class="button primary" type="submit" id="proposals-submit">
            Email me the link
          </button>
        </div>
      </form>
      <div class="proposals-note">
        <strong>Why an email and not a password.</strong> Sending you a link is how the
        conference knows the address is yours. Until you open it, nothing about that address is
        shown here and nothing about it changes — which is what stops anyone else asking this
        page about you.
      </div>
    </div>
  );
}

export function MyProposalsPage({ state }: { state: MyProposalsPageState }): JSX.Element {
  return (
    <div class="proposals-shell">
      <header class="proposals-top">
        <a class="brand" href="/" aria-label="Marquee home">
          <span class="brand-mark">M</span>
          <span class="brand-name">Marquee</span>
        </a>
      </header>
      <main class="proposals-main">
        <section class="proposals-card">
          <MyProposalsBody state={state} />
        </section>
      </main>
    </div>
  );
}

const PROPOSALS_STYLES = `
.proposals-shell { min-height: 100vh; background: var(--bg); display: grid; grid-template-rows: auto 1fr; }
.proposals-top { padding: 20px clamp(20px,5vw,70px); border-bottom: 1px solid var(--line); background: var(--panel); }
.proposals-top .brand { padding: 0; }
.proposals-main { display: grid; place-items: start center; align-content: start; gap: 16px; padding: clamp(28px,6vw,64px) 20px; }
.proposals-card { width: min(620px,100%); background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius); padding: clamp(20px,4vw,30px); }
.proposals-body h1 { font: 500 clamp(24px,3.4vw,34px)/1.1 var(--mono); letter-spacing: -.04em; margin: 6px 0 12px; }
.proposals-lede { color: var(--ink-soft); font-size: 14px; line-height: 1.65; margin: 0 0 22px; }
.proposals-form { display: grid; gap: 16px; }
.proposals-field { display: grid; gap: 6px; font-size: 12px; }
.proposals-field input { min-height: 38px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--sunk); color: var(--ink); font: 400 13px/1.4 var(--sans); }
.proposals-security { color: var(--ink-soft); font: 400 11px/1.4 var(--mono); min-height: 0; }
.proposals-security:not(:empty) { min-height: 42px; }
.proposals-security-copy { display: block; padding: 10px 0; }
.proposals-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.proposals-status { min-height: 30px; flex: 1; color: var(--ink-soft); font: 400 11px/1.4 var(--mono); }
.proposals-status.is-error { color: var(--danger); }
.proposals-note { margin-top: 20px; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--sunk); padding: 10px 12px; font-size: 11.5px; color: var(--ink-soft); line-height: 1.6; }
@media (max-width: 520px) { .proposals-actions { flex-direction: column; align-items: stretch; } .proposals-actions .button { width: 100%; } }
`;

const PROPOSALS_SCRIPT = `
(() => {
  const form = document.getElementById("proposals-form");
  if (!form) return;
  const status = document.getElementById("proposals-status");
  const submit = document.getElementById("proposals-submit");
  const holder = document.querySelector("[data-proposals-turnstile]");
  const siteKey = holder ? holder.getAttribute("data-sitekey") : "";
  let token = "";
  let widget = null;

  // An exempt conference sends no site key and mounts nothing: the page must
  // not pay for a third-party script it has no use for.
  if (siteKey && holder) {
    const render = () => {
      if (!window.turnstile || typeof window.turnstile.render !== "function") return;
      try {
        widget = window.turnstile.render(holder, {
          sitekey: siteKey,
          callback: (value) => { token = value; },
          "expired-callback": () => { token = ""; },
          "error-callback": () => { token = ""; }
        }) || null;
        holder.querySelector("[data-proposals-security-copy]")?.remove();
      } catch (error) { /* the send still tries; the server is the gate */ }
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render);
      document.head.append(script);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;
    if (status) { status.classList.remove("is-error"); status.textContent = "Sending…"; }
    try {
      const response = await fetch("/api/v1/public/proposals/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") || "").trim(),
          event: String(data.get("event") || "") || undefined,
          turnstileToken: token || undefined
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error && body.error.message) || "That could not be sent. Try again.");
      if (status) status.textContent = (body && body.message) || ${JSON.stringify(PROPOSALS_LINK_ACKNOWLEDGEMENT)};
      // A Turnstile token is single-use server-side, so a second send with the
      // same one is a 403 nobody can get past. Reset the widget, not the page.
      if (widget !== null && window.turnstile && typeof window.turnstile.reset === "function") {
        token = "";
        try { window.turnstile.reset(widget); } catch (error) { /* the next send re-challenges */ }
      }
    } catch (error) {
      if (status) { status.classList.add("is-error"); status.textContent = error instanceof Error ? error.message : "That could not be sent. Try again."; }
    } finally {
      submit.removeAttribute("aria-busy");
      submit.disabled = false;
    }
  });
})();
`;

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Your proposals</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

export function renderMyProposalsDocument(shell: string, state: MyProposalsPageState): string {
  const markup = renderToString(<MyProposalsPage state={state} />);
  // A function replacer, never a string one: `$&`, `$'` and `` $` `` are
  // substitution directives to String.replace, and `markup` carries the
  // conference's own name.
  const inject = () => `<div id="app">${markup}</div>`;
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', inject)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', inject);
  return document
    .replace("</head>", `<style data-marquee-proposals>${PROPOSALS_STYLES}</style></head>`)
    .replace("</body>", `<script data-marquee-proposals>${PROPOSALS_SCRIPT}</script></body>`);
}

/**
 * The built document, or an honest minimum. A deployment whose ASSETS binding
 * is missing still serves this page rather than a 500 — losing the chrome must
 * never lose a door.
 */
async function assetShell(assets: Fetcher | undefined, request: Request): Promise<string> {
  if (!assets) return FALLBACK_DOCUMENT;
  try {
    const url = new URL("/index.html", request.url);
    const response = await assets.fetch(new Request(url, { method: "GET" }));
    if (!response.ok) return FALLBACK_DOCUMENT;
    return response.text();
  } catch {
    return FALLBACK_DOCUMENT;
  }
}

export async function readMyProposalsState(
  context: Context<{ Bindings: Env }>,
): Promise<MyProposalsPageState> {
  const url = new URL(context.req.url);
  const requested = url.searchParams.get("event")?.slice(0, 200) ?? null;
  let event: MyProposalsPageState["event"] = null;
  let turnstileSiteKey = "";
  try {
    const live = await resolveProposalsEvent(context.env.DB, requested);
    if (live) {
      event = { name: live.name, slug: live.slug };
      turnstileSiteKey = (await publicTurnstileExempt(context.env.DB, live.id))
        ? ""
        : (context.env as unknown as { TURNSTILE_SITE_KEY?: string }).TURNSTILE_SITE_KEY ?? "";
    }
  } catch (error) {
    // A page that cannot read its own preconditions still has to open: the form
    // asks for an address rather than asserting anything about the instance, so
    // it is the state that is safe to be wrong about.
    loggerForEnv(context.env).emit("worker_error", "error", {
      source: "myProposalsPage",
      ...errorFields(error),
    });
  }
  return { event, turnstileSiteKey };
}

export const myProposalsRoutes = new Hono<{ Bindings: Env }>();

async function serveMyProposals(context: Context<{ Bindings: Env }>): Promise<Response> {
  const state = await readMyProposalsState(context);
  context.header("Cache-Control", "no-store");
  return context.html(
    renderMyProposalsDocument(await assetShell(context.env.ASSETS, context.req.raw), state),
  );
}

/**
 * Three paths, one page. Humans and agents both guess URLs, and each 404 costs
 * a turn (the MRQ-131 precedent). They are written out rather than looped
 * because `check:routes` reads `.get("…")` literals out of this file, and a
 * loop is invisible to it.
 */
myProposalsRoutes.get("/my-proposals", serveMyProposals);
myProposalsRoutes.get("/my-submissions", serveMyProposals);
myProposalsRoutes.get("/proposals", serveMyProposals);

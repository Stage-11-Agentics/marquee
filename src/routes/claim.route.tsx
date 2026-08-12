import { Hono } from "hono";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { readInstanceLink } from "../lib/auth/instance-claim";
import { ICON_LINKS } from "../lib/head-icons";
import { errorFields, loggerForEnv } from "../lib/observability/log";

/**
 * The one human-only moment in the cold start.
 *
 * An agent runs the deploy, but it must not run this: ownership has to land on
 * a person, so the agent hands over a URL and stops (ruling D5). The page is
 * server-rendered rather than part of the admin bundle because it is reached
 * with no session at all — it is what creates one.
 *
 * `/claim/:token` and `/join/:token` are the same page with different copy: the
 * first creates the instance's first owner, the second adds an organizer to one
 * that already has one. Both post to the same exchange.
 */

export type ClaimDoor = "claim" | "org_invite";

export interface ClaimPageState {
  door: ClaimDoor;
  /** False for used, expired, and unknown alike — one answer, no oracle. */
  live: boolean;
  name: string;
  email: string;
  token: string;
}

const INERT_TITLE: Record<ClaimDoor, string> = {
  claim: "This claim link is no longer valid.",
  org_invite: "This invite link is no longer valid.",
};

/**
 * One inert page for used, expired, and unknown. A visitor who guesses a token
 * learns exactly what a visitor holding a spent one learns, which is the only
 * way the page can be both helpful and silent about instance state.
 */
const INERT_COPY: Record<ClaimDoor, string> = {
  claim:
    "A claim link works once. To recover a locked-out instance, re-run the claim-link command in your deploy terminal — it prints a fresh one, and it will keep doing that forever.",
  org_invite:
    "An invite link works once. Ask an organizer of this instance to mint you a new one from Conference settings → Organizers.",
};

function ClaimForm({ state }: { state: ClaimPageState }): JSX.Element {
  const isClaim = state.door === "claim";
  return (
    <div class="claim-body">
      <div class="eyebrow">{isClaim ? "Claim this instance" : "Join this instance"}</div>
      <h1>{isClaim ? "Claim this instance" : "Confirm who you are"}</h1>
      <p class="claim-lede">
        {isClaim
          ? "The first owner is created here, once. Everything else — organizers, tokens, conferences — flows from this person."
          : "One link, one person, one use. Confirm your name and email and you are in."}
      </p>
      <form class="claim-form" id="claim-form" method="post" action="/api/v1/claim">
        <input type="hidden" name="token" value={state.token} />
        <input type="hidden" name="purpose" value={state.door} />
        <label class="claim-field" for="claim-name">
          <span>Your name</span>
          <input id="claim-name" name="name" value={state.name} autocomplete="name" required />
        </label>
        <label class="claim-field" for="claim-email">
          <span>Email</span>
          <input id="claim-email" name="email" value={state.email} autocomplete="email" required />
          <span class="claim-note">
            Unverified for now — this instance may not be able to send mail yet, and claiming must
            not depend on it.
          </span>
        </label>
        <div class="claim-callout">
          <strong>No password, ever.</strong> Once mail is configured, sign-in links arrive by
          email. Locked out before then? Re-run the claim-link command — the deploy terminal is the
          recovery path.
        </div>
        <div class="claim-actions">
          <span class="claim-status" id="claim-status" role="status" aria-live="polite"></span>
          <button class="button primary" type="submit" id="claim-submit">
            {isClaim ? "Claim instance · become owner" : "Join as an organizer"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InertPanel({ door }: { door: ClaimDoor }): JSX.Element {
  return (
    <div class="claim-body">
      <div class="eyebrow">{door === "claim" ? "Claim link · spent" : "Invite link · spent"}</div>
      <h1>{INERT_TITLE[door]}</h1>
      <p class="claim-lede">{INERT_COPY[door]}</p>
      {door === "claim" && (
        <div class="claim-callout">
          <code>node cli/marquee.mjs setup claim-link --url "$MARQUEE_URL" --json</code>
        </div>
      )}
    </div>
  );
}

export function ClaimPage({ state }: { state: ClaimPageState }): JSX.Element {
  return (
    <div class="claim-shell">
      <header class="claim-top">
        <a class="brand" href="/" aria-label="Marquee home">
          <span class="brand-mark">M</span>
          <span class="brand-name">Marquee</span>
        </a>
      </header>
      <main class="claim-main">
        <section class="claim-card">
          {state.live ? <ClaimForm state={state} /> : <InertPanel door={state.door} />}
        </section>
      </main>
    </div>
  );
}

const CLAIM_STYLES = `
.claim-shell { min-height: 100vh; background: var(--bg); display: grid; grid-template-rows: auto 1fr; }
.claim-top { padding: 20px clamp(20px,5vw,70px); border-bottom: 1px solid var(--line); background: var(--panel); }
.claim-top .brand { padding: 0; }
.claim-main { display: grid; place-items: start center; padding: clamp(28px,6vw,64px) 20px; }
.claim-card { width: min(620px,100%); background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius); padding: clamp(20px,4vw,30px); }
.claim-body h1 { font: 500 clamp(24px,3.4vw,34px)/1.1 var(--mono); letter-spacing: -.04em; margin: 6px 0 12px; }
.claim-lede { color: var(--ink-soft); font-size: 14px; line-height: 1.65; margin: 0 0 22px; }
.claim-form { display: grid; gap: 16px; }
.claim-field { display: grid; gap: 6px; font-size: 12px; }
.claim-field input { min-height: 38px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--sunk); color: var(--ink); font: 400 13px/1.4 var(--sans); }
.claim-note { color: var(--muted); font-size: 11px; line-height: 1.5; }
.claim-callout { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--sunk); padding: 10px 12px; font-size: 11.5px; color: var(--ink-soft); line-height: 1.6; }
.claim-callout code { font-family: var(--mono); word-break: break-all; }
.claim-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
/* The status line holds its height whether or not it has anything to say, so
   the button never moves under the pointer mid-submit. */
.claim-status { min-height: 16px; flex: 1; color: var(--danger); font: 400 11px/1.4 var(--mono); }
@media (max-width: 520px) { .claim-actions { flex-direction: column; align-items: stretch; } .claim-actions .button { width: 100%; } }
`;

const CLAIM_SCRIPT = `
(() => {
  const form = document.getElementById("claim-form");
  if (!form) return;
  const status = document.getElementById("claim-status");
  const submit = document.getElementById("claim-submit");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;
    if (status) status.textContent = "";
    try {
      const response = await fetch("/api/v1/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: data.get("token"),
          purpose: data.get("purpose"),
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim()
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error && body.error.message) || "This link is no longer valid.");
      window.location.assign("/handoff");
    } catch (error) {
      submit.removeAttribute("aria-busy");
      submit.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : "This link is no longer valid.";
    }
  });
})();
`;

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Claim this instance</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

export function renderClaimDocument(shell: string, state: ClaimPageState): string {
  const markup = renderToString(<ClaimPage state={state} />);
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  return document
    .replace("</head>", `<style data-marquee-claim>${CLAIM_STYLES}</style></head>`)
    .replace("</body>", `<script data-marquee-claim>${CLAIM_SCRIPT}</script></body>`);
}

async function assetShell(assets: Fetcher, request: Request): Promise<string> {
  const url = new URL("/index.html", request.url);
  const response = await assets.fetch(new Request(url, { method: "GET" }));
  if (!response.ok) return FALLBACK_DOCUMENT;
  return response.text();
}

export const claimRoutes = new Hono<{ Bindings: Env }>();

for (const [path, door] of [["/claim/:token", "claim"], ["/join/:token", "org_invite"]] as const) {
  claimRoutes.get(path, async (context) => {
    const token = context.req.param("token");
    const url = new URL(context.req.url);
    let live = false;
    try {
      live = (await readInstanceLink(context.env.DB, token, door)).status === "live";
    } catch (error) {
      loggerForEnv(context.env).emit("worker_error", "error", {
        source: "claimPage",
        ...errorFields(error),
      });
    }
    // The prefill is the agent's courtesy, not an assertion: both fields stay
    // editable, and neither is trusted for anything but the initial value.
    const state: ClaimPageState = {
      door,
      live,
      token,
      name: (url.searchParams.get("name") ?? "").slice(0, 200),
      email: (url.searchParams.get("email") ?? "").slice(0, 320),
    };
    context.header("Cache-Control", "no-store");
    // A spent link is a real answer about a real URL, so it renders 200 rather
    // than 404 — but it is never cached and never says which kind of spent.
    return context.html(
      renderClaimDocument(await assetShell(context.env.ASSETS, context.req.raw), state),
    );
  });
}

import { Hono } from "hono";
import type { Context } from "hono";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import type { PersonRow } from "../db/schema";
import { resolveAuth } from "../lib/auth/auth-middleware";
import { DEMO_SIGNIN_EMAIL_LIST } from "../lib/auth/demo-seat";
import { roleHome, rolesOf, safeNext } from "../lib/auth/signin-destination";
import { isSponsorshipContact } from "../lib/sponsors/task-access";
import { findDemoEvent } from "../lib/demo-event";
import { ICON_LINKS } from "../lib/head-icons";
import { INSTANCE_STATUS_FIXES, mailConfigured } from "../lib/instance-status";
import { errorFields, loggerForEnv } from "../lib/observability/log";

/**
 * The door. Every seat, every stranded state, one destination.
 *
 * Three surfaces promised this page long before it existed: the claim page tells
 * a new owner that sign-in links arrive by email, the error taxonomy tells an
 * operator to sign in again, and the API has minted and mailed magic links from
 * the first week. Nothing called any of it. A returning organizer whose session
 * had lapsed had no door at all — `/claim` refuses forever once claimed, the
 * demo doors 403 off a demo instance, and `/join` needs someone already inside.
 *
 * It is server-rendered rather than part of the admin bundle for the same reason
 * the claim page is: it is reached with no session, which is the whole point.
 * Every state is decided here, before the first byte, so the page never flickers
 * from one answer to another under a reader.
 */

export type SigninReason = "expired" | "used" | "already_signed_in" | "signed_out" | "session_ended";

/**
 * Each reason reads differently to someone who still has a session, because
 * the banner points at what to do next and the two states have different next
 * things. "Request a new one below" under a panel with no form below is the
 * kind of small lie that makes a page feel broken.
 */
const REASON_COPY: Record<SigninReason, { eyebrow: string; line: string; signedInLine: string }> = {
  expired: {
    eyebrow: "Link expired",
    line: "That sign-in link expired. Request a new one below.",
    signedInLine: "That sign-in link expired. This browser is still signed in, so carry on.",
  },
  used: {
    eyebrow: "Link already used",
    line: "That sign-in link was already used. Request a new one below.",
    signedInLine: "That sign-in link was already used. This browser is still signed in, so carry on.",
  },
  already_signed_in: {
    eyebrow: "Already signed in",
    line: "This browser is already signed in. Sign out before using that link.",
    signedInLine: "Sign out to use this link, or continue as the person already signed in.",
  },
  signed_out: {
    eyebrow: "Signed out",
    line: "You are signed out on this device. Request a link when you want to come back.",
    signedInLine: "That session was signed out. This browser holds a different one, still live.",
  },
  session_ended: {
    eyebrow: "Session ended",
    line: "Your session ended. Sign in again to pick up where you left off.",
    signedInLine: "That session ended. This browser is signed in again, so carry on.",
  },
};

function readReason(value: string | null): SigninReason | null {
  return value === "expired" || value === "used" || value === "already_signed_in" || value === "signed_out" || value === "session_ended"
    ? value
    : null;
}

function readRetryToken(value: string | null): string | null {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{20,256}$/.test(token) ? token : null;
}

export interface SigninSignedIn {
  name: string;
  email: string;
  /** Where Continue goes: the caller's safe `?next=`, else this seat's home. */
  home: string;
}

export interface SigninPageState {
  /** Present exactly when a live session resolved; the page then shows no form. */
  signedIn: SigninSignedIn | null;
  mailConfigured: boolean;
  demo: boolean;
  reason: SigninReason | null;
  /** Already validated as a same-origin path, or empty. */
  next: string;
  /** A fresh link preserved for the sign-out-and-retry recovery action. */
  retryToken: string | null;
}

function ReasonBanner({ reason, signedIn }: { reason: SigninReason; signedIn: boolean }): JSX.Element {
  const copy = REASON_COPY[reason];
  return (
    <div class="signin-reason" role="status">
      <strong>{copy.eyebrow}.</strong> {signedIn ? copy.signedInLine : copy.line}
    </div>
  );
}

function MailCallout({ demo }: { demo: boolean }): JSX.Element {
  return (
    <div class="signin-callout" data-signin-mail="unconfigured">
      <strong>This deployment cannot send mail yet.</strong>{" "}
      {demo
        ? "A link requested here will not be emailed; the demo shows it on screen instead."
        : "A link requested here will not arrive."}{" "}
      Configure the sender and it will:
      {INSTANCE_STATUS_FIXES.mail.map((command) => (
        <code key={command}>{command}</code>
      ))}
    </div>
  );
}

function SigninForm({ state, lead }: { state: SigninPageState; lead: boolean }): JSX.Element {
  return (
    <div class="signin-body">
      <div class="eyebrow">Sign in</div>
      {lead
        ? <h1>Sign in to Marquee</h1>
        : <h2 class="signin-heading">Sign in with your own address</h2>}
      <p class="signin-lede">
        No password, ever. Give the address your conference knows you by and a one-time link
        arrives by email. It works once and expires in fifteen minutes.
      </p>
      {state.reason && <ReasonBanner reason={state.reason} signedIn={false} />}
      {!state.mailConfigured && <MailCallout demo={state.demo} />}
      <form class="signin-form" id="signin-form" method="post" action="/api/v1/auth/magic-link">
        <input type="hidden" name="next" value={state.next} />
        <label class="signin-field" for="signin-email">
          <span>Email</span>
          <input
            id="signin-email"
            name="email"
            type="email"
            autocomplete="email"
            inputMode="email"
            required
          />
        </label>
        <div class="signin-actions">
          <span class="signin-status" id="signin-status" role="status" aria-live="polite"></span>
          <button class="button primary" type="submit" id="signin-submit">
            Email me a sign-in link
          </button>
        </div>
      </form>
      {/* The link block holds its place whether or not there is a link in it, so
          nothing below moves when the demo answers. */}
      <div class="signin-link" id="signin-link" hidden>
        <span class="subtle">Demo mode · the link that would have been emailed</span>
        <a id="signin-link-anchor" href="/">Open your sign-in link</a>
      </div>
    </div>
  );
}

function DemoDoors(): JSX.Element {
  return (
    <div class="signin-demo">
      <div class="eyebrow">Demo conference</div>
      <h1>Open the demo conference</h1>
      <p class="signin-demo-lede">
        This deployment runs a populated demo. Open it in any seat — each one is a real session,
        not a preview.
      </p>
      <div class="signin-demo-doors">
        <button class="button primary" type="button" data-signin-demo="organizer" data-signin-to="/dashboard">
          Enter as organizer
        </button>
        <button class="button" type="button" data-signin-demo="reviewer" data-signin-to="/reviewer">
          Enter as reviewer
        </button>
        <button class="button" type="button" data-signin-demo="speaker" data-signin-to="/portal">
          Enter as speaker
        </button>
      </div>
      <span class="signin-status" id="signin-demo-status" role="status" aria-live="polite"></span>
      {/* The form below is the affordance most people reach for first, so the
          page says plainly which addresses it answers to rather than letting a
          visitor guess and land on an acknowledgement. */}
      <p class="signin-demo-emails" data-signin-demo-emails>
        Or sign in by email:{" "}
        {DEMO_SIGNIN_EMAIL_LIST.map((address, index) => (
          <>
            {index > 0 && ", "}
            <code key={address}>{address}</code>
          </>
        ))}{" "}
        enter their seats directly, no link to wait for.
      </p>
    </div>
  );
}

function SignedInPanel({ state, person }: { state: SigninPageState; person: SigninSignedIn }): JSX.Element {
  const canUseLink = state.reason === "already_signed_in" && state.retryToken !== null;
  return (
    <div class="signin-body">
      <div class="eyebrow">Already signed in</div>
      <h1>You are signed in</h1>
      <p class="signin-lede">
        Signed in as {person.name} · {person.email}
      </p>
      {state.reason && <ReasonBanner reason={state.reason} signedIn />}
      <div class="signin-actions">
        <span class="signin-status" id="signin-status" role="status" aria-live="polite"></span>
        <div class="signin-actions-pair">
          <button
            class="button"
            type="button"
            id={canUseLink ? "signin-use-link" : "signin-signout"}
            {...(canUseLink ? { "data-signin-token": state.retryToken } : {})}
          >
            {canUseLink ? "Sign out and use this sign-in link" : "Sign out"}
          </button>
          <a class="button primary" href={person.home}>
            Continue
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The demo leads when there is one.
 *
 * Whoever arrives at a demo deployment came to see the conference, not to prove
 * they own an address it has never heard of — so the three seats are the first
 * thing on the page and the form is second. A real instance has no demo and is
 * unchanged: the form is the page, exactly as before.
 */
export function SigninPage({ state }: { state: SigninPageState }): JSX.Element {
  const demoLeads = !state.signedIn && state.demo;
  return (
    <div class="signin-shell">
      <header class="signin-top">
        <a class="brand" href="/" aria-label="Marquee home">
          <span class="brand-mark">M</span>
          <span class="brand-name">Marquee</span>
        </a>
      </header>
      <main class="signin-main">
        {demoLeads && (
          <section class="signin-card">
            <DemoDoors />
          </section>
        )}
        <section class={demoLeads ? "signin-card secondary" : "signin-card"}>
          {state.signedIn
            ? <SignedInPanel state={state} person={state.signedIn} />
            : <SigninForm state={state} lead={!demoLeads} />}
        </section>
      </main>
    </div>
  );
}

const SIGNIN_STYLES = `
.signin-shell { min-height: 100vh; background: var(--bg); display: grid; grid-template-rows: auto 1fr; }
.signin-top { padding: 20px clamp(20px,5vw,70px); border-bottom: 1px solid var(--line); background: var(--panel); }
.signin-top .brand { padding: 0; }
.signin-main { display: grid; place-items: start center; align-content: start; gap: 16px; padding: clamp(28px,6vw,64px) 20px; }
.signin-card { width: min(620px,100%); background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius); padding: clamp(20px,4vw,30px); }
.signin-card.secondary { border-top-color: var(--line-strong); }
.signin-body h1, .signin-demo h1 { font: 500 clamp(24px,3.4vw,34px)/1.1 var(--mono); letter-spacing: -.04em; margin: 6px 0 12px; }
.signin-heading { font: 500 clamp(18px,2.2vw,22px)/1.2 var(--mono); letter-spacing: -.03em; margin: 6px 0 12px; }
.signin-lede { color: var(--ink-soft); font-size: 14px; line-height: 1.65; margin: 0 0 22px; }
.signin-reason { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--sunk); padding: 10px 12px; font-size: 12px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 18px; }
.signin-callout { border: 1px solid var(--warning-line); border-left: 3px solid var(--warning-line); border-radius: var(--radius); background: var(--warning-soft); color: var(--warning-ink); padding: 10px 12px; font-size: 11.5px; line-height: 1.6; margin: 0 0 18px; display: grid; gap: 6px; }
.signin-callout code { font-family: var(--mono); word-break: break-all; }
.signin-form { display: grid; gap: 16px; }
.signin-field { display: grid; gap: 6px; font-size: 12px; }
.signin-field input { min-height: 38px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--sunk); color: var(--ink); font: 400 13px/1.4 var(--sans); }
.signin-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.signin-actions-pair { display: flex; gap: 8px; }
/* The status line holds its height whether or not it has anything to say, so
   the button never moves under the pointer mid-submit. 30px, not one line's
   16px: the acknowledgement wraps to two lines at this card width, and a
   16px reservation only holds because the button's own 30px happens to govern
   the row. Reserving the height that actually lands makes it hold on purpose. */
.signin-status { min-height: 30px; flex: 1; color: var(--ink-soft); font: 400 11px/1.4 var(--mono); }
.signin-status.is-error { color: var(--danger); }
.signin-link { margin-top: 18px; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--sunk); padding: 10px 12px; display: grid; gap: 6px; }
.signin-link a { font: 400 11.5px/1.6 var(--mono); color: var(--accent-dark); word-break: break-all; }
.signin-demo .eyebrow { color: var(--accent-dark); }
.signin-demo-lede { color: var(--ink-soft); font-size: 13px; line-height: 1.6; margin: 8px 0 16px; }
.signin-demo-doors { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.signin-demo-emails { margin: 4px 0 0; color: var(--ink-soft); font-size: 12px; line-height: 1.7; }
.signin-demo-emails code { font-family: var(--mono); color: var(--accent-dark); }
@media (max-width: 520px) { .signin-actions { flex-direction: column; align-items: stretch; } .signin-actions-pair { flex-direction: column; } .signin-actions .button { width: 100%; } .signin-demo-doors .button { width: 100%; } }
`;

/**
 * The page's own script, in the claim page's idiom: no bundle, no hydration.
 *
 * Two rules it never breaks. The acknowledgement is the server's, verbatim, so
 * the page can never become an oracle for which addresses exist. And a link
 * already on screen is never blanked by a later request — the 60-second cooldown
 * means a second submit legitimately mints nothing, and wiping the first link
 * would strand the reader holding it.
 */
const SIGNIN_SCRIPT = `
(() => {
  const form = document.getElementById("signin-form");
  const status = document.getElementById("signin-status");
  const setStatus = (node, text, isError) => {
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-error", Boolean(isError));
  };
  if (form) {
    const submit = document.getElementById("signin-submit");
    const linkBlock = document.getElementById("signin-link");
    const linkAnchor = document.getElementById("signin-link-anchor");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const next = String(data.get("next") || "");
      submit.setAttribute("aria-busy", "true");
      submit.disabled = true;
      setStatus(status, "Requesting a sign-in link…", false);
      try {
        const response = await fetch("/api/v1/auth/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: String(data.get("email") || "").trim(),
            ...(next ? { redirect_to: next } : {})
          })
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error((body && body.error && body.error.message) || "That request could not be completed.");
        setStatus(status, (body && body.message) || "", false);
        // A demo address is already signed in by the time this lands — the seat
        // is a cookie, not a link — so the only thing left is to walk through
        // the door.
        if (body && body.demo_seat && body.demo_seat.redirect_to) {
          window.location.assign(body.demo_seat.redirect_to);
          return;
        }
        if (body && body.magic_link && linkBlock && linkAnchor) {
          linkAnchor.setAttribute("href", body.magic_link);
          linkBlock.hidden = false;
        }
      } catch (error) {
        setStatus(status, error instanceof Error ? error.message : "That request could not be completed.", true);
      } finally {
        submit.removeAttribute("aria-busy");
        submit.disabled = false;
      }
    });
  }

  const demoStatus = document.getElementById("signin-demo-status");
  document.querySelectorAll("[data-signin-demo]").forEach((door) => {
    door.addEventListener("click", async () => {
      const role = door.getAttribute("data-signin-demo");
      const destination = door.getAttribute("data-signin-to") || "/dashboard";
      door.setAttribute("aria-busy", "true");
      door.disabled = true;
      setStatus(demoStatus, "Opening the demo workspace…", false);
      try {
        const response = await fetch("/api/v1/auth/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role })
        });
        if (!response.ok) throw new Error("This demo is unavailable on the current conference deployment.");
        window.location.assign(destination);
      } catch (error) {
        door.removeAttribute("aria-busy");
        door.disabled = false;
        setStatus(demoStatus, error instanceof Error ? error.message : "This demo is unavailable.", true);
      }
    });
  });

  const signOut = document.getElementById("signin-signout");
  const useLink = document.getElementById("signin-use-link");
  const signOutAndGo = async (destination) => {
    const button = signOut || useLink;
    if (!button) return;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    setStatus(status, "Signing out…", false);
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign(destination);
  };
  if (signOut) signOut.addEventListener("click", () => void signOutAndGo("/signin?reason=signed_out"));
  if (useLink) {
    const token = useLink.getAttribute("data-signin-token");
    if (token) {
      useLink.addEventListener("click", () => {
        void signOutAndGo("/api/v1/auth/exchange?token=" + encodeURIComponent(token));
      });
    }
  }
})();
`;

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Sign in</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

export function renderSigninDocument(shell: string, state: SigninPageState): string {
  const markup = renderToString(<SigninPage state={state} />);
  // A function replacer, never a string one: `$&`, `$'` and `` $` `` are
  // substitution directives to String.replace, and `markup` carries the
  // query-supplied `next`.
  const inject = () => `<div id="app">${markup}</div>`;
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', inject)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', inject);
  return document
    .replace("</head>", `<style data-marquee-signin>${SIGNIN_STYLES}</style></head>`)
    .replace("</body>", `<script data-marquee-signin>${SIGNIN_SCRIPT}</script></body>`);
}

/**
 * The built document, or an honest minimum. A deployment whose ASSETS binding
 * is missing still serves this page rather than a 500 — losing the chrome must
 * never lose the only door.
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

export async function readSigninState(context: Context<{ Bindings: Env }>): Promise<SigninPageState> {
  const url = new URL(context.req.url);
  // Bounded like the claim page's prefills: a query value is rendered into
  // the form and posted back as `redirect_to`, where it is stored and later
  // becomes a Location header.
  const next = safeNext(url.searchParams.get("next")?.slice(0, 512)) ?? "";
  const reason = readReason(url.searchParams.get("reason"));
  const retryToken = reason === "already_signed_in" ? readRetryToken(url.searchParams.get("token")) : null;

  let signedIn: SigninSignedIn | null = null;
  let demo = false;
  try {
    const auth = await resolveAuth(context);
    if (auth?.kind === "session") {
      const person = await context.env.DB
        .prepare("SELECT * FROM people WHERE id = ?")
        .bind(auth.personId)
        .first<PersonRow>();
      if (person) {
        signedIn = {
          name: person.name,
          email: person.email,
          // Same resolution as the magic-link mint, including the sponsor seat:
          // Continue must land where the link would have.
          home: next || roleHome(rolesOf(auth.memberships), {
            sponsorContact: await isSponsorshipContact(context.env.DB, person.id, person.org_id),
          }),
        };
      }
    }
    demo = (await findDemoEvent(context.env.DB)) !== null;
  } catch (error) {
    // A page that cannot read its own preconditions still has to open: the
    // anonymous form is the state that is safe to be wrong about, because it
    // asks for an address rather than asserting anything about the instance.
    loggerForEnv(context.env).emit("worker_error", "error", {
      source: "signinPage",
      ...errorFields(error),
    });
  }

  return {
    signedIn,
    mailConfigured: mailConfigured(context.env),
    demo,
    reason,
    next,
    retryToken,
  };
}

export const signinRoutes = new Hono<{ Bindings: Env }>();

/**
 * Three paths, one page. Humans and agents both guess URLs, and each 404 costs
 * a turn (the MRQ-131 precedent). They are written out rather than looped
 * because `check:routes` reads `.get("…")` literals out of this file, and a
 * loop is invisible to it.
 */
async function serveSignin(context: Context<{ Bindings: Env }>): Promise<Response> {
  const state = await readSigninState(context);
  context.header("Cache-Control", "no-store");
  return context.html(
    renderSigninDocument(await assetShell(context.env.ASSETS, context.req.raw), state),
  );
}

signinRoutes.get("/signin", serveSignin);
signinRoutes.get("/login", serveSignin);
signinRoutes.get("/sign-in", serveSignin);

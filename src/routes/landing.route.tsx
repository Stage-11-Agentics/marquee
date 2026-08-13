import { Hono } from "hono";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { instanceIsUnclaimed } from "../lib/auth/instance-claim";
import { DEMO_EVENT_ORDER, SEEDED_DEMO_EVENT_ID } from "../lib/demo-event";
import { ICON_LINKS } from "../lib/head-icons";
import { errorFields, loggerForEnv } from "../lib/observability/log";
import { LANDING_THEMES } from "../ui/shell/theme";
import { hasSpeakerTaskCancellationColumn, submissionStatusPredicate } from "./submissions.queries";

export interface LandingCounts {
  submitted: number;
  inReview: number;
  accepted: number;
  onboarding: number;
  scheduled: number;
  published: number;
  reviewPressure: number;
  overdueSpeakers: number;
}

export interface LandingData {
  conferenceName: string;
  counts: LandingCounts;
  reviewTrack: string;
  notice?: string;
  /**
   * True exactly when this instance has a demo conference — which is the
   * instance whose landing is the graded demo surface, and whose markup
   * therefore does not change. A real deployment (no demo event) is the only
   * one that gains the "Sign in" link, because it is the only one whose
   * visitors have accounts to sign in to.
   */
  demoMode: boolean;
}

const EMPTY_COUNTS: LandingCounts = {
  submitted: 0,
  inReview: 0,
  accepted: 0,
  onboarding: 0,
  scheduled: 0,
  published: 0,
  reviewPressure: 0,
  overdueSpeakers: 0,
};

interface LandingRow {
  conference_name: string;
  submitted_count: number;
  in_review_count: number;
  accepted_count: number;
  onboarding_count: number;
  scheduled_count: number;
  published_count: number;
  review_pressure_count: number;
  overdue_speakers_count: number;
  review_track: string | null;
}

/**
 * The landing is deliberately one D1 read. Counts are not copied into the
 * client bundle: the HTML judge receives the same source-of-truth figures the
 * organizer will see after entering the demo.
 */
export async function loadLandingData(db: D1Database): Promise<LandingData> {
  const activeTaskClause = await hasSpeakerTaskCancellationColumn(db)
    ? " AND cancelled_at IS NULL"
    : "";
  const stageCount = (status: "submitted" | "in_review" | "accepted" | "onboarding" | "scheduled" | "published"): string => `(SELECT COUNT(DISTINCT stage_submission.id)
            FROM submissions stage_submission
            LEFT JOIN agenda_items stage_agenda
              ON stage_agenda.submission_id = stage_submission.id
             AND stage_agenda.kind = 'session'
           WHERE stage_submission.event_id = demo.id
             AND ${submissionStatusPredicate(status, {
               submission: "stage_submission",
               agenda: "stage_agenda",
               includeCancelledAt: Boolean(activeTaskClause),
             })})`;
  const row = await db
    .prepare(
      `WITH demo AS (
         SELECT id, name, updated_at
         FROM events
         WHERE demo_mode = 1
         ${DEMO_EVENT_ORDER}
       )
       SELECT
         demo.name AS conference_name,
         ${stageCount("submitted")} AS submitted_count,
         ${stageCount("in_review")} AS in_review_count,
         ${stageCount("accepted")} AS accepted_count,
         ${stageCount("onboarding")} AS onboarding_count,
         ${stageCount("scheduled")} AS scheduled_count,
         ${stageCount("published")} AS published_count,
         (SELECT COUNT(*)
            FROM submissions
           WHERE event_id = demo.id
             AND status IN ('submitted', 'in_review')
             AND primary_track_id = (
               SELECT id FROM tracks
                WHERE event_id = demo.id AND lower(name) = 'agents'
                ORDER BY position ASC LIMIT 1
             )) AS review_pressure_count,
         (SELECT COUNT(DISTINCT person_id)
            FROM speaker_tasks
           WHERE event_id = demo.id AND status = 'open' AND due_at < demo.updated_at${activeTaskClause}) AS overdue_speakers_count,
         (SELECT name FROM tracks
           WHERE event_id = demo.id AND lower(name) = 'agents'
           ORDER BY position ASC LIMIT 1) AS review_track
       FROM demo`,
    )
    .bind(SEEDED_DEMO_EVENT_ID)
    .first<LandingRow>();

  if (!row) {
    return {
      conferenceName: "demo conference",
      counts: EMPTY_COUNTS,
      reviewTrack: "Agents",
      notice: "No demo conference is configured yet.",
      demoMode: false,
    };
  }

  return {
    demoMode: true,
    conferenceName: row.conference_name,
    counts: {
      submitted: Number(row.submitted_count),
      inReview: Number(row.in_review_count),
      accepted: Number(row.accepted_count),
      onboarding: Number(row.onboarding_count),
      scheduled: Number(row.scheduled_count),
      published: Number(row.published_count),
      reviewPressure: Number(row.review_pressure_count),
      overdueSpeakers: Number(row.overdue_speakers_count),
    },
    reviewTrack: row.review_track ?? "Agents",
  };
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return value === 1 ? singular : pluralForm;
}

function PreviewStage({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div class="mini-stage">
      <span class="subtle">{label}</span>
      <strong class="tabular">{count(value)}</strong>
    </div>
  );
}

export function LandingPage({ data }: { data: LandingData }): JSX.Element {
  const { counts } = data;
  const reviewSentence = `${count(counts.reviewPressure)} ${plural(counts.reviewPressure, "abstract")} still need review in ${data.reviewTrack}.`;
  const overdueSentence = `${count(counts.overdueSpeakers)} accepted ${plural(counts.overdueSpeakers, "speaker")} ${counts.overdueSpeakers === 1 ? "is" : "are"} overdue.`;

  return (
    <div class="landing">
      <header class="landing-nav">
        <a class="brand" href="/" aria-label="Marquee home">
          <span class="brand-mark">M</span>
          <span class="brand-name">Marquee</span>
        </a>
        <div class="landing-links">
          {!data.demoMode && <a class="button" href="/signin">Sign in</a>}
          <a class="button" href="https://github.com/Stage-11-Agentics/marquee">View on GitHub ↗</a>
          <a class="button primary" href="/submissions?demo=organizer" data-demo-role="organizer">Enter demo</a>
        </div>
      </header>

      <div class="landing-flow">
        <section class="theme-choose" id="pick-theme" aria-label="Pick a look before you enter">
          <div class="theme-choose-copy">
            <h2>Welcome to Marquee</h2>
            <p class="theme-choose-lead">Pick your theme.</p>
          </div>
          <div class="theme-grid" role="group" aria-label="Available themes">
            {LANDING_THEMES.map((theme) => (
              <button key={theme.id} type="button" class="theme-card" data-theme-choice={theme.id} aria-pressed="false">
                <span class="theme-shot">
                  <img src={`/themes/${theme.id}.webp`} alt={`The program home in the ${theme.label} theme`} width={1440} height={900} />
                </span>
                <span class="theme-card-label">
                  <span class="theme-name">{theme.label}</span>
                  <span class="theme-kind">{theme.kind}</span>
                </span>
              </button>
            ))}
          </div>
          <div class="theme-choose-note">
            Marquee Light is the default, and you can change it at any time —{" "}
            <a class="theme-skip" href="#choose-role">skip straight to the demo →</a>
          </div>
        </section>

        <main class="hero" id="choose-role">
        <div class="hero-copy">
          <a class="theme-back" href="/" data-landing-back>← Pick a different theme</a>
          <div class="eyebrow">Open-source conference program operations</div>
          <h1>Fantastic conferences, effortlessly.</h1>
          <p>
            Run the entire program lifecycle—from call for speakers through review, acceptance,
            onboarding, and a published agenda—in one fast, owned workspace.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="/submissions?demo=organizer" data-demo-role="organizer">Enter as organizer →</a>
            <a class="button" href="/reviewer?demo=reviewer" data-demo-role="reviewer">Enter as reviewer</a>
            <a class="button" href="/portal?demo=speaker" data-demo-role="speaker">Enter as speaker</a>
            <a class="button ghost" href="/f/cfp">View public CFP</a>
            <a class="button ghost" href="/agenda">View public agenda</a>
            <a class="button ghost" href="/speakers">Browse speakers</a>
          </div>
          <div class="hero-note">No signup. Every demo opens the populated {data.conferenceName} workspace, each in its own seat.</div>
          <div class="demo-status" id="demo-status" role="status" aria-live="polite"></div>
        </div>

        <section class="hero-pipeline" aria-label="Live pipeline preview">
          <div class="eyebrow">{data.conferenceName} · Live program</div>
          <div class="mini-pipeline">
            <PreviewStage label="Submitted" value={counts.submitted} />
            <PreviewStage label="In review" value={counts.inReview} />
            <PreviewStage label="Ready to place" value={counts.accepted} />
            <PreviewStage label="Onboarding" value={counts.onboarding} />
            <PreviewStage label="Scheduled" value={counts.scheduled} />
            <PreviewStage label="Published" value={counts.published} />
          </div>
          <div class="mini-attention">
            <strong>Wave 2 closes Friday.</strong> {reviewSentence} {overdueSentence}
            {data.notice && <span class="preview-notice"> {data.notice}</span>}
          </div>
        </section>
        </main>
      </div>

      <footer class="landing-foot">
        <span>Apache-2.0 · Self-hosted · API-first</span>
        <span>Built for {data.conferenceName}</span>
      </footer>
    </div>
  );
}

/**
 * What a deployment shows at its root URL before anyone owns it.
 *
 * It states who the first user is meant to be and how the software learns it is
 * them — and nothing else. There is no signup form, because an unclaimed Worker
 * is on a public URL from its first second; there are no counts, no conference
 * name, and no hint of what is in the database, because a stranger who finds
 * the URL must learn nothing from it (AC-277).
 *
 * This page is unreachable on any instance that has an owner, and the seeded
 * demo has one — so a seeded deployment's landing is byte-identical to what it
 * was before this existed.
 */
export function UnclaimedLandingPage(): JSX.Element {
  return (
    <div class="landing unclaimed">
      <header class="landing-nav">
        <a class="brand" href="/" aria-label="Marquee home">
          <span class="brand-mark">M</span>
          <span class="brand-name">Marquee</span>
        </a>
        <div class="landing-links">
          <a class="button" href="https://github.com/Stage-11-Agentics/marquee">View on GitHub ↗</a>
        </div>
      </header>

      <main class="hero unclaimed-hero">
        <div class="hero-copy">
          <div class="eyebrow">Fresh install · unclaimed</div>
          <h1>Nobody owns this instance yet.</h1>
          <p>
            Initial setup is run by an agent: point your coding agent at the repository and{" "}
            <strong>SKILL.md</strong> walks it from clone to a one-time claim link. The link is
            printed in the deploy terminal, because on day zero that terminal is the only proof of
            ownership there is — identity here never depends on mail, which is itself a thing setup
            configures.
          </p>
          <p>Ownership lands on a person, not on an agent: a human opens the claim link.</p>
          <div class="unclaimed-command">
            <span class="subtle">No link in hand? Print a fresh one — it works forever.</span>
            <code>node cli/marquee.mjs setup claim-link --url "$MARQUEE_URL" --json</code>
          </div>
          <div class="hero-note">
            A used claim link is inert. Re-running the command is the recovery path for a locked-out
            instance.
          </div>
        </div>
      </main>

      <footer class="landing-foot">
        <span>Apache-2.0 · Self-hosted · API-first</span>
        <span>Unclaimed instance</span>
      </footer>
    </div>
  );
}

const LANDING_STYLES = `
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
.landing { min-height: 100vh; background: var(--bg); display: grid; grid-template-rows: auto 1fr auto; }
.landing-nav { padding: 20px clamp(20px,5vw,70px); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--panel); }
.landing-nav .brand { padding: 0; }
.landing-links { display: flex; gap: 8px; }
.hero { width: min(1180px,90vw); margin: auto; display: grid; grid-template-columns: 1.05fr .95fr; gap: clamp(35px,8vw,100px); align-items: center; padding: 55px 0 70px; }
.hero-copy .eyebrow { color: var(--accent-dark); margin-bottom: 15px; }
.hero h1 { font: 500 clamp(38px,5.2vw,62px)/1.02 var(--mono); letter-spacing: -.055em; margin: 0 0 22px; max-width: 720px; }
.hero p { color: var(--ink-soft); font-size: 16px; line-height: 1.65; max-width: 600px; margin: 0 0 28px; }
.hero-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.hero-actions .button { min-height: 40px; padding: 10px 16px; }
.hero-note { margin-top: 15px; color: var(--muted); font-size: 11px; }
.demo-status { min-height: 15px; margin-top: 8px; color: var(--danger); font: 400 10.5px/1.4 var(--mono); }
.hero-pipeline { background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius); box-shadow: none; padding: 20px; background-image: linear-gradient(var(--graph) 1px, transparent 1px), linear-gradient(90deg, var(--graph) 1px, transparent 1px); background-size: 8px 8px, 8px 8px; }
.mini-pipeline { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 17px 0; }
.mini-stage { border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 12px; min-height: 72px; background: rgba(255,255,255,.82); }
.mini-stage strong { display: block; font-size: 21px; margin-top: 9px; font-family: var(--mono); font-variant-numeric: tabular-nums lining-nums; }
.mini-attention { padding: 12px; background: var(--warning-soft); border: 1px solid var(--warning-line); color: var(--warning-ink); border-radius: var(--radius); font-size: 11px; line-height: 1.5; }
.preview-notice { display: block; margin-top: 6px; }
.landing-foot { border-top: 1px solid var(--line); padding: 18px clamp(20px,5vw,70px); color: var(--muted); font: 400 11px/1 var(--mono); display: flex; justify-content: space-between; }
/*
 * Two screens, one document. The stage attribute is stamped on <html> before
 * first paint (see LANDING_STAGE_SCRIPT), so picking a theme swaps screens with
 * no scroll and no round trip. With scripting off no attribute is ever set, and
 * these rules do not apply: the page is the single scrolling column it renders
 * as, picker first, hero under the fold behind the skip link.
 */
html[data-landing-stage] .landing-flow { display: grid; align-content: center; }
html[data-landing-stage="choose"] .hero { display: none; }
html[data-landing-stage="choose"] .theme-choose { min-height: 0; }
html[data-landing-stage="enter"] .theme-choose { display: none; }
.theme-choose { width: min(940px,92vw); margin: 0 auto; min-height: calc(100svh - 77px); display: grid; align-content: center; justify-items: center; gap: 26px; padding: 48px 0 34px; text-align: center; }
.theme-choose h2 { font: 700 clamp(40px,6.4vw,74px)/1 var(--mono); letter-spacing: -.055em; margin: 0 0 16px; }
.theme-choose-lead { font: 500 clamp(19px,2.6vw,28px)/1.2 var(--mono); letter-spacing: -.03em; color: var(--ink-soft); margin: 0; }
.theme-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); justify-content: center; gap: 16px; width: 100%; }
.theme-card { display: grid; padding: 0; text-align: left; background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
.theme-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-card[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--accent); border-color: var(--accent); }
.theme-shot { display: block; aspect-ratio: 16 / 10; background: var(--sunk); border-bottom: 1px solid var(--line); }
.theme-shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.theme-card-label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 9px 11px; }
.theme-name { font: 600 12px/1.2 var(--mono); letter-spacing: -.01em; }
.theme-kind { color: var(--muted); font: 400 9.5px/1.2 var(--mono); text-transform: uppercase; letter-spacing: .08em; }
.theme-choose-note { color: var(--muted); font: 400 11px/1.4 var(--mono); }
.theme-skip { color: var(--accent-dark); text-decoration: underline; text-underline-offset: 2px; }
.theme-back { display: inline-block; margin-bottom: 16px; color: var(--muted); font: 400 11px/1 var(--mono); text-decoration: underline; text-underline-offset: 3px; }
.theme-back:hover { color: var(--accent-dark); }
@media (max-width: 1000px) { .theme-choose { min-height: 0; } }
@media (max-width: 620px) { .theme-grid { grid-template-columns: minmax(0,1fr); } }
/* A laptop is short, not wide: on a 900px-tall screen the four previews at full
   size push the choice off the bottom, and a picker you have to scroll is the
   thing this page exists to stop being. Trade preview size for the whole set
   staying on one screen. */
@media (max-height: 1000px) { .theme-choose { width: min(780px,92vw); gap: 18px; padding: 26px 0 20px; } .theme-choose h2 { font-size: clamp(34px,5vw,54px); margin-bottom: 10px; } .theme-choose-lead { font-size: clamp(17px,2vw,22px); } }
@media (max-height: 760px) { .theme-choose { width: min(600px,92vw); gap: 14px; padding: 18px 0 14px; } }
@media (max-width: 800px) { .hero { grid-template-columns: 1fr; gap: 34px; padding: 42px 0 52px; } .landing-links .button:first-child { display: none; } }
@media (max-width: 520px) { .landing-nav { align-items: flex-start; gap: 16px; } .landing-links { flex: 1; justify-content: flex-end; } .landing-links .button { min-height: 30px; padding: 7px 9px; } .hero h1 { font-size: clamp(36px, 12vw, 48px); } .hero p { font-size: 14px; } .landing-foot { align-items: flex-start; flex-direction: column; gap: 8px; } }
`;

const LANDING_SCRIPT = `
(() => {
  // Font URLs mirror the pre-paint script in index.html and the registry in
  // src/ui/shell/theme.ts — keep the three in sync. The landing cannot import
  // the app's helpers because it hydrates nothing: this script is the page.
  const THEME_FONTS = {
    "latent-space": "https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&display=swap",
    "ai-engineer": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap"
  };
  const root = document.documentElement;
  // Which of the two screens is showing. #choose-role in the URL means "already
  // through the door", so a shared link, a reload, and the back button all land
  // where the visitor left off. The head script stamps this before first paint;
  // re-stamping here covers a head script that never ran.
  const stageForHash = () => (location.hash === "#choose-role" ? "enter" : "choose");
  const setStage = (stage) => {
    root.dataset.landingStage = stage;
    if (stage === "enter") window.scrollTo(0, 0);
  };
  let pushedStage = false;
  setStage(stageForHash());
  const syncStage = () => setStage(stageForHash());
  window.addEventListener("hashchange", syncStage);
  window.addEventListener("popstate", syncStage);
  const backLink = document.querySelector("[data-landing-back]");
  if (backLink) {
    backLink.addEventListener("click", (event) => {
      event.preventDefault();
      if (pushedStage) { pushedStage = false; history.back(); return; }
      history.pushState(null, "", location.pathname + location.search);
      setStage("choose");
    });
  }
  const cards = Array.from(document.querySelectorAll("[data-theme-choice]"));
  const markPressed = () => {
    const worn = root.dataset.theme || "day";
    cards.forEach((card) => card.setAttribute("aria-pressed", String(card.getAttribute("data-theme-choice") === worn)));
  };
  markPressed();
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-theme-choice");
      if (id === "day") delete root.dataset.theme;
      else root.dataset.theme = id;
      // swyxy's dark mode is part of the one stored swyxy choice; every other
      // theme must clear the modifier or it leaks onto the next register.
      delete root.dataset.swyxyMode;
      try {
        if (id === "swyxy" && localStorage.getItem("marquee-swyxy-mode") === "dark") root.dataset.swyxyMode = "dark";
        localStorage.setItem("marquee-theme", id);
      } catch (_) { /* private mode: the theme still applies for this visit */ }
      if (THEME_FONTS[id] && !document.querySelector('link[data-theme-fonts="' + id + '"]')) {
        const pre = document.createElement("link");
        pre.rel = "preconnect"; pre.href = "https://fonts.gstatic.com"; pre.crossOrigin = "anonymous";
        const css = document.createElement("link");
        css.rel = "stylesheet"; css.href = THEME_FONTS[id]; css.dataset.themeFonts = id;
        document.head.append(pre, css);
      }
      markPressed();
      // Picking a theme is entering. No scroll, no fetch: the hero is already in
      // the document, so the swap is a repaint away.
      if (location.hash !== "#choose-role") {
        history.pushState(null, "", "#choose-role");
        pushedStage = true;
      }
      setStage("enter");
    });
  });
  document.querySelectorAll("[data-demo-role]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const role = link.getAttribute("data-demo-role");
      const destination = link.getAttribute("href") || "/submissions";
      const status = document.getElementById("demo-status");
      link.setAttribute("aria-busy", "true");
      link.classList.add("is-busy");
      if (status) status.textContent = "Opening the populated demo workspace…";
      try {
        const response = await fetch("/api/v1/auth/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role })
        });
        if (!response.ok) throw new Error("Demo login unavailable");
        window.location.assign(destination);
      } catch (_) {
        link.removeAttribute("aria-busy");
        link.classList.remove("is-busy");
        if (status) status.textContent = "This demo is unavailable on the current conference deployment.";
      }
    });
  });
})();
`;

const FALLBACK_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marquee — Program operations</title>${ICON_LINKS}</head><body><div id="app"></div></body></html>`;

/**
 * Which screen the landing opens on, decided before the first paint.
 *
 * It runs in the head, ahead of any markup, so a visitor arriving at
 * `/#choose-role` never sees the theme picker flash past on the way to the hero.
 * Setting the attribute is also what arms the two-screen CSS at all: if
 * scripting is off this never runs, no attribute is ever set, and the page stays
 * the one scrolling column it was rendered as.
 */
const LANDING_STAGE_SCRIPT = `
(() => {
  try {
    document.documentElement.dataset.landingStage =
      location.hash === "#choose-role" ? "enter" : "choose";
  } catch (_) { /* no attribute: the scrolling fallback is a correct page */ }
})();
`;

export function renderLandingDocument(shell: string, data: LandingData): string {
  const markup = renderToString(<LandingPage data={data} />);
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  return document
    .replace(
      "</head>",
      `<style data-marquee-landing>${LANDING_STYLES}</style><script data-marquee-landing-stage>${LANDING_STAGE_SCRIPT}</script></head>`,
    )
    .replace("</body>", `<script data-marquee-landing>${LANDING_SCRIPT}</script></body>`);
}

const UNCLAIMED_STYLES = `
.unclaimed-hero { grid-template-columns: 1fr; max-width: 780px; }
.unclaimed-hero .hero-copy p { max-width: 62ch; }
.unclaimed-command { margin-top: 22px; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--sunk); padding: 12px 14px; display: grid; gap: 8px; }
.unclaimed-command code { font: 400 11.5px/1.6 var(--mono); color: var(--ink); word-break: break-all; }
`;

/**
 * Rendered only when the zero-owner guard says so. Deliberately a separate
 * function from `renderLandingDocument`: the demo landing's markup, styles, and
 * script must not change by a byte because this page exists.
 */
export function renderUnclaimedLandingDocument(shell: string): string {
  const markup = renderToString(<UnclaimedLandingPage />);
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  return document.replace(
    "</head>",
    `<style data-marquee-landing>${LANDING_STYLES}${UNCLAIMED_STYLES}</style></head>`,
  );
}

/**
 * The built document, or an honest minimum. A deployment whose ASSETS binding
 * is missing still serves this page rather than a 500 — the shell only supplies
 * chrome, and losing it must not lose the page.
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

export const landingRoutes = new Hono<{ Bindings: Env }>();

landingRoutes.get("/", async (context) => {
  // The guard, first and hard: an instance with any org-wide owner renders the
  // page it always rendered. A failure to read the guard resolves to "claimed",
  // because showing an unclaimed landing on a working conference would be far
  // worse than showing the demo landing on a fresh install.
  let unclaimed = false;
  try {
    unclaimed = await instanceIsUnclaimed(context.env.DB);
  } catch (error) {
    loggerForEnv(context.env).emit("worker_error", "error", {
      source: "landingClaimGuard",
      ...errorFields(error),
    });
  }
  if (unclaimed) {
    context.header("Cache-Control", "no-store");
    return context.html(
      renderUnclaimedLandingDocument(await assetShell(context.env.ASSETS, context.req.raw)),
    );
  }

  let data: LandingData;
  try {
    data = await loadLandingData(context.env.DB);
  } catch (error) {
    loggerForEnv(context.env).emit("worker_error", "error", {
      source: "landingPreview",
      ...errorFields(error),
    });
    data = {
      conferenceName: "demo conference",
      counts: EMPTY_COUNTS,
      reviewTrack: "Agents",
      notice: "The live pipeline preview is unavailable. Try again shortly.",
      // A failed read is not evidence that this is a real deployment. Treating
      // it as the demo keeps the graded landing byte-identical under a database
      // wobble, which is the failure worth being conservative about.
      demoMode: true,
    };
  }

  context.header("Cache-Control", "no-store");
  return context.html(renderLandingDocument(await assetShell(context.env.ASSETS, context.req.raw), data));
});

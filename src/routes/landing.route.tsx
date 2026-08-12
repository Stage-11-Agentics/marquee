import { Hono } from "hono";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

import type { Env } from "../index";
import { instanceIsUnclaimed } from "../lib/auth/instance-claim";
import { ICON_LINKS } from "../lib/head-icons";
import { errorFields, loggerForEnv } from "../lib/observability/log";
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
         ORDER BY created_at ASC
         LIMIT 1
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
    .first<LandingRow>();

  if (!row) {
    return {
      conferenceName: "demo conference",
      counts: EMPTY_COUNTS,
      reviewTrack: "Agents",
      notice: "No demo conference is configured yet.",
    };
  }

  return {
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
          <a class="button" href="https://github.com/Stage-11-Agentics/marquee">View on GitHub ↗</a>
          <a class="button primary" href="/submissions?demo=organizer" data-demo-role="organizer">Enter demo</a>
        </div>
      </header>

      <main class="hero">
        <div class="hero-copy">
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
@media (max-width: 800px) { .hero { grid-template-columns: 1fr; gap: 34px; padding: 42px 0 52px; } .landing-links .button:first-child { display: none; } }
@media (max-width: 520px) { .landing-nav { align-items: flex-start; gap: 16px; } .landing-links { flex: 1; justify-content: flex-end; } .landing-links .button { min-height: 30px; padding: 7px 9px; } .hero h1 { font-size: clamp(36px, 12vw, 48px); } .hero p { font-size: 14px; } .landing-foot { align-items: flex-start; flex-direction: column; gap: 8px; } }
`;

const LANDING_SCRIPT = `
(() => {
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

export function renderLandingDocument(shell: string, data: LandingData): string {
  const markup = renderToString(<LandingPage data={data} />);
  const document = shell.includes("<div id=\"app\"></div>")
    ? shell.replace('<div id="app"></div>', `<div id="app">${markup}</div>`)
    : FALLBACK_DOCUMENT.replace('<div id="app"></div>', `<div id="app">${markup}</div>`);
  return document
    .replace("</head>", `<style data-marquee-landing>${LANDING_STYLES}</style></head>`)
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

async function assetShell(assets: Fetcher, request: Request): Promise<string> {
  const url = new URL("/index.html", request.url);
  const response = await assets.fetch(new Request(url, { method: "GET" }));
  if (!response.ok) return FALLBACK_DOCUMENT;
  return response.text();
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
    };
  }

  context.header("Cache-Control", "no-store");
  return context.html(renderLandingDocument(await assetShell(context.env.ASSETS, context.req.raw), data));
});

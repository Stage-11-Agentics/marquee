/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";

import { sessionCalendarLinks, sessionDirectionsUrl } from "../../../lib/public-calendar";
import {
  publicAbstractSnippet,
  type PublicAgendaData,
  type PublicEvent,
  type PublicSession,
  type PublicSpeaker,
  type PublicSpeakerDirectoryData,
  type PublicSpeakerSummary,
  type PublicVenueDisclosure,
} from "../../../lib/public-site";

export const PUBLIC_SITE_STYLES = `
:root {
  --public-bg: #eaeef2;
  --public-surface: #ffffff;
  --public-sunk: #f4f7f9;
  --public-ink: #101820;
  --public-soft: #2c3a46;
  --public-muted: #57646f;
  --public-rule: #c8d2da;
  --public-rule-soft: #dde4ea;
  --public-accent: #0b6a72;
  --public-accent-wash: #e2f0f1;
  --public-warn: #8a5c00;
  --public-warn-wash: #fdf1dd;
  --public-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --public-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.public-site, .public-site * { box-sizing: border-box; }
.public-site { min-height: 100vh; background: var(--public-bg); color: var(--public-ink); font: 14px/1.45 var(--public-sans); }
.public-site body { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.public-site a { color: inherit; text-decoration: none; }
.public-site button, .public-site input, .public-site select, .public-site textarea { color: inherit; font: inherit; }
.public-site button, .public-site a { -webkit-tap-highlight-color: transparent; }
.public-site button { cursor: pointer; }
.public-top { min-height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 clamp(16px, 5vw, 70px); border-bottom: 1px solid var(--public-rule); background: var(--public-surface); }
.public-brand { display: inline-flex; align-items: center; gap: 10px; min-width: 0; font: 650 12px/1 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; }
.public-mark { width: 25px; height: 25px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--public-rule); border-radius: 3px; color: var(--public-accent); font: 700 14px/1 Georgia, serif; }
.public-brand span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.public-top-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.public-button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--public-rule); border-radius: 3px; padding: 7px 11px; background: var(--public-surface); font-size: 12px; font-weight: 650; }
.public-button:hover, .public-button:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.public-button.primary { border-color: var(--public-accent); background: var(--public-accent); color: white; }
.public-button.ghost { border-color: transparent; background: transparent; color: var(--public-accent); }
.public-main { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: clamp(28px, 5vw, 52px) 0 70px; }
.public-kicker { margin-bottom: 12px; color: var(--public-accent); font: 700 10px/1 var(--public-mono); letter-spacing: .13em; text-transform: uppercase; }
.public-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.public-heading h1 { margin: 0 0 7px; font: 550 clamp(30px, 5vw, 44px)/1.02 Georgia, serif; letter-spacing: -.035em; }
.public-heading p { max-width: 660px; margin: 0; color: var(--public-muted); }
.public-filters { min-height: 110px; display: grid; grid-template-columns: repeat(3, minmax(130px, 1fr)) minmax(180px, 1.3fr); align-items: center; gap: 9px; margin-bottom: 14px; padding: 9px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.public-filters > .public-days { grid-column: 1 / -1; }
.public-facet { display: grid; gap: 3px; min-width: 0; }
.public-facet > span { color: var(--public-muted); font: 650 9px/1 var(--public-mono); letter-spacing: .09em; text-transform: uppercase; }
.public-days { min-height: 38px; display: inline-flex; align-items: stretch; gap: 4px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.public-days::-webkit-scrollbar { display: none; }
.public-days button { flex: 0 0 96px; width: 96px; min-height: 36px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-sunk); color: var(--public-muted); font: 650 10px/1 var(--public-mono); white-space: nowrap; }
.public-days button.active { border-color: var(--public-accent); background: var(--public-accent-wash); color: var(--public-accent); }
.public-select, .public-search { width: 100%; min-width: 0; height: 36px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 0 9px; font-size: 12px; }
.public-search::placeholder { color: var(--public-muted); }
.public-agenda-list { min-height: 430px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.public-day-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-height: 38px; margin: 0; padding: 11px 16px; border-bottom: 1px solid var(--public-rule); background: var(--public-accent-wash); font: 650 12px/1 var(--public-mono); letter-spacing: .07em; text-transform: uppercase; }
.public-day-head small { color: var(--public-muted); font: 600 10px/1 var(--public-mono); font-variant-numeric: tabular-nums; text-transform: none; letter-spacing: .04em; }
.public-slot-head { position: sticky; top: 38px; z-index: 1; min-height: 27px; margin: 0; padding: 7px 16px; border-bottom: 1px solid var(--public-rule-soft); background: var(--public-sunk); color: var(--public-soft); font: 650 10px/1.3 var(--public-mono); letter-spacing: .09em; font-variant-numeric: tabular-nums; }
.public-agenda-row { display: grid; grid-template-columns: 40px 118px minmax(0, 1fr) minmax(145px, .55fr); align-items: start; gap: 13px; min-height: 104px; padding: 16px 16px 16px 12px; border-bottom: 1px solid var(--public-rule-soft); }
.public-agenda-row:last-child { border-bottom: 0; }
.public-time { color: var(--public-muted); font: 650 11px/1.35 var(--public-mono); font-variant-numeric: tabular-nums; }
.public-day { display: block; margin-bottom: 3px; color: var(--public-accent); font-size: 10px; }
.public-time strong { display: block; margin-bottom: 1px; color: var(--public-ink); font-size: 15px; }
.public-time span { display: block; line-height: 1.35; }
.public-until { margin-bottom: 3px; }
.public-session-title { margin: 0; font: 650 17px/1.2 Georgia, serif; letter-spacing: -.01em; }
.public-session-title a:hover, .public-session-title a:focus-visible { color: var(--public-accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.public-speakers { min-height: 20px; margin: 8px 0 0; color: var(--public-muted); font-size: 12px; }
.public-speakers a { text-decoration: underline; text-decoration-color: var(--public-rule); text-underline-offset: 3px; }
.public-speakers a:hover, .public-speakers a:focus-visible { color: var(--public-accent); }
.public-speaker-role { color: var(--public-soft); }
/* Real abstracts contain pasted URLs. On a phone one of them is wider than
   the column, and an unbreakable token drags the whole page sideways — so the
   card's prose breaks rather than the layout. */
.public-abstract, .public-more p, .public-session-title, .public-speakers { overflow-wrap: anywhere; }
.public-abstract { min-height: 34px; margin: 9px 0 0; color: var(--public-soft); font-size: 12px; line-height: 1.55; }
.public-more { margin-top: 5px; }
.public-more > summary { display: inline-block; color: var(--public-accent); font: 650 11px/1.3 var(--public-mono); cursor: pointer; list-style: none; }
.public-more > summary::-webkit-details-marker { display: none; }
.public-more > summary::after { content: " ▾"; }
.public-more[open] > summary::after { content: " ▴"; }
.public-more > summary:hover, .public-more > summary:focus-visible { text-decoration: underline; text-underline-offset: 3px; outline: none; }
.public-more p { margin: 6px 0 0; color: var(--public-soft); font-size: 12px; line-height: 1.55; }
.public-more a { color: var(--public-accent); font: 650 11px/1.3 var(--public-mono); }
.public-card-meta { display: grid; gap: 9px; align-content: start; }
.public-meta-row { display: grid; gap: 4px; justify-items: flex-end; }
.public-meta-row > span { color: var(--public-muted); font: 650 9px/1 var(--public-mono); letter-spacing: .09em; text-transform: uppercase; }
.public-track-list { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: flex-start; gap: 5px; }
.public-track-chip { display: inline-flex; min-height: 23px; align-items: center; border: 1px solid var(--public-rule); border-left: 3px solid var(--track-color, var(--public-accent)); border-radius: 2px; padding: 3px 6px; color: var(--public-muted); font: 600 9px/1.2 var(--public-mono); }
.public-format-chip { display: inline-flex; min-height: 23px; align-items: center; border: 1px solid var(--public-accent); border-radius: 2px; padding: 3px 6px; background: var(--public-accent-wash); color: var(--public-accent); font: 600 9px/1.2 var(--public-mono); }
.public-empty { min-height: 428px; display: grid; place-items: center; padding: 36px; color: var(--public-muted); text-align: center; }
.public-empty strong { display: block; margin-bottom: 5px; color: var(--public-ink); font: 650 18px/1.2 Georgia, serif; }
.public-empty span { display: block; }
.public-empty .public-button { margin-top: 16px; }
.public-card { border: 1px solid var(--public-rule); background: var(--public-surface); padding: clamp(20px, 4vw, 36px); }
.public-card h1 { margin: 13px 0 8px; font: 550 clamp(30px, 5vw, 46px)/1.03 Georgia, serif; letter-spacing: -.035em; }
.public-card h2 { margin: 0 0 9px; font: 650 15px/1.2 var(--public-mono); letter-spacing: .05em; text-transform: uppercase; }
.public-card p { color: var(--public-soft); line-height: 1.65; }
.public-detail-meta { margin: 0; color: var(--public-muted) !important; font: 600 11px/1.45 var(--public-mono); }
.detail-actions { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; margin: 18px 0 0; }
.public-getting-there { margin: 0; color: var(--public-muted); font: 600 11px/1.7 var(--public-mono); }
.public-getting-there a { color: var(--public-accent); text-decoration: underline; text-underline-offset: 3px; }
.public-divider { height: 1px; margin: 25px 0; background: var(--public-rule-soft); }
.public-speaker-list { display: grid; gap: 8px; }
.public-speaker-link, .public-session-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--public-rule-soft); padding: 11px 12px; }
.public-speaker-link:hover, .public-speaker-link:focus-visible, .public-session-link:hover, .public-session-link:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.public-speaker-link strong, .public-session-link strong { display: block; font-size: 13px; }
.public-speaker-link small, .public-session-link small { display: block; margin-top: 3px; color: var(--public-muted); }
.public-profile { display: flex; align-items: flex-start; gap: 14px; }
.public-avatar { --avatar-size: 48px; width: var(--avatar-size); height: var(--avatar-size); display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--public-rule); background: var(--public-accent-wash); color: var(--public-accent); font: 700 12px/1 var(--public-mono); object-fit: cover; }
.public-speaker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.public-directory-filters { grid-template-columns: minmax(0, 1fr) auto; }
.public-directory-actions { display: flex; gap: 8px; }

.public-directory-card { display: flex; align-items: flex-start; gap: 13px; min-height: 132px; border: 1px solid var(--public-rule); background: var(--public-surface); padding: 16px; }
.public-directory-card:hover, .public-directory-card:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.public-directory-card .public-avatar { --avatar-size: 56px; font-size: 13px; }
.public-directory-card h2 { margin: 0; font: 650 18px/1.15 Georgia, serif; }
.public-directory-card p { margin: 6px 0 0; color: var(--public-muted); font-size: 11px; line-height: 1.45; }
.public-directory-card small { display: block; margin-top: 12px; color: var(--public-accent); font: 650 9px/1 var(--public-mono); letter-spacing: .06em; text-transform: uppercase; }
.public-profile h1 { margin-top: 0; }
.public-not-found { max-width: 680px; margin: 40px auto; text-align: center; }
.public-not-found .public-card { min-height: 300px; display: grid; place-items: center; }
.public-not-found strong { display: block; color: var(--public-accent); font: 700 28px/1 var(--public-mono); }
.public-not-found h1 { margin: 12px 0 7px; font: 550 30px/1.1 Georgia, serif; }

/* ── The attendee's own schedule ───────────────────────────────────────
   Stars, the itinerary view, and its sheets. Every rule here is lifted
   from the ratified prototype (prototypes/attendee-schedule/index.html);
   the build reproduces it one-to-one. */

.num { font-family: var(--public-mono); font-variant-numeric: tabular-nums lining-nums; }

/* One tap, a fixed slot, never moves: the leading rail down every card. */
.star-btn { width: 36px; height: 36px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--public-rule); border-radius: 3px; background: var(--public-surface); color: var(--public-muted); font-size: 17px; line-height: 1; transition: border-color 110ms, background 110ms, color 110ms, transform 110ms; }
.star-btn:hover, .star-btn:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); color: var(--public-accent); outline: none; }
/* Starred is gold on ink; unstarred is a quiet outline. The state lives on
   aria-pressed, so the control's accessible truth and its paint can never
   disagree. */
.star-btn[aria-pressed="true"] { border-color: var(--public-ink); background: var(--public-ink); color: #ffc94d; }
.star-btn[aria-pressed="true"]:hover, .star-btn[aria-pressed="true"]:focus-visible { border-color: var(--public-ink); background: #22303c; color: #ffd76e; }
.star-btn .glyph::before { content: "☆"; }
.star-btn[aria-pressed="true"] .glyph::before { content: "★"; }
.star-btn.just-starred { transform: scale(1.12); }
.public-agenda-row > .star-btn { margin-top: -2px; }

/* Two labelled buttons, not a toggle: the current view and the way back
   are both legible. The count is fixed-width so nothing shifts as it fills. */
.view-seg { display: inline-flex; gap: 0; }
.view-seg .seg { border-radius: 0; gap: 7px; }
.view-seg .seg:first-child { border-radius: 3px 0 0 3px; }
.view-seg .seg:last-child { border-radius: 0 3px 3px 0; margin-left: -1px; }
.view-seg .seg[aria-selected="true"] { border-color: var(--public-accent); background: var(--public-accent); color: #fff; position: relative; z-index: 1; }
.mysched-btn .count { display: inline-grid; place-items: center; min-width: 22px; height: 20px; border-radius: 2px; padding: 0 4px; background: var(--public-accent-wash); color: var(--public-accent-ink); font: 700 11px/1 var(--public-mono); font-variant-numeric: tabular-nums; }
.mysched-btn[aria-selected="true"] .count { background: rgba(255,255,255,.18); color: #fff; }
.mysched-btn.has-stars .glyph { color: #c9920a; }
.mysched-btn[aria-selected="true"] .glyph { color: #ffc94d; }

/* Itinerary */
.sched-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-height: 58px; margin-bottom: 14px; padding: 9px 12px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.sched-summary .counts { color: var(--public-muted); font: 650 11px/1.4 var(--public-mono); }
.sched-summary .counts strong { color: var(--public-ink); font-size: 14px; margin-right: 8px; }
.sched-export { display: flex; gap: 7px; flex-wrap: wrap; }
.next-chip { display: inline-flex; align-items: center; min-height: 18px; margin-left: 8px; border-radius: 2px; padding: 2px 6px; background: var(--public-accent); color: #fff; font: 700 9px/1 var(--public-mono); letter-spacing: .12em; text-transform: uppercase; vertical-align: 2px; }
.overlap-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 20px; margin-top: 7px; border: 1px solid var(--public-rule-soft); border-radius: 2px; padding: 2px 7px; color: var(--public-muted); background: var(--public-sunk); font: 600 10px/1.3 var(--public-mono); }
.overlap-chip::before { content: "‖"; color: var(--public-warn); font-weight: 700; }
.sched-note { margin: 0 0 14px; border: 1px solid var(--public-rule); background: var(--public-surface); padding: 12px 14px; color: var(--public-muted); font-size: 12px; line-height: 1.6; }

/* "At a glance": a real time axis, overlapping picks side by side, a NOW rule. */
.glance { display: grid; grid-template-columns: 34px repeat(var(--glance-days, 3), 1fr); gap: 0 10px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.glance-head { grid-row: 1; padding-bottom: 7px; color: var(--public-accent); font: 700 9.5px/1.3 var(--public-mono); letter-spacing: .1em; text-transform: uppercase; }
.glance-head small { display: block; color: var(--public-muted); letter-spacing: .06em; }
.glance-axis { grid-row: 2; position: relative; height: 234px; }
.glance-axis span { position: absolute; right: 6px; transform: translateY(-50%); color: var(--public-muted); font: 600 9px/1 var(--public-mono); }
.glance-lane { grid-row: 2; position: relative; height: 234px; border: 1px solid var(--public-rule-soft); background: var(--public-sunk); background-image: repeating-linear-gradient(to bottom, var(--public-rule-soft) 0 1px, transparent 1px 26px); }
.glance-block { position: absolute; left: 3px; right: 3px; overflow: hidden; display: flex; align-items: flex-start; gap: 5px; border: 1px solid var(--public-accent); border-left-width: 3px; border-radius: 2px; background: var(--public-accent-wash); padding: 2px 5px; text-align: left; cursor: pointer; min-height: 17px; }
.glance-block:hover, .glance-block:focus-visible { background: var(--public-accent); color: #fff; outline: none; }
.glance-block:hover small, .glance-block:focus-visible small { color: rgba(255,255,255,.85); }
.glance-block small { flex: 0 0 auto; color: var(--public-accent-ink); font: 700 9px/1.5 var(--public-mono); font-variant-numeric: tabular-nums; }
.glance-block strong { flex: 1 1 auto; min-width: 0; font: 650 10px/1.35 var(--public-sans); letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.glance-block.lane-a { right: calc(50% + 2px); }
.glance-block.lane-b { left: calc(50% + 2px); }
.glance-block.is-next { border-color: var(--public-accent); box-shadow: inset 0 0 0 1px var(--public-accent); }
.glance-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--public-muted); font: 600 10px/1 var(--public-mono); }
.glance-now { position: absolute; left: 0; right: 0; z-index: 2; border-top: 2px solid #b02a1f; pointer-events: none; }
.glance-now span { position: absolute; left: 0; top: -8px; padding: 1px 4px; background: #b02a1f; color: #fff; border-radius: 2px; font: 700 8.5px/1.5 var(--public-mono); font-variant-numeric: tabular-nums; }
.glance-tip { position: fixed; z-index: 200; width: 264px; background: var(--public-surface); border: 1px solid var(--public-accent); border-radius: 3px; padding: 10px 12px; pointer-events: none; display: none; }
.glance-tip.show { display: block; }
.glance-tip .t-time { color: var(--public-accent); font: 700 10px/1.4 var(--public-mono); font-variant-numeric: tabular-nums; letter-spacing: .06em; }
.glance-tip .t-title { margin: 3px 0 4px; font: 650 14px/1.25 Georgia, serif; letter-spacing: -.01em; color: var(--public-ink); }
.glance-tip .t-meta { color: var(--public-muted); font-size: 11px; line-height: 1.45; }
.glance-tip .t-overlap { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; border: 1px solid var(--public-rule-soft); border-radius: 2px; padding: 1px 6px; color: var(--public-muted); background: var(--public-sunk); font: 600 9.5px/1.4 var(--public-mono); }
.glance-tip .t-overlap::before { content: "‖"; color: var(--public-warn); font-weight: 700; }

/* Sheets */
.sheet-scrim { position: fixed; inset: 0; z-index: 90; background: rgba(16,24,32,.34); display: none; }
.sheet-scrim.open { display: block; }
.sheet { position: fixed; z-index: 100; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(560px, calc(100% - 28px)); max-height: min(84vh, 700px); overflow-y: auto; background: var(--public-surface); border: 1px solid var(--public-rule); border-radius: 3px; padding: 22px; display: none; }
.sheet.open { display: block; }
.sheet h2 { margin: 0 0 4px; font: 550 22px/1.15 Georgia, serif; letter-spacing: -.02em; text-transform: none; }
.sheet > p { margin: 0 0 16px; color: var(--public-muted); font-size: 12.5px; line-height: 1.55; }
/* A bad moment gets its own line rather than overwriting the sheet's
   explanation, which the attendee still needs once the network returns. */
.sheet > p.sheet-error { margin: 0 0 12px; padding: 8px 10px; border: 1px solid var(--public-warn); border-radius: 2px; background: var(--public-warn-wash); color: var(--public-warn); }
.sheet-row { border: 1px solid var(--public-rule-soft); border-radius: 3px; padding: 12px; margin-bottom: 10px; }
.sheet-row h3 { margin: 0 0 3px; font: 650 12px/1.3 var(--public-sans); }
.sheet-row .hint { margin: 0 0 8px; color: var(--public-muted); font-size: 11.5px; line-height: 1.5; }
.url-line { display: flex; gap: 7px; align-items: stretch; }
.url-line code { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-sunk); padding: 7px 9px; font: 600 11px/1.3 var(--public-mono); color: var(--public-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-btn { flex: 0 0 72px; width: 72px; min-height: 34px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); font: 650 11px/1 var(--public-mono); }
.copy-btn:hover, .copy-btn:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.copy-btn.done { border-color: var(--public-accent); background: var(--public-accent); color: #fff; }
.sheet-close { margin-top: 8px; width: 100%; }
.qr { width: 180px; height: 180px; margin: 4px auto 0; display: block; border: 1px solid var(--public-rule); background: #fff; padding: 8px; image-rendering: pixelated; }
.agents-pre { margin: 8px 0 0; border: 1px solid var(--public-rule); background: var(--public-sunk); border-radius: 2px; padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; font: 600 10.5px/1.7 var(--public-mono); color: var(--public-soft); }
.agents-pre b { color: var(--public-accent-ink); font-weight: 700; }

/* Session detail */
.back-link { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px; color: var(--public-accent); font: 650 11px/1 var(--public-mono); letter-spacing: .06em; text-transform: uppercase; }
.back-link:hover, .back-link:focus-visible { text-decoration: underline; text-underline-offset: 3px; }

/* Footer */
.public-footer { border-top: 1px solid var(--public-rule); background: var(--public-surface); margin-top: 40px; }
.public-footer-inner { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 18px 0; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--public-muted); font: 600 10px/1.6 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; }
.public-footer-links { display: flex; gap: 16px; }
.public-footer-inner a { color: var(--public-accent); }
.public-footer-inner a:hover, .public-footer-inner a:focus-visible { text-decoration: underline; text-underline-offset: 3px; }

@media (max-width: 760px) {
  .public-heading { display: block; }
  .public-filters { min-height: 150px; grid-template-columns: 1fr 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: 1 / -1; width: 100%; }
  .public-days button { flex: 1 1 0; width: auto; min-width: 0; padding: 0 2px; font-size: 9px; }
  .public-agenda-row { grid-template-columns: 40px 86px minmax(0, 1fr); gap: 10px; }
  .public-card-meta { grid-column: 3; }
  .public-meta-row { justify-items: flex-start; }
  .public-track-list { justify-content: flex-start; }
  .glance { grid-template-columns: 34px repeat(var(--glance-days, 3), 1fr); }
}
@media (max-width: 460px) {
  .public-top { align-items: center; flex-wrap: wrap; row-gap: 8px; padding-top: 10px; padding-bottom: 10px; }
  /* Brand on one row, the view switch spanning the next: on a phone the
     switch is the primary control and gets the whole width. */
  .public-top-actions { flex: 1 1 100%; width: 100%; gap: 4px; }
  .public-top-actions .public-button { min-height: 30px; padding: 5px 7px; font-size: 10px; }
  .view-seg { flex: 1 1 100%; width: 100%; }
  /* Two halves of one row, each on one line: "My schedule" breaking across
     two lines made the switch look like two different controls. */
  .view-seg .seg { flex: 1 1 0; min-height: 38px; gap: 5px; padding: 7px 4px; white-space: nowrap; }
  .public-filters { min-height: 236px; grid-template-columns: 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: auto; }
  .public-agenda-row { grid-template-columns: 40px minmax(0, 1fr); min-height: 132px; padding: 14px 14px 14px 10px; }
  .public-agenda-row > .star-btn { grid-row: 1 / span 3; }
  .public-agenda-row > .public-time, .public-agenda-row > div { grid-column: 2; }
  .public-card-meta { grid-column: 2; }
  .public-session-title { font-size: 16px; }
  .sched-summary { padding: 9px; }
  .sched-export { width: 100%; }
  .sched-export .public-button { flex: 1 1 45%; padding: 7px 4px; font-size: 11px; }
}
`;

export const PUBLIC_AGENDA_SCRIPT = `
(() => {
  const form = document.querySelector('[data-public-agenda-filters]');
  if (!form) return;
  const submit = () => {
    const activeDay = form.querySelector('button[name="day"].active');
    if (!(activeDay instanceof HTMLButtonElement)) preserveCurrentDay();
    if (form.requestSubmit) form.requestSubmit(activeDay instanceof HTMLButtonElement ? activeDay : undefined);
    else form.submit();
  };
  function preserveCurrentDay() {
    const currentDay = new URLSearchParams(window.location.search).get('day');
    if (!currentDay || currentDay === 'all') return;
    let preservedDay = form.querySelector('input[data-preserved-day]');
    if (!(preservedDay instanceof HTMLInputElement)) {
      preservedDay = document.createElement('input');
      preservedDay.type = 'hidden';
      preservedDay.name = 'day';
      preservedDay.dataset.preservedDay = 'true';
      form.append(preservedDay);
    }
    preservedDay.value = currentDay;
  }
  const days = form.querySelector('.public-days');
  const activeTab = form.querySelector('button[name="day"].active');
  if (days instanceof HTMLElement && activeTab instanceof HTMLElement && days.scrollWidth > days.clientWidth) {
    days.scrollLeft = Math.max(0, activeTab.offsetLeft - days.offsetLeft);
  }
  form.querySelectorAll('select').forEach((control) => control.addEventListener('change', submit));
  const search = form.querySelector('[name="q"]');
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  let timer;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(submit, 180);
  });
})();
`;

/** What the one client module needs to know, stamped onto the page root. */
export interface PublicScheduleConfig {
  eventSlug: string;
  eventName: string;
  timezone: string;
  days: Array<{ date: string; label: string }>;
  view: "agenda" | "mine";
}

export type PublicScheduleView = "agenda" | "mine";

/**
 * The header count is a number stated as fact, in tabular figures. Any page
 * that renders it has to be able to fill it, so every public shell carries the
 * config the module reads — on a page with no session cards the module simply
 * paints the count and stops.
 */
export function countOnlySchedule(event: PublicEvent): PublicScheduleConfig {
  return {
    eventSlug: event.slug,
    eventName: event.name,
    timezone: event.timezone,
    days: [],
    view: "agenda",
  };
}

function agendaHref(eventSlug: string, view: PublicScheduleView): string {
  const query = `event=${encodeURIComponent(eventSlug)}`;
  return view === "mine" ? `/agenda?${query}&view=mine` : `/agenda?${query}`;
}

/**
 * The star, server-rendered in its fixed slot on every surface a session
 * appears on. It ships state-unknown (`aria-pressed="false"`) because only the
 * browser holds the answer; the script flips it in place and nothing moves.
 */
export function StarButton({ session }: { session: PublicSession }): JSX.Element {
  return (
    <button
      type="button"
      class="star-btn"
      data-schedule-star={session.id}
      aria-pressed="false"
      aria-label={`Add to my schedule: ${session.title}`}
    >
      <span class="glyph" aria-hidden="true" />
    </button>
  );
}

/**
 * "My schedule" lives in the header with a live count — one tap away from
 * every public page, including a session's own. Two labelled segments rather
 * than a toggle: the current view and the way back are both legible, and the
 * count sits in a fixed-width slot so filling it moves nothing.
 */
function ViewSegments({ eventSlug, view }: { eventSlug: string; view: PublicScheduleView }): JSX.Element {
  return (
    <div class="view-seg" role="tablist" aria-label="View">
      <a class="public-button seg" role="tab" aria-selected={view === "agenda" ? "true" : "false"} href={agendaHref(eventSlug, "agenda")} data-schedule-view="agenda">Conference agenda</a>
      <a class="public-button seg mysched-btn" role="tab" aria-selected={view === "mine" ? "true" : "false"} href={agendaHref(eventSlug, "mine")} data-schedule-view="mine">
        <span class="glyph" aria-hidden="true">★</span> My schedule <span class="count num" data-schedule-count>0</span>
      </a>
    </div>
  );
}

export function PublicShell({
  event,
  title,
  actions,
  children,
  schedule,
  view = "agenda",
}: {
  event: PublicEvent;
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
  schedule?: PublicScheduleConfig;
  view?: PublicScheduleView;
}): JSX.Element {
  return (
    <div
      class="public-site"
      data-public-page={title.toLowerCase().replaceAll(" ", "-")}
      data-public-schedule={schedule ? JSON.stringify(schedule) : undefined}
    >
      <header class="public-top">
        <a class="public-brand" href="/" aria-label={`${event.name} — Marquee home`}>
          <span class="public-mark">M</span><span>{event.name}</span>
        </a>
        <div class="public-top-actions">
          {actions}
          <ViewSegments eventSlug={event.slug} view={view} />
        </div>
      </header>
      {children}
      <footer class="public-footer">
        <div class="public-footer-inner">
          <span>{event.name} · {event.startsOn} – {event.endsOn}{event.venue ? ` · ${event.venue}` : ""}</span>
          <span class="public-footer-links">
            <a href={`/agenda/agents?event=${encodeURIComponent(event.slug)}`}>For agents ↗</a>
            <a href="/">Organizer demo</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function sessionHref(slug: string): string {
  return `/s/${encodeURIComponent(slug)}`;
}

function speakerHref(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

function TrackChips({ session }: { session: PublicSession }): JSX.Element {
  return (
    <div class="public-track-list">
      {session.tracks.length > 0 ? session.tracks.map((track) => (
        <span class="public-track-chip" style={{ "--track-color": track.color }} key={track.id}>{track.name}</span>
      )) : <span class="public-track-chip">—</span>}
    </div>
  );
}

function FormatChip({ session }: { session: PublicSession }): JSX.Element {
  return <span class="public-format-chip">{session.format?.name ?? "—"}</span>;
}

/**
 * Format and Track carry their own labels rather than sitting in one
 * undifferentiated chip row: a reader (or an agent reading a screenshot)
 * should never have to guess which taxonomy a chip belongs to. Both rows
 * always render — "—" where a session carries no value — so a card's height
 * does not change with its data.
 */
function CardMeta({ session }: { session: PublicSession }): JSX.Element {
  return (
    <div class="public-card-meta">
      <div class="public-meta-row"><span>Format</span><FormatChip session={session} /></div>
      <div class="public-meta-row"><span>Track</span><TrackChips session={session} /></div>
    </div>
  );
}

function speakerRole(speaker: PublicSpeakerSummary): string {
  return [speaker.title, speaker.company].filter(Boolean).join(", ");
}

/** Job title and company have always been in the projection; the card just never showed them. */
function SpeakerLine({ session }: { session: PublicSession }): JSX.Element {
  return (
    <p class="public-speakers">
      {session.speakers.length > 0 ? session.speakers.map((speaker, index) => (
        <span key={speaker.id}>
          {index > 0 ? " · " : ""}
          <a href={speakerHref(speaker.slug)}>{speaker.name}</a>
          {speakerRole(speaker) ? <span class="public-speaker-role"> — {speakerRole(speaker)}</span> : null}
        </span>
      )) : "—"}
    </p>
  );
}

/**
 * The description a list page can afford: a server-truncated snippet plus a
 * `<details>` expansion. No JavaScript is involved — these pages are SSR
 * strings — and the whole abstract never ships to a list of a hundred cards.
 */
function SessionAbstract({ session }: { session: PublicSession }): JSX.Element {
  const snippet = publicAbstractSnippet(session.abstract);
  if (!snippet) return <p class="public-abstract">—</p>;
  return (
    <>
      <p class="public-abstract">{snippet.head}{snippet.rest ? "…" : ""}</p>
      {snippet.rest ? (
        <details class="public-more">
          <summary>Show more</summary>
          <p>{snippet.rest}{snippet.clipped ? "…" : ""}</p>
          {snippet.clipped ? <a href={sessionHref(session.slug)}>Read the full abstract →</a> : null}
        </details>
      ) : null}
    </>
  );
}

/**
 * The per-card contract. `data-public-session-id` predates this render tree;
 * slug, start and day joined it so a client module binds to stable hooks
 * instead of editing this markup. `-end` is what a conflict is made of — an
 * overlap needs intervals, not instants — and title/room/speakers let the
 * schedule module render an itinerary without scraping the card's markup.
 * The same hooks are what a computer-use agent drives.
 */
function SessionCard({ session }: { session: PublicSession }): JSX.Element {
  return (
    <article
      class="public-agenda-row"
      data-public-session-id={session.id}
      data-public-session-slug={session.slug}
      data-public-session-start={session.startsAt}
      data-public-session-end={session.startsAt + session.durationMin * 60_000}
      data-public-session-day={session.date}
      data-public-session-title={session.title}
      data-public-session-room={session.roomLabel}
      data-public-session-speakers={session.speakers.map((speaker) => speaker.name).join(", ")}
    >
      <StarButton session={session} />
      <time class="public-time" dateTime={`${session.date}T${session.time}`}>
        <span class="public-day">{session.day}</span>
        <strong>{session.time}</strong>
        <span class="public-until">→ {session.endTime}</span>
        <span>{session.roomLabel}</span>
      </time>
      <div>
        <h3 class="public-session-title"><a href={sessionHref(session.slug)}>{session.title}</a></h3>
        <SpeakerLine session={session} />
        <SessionAbstract session={session} />
      </div>
      <CardMeta session={session} />
    </article>
  );
}

interface AgendaTimeSlot {
  time: string;
  sessions: PublicSession[];
}

interface AgendaDayGroup {
  date: string;
  label: string;
  count: number;
  slots: AgendaTimeSlot[];
}

/**
 * Day sections with time-slot headers inside them. EMB-06 passes on a clearly
 * time-slotted list and this is the honest reading of a conference schedule on
 * a phone; the room-column grid is deliberately not built.
 */
function groupSessions(sessions: PublicSession[]): AgendaDayGroup[] {
  const groups: AgendaDayGroup[] = [];
  for (const session of sessions) {
    let group = groups.at(-1);
    if (!group || group.date !== session.date) {
      group = { date: session.date, label: session.day, count: 0, slots: [] };
      groups.push(group);
    }
    group.count += 1;
    let slot = group.slots.at(-1);
    if (!slot || slot.time !== session.time) {
      slot = { time: session.time, sessions: [] };
      group.slots.push(slot);
    }
    slot.sessions.push(session);
  }
  return groups;
}

/**
 * The itinerary's own furniture, server-rendered empty.
 *
 * Nothing here can be filled on the server — the starred set lives in the
 * attendee's browser and never leaves it unless they ask. So every slot the
 * script will fill exists in the SSR markup at its final size: the summary bar
 * keeps its 58px, the glance panel its axis height, the count its 22px. The
 * script flips content into reserved space; it never inserts layout.
 */
function MySchedulePanels({ days, eventSlug }: { days: PublicAgendaData["days"]; eventSlug: string }): JSX.Element {
  return (
    <>
      <noscript>
        <p class="sched-note">Your schedule lives in this browser, so it needs JavaScript. Everything below is the full conference program.</p>
      </noscript>
      <div class="sched-summary" data-schedule-summary hidden>
        <span class="counts num" data-schedule-counts />
        <div class="sched-export">
          <button type="button" class="public-button" data-schedule-action="phone">Open on your phone</button>
          <button type="button" class="public-button" data-schedule-action="ics">Download .ics</button>
          <button type="button" class="public-button" data-schedule-action="share">Subscribe / share</button>
          <button type="button" class="public-button" data-schedule-action="brief">Brief your agent</button>
        </div>
      </div>
      <div
        class="glance"
        style={{ "--glance-days": String(Math.max(days.length, 1)) }}
        aria-label="My schedule at a glance"
        data-schedule-glance
        hidden
      />
      <section class="public-agenda-list" data-schedule-empty hidden>
        <div class="public-empty"><div>
          <strong>Nothing starred yet</strong>
          <span>Tap ☆ on any session and it lands here — your own conference, in time order. No account needed.</span>
          <a class="public-button primary" href={`/agenda?event=${encodeURIComponent(eventSlug)}`}>Browse the agenda</a>
        </div></div>
      </section>
    </>
  );
}

/**
 * The sheets: cross-device handoff, the share/subscribe pair, and the agent
 * briefing. Static markup, script-toggled — a public page carries no Preact
 * runtime, and a dialog that only exists after a fetch is a dialog that stalls.
 */
function ScheduleSheets(): JSX.Element {
  return (
    <>
      <div class="sheet-scrim" data-schedule-scrim />
      <div class="sheet" id="schedule-phone-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-phone-title" data-schedule-sheet="phone">
        <h2 id="schedule-phone-title">Open on your phone</h2>
        <p class="sheet-error" data-schedule-error hidden />
        <p>Scan and your phone picks up right where this leaves off — same stars, same schedule, both devices can edit. The link carries your private write key in the URL fragment, so it never reaches our logs. Don't share this one; use <b>Share</b> for friends.</p>
        {/* Drawn in the browser, never fetched: the private write key rides
            the URL fragment and must not reach a server to become an image. */}
        <canvas class="qr" width="180" height="180" role="img" aria-label="QR code for your private sync link" data-schedule-qr />
        <div class="url-line" style={{ marginTop: "14px" }}>
          <code data-schedule-url="sync" />
          <button type="button" class="copy-btn" data-schedule-copy="sync">Copy</button>
        </div>
        <button type="button" class="public-button sheet-close" data-schedule-close>Done</button>
      </div>
      <div class="sheet" id="schedule-share-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-share-title" data-schedule-sheet="share">
        <h2 id="schedule-share-title">Your schedule, everywhere</h2>
        <p class="sheet-error" data-schedule-error hidden />
        <p>One code — <code class="num" data-schedule-code /> — powers all three. No account needed.</p>
        <div class="sheet-row">
          <h3>Subscribe in your calendar</h3>
          <p class="hint">Live feed — restar a session here and your calendar updates by itself. The strongest way to never miss a pick.</p>
          <div class="url-line">
            <code data-schedule-url="webcal" />
            <button type="button" class="copy-btn" data-schedule-copy="webcal">Copy</button>
          </div>
        </div>
        <div class="sheet-row">
          <h3>Share with a friend</h3>
          <p class="hint">Read-only. They see your picks and can import a copy into their own schedule — their stars stay theirs.</p>
          <div class="url-line">
            <code data-schedule-url="share" />
            <button type="button" class="copy-btn" data-schedule-copy="share">Copy</button>
          </div>
        </div>
        <button type="button" class="public-button sheet-close" data-schedule-close>Done</button>
      </div>
      <div class="sheet" id="schedule-brief-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-brief-title" data-schedule-sheet="brief">
        <h2 id="schedule-brief-title">Brief your agent</h2>
        <p class="sheet-error" data-schedule-error hidden />
        <p>One block, ready to paste into any agent. Your picks are inline so it works immediately; the live URLs let the agent re-check and act on your behalf.</p>
        <pre class="agents-pre" style={{ maxHeight: "280px", overflowY: "auto" }} data-schedule-brief />
        <div class="url-line" style={{ marginTop: "10px" }}>
          <code style={{ border: 0, background: "none", paddingLeft: 0 }}>Paste into Claude, ChatGPT, or your own agent</code>
          <button type="button" class="copy-btn" style={{ flexBasis: "110px", width: "110px" }} data-schedule-copy="brief">Copy briefing</button>
        </div>
        <button type="button" class="public-button sheet-close" data-schedule-close>Done</button>
      </div>
    </>
  );
}

export function PublicAgendaPage({ data, view = "agenda" }: { data: PublicAgendaData; view?: PublicScheduleView }): JSX.Element {
  const eventQuery = `event=${encodeURIComponent(data.event.slug)}`;
  const mine = view === "mine";
  const hasFilters = Boolean(
    data.filters.track || data.filters.format || data.filters.room || data.filters.q
      || (data.filters.day && data.filters.day !== "all"),
  );
  /**
   * The feed URL for exactly what is on screen. The old data link carried the
   * event and nothing else, so from a filtered agenda it handed you a different
   * program than the one you were reading — which is why MRQ-94 removed it
   * rather than fix it. A link that answers a different question than the page
   * is worse than no link; a link that answers the same one is the page's
   * machine-readable half.
   */
  const feedQuery = new URLSearchParams({ event: data.event.slug });
  if (data.filters.day && data.filters.day !== "all") feedQuery.set("day", data.filters.day);
  if (data.filters.track) feedQuery.set("track", data.filters.track);
  if (data.filters.format) feedQuery.set("format", data.filters.format);
  if (data.filters.room) feedQuery.set("room", data.filters.room);
  if (data.filters.q) feedQuery.set("q", data.filters.q);
  const venueName = data.venue?.buildingName ?? data.event.venue ?? "Online";
  const groups = groupSessions(data.sessions);
  return (
    <PublicShell
      event={data.event}
      title="Agenda"
      view={view}
      schedule={{
        eventSlug: data.event.slug,
        eventName: data.event.name,
        timezone: data.event.timezone,
        days: data.days.map((day) => ({ date: day.id, label: day.label })),
        view,
      }}
      /*
        The itinerary is the attendee's own page: brand, the two segments, and
        nothing else, exactly as ruled. Speakers, the data feed and the embed
        builder are still one tap away on the agenda they came from — they are
        not deleted, they are simply not what this screen is for.
      */
      actions={mine ? undefined : <>
        <a class="public-button" href={`/speakers?${eventQuery}`}>Speakers</a>
        <a class="public-button" href={`/api/v1/public/agenda?${feedQuery.toString()}`}>Agenda data ↗</a>
        <a class={`public-button ${data.sessions.length > 0 ? "primary" : ""}`.trim()} href={`/embed/config?${eventQuery}`}>Get embed code</a>
      </>}
    >
      <main class="public-main">
        <div class="public-kicker">{mine ? `Your itinerary · ${data.event.name}` : `${data.event.startsOn} → ${data.event.endsOn} · ${venueName}`}</div>
        <div class="public-heading">
          <div>
            <h1>{mine ? "My schedule" : "Agenda"}</h1>
            <p>{mine
              ? "Everything you've starred, in the order your conference happens. Stars live on this device until you sync or share."
              : data.event.tagline ?? "Practical sessions for people building and operating AI."}</p>
          </div>
        </div>
        {/*
          A shared link's landing strip. The count cannot be known until the
          code is fetched, so the strip ships at its final size and the script
          fills the sentence — the same reserve-then-fill rule as the summary.
        */}
        <div class="sched-note" data-schedule-import hidden>
          <span data-schedule-import-message>Someone shared a schedule with you.</span>{" "}
          <button type="button" class="public-button" data-schedule-action="import">Import a copy into my schedule</button>
        </div>
        {mine ? <MySchedulePanels days={data.days} eventSlug={data.event.slug} /> : null}
        <form class="public-filters" method="get" action="/agenda" data-public-agenda-filters hidden={mine}>
          <input type="hidden" name="event" value={data.event.slug} />
          <div class="public-days" role="tablist" aria-label="Agenda day">
            <button type="submit" name="day" value="all" class={data.filters.day === "all" ? "active" : ""} role="tab" aria-selected={data.filters.day === "all"}>
              All days
            </button>
            {data.days.map((day) => (
              <button type="submit" name="day" value={day.id} class={data.filters.day === day.id ? "active" : ""} role="tab" aria-selected={data.filters.day === day.id} key={day.id}>
                {day.label.replace(" · ", " ")}
              </button>
            ))}
          </div>
          <label class="public-facet">
            <span>Track</span>
            <select class="public-select" name="track" aria-label="Filter by track" value={data.filters.track ?? ""}>
              <option value="">All tracks</option>
              {data.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
            </select>
          </label>
          <label class="public-facet">
            <span>Format</span>
            <select class="public-select" name="format" aria-label="Filter by format" value={data.filters.format ?? ""}>
              <option value="">All formats</option>
              {data.formats.map((format) => <option value={format.id} key={format.id}>{format.name}</option>)}
            </select>
          </label>
          <label class="public-facet">
            <span>Location</span>
            <select class="public-select" name="room" aria-label="Filter by location" value={data.filters.room ?? ""}>
              <option value="">All locations</option>
              {data.rooms.map((room) => <option value={room.id} key={room.id}>{room.label}</option>)}
            </select>
          </label>
          <label class="public-facet">
            <span>Search</span>
            <input class="public-search" name="q" value={data.filters.q ?? ""} placeholder="Search title or speaker" aria-label="Search the agenda" />
          </label>
        </form>
        <section class="public-agenda-list" aria-live="polite" aria-label={mine ? "My starred sessions" : "Published agenda sessions"} data-schedule-list>
          {groups.length > 0 ? groups.map((group) => (
            <div class="public-agenda-day" data-public-agenda-day={group.date} key={group.date}>
              <h2 class="public-day-head">
                <span class="public-day">{group.label}</span>
                <small>{group.count} {group.count === 1 ? "session" : "sessions"}</small>
              </h2>
              {group.slots.map((slot) => (
                <div class="public-agenda-slot" key={`${group.date}-${slot.time}`}>
                  <h3 class="public-slot-head">{slot.time}</h3>
                  {slot.sessions.map((session) => <SessionCard session={session} key={session.id} />)}
                </div>
              ))}
            </div>
          )) : (
            <div class="public-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/agenda?${eventQuery}` : "/"}>{hasFilters ? "Show full agenda" : "Return to conference"}</a></div></div>
          )}
        </section>
      </main>
      {mine ? <ScheduleSheets /> : null}
    </PublicShell>
  );
}

/**
 * Where an attendee decides "yes, I'm going": the session's own page carries
 * the same star the cards do, the calendar it belongs in, and the way to walk
 * there. `origin` comes from the request so the links a local dev server hands
 * out point at that server rather than at production.
 */
export function PublicSessionPage({ event, venue, session, origin }: { event: PublicEvent; venue: PublicVenueDisclosure; session: PublicSession; origin: string }): JSX.Element {
  const venueName = venue.buildingName ?? event.venue ?? "Online";
  const links = sessionCalendarLinks(session, event, origin);
  const directions = sessionDirectionsUrl(session);
  const icsHref = `/api/v1/public/sessions/${encodeURIComponent(session.slug)}/calendar.ics?event=${encodeURIComponent(event.slug)}`;
  return (
    <PublicShell
      event={event}
      title="Session"
      schedule={{
        eventSlug: event.slug,
        eventName: event.name,
        timezone: event.timezone,
        days: [{ date: session.date, label: session.day }],
        view: "agenda",
      }}
    >
      <main class="public-main">
        {/*
          Back to where they came from, not to a page they never chose: the
          script rewrites this to "← My schedule" when the itinerary is where
          the session was opened from. Server-rendered as the agenda, which is
          the honest answer for a cold link.
        */}
        <a class="back-link" data-schedule-back href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>
        <article
          class="public-card"
          data-public-session-id={session.id}
          data-public-session-slug={session.slug}
          data-public-session-start={session.startsAt}
          data-public-session-end={session.startsAt + session.durationMin * 60_000}
          data-public-session-day={session.date}
          data-public-session-title={session.title}
          data-public-session-room={session.roomLabel}
          data-public-session-speakers={session.speakers.map((speaker) => speaker.name).join(", ")}
        >
          <div class="public-kicker">{venueName}</div>
          <div class="public-track-list" style={{ justifyContent: "flex-start" }}><FormatChip session={session} /><TrackChips session={session} /></div>
          <h1>{session.title}</h1>
          <p class="public-detail-meta">{session.day} · {session.time}–{session.endTime} · {session.roomLabel} · {session.durationMin} minutes</p>
          <p class="public-detail-meta">Format: {session.format?.name ?? "—"} · Track: {session.tracks.map((track) => track.name).join(", ") || "—"}</p>
          <div class="detail-actions">
            <StarButton session={session} />
            <a class="public-button" href={icsHref}>Add to calendar (.ics)</a>
            <a class="public-button" href={links.google} target="_blank" rel="noopener">Google</a>
            <a class="public-button" href={links.outlook} target="_blank" rel="noopener">Outlook</a>
          </div>
          <div class="public-divider" />
          <h2>About this session</h2>
          <p>{session.abstract || "—"}</p>
          <div class="public-divider" />
          <h2>Speakers</h2>
          <div class="public-speaker-list">
            {session.speakers.length > 0 ? session.speakers.map((speaker) => (
              <a class="public-speaker-link" href={speakerHref(speaker.slug)} key={speaker.id}>
                <span><strong>{speaker.name}</strong><small>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</small></span><span aria-hidden="true">→</span>
              </a>
            )) : <span>—</span>}
          </div>
          <div class="public-divider" />
          <h2>Getting there</h2>
          <p class="public-getting-there">
            {directions
              ? <a href={directions} target="_blank" rel="noopener">{session.building} — Directions ↗</a>
              : <span>{session.building ?? venueName}</span>}
            {session.buildingAddress ? <><br />{session.buildingAddress}</> : null}
          </p>
        </article>
      </main>
    </PublicShell>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function PublicSpeakerAvatar({
  speaker,
  className,
}: {
  speaker: PublicSpeakerSummary;
  className?: string;
}): JSX.Element {
  const classes = ["public-avatar", className].filter(Boolean).join(" ");
  return speaker.headshotUrl
    ? <img class={classes} src={speaker.headshotUrl} alt={`${speaker.name} synthetic avatar`} width="48" height="48" loading="lazy" />
    : <span class={classes} role="img" aria-label={`${speaker.name} initials avatar`}>{initials(speaker.name)}</span>;
}

/**
 * The agent guide is a PAGE, not a sheet.
 *
 * Everything on it is written for a reader that cannot open a modal, cannot
 * run a script, and arrives by fetching a URL. A dialog would have hidden the
 * one document whose entire audience is machines — so it is a plain server-
 * rendered page an agent can GET, a human can bookmark, and both can link to.
 */
export function PublicAgentsPage({ event, origin }: { event: PublicEvent; origin: string }): JSX.Element {
  const base = origin.replace(/\/+$/, "");
  const agendaFeed = `${base}/api/v1/public/agenda?event=${encodeURIComponent(event.slug)}`;
  return (
    <PublicShell event={event} title="For agents" schedule={countOnlySchedule(event)}>
      <main class="public-main">
        <a class="back-link" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>
        <div class="public-kicker">{event.name}</div>
        <div class="public-heading">
          <div>
            <h1>For agents</h1>
            <p>Everything on this site is anonymous, typed JSON. An agent can build its human's conference schedule end to end without a browser and without an account.</p>
          </div>
        </div>
        <article class="public-card">
          <h2>The loop</h2>
          <pre class="agents-pre">{`GET  /api/v1/public/agenda?event=${event.slug}
     → the full published program: sessions, times, rooms,
       buildings, tracks, formats, speakers

POST /api/v1/public/schedules
     { "eventSlug": "${event.slug}",
       "sessionIds": ["ses_…", "ses_…"] }
     → { "code": "MQ-…", "writeKey": "…",
         "urls": { "share": …, "sync": …, "webcal": …, "ics": …, "json": … },
         "sessions": [ … ], "overlaps": [ … ] }

GET  /api/v1/public/schedules/{code}
     → the set with full session objects and computed overlap pairs

PUT  /api/v1/public/schedules/{code}
     (X-Schedule-Write-Key header) → replace the set

GET  /api/v1/public/schedules/{code}/calendar.ics
     → the live calendar feed; webcal:// is the same URL

GET  /api/v1/public/sessions/{slug}/calendar.ics
     → one session as a calendar file`}</pre>
          <div class="public-divider" />
          <h2>What to hand a human</h2>
          <p>
            The POST response is self-describing on purpose: every URL that matters comes back fully formed, so nothing has to be assembled by hand. Give them the <strong>share</strong> link to look at, the <strong>webcal</strong> link to subscribe to, and keep the <strong>sync</strong> link private — it carries the write key in its fragment, which is the only thing that can change the schedule.
          </p>
          <div class="public-divider" />
          <h2>Rules worth knowing</h2>
          <p>
            Session ids and slugs are both accepted, so it does not matter whether you read the API or the page. Only published sessions of the named event resolve; anything else is a 422 that names it. A set is capped at 200 sessions. Overlaps are computed server-side and returned as id pairs — touching sessions are not overlapping. Losing the write key makes a code permanently read-only; it is stored only as a hash.
          </p>
          <div class="public-divider" />
          <h2>Driving the UI instead</h2>
          <p>
            Every session card on the agenda carries stable hooks, and so does the session page: <code class="num">data-public-session-id</code>, <code class="num">-slug</code>, <code class="num">-start</code>, <code class="num">-end</code> (epoch milliseconds), <code class="num">-day</code>, <code class="num">-title</code>, <code class="num">-room</code>, <code class="num">-speakers</code>. The star control is <code class="num">[data-schedule-star="&lt;session id&gt;"]</code> with <code class="num">aria-pressed</code> carrying its state, and the itinerary lives at <code class="num">/agenda?view=mine</code>. A computer-use agent finds the same handles the site's own script binds to.
          </p>
          <div class="public-divider" />
          <p class="public-detail-meta">
            <a href={agendaFeed} style={{ color: "var(--public-accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}>Read this event's program as JSON ↗</a>
          </p>
        </article>
      </main>
    </PublicShell>
  );
}

export function PublicSpeakerDirectoryPage({ data }: { data: PublicSpeakerDirectoryData }): JSX.Element {
  const eventQuery = `event=${encodeURIComponent(data.event.slug)}`;
  const hasSearch = Boolean(data.filters.q);
  const venueName = data.venue?.buildingName ?? data.event.venue ?? "Online";
  return (
    <PublicShell
      event={data.event}
      title="Speakers"
      schedule={countOnlySchedule(data.event)}
      actions={<a class="public-button" href={`/agenda?${eventQuery}`}>← Agenda</a>}
    >
      <main class="public-main">
        <div class="public-kicker">{data.event.startsOn} → {data.event.endsOn} · {venueName}</div>
        <div class="public-heading">
          <div>
            <h1>Speakers</h1>
            <p>Meet the people shaping this conference. Open a profile to see their published sessions.</p>
          </div>
        </div>
        {/*
          Nothing on this page ever ran this search but the browser's implicit
          form submission on Enter — the page's one script is the attendee
          schedule's and never touches the directory — invisible unless
          you already knew to press it. A visitor typed a surname, watched the
          grid not move, and reasonably concluded the box was decorative. The
          agenda's own search does narrow as you type, which makes the silence
          here read as broken rather than as "press Enter". Give the form the
          control it always needed; the filtering behind it works.
        */}
        <form class="public-filters public-directory-filters" method="get" action="/speakers">
          <input type="hidden" name="event" value={data.event.slug} />
          <label>
            <span class="sr-only">Search speakers</span>
            <input class="public-search" name="q" value={data.filters.q ?? ""} placeholder="Search speakers or companies" aria-label="Search speakers or companies" />
          </label>
          <div class="public-directory-actions">
            <button class="public-button primary" type="submit">Search</button>
            {data.filters.q ? <a class="public-button" href={`/speakers?event=${encodeURIComponent(data.event.slug)}`}>Clear</a> : null}
          </div>
        </form>
        {data.speakers.length > 0 ? (
          <section class="public-speaker-grid" aria-label="Published speakers">
            {data.speakers.map((speaker) => (
              <a class="public-directory-card" href={`${speakerHref(speaker.slug)}?${eventQuery}`} key={speaker.id}>
                <PublicSpeakerAvatar speaker={speaker} />
                <div>
                  <h2>{speaker.name}</h2>
                  <p>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</p>
                  <small>View profile →</small>
                </div>
              </a>
            ))}
          </section>
        ) : (
          <div class="public-empty"><div><strong>{hasSearch ? "No published speakers match" : "No published speakers yet"}</strong><span>{hasSearch ? "Try a different name or company." : "The conference team has not published any speakers yet."}</span>{hasSearch ? <a class="public-button primary" href={`/speakers?${eventQuery}`}>Show all speakers</a> : <a class="public-button primary" href={`/agenda?${eventQuery}`}>View the agenda</a>}</div></div>
        )}
      </main>
    </PublicShell>
  );
}

export function PublicSpeakerPage({ event, venue, speaker }: { event: PublicEvent; venue: PublicVenueDisclosure; speaker: PublicSpeaker }): JSX.Element {
  const venueName = venue.buildingName ?? event.venue ?? "Online";
  return (
    <PublicShell event={event} title="Speaker" schedule={countOnlySchedule(event)} actions={<a class="public-button" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>}>
      <main class="public-main">
        <article class="public-card">
          <div class="public-kicker">{venueName}</div>
          <div class="public-profile">
            <PublicSpeakerAvatar speaker={speaker} />
            <div>
              <div class="public-kicker">Speaker</div>
              <h1>{speaker.name}</h1>
              <p class="public-detail-meta">{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</p>
            </div>
          </div>
          <p>{speaker.bio || "—"}</p>
          <div class="public-divider" />
          <h2>Sessions</h2>
          <div class="public-speaker-list">
            {speaker.sessions.length > 0 ? speaker.sessions.map((session) => (
              <a class="public-session-link" href={sessionHref(session.slug)} key={session.id}>
                <span><strong>{session.title}</strong><small>{session.day} · {session.time} · {session.roomLabel}</small></span><span aria-hidden="true">→</span>
              </a>
            )) : <span>—</span>}
          </div>
        </article>
      </main>
    </PublicShell>
  );
}

export function PublicNotFoundPage(): JSX.Element {
  return (
    <div class="public-site public-not-found">
      <main class="public-card">
        <div>
          <strong>404</strong>
          <h1>That public page is unavailable.</h1>
          <p>The program only exposes published sessions and their speakers.</p>
          <a class="public-button primary" href="/agenda">View the agenda</a>
        </div>
      </main>
    </div>
  );
}

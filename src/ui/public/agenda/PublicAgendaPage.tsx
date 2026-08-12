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
.public-agenda-row { display: grid; grid-template-columns: 118px minmax(0, 1fr) minmax(145px, .55fr); align-items: start; gap: 15px; min-height: 104px; padding: 16px; border-bottom: 1px solid var(--public-rule-soft); }
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
.public-directory-filters { grid-template-columns: minmax(0, 1fr); }
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
@media (max-width: 760px) {
  .public-heading { display: block; }
  .public-filters { min-height: 150px; grid-template-columns: 1fr 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: 1 / -1; width: 100%; }
  .public-days button { flex: 1 1 0; width: auto; min-width: 0; padding: 0 2px; font-size: 9px; }
  .public-agenda-row { grid-template-columns: 86px minmax(0, 1fr); gap: 10px; }
  .public-card-meta { grid-column: 2; }
  .public-meta-row { justify-items: flex-start; }
  .public-track-list { justify-content: flex-start; }
}
@media (max-width: 460px) {
  .public-top { align-items: flex-start; padding-top: 12px; padding-bottom: 12px; }
  .public-top-actions { gap: 4px; }
  .public-top-actions .public-button { min-height: 30px; padding: 5px 7px; font-size: 10px; }
  .public-filters { min-height: 236px; grid-template-columns: 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: auto; }
  .public-agenda-row { grid-template-columns: 1fr; min-height: 132px; padding: 14px; }
  .public-card-meta { grid-column: auto; }
  .public-session-title { font-size: 16px; }
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

export function PublicShell({
  event,
  title,
  actions,
  children,
}: {
  event: PublicEvent;
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div class="public-site" data-public-page={title.toLowerCase().replaceAll(" ", "-")}>
      <header class="public-top">
        <a class="public-brand" href="/" aria-label={`${event.name} — Marquee home`}>
          <span class="public-mark">M</span><span>{event.name}</span>
        </a>
        <div class="public-top-actions">
          {actions}
          <a class="public-button" href="/">Organizer demo</a>
        </div>
      </header>
      {children}
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
 * slug, start and day join it so a later client module (a star control, a
 * personal schedule) binds to stable hooks instead of editing this markup.
 */
function SessionCard({ session }: { session: PublicSession }): JSX.Element {
  return (
    <article
      class="public-agenda-row"
      data-public-session-id={session.id}
      data-public-session-slug={session.slug}
      data-public-session-start={session.startsAt}
      data-public-session-day={session.date}
    >
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

export function PublicAgendaPage({ data }: { data: PublicAgendaData }): JSX.Element {
  const eventQuery = `event=${encodeURIComponent(data.event.slug)}`;
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
      actions={<>
        <a class="public-button" href={`/speakers?${eventQuery}`}>Speakers</a>
        <a class="public-button" href={`/api/v1/public/agenda?${feedQuery.toString()}`}>Agenda data ↗</a>
        <a class={`public-button ${data.sessions.length > 0 ? "primary" : ""}`.trim()} href={`/embed/config?${eventQuery}`}>Get embed code</a>
      </>}
    >
      <main class="public-main">
        <div class="public-kicker">{data.event.startsOn} → {data.event.endsOn} · {venueName}</div>
        <div class="public-heading">
          <div>
            <h1>Agenda</h1>
            <p>{data.event.tagline ?? "Practical sessions for people building and operating AI."}</p>
          </div>
        </div>
        <form class="public-filters" method="get" action="/agenda" data-public-agenda-filters>
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
        <section class="public-agenda-list" aria-live="polite" aria-label="Published agenda sessions">
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
    <PublicShell event={event} title="Session" actions={<a class="public-button" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>}>
      <main class="public-main">
        <article
          class="public-card"
          data-public-session-id={session.id}
          data-public-session-slug={session.slug}
          data-public-session-start={session.startsAt}
          data-public-session-end={session.startsAt + session.durationMin * 60_000}
          data-public-session-day={session.date}
          data-public-session-title={session.title}
        >
          <div class="public-kicker">{venueName}</div>
          <div class="public-track-list" style={{ justifyContent: "flex-start" }}><FormatChip session={session} /><TrackChips session={session} /></div>
          <h1>{session.title}</h1>
          <p class="public-detail-meta">{session.day} · {session.time}–{session.endTime} · {session.roomLabel} · {session.durationMin} minutes</p>
          <p class="public-detail-meta">Format: {session.format?.name ?? "—"} · Track: {session.tracks.map((track) => track.name).join(", ") || "—"}</p>
          <div class="detail-actions">
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

export function PublicSpeakerDirectoryPage({ data }: { data: PublicSpeakerDirectoryData }): JSX.Element {
  const eventQuery = `event=${encodeURIComponent(data.event.slug)}`;
  const hasSearch = Boolean(data.filters.q);
  const venueName = data.venue?.buildingName ?? data.event.venue ?? "Online";
  return (
    <PublicShell
      event={data.event}
      title="Speakers"
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
        <form class="public-filters public-directory-filters" method="get" action="/speakers">
          <input type="hidden" name="event" value={data.event.slug} />
          <label>
            <span class="sr-only">Search speakers</span>
            <input class="public-search" name="q" value={data.filters.q ?? ""} placeholder="Search speakers or companies" aria-label="Search speakers or companies" />
          </label>
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
    <PublicShell event={event} title="Speaker" actions={<a class="public-button" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>}>
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

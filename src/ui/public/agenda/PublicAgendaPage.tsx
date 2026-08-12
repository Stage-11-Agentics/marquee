/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";

import type {
  PublicAgendaData,
  PublicEvent,
  PublicSession,
  PublicSpeaker,
  PublicSpeakerDirectoryData,
  PublicSpeakerSummary,
  PublicVenueDisclosure,
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
.public-filters { min-height: 58px; display: grid; grid-template-columns: auto minmax(150px, 190px) minmax(190px, 1fr); align-items: center; gap: 9px; margin-bottom: 14px; padding: 9px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.public-days { min-height: 38px; display: inline-flex; align-items: stretch; gap: 4px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.public-days::-webkit-scrollbar { display: none; }
.public-days button { flex: 0 0 96px; width: 96px; min-height: 36px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-sunk); color: var(--public-muted); font: 650 10px/1 var(--public-mono); white-space: nowrap; }
.public-days button.active { border-color: var(--public-accent); background: var(--public-accent-wash); color: var(--public-accent); }
.public-select, .public-search { width: 100%; min-width: 0; height: 36px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 0 9px; font-size: 12px; }
.public-search::placeholder { color: var(--public-muted); }
.public-agenda-list { min-height: 430px; border: 1px solid var(--public-rule); background: var(--public-surface); }
.public-agenda-row { display: grid; grid-template-columns: 118px minmax(0, 1fr) minmax(145px, .55fr); align-items: start; gap: 15px; min-height: 104px; padding: 16px; border-bottom: 1px solid var(--public-rule-soft); }
.public-agenda-row:last-child { border-bottom: 0; }
.public-time { color: var(--public-muted); font: 650 11px/1.35 var(--public-mono); }
.public-day { display: block; margin-bottom: 3px; color: var(--public-accent); font-size: 10px; }
.public-time strong { display: block; margin-bottom: 3px; color: var(--public-ink); font-size: 15px; }
.public-time span { display: block; line-height: 1.35; }
.public-session-title { margin: 0; font: 650 17px/1.2 Georgia, serif; letter-spacing: -.01em; }
.public-session-title a:hover, .public-session-title a:focus-visible { color: var(--public-accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.public-speakers { min-height: 20px; margin: 8px 0 0; color: var(--public-muted); font-size: 12px; }
.public-speakers a { text-decoration: underline; text-decoration-color: var(--public-rule); text-underline-offset: 3px; }
.public-speakers a:hover, .public-speakers a:focus-visible { color: var(--public-accent); }
.public-track-list { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: flex-start; gap: 5px; }
.public-track-chip { display: inline-flex; min-height: 23px; align-items: center; border: 1px solid var(--public-rule); border-left: 3px solid var(--track-color, var(--public-accent)); border-radius: 2px; padding: 3px 6px; color: var(--public-muted); font: 600 9px/1.2 var(--public-mono); }
.public-empty { min-height: 428px; display: grid; place-items: center; padding: 36px; color: var(--public-muted); text-align: center; }
.public-empty strong { display: block; margin-bottom: 5px; color: var(--public-ink); font: 650 18px/1.2 Georgia, serif; }
.public-empty span { display: block; }
.public-empty .public-button { margin-top: 16px; }
.public-card { border: 1px solid var(--public-rule); background: var(--public-surface); padding: clamp(20px, 4vw, 36px); }
.public-card h1 { margin: 13px 0 8px; font: 550 clamp(30px, 5vw, 46px)/1.03 Georgia, serif; letter-spacing: -.035em; }
.public-card h2 { margin: 0 0 9px; font: 650 15px/1.2 var(--public-mono); letter-spacing: .05em; text-transform: uppercase; }
.public-card p { color: var(--public-soft); line-height: 1.65; }
.public-detail-meta { margin: 0; color: var(--public-muted) !important; font: 600 11px/1.45 var(--public-mono); }
.public-divider { height: 1px; margin: 25px 0; background: var(--public-rule-soft); }
.public-speaker-list { display: grid; gap: 8px; }
.public-speaker-link, .public-session-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--public-rule-soft); padding: 11px 12px; }
.public-speaker-link:hover, .public-speaker-link:focus-visible, .public-session-link:hover, .public-session-link:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.public-speaker-link strong, .public-session-link strong { display: block; font-size: 13px; }
.public-speaker-link small, .public-session-link small { display: block; margin-top: 3px; color: var(--public-muted); }
.public-profile { display: flex; align-items: flex-start; gap: 14px; }
.public-avatar { width: 48px; height: 48px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--public-rule); background: var(--public-accent-wash); color: var(--public-accent); font: 700 12px/1 var(--public-mono); }
.public-speaker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.public-directory-filters { grid-template-columns: minmax(0, 1fr); }
.public-directory-card { display: flex; align-items: flex-start; gap: 13px; min-height: 132px; border: 1px solid var(--public-rule); background: var(--public-surface); padding: 16px; }
.public-directory-card:hover, .public-directory-card:focus-visible { border-color: var(--public-accent); background: var(--public-accent-wash); outline: none; }
.public-directory-card .public-avatar { width: 56px; height: 56px; font-size: 13px; object-fit: cover; }
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
  .public-filters { grid-template-columns: 1fr 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: 1 / -1; width: 100%; }
  .public-days button { flex: 1 1 0; width: auto; min-width: 0; padding: 0 2px; font-size: 9px; }
  .public-agenda-row { grid-template-columns: 86px minmax(0, 1fr); gap: 10px; }
  .public-track-list { grid-column: 2; justify-content: flex-start; }
}
@media (max-width: 460px) {
  .public-top { align-items: flex-start; padding-top: 12px; padding-bottom: 12px; }
  .public-top-actions { gap: 4px; }
  .public-top-actions .public-button { min-height: 30px; padding: 5px 7px; font-size: 10px; }
  .public-filters { grid-template-columns: 1fr; }
  .public-directory-filters { grid-template-columns: minmax(0, 1fr); }
  .public-days { grid-column: auto; }
  .public-agenda-row { grid-template-columns: 1fr; min-height: 132px; padding: 14px; }
  .public-track-list { grid-column: auto; }
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

export function PublicAgendaPage({ data }: { data: PublicAgendaData }): JSX.Element {
  const eventQuery = `event=${encodeURIComponent(data.event.slug)}`;
  const hasFilters = Boolean(data.filters.track || data.filters.q || (data.filters.day && data.filters.day !== "all"));
  const venueName = data.venue?.buildingName ?? data.event.venue ?? "Online";
  return (
    <PublicShell
      event={data.event}
      title="Agenda"
      actions={<a class={`public-button ${data.sessions.length > 0 ? "primary" : ""}`.trim()} href={`/embed/config?${eventQuery}`}>Get embed code</a>}
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
          <label>
            <span class="sr-only">Track</span>
            <select class="public-select" name="track" aria-label="Filter by track" value={data.filters.track ?? ""}>
              <option value="">All tracks</option>
              {data.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
            </select>
          </label>
          <label>
            <span class="sr-only">Search</span>
            <input class="public-search" name="q" value={data.filters.q ?? ""} placeholder="Search title or speaker" aria-label="Search the agenda" />
          </label>
        </form>
        <section class="public-agenda-list" aria-live="polite" aria-label="Published agenda sessions">
          {data.sessions.length > 0 ? data.sessions.map((session) => (
            <article class="public-agenda-row" data-public-session-id={session.id} key={session.id}>
              <time class="public-time" dateTime={`${session.date}T${session.time}`}>{data.filters.day === "all" ? <span class="public-day">{session.day}</span> : null}<strong>{session.time}</strong><span>{session.roomLabel}</span></time>
              <div>
                <h2 class="public-session-title"><a href={sessionHref(session.slug)}>{session.title}</a></h2>
                <p class="public-speakers">
                  {session.speakers.length > 0 ? session.speakers.map((speaker, index) => <span key={speaker.id}>{index > 0 ? " · " : ""}<a href={speakerHref(speaker.slug)}>{speaker.name}</a></span>) : "—"}
                </p>
              </div>
              <TrackChips session={session} />
            </article>
          )) : (
            <div class="public-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/agenda?${eventQuery}` : "/"}>{hasFilters ? "Show full agenda" : "Return to conference"}</a></div></div>
          )}
        </section>
      </main>
    </PublicShell>
  );
}

export function PublicSessionPage({ event, venue, session }: { event: PublicEvent; venue: PublicVenueDisclosure; session: PublicSession }): JSX.Element {
  const venueName = venue.buildingName ?? event.venue ?? "Online";
  return (
    <PublicShell event={event} title="Session" actions={<a class="public-button" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>}>
      <main class="public-main">
        <article class="public-card">
          <div class="public-kicker">{venueName}</div>
          <div class="public-track-list" style={{ justifyContent: "flex-start" }}><TrackChips session={session} /></div>
          <h1>{session.title}</h1>
          <p class="public-detail-meta">{session.day} · {session.time} · {session.roomLabel} · {session.durationMin} minutes</p>
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
        </article>
      </main>
    </PublicShell>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function directoryAvatar(speaker: PublicSpeakerSummary): JSX.Element {
  const withHeadshot = speaker as PublicSpeakerSummary & { headshotUrl?: string | null };
  return withHeadshot.headshotUrl
    ? <img class="public-avatar" src={withHeadshot.headshotUrl} alt={`${speaker.name} avatar`} />
    : <div class="public-avatar" aria-hidden="true">{initials(speaker.name)}</div>;
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
                {directoryAvatar(speaker)}
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
            <div class="public-avatar" aria-hidden="true">{initials(speaker.name)}</div>
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

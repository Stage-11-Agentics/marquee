/** @jsxImportSource preact */
import type { JSX } from "preact";

import { EMBED_KINDS, type EmbedKind, type EmbedLayout } from "../../db/schema";
import type {
  PublicEmbedData,
  PublicEvent,
  PublicTrack,
} from "../../lib/public-site";
import { PublicShell, PUBLIC_SITE_STYLES, PublicSpeakerAvatar } from "../public/agenda/PublicAgendaPage";

const EMBED_KIND_LABEL: Record<EmbedKind, string> = {
  agenda: "Agenda",
  sessions: "Sessions",
  speakers: "Speakers",
  cfp: "Call for speakers",
};

export const EMBED_STYLES = `
.embed-site { --embed-accent: var(--public-accent); width: 100%; min-height: 100vh; overflow-x: hidden; background: var(--public-bg); color: var(--public-ink); font-family: var(--public-sans); }
.embed-site * { box-sizing: border-box; }
.embed-site a { color: inherit; text-decoration: none; }
.embed-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; border-bottom: 2px solid var(--embed-accent); background: var(--public-surface); }
.embed-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 650 14px/1.2 Georgia, serif; }
.embed-header span { flex: 0 0 auto; color: var(--public-muted); font: 600 9px/1 var(--public-mono); text-transform: uppercase; letter-spacing: .08em; }
.embed-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 7px; padding: 10px 16px; background: var(--public-sunk); border-bottom: 1px solid var(--public-rule-soft); }
.embed-control { width: 100%; min-width: 0; height: 31px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 0 7px; font-size: 11px; }
.embed-list { display: grid; gap: 0; background: var(--public-surface); }
.embed-session { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 11px; padding: 13px 16px; border-bottom: 1px solid var(--public-rule-soft); }
.embed-session:last-child { border-bottom: 0; }
.embed-session time { color: var(--public-muted); font: 650 10px/1.35 var(--public-mono); }
.embed-session time strong { display: block; margin-bottom: 3px; color: var(--public-ink); font-size: 13px; }
.embed-session h2 { margin: 0; color: var(--embed-accent); font: 650 14px/1.25 Georgia, serif; }
.embed-session p { margin: 4px 0 0; color: var(--public-muted); font-size: 10px; }
.embed-tracks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.embed-track { border-left: 3px solid var(--track-color, var(--embed-accent)); border-top: 1px solid var(--public-rule); border-right: 1px solid var(--public-rule); border-bottom: 1px solid var(--public-rule); padding: 3px 5px; color: var(--public-muted); font: 600 8px/1.2 var(--public-mono); }
.embed-speaker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px; padding: 12px 16px 16px; }
.embed-speaker { min-width: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; border: 1px solid var(--public-rule); border-top: 2px solid var(--embed-accent); padding: 12px; background: var(--public-surface); }
.embed-speaker-avatar { --avatar-size: 44px; }
.embed-speaker-copy { min-width: 0; }
.embed-speaker h2 { margin: 0; overflow-wrap: anywhere; font: 650 16px/1.15 Georgia, serif; }
.embed-speaker p { margin: 4px 0 0; color: var(--public-muted); font-size: 10px; }
.embed-speaker small { display: block; margin-top: 12px; color: var(--public-soft); font: 600 9px/1.35 var(--public-mono); }
.embed-speaker-list { display: grid; gap: 0; padding: 4px 16px 16px; }
.embed-speaker-row { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--public-rule-soft); font-size: 12px; }
.embed-speaker-row .embed-speaker-avatar { --avatar-size: 36px; }
.embed-speaker-row-copy { min-width: 0; }
.embed-speaker-row:last-child { border-bottom: 0; }
.embed-speaker-row strong { font: 650 13px/1.2 Georgia, serif; }
.embed-speaker-row-copy span { color: var(--public-muted); font-size: 10px; }
.embed-flat-list { display: grid; gap: 0; background: var(--public-surface); }
.embed-flat-row { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; padding: 11px 16px; border-bottom: 1px solid var(--public-rule-soft); }
.embed-flat-row:last-child { border-bottom: 0; }
.embed-flat-row h2 { margin: 0; flex: 1 1 auto; min-width: 0; color: var(--public-ink); font: 650 13px/1.3 Georgia, serif; }
.embed-flat-row time { flex: 0 0 auto; color: var(--public-muted); font: 650 10px/1 var(--public-mono); }
.embed-cfp { padding: 18px 16px 22px; }
.embed-cfp strong { display: block; margin-bottom: 6px; color: var(--embed-accent); font: 650 17px/1.25 Georgia, serif; }
.embed-cfp p { margin: 0 0 10px; color: var(--public-muted); font-size: 12px; }
.embed-cfp .embed-track { margin-right: 4px; }
.embed-empty { min-height: 170px; display: grid; place-items: center; padding: 25px 16px; color: var(--public-muted); text-align: center; }
.embed-empty strong { display: block; margin-bottom: 5px; color: var(--public-ink); font: 650 16px/1.2 Georgia, serif; }
.embed-empty span { display: block; }
.embed-empty .public-button { margin-top: 14px; }
.embed-config { width: min(1060px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 70px; }
.embed-config-grid { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.2fr); gap: 16px; align-items: start; }
.embed-config-panel { border: 1px solid var(--public-rule); background: var(--public-surface); padding: 18px; }
.embed-config-panel h1 { margin: 0 0 7px; font: 550 31px/1.05 Georgia, serif; letter-spacing: -.03em; }
.embed-config-panel h2 { margin: 0 0 14px; font: 650 12px/1 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; }
.embed-config-panel > p { margin: 0 0 20px; color: var(--public-muted); line-height: 1.6; }
.embed-field { display: grid; gap: 5px; margin-top: 13px; }
.embed-field label { color: var(--public-muted); font: 650 10px/1 var(--public-mono); text-transform: uppercase; letter-spacing: .08em; }
.embed-field select, .embed-field input, .embed-field textarea { width: 100%; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 8px; font-size: 12px; }
.embed-field input[type=color] { height: 36px; padding: 3px; }
.embed-field textarea { min-height: 86px; resize: vertical; font: 10px/1.5 var(--public-mono); }
.embed-field-note { display: block; min-height: 28px; margin-top: 4px; color: var(--public-soft); font-size: 10px; line-height: 1.4; }
.embed-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 13px; }
.embed-format-segment, .embed-layout-segment { display: flex; border: 1px solid var(--public-rule); border-radius: 2px; overflow: hidden; }
.embed-format-segment button, .embed-layout-segment button { flex: 1 1 0; min-height: 34px; border: 0; border-right: 1px solid var(--public-rule); background: var(--public-surface); color: var(--public-muted); font: 650 10px/1 var(--public-mono); letter-spacing: .04em; padding: 0 4px; }
.embed-format-segment button:last-child, .embed-layout-segment button:last-child { border-right: 0; }
.embed-format-segment button.active, .embed-layout-segment button.active { background: var(--public-accent-wash); color: var(--public-accent); }
.embed-format-segment button:disabled, .embed-layout-segment button:disabled { color: var(--public-soft); cursor: not-allowed; opacity: .55; }
.embed-preview { min-height: 420px; border: 1px solid var(--public-rule); background: var(--public-sunk); padding: 14px; }
.embed-preview iframe { width: 100%; min-height: 380px; display: block; border: 1px solid var(--public-rule); background: white; }
.embed-copy { display: flex; justify-content: flex-end; margin-top: 7px; }
.embed-copy button { min-height: 32px; border: 1px solid var(--public-accent); border-radius: 2px; background: var(--public-accent); color: white; padding: 6px 10px; font-size: 11px; font-weight: 650; }
@media (max-width: 680px) { .embed-config-grid { grid-template-columns: 1fr; } .embed-preview { min-height: 360px; } .embed-field-row { grid-template-columns: 1fr; } }
@media (max-width: 375px) { .embed-session { grid-template-columns: 70px minmax(0, 1fr); padding: 11px; } .embed-flat-row { padding: 9px 11px; } .embed-header, .embed-controls, .embed-speaker-grid, .embed-speaker-list, .embed-cfp { padding-left: 11px; padding-right: 11px; } .embed-speaker-grid { grid-template-columns: 1fr; } }
`;

export const EMBED_CONFIG_SCRIPT = `
(() => {
  const form = document.querySelector('[data-embed-config]');
  const code = document.querySelector('[data-embed-code]');
  const preview = document.querySelector('[data-embed-preview]');
  const copy = document.querySelector('[data-copy-embed]');
  const kindButtons = Array.from(document.querySelectorAll('[data-embed-kind]'));
  const layoutButtons = Array.from(document.querySelectorAll('[data-embed-layout]'));
  const trackField = document.getElementById('embed-track');
  const statusField = document.getElementById('embed-status');
  const trackNote = document.querySelector('[data-track-note]');
  const statusNote = document.querySelector('[data-status-note]');
  const layoutNote = document.querySelector('[data-layout-note]');
  if (!form || !code || !preview) return;
  const KIND_LABEL = { agenda: 'Agenda', sessions: 'Sessions', speakers: 'Speakers', cfp: 'Call for speakers' };
  const state = {
    kind: kindButtons.find((b) => b.classList.contains('active'))?.dataset.embedKind || 'agenda',
    layout: layoutButtons.find((b) => b.classList.contains('active'))?.dataset.embedLayout || 'cards',
  };
  const paintControls = () => {
    kindButtons.forEach((b) => { const active = b.dataset.embedKind === state.kind; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    const notApplicable = state.kind === 'cfp';
    if (trackField) trackField.disabled = notApplicable;
    if (statusField) statusField.disabled = notApplicable;
    if (trackNote) trackNote.textContent = notApplicable ? 'Not applicable — the block promotes the whole call' : 'Limits the embed to one track';
    if (statusNote) statusNote.textContent = notApplicable ? 'Not applicable — the block promotes the whole call' : 'Limits the embed to one status';
    const layoutApplies = state.kind === 'speakers';
    layoutButtons.forEach((b) => { b.disabled = !layoutApplies; const active = layoutApplies && b.dataset.embedLayout === state.layout; b.classList.toggle('active', active); });
    if (layoutNote) layoutNote.textContent = layoutApplies ? 'Gallery cards or a compact list' : 'Applies to the Speakers format';
  };
  const update = () => {
    const values = new FormData(form);
    const event = String(values.get('event') || 'conference');
    const kind = state.kind;
    const slug = event + '-' + kind;
    const params = new URLSearchParams();
    const track = String(values.get('track') || '');
    const status = String(values.get('status') || '');
    const accent = String(values.get('accent') || '');
    if (track && kind !== 'cfp') params.set('track', track);
    if (status && kind !== 'cfp') params.set('status', status);
    if (kind === 'speakers' && state.layout === 'list') params.set('layout', 'list');
    if (accent) params.set('accent', accent);
    const src = '/embed/' + encodeURIComponent(slug) + (params.toString() ? '?' + params.toString() : '');
    const absolute = window.location.origin + src;
    code.value = '<iframe src="' + absolute + '" title="' + event + ' ' + KIND_LABEL[kind].toLowerCase() + '" loading="lazy" style="width:100%;border:0"></iframe>';
    preview.src = src;
  };
  kindButtons.forEach((b) => b.addEventListener('click', () => { state.kind = b.dataset.embedKind; paintControls(); update(); }));
  layoutButtons.forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; state.layout = b.dataset.embedLayout; paintControls(); update(); }));
  form.querySelectorAll('select, input').forEach((control) => control.addEventListener('input', update));
  copy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.value); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy embed code'; }, 1200); }
    catch (_) { code.focus(); code.select(); copy.textContent = 'Select and copy'; }
  });
  paintControls();
  update();
})();
`;

function trackChip(track: PublicTrack): JSX.Element {
  return <span class="embed-track" style={{ "--track-color": track.color }} key={track.id}>{track.name}</span>;
}

function formatDeadline(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(epochMs));
}

function speakerCards(speakers: PublicEmbedData["speakers"]): JSX.Element {
  return (
    <section class="embed-speaker-grid" aria-label="Published speakers">
      {speakers.map((speaker) => <article class="embed-speaker" key={speaker.id}>
        <PublicSpeakerAvatar speaker={speaker} className="embed-speaker-avatar" />
        <div class="embed-speaker-copy"><h2>{speaker.name}</h2><p>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</p><small>{speaker.sessions.length} {speaker.sessions.length === 1 ? "published session" : "published sessions"}</small></div>
      </article>)}
    </section>
  );
}

function speakerList(speakers: PublicEmbedData["speakers"]): JSX.Element {
  return (
    <ul class="embed-speaker-list" aria-label="Published speakers">
      {speakers.map((speaker) => <li class="embed-speaker-row" key={speaker.id}>
        <PublicSpeakerAvatar speaker={speaker} className="embed-speaker-avatar" />
        <div class="embed-speaker-row-copy"><strong>{speaker.name}</strong><span>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</span></div>
      </li>)}
    </ul>
  );
}

function sessionsFlatList(sessions: PublicEmbedData["sessions"]): JSX.Element {
  return (
    <section class="embed-flat-list" aria-label="Published sessions">
      {sessions.map((session) => (
        <article class="embed-flat-row" key={session.id}>
          <h2>{session.title}</h2>
          <div class="embed-tracks">{session.tracks.map(trackChip)}</div>
          <time>{session.day} · {session.time}</time>
        </article>
      ))}
    </section>
  );
}

function cfpBody(cfp: PublicEmbedData["cfp"]): JSX.Element {
  if (!cfp) {
    return <div class="embed-empty"><div><strong>Call for speakers has not opened yet</strong><span>Check back once the conference team publishes a form.</span></div></div>;
  }
  const isOpen = cfp.status === "open";
  return (
    <div class="embed-cfp">
      <strong>Call for speakers is {isOpen ? "open" : "closed"}{isOpen && cfp.closesAt ? ` · closes ${formatDeadline(cfp.closesAt)}` : ""}</strong>
      {cfp.formats.length > 0 ? <div class="embed-tracks">{cfp.formats.map((name) => <span class="embed-track" key={name}>{name}</span>)}</div> : null}
      {isOpen
        ? <p><a class="public-button primary" href={cfp.url}>Submit a proposal →</a></p>
        : <p>Submissions are closed. This block updates automatically — no republish — once the call reopens.</p>}
    </div>
  );
}

export function EmbedPage({ data }: { data: PublicEmbedData }): JSX.Element {
  const accent = data.config.accent ?? data.event.accent ?? "#0b6a72";
  const action = EMBED_KIND_LABEL[data.kind];
  const hasFilters = Boolean(data.filters.track || data.filters.status);
  const layout: EmbedLayout = data.filters.layout ?? "cards";
  const agendaHref = `/agenda?event=${encodeURIComponent(data.event.slug)}`;
  return (
    <div class="embed-site" data-embed-kind={data.kind} style={{ "--embed-accent": accent }}>
      <header class="embed-header"><strong>{data.event.name} · {action}{data.venue?.buildingName ? ` · ${data.venue.buildingName}` : ""}</strong><span>Published program</span></header>
      {data.kind !== "cfp" ? (
        <form class="embed-controls" method="get" action={`/embed/${encodeURIComponent(data.slug)}`}>
          <select class="embed-control" name="track" aria-label="Filter embed by track" value={data.filters.track ?? ""}>
            <option value="">All tracks</option>
            {data.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
          </select>
          <select class="embed-control" name="status" aria-label="Filter embed by status" value={data.filters.status ?? ""}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="accepted">Accepted</option>
            <option value="waitlisted">Waitlisted</option>
          </select>
        </form>
      ) : null}
      {data.kind === "cfp" ? cfpBody(data.cfp) : data.kind === "speakers" ? (
        data.speakers.length > 0 ? (layout === "list" ? speakerList(data.speakers) : speakerCards(data.speakers))
          : <div class="embed-empty"><div><strong>{hasFilters ? "No published speakers match" : "No published speakers yet"}</strong><span>{hasFilters ? "Clear a filter to bring the gallery back into view." : "The conference team has not published any speakers yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show all speakers" : "Open the conference agenda"}</a></div></div>
      ) : data.kind === "sessions" ? (
        data.sessions.length > 0 ? sessionsFlatList(data.sessions)
          : <div class="embed-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show full agenda" : "Open the conference agenda"}</a></div></div>
      ) : (
        data.sessions.length > 0 ? <section class="embed-list" aria-label="Published agenda">
          {data.sessions.map((session) => <article class="embed-session" key={session.id}><time><strong>{session.time}</strong>{session.day}<br />{session.roomLabel}</time><div><h2>{session.title}</h2><p>{session.speakers.map((speaker) => speaker.name).join(" · ") || "—"}</p><div class="embed-tracks">{session.tracks.map(trackChip)}</div></div></article>)}
        </section> : <div class="embed-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show full agenda" : "Open the conference agenda"}</a></div></div>
      )}
    </div>
  );
}

function embedSlug(event: PublicEvent, kind: EmbedKind): string {
  return `${event.slug}-${kind}`;
}

function snippet(event: PublicEvent, kind: EmbedKind, track: string, status: string, layout: EmbedLayout, accent: string): string {
  const query = new URLSearchParams();
  if (track && kind !== "cfp") query.set("track", track);
  if (status && kind !== "cfp") query.set("status", status);
  if (kind === "speakers" && layout === "list") query.set("layout", "list");
  if (accent) query.set("accent", accent);
  const source = `https://marquee.stage11.dev/embed/${embedSlug(event, kind)}${query.toString() ? `?${query.toString()}` : ""}`;
  return `<iframe src="${source}" title="${event.name} ${EMBED_KIND_LABEL[kind].toLowerCase()}" loading="lazy" style="width:100%;border:0"></iframe>`;
}

function previewSrc(event: PublicEvent, kind: EmbedKind, track: string, status: string, layout: EmbedLayout, accent: string): string {
  const slug = embedSlug(event, kind);
  const params: Record<string, string> = {};
  if (track && kind !== "cfp") params.track = track;
  if (status && kind !== "cfp") params.status = status;
  if (kind === "speakers" && layout === "list") params.layout = "list";
  if (accent) params.accent = accent;
  const query = new URLSearchParams(params).toString();
  return `/embed/${encodeURIComponent(slug)}${query ? `?${query}` : ""}`;
}

export function EmbedConfigPage({
  event,
  tracks,
  kind,
  track,
  status,
  layout,
  accent,
  preview,
}: {
  event: PublicEvent;
  tracks: PublicTrack[];
  kind: EmbedKind;
  track: string;
  status: string;
  layout: EmbedLayout;
  accent: string;
  preview: PublicEmbedData;
}): JSX.Element {
  const notApplicable = kind === "cfp";
  const layoutApplies = kind === "speakers";
  return (
    <PublicShell event={event} title="Embed configuration" actions={<a class="public-button" href={`/agenda?event=${encodeURIComponent(event.slug)}`}>← Agenda</a>}>
      <main class="embed-config">
        <div class="public-kicker">Public surfaces · no login required</div>
        <div class="embed-config-grid">
          <section class="embed-config-panel">
            <h1>Embed the program.</h1>
            <p>Choose a public surface, tune its filters and color, then take the live frame to your own site.</p>
            <form data-embed-config>
              <input type="hidden" name="event" value={event.slug} />
              <div class="embed-field">
                <label>Format</label>
                <div class="embed-format-segment" role="group" aria-label="Embed format">
                  {EMBED_KINDS.map((item) => (
                    <button type="button" data-embed-kind={item} class={item === kind ? "active" : ""} aria-pressed={item === kind} key={item}>{EMBED_KIND_LABEL[item]}</button>
                  ))}
                </div>
              </div>
              <div class="embed-field-row">
                <div class="embed-field">
                  <label for="embed-track">Track</label>
                  <select id="embed-track" name="track" value={track} disabled={notApplicable}>
                    <option value="">All tracks</option>
                    {tracks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select>
                  <span class="embed-field-note" data-track-note>{notApplicable ? "Not applicable — the block promotes the whole call" : "Limits the embed to one track"}</span>
                </div>
                <div class="embed-field">
                  <label for="embed-status">Status</label>
                  <select id="embed-status" name="status" value={status} disabled={notApplicable}>
                    <option value="">All published</option>
                    <option value="published">Published</option>
                    <option value="accepted">Accepted</option>
                    <option value="waitlisted">Waitlisted</option>
                  </select>
                  <span class="embed-field-note" data-status-note>{notApplicable ? "Not applicable — the block promotes the whole call" : "Limits the embed to one status"}</span>
                </div>
              </div>
              <div class="embed-field">
                <label>Layout</label>
                <div class="embed-layout-segment" role="group" aria-label="Speaker layout">
                  <button type="button" data-embed-layout="cards" disabled={!layoutApplies} class={layoutApplies && layout === "cards" ? "active" : ""}>Cards</button>
                  <button type="button" data-embed-layout="list" disabled={!layoutApplies} class={layoutApplies && layout === "list" ? "active" : ""}>List</button>
                </div>
                <span class="embed-field-note" data-layout-note>{layoutApplies ? "Gallery cards or a compact list" : "Applies to the Speakers format"}</span>
              </div>
              <div class="embed-field"><label for="embed-accent">Accent color</label><input id="embed-accent" name="accent" type="color" value={accent} /></div>
              <div class="embed-field"><label for="embed-code">Embed code</label><textarea data-embed-code id="embed-code" readOnly value={snippet(event, kind, track, status, layout, accent)} /></div>
              <div class="embed-copy"><button type="button" data-copy-embed>Copy embed code</button></div>
            </form>
          </section>
          <section class="embed-config-panel">
            <h2>Live preview</h2>
            <div class="embed-preview"><iframe data-embed-preview title={`${event.name} ${EMBED_KIND_LABEL[kind].toLowerCase()} live preview`} src={previewSrc(event, kind, track, status, layout, accent)} /></div>
            <p style={{ margin: "10px 0 0", fontSize: "11px" }}>Published changes are served anonymously and refreshed from a 30-second edge cache.</p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}

export { PUBLIC_SITE_STYLES };

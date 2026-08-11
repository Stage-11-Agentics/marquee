/** @jsxImportSource preact */
import type { JSX } from "preact";

import type {
  PublicEmbedData,
  PublicEvent,
  PublicTrack,
} from "../../lib/public-site";
import { PublicShell, PUBLIC_SITE_STYLES } from "../public/agenda/PublicAgendaPage";

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
.embed-speaker { min-width: 0; border: 1px solid var(--public-rule); border-top: 2px solid var(--embed-accent); padding: 12px; background: var(--public-surface); }
.embed-speaker h2 { margin: 0; overflow-wrap: anywhere; font: 650 16px/1.15 Georgia, serif; }
.embed-speaker p { margin: 4px 0 0; color: var(--public-muted); font-size: 10px; }
.embed-speaker small { display: block; margin-top: 12px; color: var(--public-soft); font: 600 9px/1.35 var(--public-mono); }
.embed-empty { min-height: 170px; display: grid; place-items: center; padding: 25px 16px; color: var(--public-muted); text-align: center; }
.embed-empty strong { display: block; margin-bottom: 5px; color: var(--public-ink); font: 650 16px/1.2 Georgia, serif; }
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
.embed-preview { min-height: 420px; border: 1px solid var(--public-rule); background: var(--public-sunk); padding: 14px; }
.embed-preview iframe { width: 100%; min-height: 380px; display: block; border: 1px solid var(--public-rule); background: white; }
.embed-copy { display: flex; justify-content: flex-end; margin-top: 7px; }
.embed-copy button { min-height: 32px; border: 1px solid var(--public-accent); border-radius: 2px; background: var(--public-accent); color: white; padding: 6px 10px; font-size: 11px; font-weight: 650; }
@media (max-width: 680px) { .embed-config-grid { grid-template-columns: 1fr; } .embed-preview { min-height: 360px; } }
@media (max-width: 375px) { .embed-session { grid-template-columns: 70px minmax(0, 1fr); padding: 11px; } .embed-header, .embed-controls, .embed-speaker-grid { padding-left: 11px; padding-right: 11px; } .embed-speaker-grid { grid-template-columns: 1fr; } }
`;

export const EMBED_CONFIG_SCRIPT = `
(() => {
  const form = document.querySelector('[data-embed-config]');
  const code = document.querySelector('[data-embed-code]');
  const preview = document.querySelector('[data-embed-preview]');
  const copy = document.querySelector('[data-copy-embed]');
  if (!form || !code || !preview) return;
  const update = () => {
    const values = new FormData(form);
    const kind = String(values.get('kind') || 'agenda');
    const event = String(values.get('event') || 'conference');
    const slug = event + '-' + (kind === 'speakers' ? 'speakers' : 'agenda');
    const params = new URLSearchParams();
    const track = String(values.get('track') || '');
    const status = String(values.get('status') || '');
    const accent = String(values.get('accent') || '');
    if (track) params.set('track', track);
    if (status) params.set('status', status);
    if (accent) params.set('accent', accent);
    const src = '/embed/' + encodeURIComponent(slug) + (params.toString() ? '?' + params.toString() : '');
    const absolute = window.location.origin + src;
    code.value = '<iframe src="' + absolute + '" title="' + event + ' ' + kind + '" loading="lazy" style="width:100%;border:0"></iframe>';
    preview.src = src;
  };
  form.querySelectorAll('select, input').forEach((control) => control.addEventListener('input', update));
  copy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.value); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy embed code'; }, 1200); }
    catch (_) { code.focus(); code.select(); copy.textContent = 'Select and copy'; }
  });
  update();
})();
`;

function trackChip(track: PublicTrack): JSX.Element {
  return <span class="embed-track" style={{ "--track-color": track.color }} key={track.id}>{track.name}</span>;
}

export function EmbedPage({ data }: { data: PublicEmbedData }): JSX.Element {
  const accent = data.config.accent ?? data.event.accent ?? "#0b6a72";
  const action = data.kind === "speakers" ? "Speaker gallery" : "Agenda";
  return (
    <div class="embed-site" data-embed-kind={data.kind} style={{ "--embed-accent": accent }}>
      <header class="embed-header"><strong>{data.event.name} · {action}</strong><span>Published program</span></header>
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
      {data.kind === "speakers" ? (
        data.speakers.length > 0 ? <section class="embed-speaker-grid" aria-label="Published speakers">
          {data.speakers.map((speaker) => <article class="embed-speaker" key={speaker.id}><h2>{speaker.name}</h2><p>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "Speaker"}</p><small>{speaker.sessions.length} {speaker.sessions.length === 1 ? "published session" : "published sessions"}</small></article>)}
        </section> : <div class="embed-empty"><div><strong>No published speakers match</strong><span>Clear a filter to bring the gallery back into view.</span></div></div>
      ) : (
        data.sessions.length > 0 ? <section class="embed-list" aria-label="Published agenda">
          {data.sessions.map((session) => <article class="embed-session" key={session.id}><time><strong>{session.time}</strong>{session.day}<br />{session.roomLabel}</time><div><h2>{session.title}</h2><p>{session.speakers.map((speaker) => speaker.name).join(" · ") || "—"}</p><div class="embed-tracks">{session.tracks.map(trackChip)}</div></div></article>)}
        </section> : <div class="embed-empty"><div><strong>No published sessions match</strong><span>Clear a filter to bring the program back into view.</span></div></div>
      )}
    </div>
  );
}

function embedSlug(event: PublicEvent, kind: "agenda" | "speakers"): string {
  return `${event.slug}-${kind}`;
}

function snippet(event: PublicEvent, kind: "agenda" | "speakers", track: string, status: string, accent: string): string {
  const query = new URLSearchParams();
  if (track) query.set("track", track);
  if (status) query.set("status", status);
  if (accent) query.set("accent", accent);
  const source = `https://marquee.example/embed/${embedSlug(event, kind)}${query.toString() ? `?${query.toString()}` : ""}`;
  return `<iframe src="${source}" title="${event.name} ${kind}" loading="lazy" style="width:100%;border:0"></iframe>`;
}

export function EmbedConfigPage({
  event,
  tracks,
  kind,
  track,
  status,
  accent,
  preview,
}: {
  event: PublicEvent;
  tracks: PublicTrack[];
  kind: "agenda" | "speakers";
  track: string;
  status: string;
  accent: string;
  preview: PublicEmbedData;
}): JSX.Element {
  const slug = embedSlug(event, kind);
  return (
    <PublicShell event={event} title="Embed configuration" actions={<a class="public-button" href="/agenda">← Agenda</a>}>
      <main class="embed-config">
        <div class="public-kicker">Public surfaces · no login required</div>
        <div class="embed-config-grid">
          <section class="embed-config-panel">
            <h1>Embed the program.</h1>
            <p>Choose a public surface, tune its filters and color, then take the live frame to your own site.</p>
            <form data-embed-config>
              <input type="hidden" name="event" value={event.slug} />
              <div class="embed-field"><label for="embed-kind">Surface</label><select id="embed-kind" name="kind" value={kind}><option value="agenda">Agenda itinerary</option><option value="speakers">Speaker gallery</option></select></div>
              <div class="embed-field"><label for="embed-track">Track</label><select id="embed-track" name="track" value={track}><option value="">All tracks</option>{tracks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
              <div class="embed-field"><label for="embed-status">Status</label><select id="embed-status" name="status" value={status}><option value="">All published</option><option value="published">Published</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option></select></div>
              <div class="embed-field"><label for="embed-accent">Accent color</label><input id="embed-accent" name="accent" type="color" value={accent} /></div>
              <div class="embed-field"><label for="embed-code">Embed code</label><textarea data-embed-code id="embed-code" readOnly value={snippet(event, kind, track, status, accent)} /></div>
              <div class="embed-copy"><button type="button" data-copy-embed>Copy embed code</button></div>
            </form>
          </section>
          <section class="embed-config-panel">
            <h2>Live preview</h2>
            <div class="embed-preview"><iframe data-embed-preview title={`${event.name} ${kind} live preview`} src={`/embed/${encodeURIComponent(slug)}${track || status || accent ? `?${new URLSearchParams({ ...(track ? { track } : {}), ...(status ? { status } : {}), ...(accent ? { accent } : {}) }).toString()}` : ""}`} /></div>
            <p style={{ margin: "10px 0 0", fontSize: "11px" }}>Published changes are served anonymously and refreshed from a 30-second edge cache.</p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}

export { PUBLIC_SITE_STYLES };

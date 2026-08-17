/** @jsxImportSource preact */
import type { JSX } from "preact";

import { EMBED_KINDS, EMBED_OUTPUT_FORMATS, type EmbedKind, type EmbedLayout, type EmbedOutputFormat } from "../../db/schema";
import { formatEventDateTime } from "../../lib/event-time";
import {
  embedFieldsForKind,
  type EmbedField,
  publicAbstractSnippet,
  type PublicEmbedData,
  type PublicEvent,
  type PublicSession,
  type PublicTrack,
} from "../../lib/public-site";
import { EMBED_SNIPPET_HEIGHT_PX, embedCalendarLink, embedIframeSnippet, embedSnippetNote, embedSnippetStyle } from "../../lib/embed-snippet";
import { PUBLIC_SPEAKER_EMPTY_LABEL } from "../../lib/participants";
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
.embed-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 10px 16px; background: var(--public-sunk); border-bottom: 1px solid var(--public-rule-soft); }
.embed-control { width: 100%; min-width: 0; height: 31px; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 0 7px; font-size: 11px; }
.embed-list { display: grid; gap: 0; background: var(--public-surface); }
.embed-session { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 11px; padding: 13px 16px; border-bottom: 1px solid var(--public-rule-soft); }
.embed-session:last-child { border-bottom: 0; }
.embed-session time { color: var(--public-muted); font: 650 10px/1.35 var(--public-mono); }
.embed-session time strong { display: block; margin-bottom: 3px; color: var(--public-ink); font-size: 13px; }
.embed-session h2 { margin: 0; color: var(--embed-accent); font: 650 14px/1.25 Georgia, serif; }
.embed-session p { margin: 4px 0 0; color: var(--public-muted); font-size: 10px; }
.embed-speaker-credits { min-height: 15px; }
.embed-abstract { min-height: 26px; margin: 6px 0 0; color: var(--public-soft); font-size: 10px; line-height: 1.5; }
.embed-more { margin-top: 4px; }
.embed-more > summary { display: inline-block; color: var(--embed-accent); font: 650 9px/1.2 var(--public-mono); cursor: pointer; list-style: none; }
.embed-more > summary::-webkit-details-marker { display: none; }
.embed-more > summary::after { content: " ▾"; }
.embed-more[open] > summary::after { content: " ▴"; }
.embed-more p { margin: 5px 0 0; color: var(--public-soft); font-size: 10px; line-height: 1.5; }
.embed-tracks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.embed-meta-label { color: var(--public-muted); font: 650 8px/1.2 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; align-self: center; }
.embed-format { border: 1px solid var(--embed-accent); background: var(--public-accent-wash); padding: 3px 5px; color: var(--embed-accent); font: 600 8px/1.2 var(--public-mono); }
.embed-track { border-left: 3px solid var(--track-color, var(--embed-accent)); border-top: 1px solid var(--public-rule); border-right: 1px solid var(--public-rule); border-bottom: 1px solid var(--public-rule); padding: 3px 5px; color: var(--public-muted); font: 600 8px/1.2 var(--public-mono); }
.embed-speaker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px; padding: 12px 16px 16px; }
.embed-speaker { min-width: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; border: 1px solid var(--public-rule); border-top: 2px solid var(--embed-accent); padding: 12px; background: var(--public-surface); }
.embed-speaker.no-avatar, .embed-speaker-row.no-avatar { grid-template-columns: minmax(0, 1fr); }
.embed-speaker:hover, .embed-speaker:focus-visible { border-color: var(--embed-accent); background: var(--public-accent-wash); outline: none; }
.embed-speaker-avatar { --avatar-size: 44px; }
.embed-speaker-copy { min-width: 0; }
.embed-speaker h2 { margin: 0; overflow-wrap: anywhere; font: 650 16px/1.15 Georgia, serif; }
.embed-speaker p { margin: 4px 0 0; color: var(--public-muted); font-size: 10px; }
.embed-speaker small { display: block; margin-top: 12px; color: var(--public-soft); font: 600 9px/1.35 var(--public-mono); }
.embed-speaker-list { display: grid; gap: 0; min-width: 0; padding: 4px 16px 16px; list-style: none; }
.embed-speaker-list > li { min-width: 0; }
.embed-speaker-row { display: grid; width: 100%; min-width: 0; grid-template-columns: 36px minmax(0, 1fr); align-items: start; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--public-rule-soft); font-size: 12px; }
.embed-speaker-row:hover, .embed-speaker-row:focus-visible { color: var(--embed-accent); outline: none; }
.embed-speaker-row .embed-speaker-avatar { --avatar-size: 36px; }
.embed-speaker-row-copy { display: block; width: 100%; min-width: 0; }
.embed-speaker-row:last-child { border-bottom: 0; }
.embed-speaker-row strong { display: block; overflow-wrap: anywhere; font: 650 13px/1.2 Georgia, serif; }
.embed-speaker-row-copy span { display: block; overflow-wrap: anywhere; color: var(--public-muted); font-size: 10px; }
.embed-speaker-row-copy p { display: block; max-width: 100%; margin: 4px 0 0; color: var(--public-soft); font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
.embed-speaker-social { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.embed-speaker-social a { color: var(--embed-accent); font: 600 9px/1.2 var(--public-mono); overflow-wrap: anywhere; }
.embed-flat-list { display: grid; gap: 0; background: var(--public-surface); }
.embed-session-location { margin: 4px 0 0; color: var(--public-muted); font: 600 10px/1.35 var(--public-mono); }
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
.embed-preview-note { color: var(--public-muted, inherit); font-size: 11px; margin: 0 0 8px; }
.embed-preview { min-height: 420px; border: 1px solid var(--public-rule); background: var(--public-sunk); padding: 14px; }
.embed-preview iframe { width: 100%; min-height: 380px; display: block; border: 1px solid var(--public-rule); background: white; }
.embed-copy { display: flex; justify-content: flex-end; margin-top: 7px; }
.embed-copy button { min-height: 32px; border: 1px solid var(--public-accent); border-radius: 2px; background: var(--public-accent); color: white; padding: 6px 10px; font-size: 11px; font-weight: 650; }
.embed-output-segment { display: flex; border: 1px solid var(--public-rule); border-radius: 2px; overflow: hidden; }
.embed-output-segment { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
.embed-output-segment button { min-width: 0; min-height: 34px; border: 0; border-right: 1px solid var(--public-rule); background: var(--public-surface); color: var(--public-muted); font: 650 9px/1 var(--public-mono); letter-spacing: .02em; padding: 0 3px; }
.embed-output-segment button:last-child { border-right: 0; }
.embed-output-segment button.active { background: var(--public-accent-wash); color: var(--public-accent); }
.embed-field-options { min-height: 164px; border: 1px solid var(--public-rule); background: var(--public-sunk); padding: 9px; }
.embed-field-options fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.embed-field-options legend { margin-bottom: 8px; color: var(--public-muted); font: 650 9px/1 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; }
/* Two columns only while two columns fit. A track narrower than its longest
   word is how "Session title" becomes a stack of single letters. */
.embed-field-option-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 7px 10px; }
/* These labels are prose the organizer reads, not the micro-labels the
   .embed-field label rule paints above a control — that rule is more specific
   than a bare class, so the reset has to be explicit here. */
.embed-field .embed-field-option { display: flex; align-items: flex-start; gap: 7px; min-width: 0; color: var(--public-ink); font: 400 11px/1.25 var(--public-sans); text-transform: none; letter-spacing: normal; }
.embed-field .embed-field-option > span { min-width: 0; overflow-wrap: break-word; }
/* The .embed-field input rule stretches text inputs to the panel; a checkbox
   given that width takes the whole grid track and leaves its label a single
   character of room. */
.embed-field .embed-field-option input[type=checkbox] { flex: 0 0 auto; width: auto; margin-top: 1px; padding: 0; accent-color: var(--public-accent); }
.embed-saved-panel { margin-top: 16px; }
.embed-saved-head { display: flex; align-items: start; justify-content: space-between; gap: 14px; }
.embed-saved-head p { margin: 5px 0 0; color: var(--public-muted); font-size: 11px; line-height: 1.45; }
.embed-manager-status { flex: 0 0 auto; min-height: 20px; color: var(--public-muted); font: 600 10px/1.4 var(--public-mono); text-align: right; }
.embed-save-row { display: flex; gap: 8px; align-items: end; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--public-rule-soft); }
.embed-save-row label { display: grid; flex: 1 1 auto; gap: 5px; color: var(--public-muted); font: 650 10px/1 var(--public-mono); letter-spacing: .08em; text-transform: uppercase; }
.embed-save-row input { width: 100%; border: 1px solid var(--public-rule); border-radius: 2px; background: var(--public-surface); padding: 8px; font-size: 12px; }
.embed-save-row button, .embed-saved-row button { min-height: 32px; border: 1px solid var(--public-accent); border-radius: 2px; background: var(--public-surface); color: var(--public-accent); padding: 6px 10px; font-size: 11px; font-weight: 650; white-space: nowrap; }
.embed-save-row button { background: var(--public-accent); color: white; }
.embed-save-row button:disabled { cursor: wait; opacity: .65; }
.embed-saved-list { display: grid; gap: 8px; margin-top: 14px; }
.embed-saved-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border: 1px solid var(--public-rule); background: var(--public-sunk); }
.embed-saved-row > div:first-child { min-width: 0; }
.embed-saved-row strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 650 13px/1.2 Georgia, serif; }
.embed-saved-row small { display: block; margin-top: 4px; color: var(--public-muted); font: 600 9px/1.3 var(--public-mono); letter-spacing: .04em; text-transform: uppercase; }
.embed-saved-row code { display: block; overflow: hidden; margin-top: 4px; color: var(--public-soft); text-overflow: ellipsis; white-space: nowrap; font: 9px/1.3 var(--public-mono); }
.embed-saved-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.embed-saved-actions .is-enabled { color: var(--public-accent); font: 650 9px/1 var(--public-mono); text-transform: uppercase; }
.embed-saved-actions .is-disabled { color: var(--public-soft); font: 650 9px/1 var(--public-mono); text-transform: uppercase; }
.embed-saved-empty { padding: 14px; color: var(--public-muted); border: 1px dashed var(--public-rule); font-size: 11px; }
@media (max-width: 680px) { .embed-saved-head, .embed-save-row, .embed-saved-row { align-items: stretch; flex-direction: column; } .embed-manager-status { text-align: left; } .embed-save-row button { width: 100%; } .embed-saved-actions { justify-content: space-between; } }
@media (max-width: 680px) { .embed-config-grid { grid-template-columns: 1fr; } .embed-preview { min-height: 360px; } .embed-field-row { grid-template-columns: 1fr; } }
@media (max-width: 375px) { .embed-session { grid-template-columns: 70px minmax(0, 1fr); padding: 11px; } .embed-header, .embed-controls, .embed-speaker-grid, .embed-speaker-list, .embed-cfp { padding-left: 11px; padding-right: 11px; } .embed-controls { grid-template-columns: 1fr; } .embed-speaker-grid { grid-template-columns: 1fr; } }
`;

export const EMBED_CONFIG_SCRIPT = `
(() => {
  const form = document.querySelector('[data-embed-config]');
  const code = document.querySelector('[data-embed-code]');
  const preview = document.querySelector('[data-embed-preview]');
  const copy = document.querySelector('[data-copy-embed]');
  const kindButtons = Array.from(document.querySelectorAll('[data-embed-kind]'));
  const outputButtons = Array.from(document.querySelectorAll('[data-embed-output]'));
  const layoutButtons = Array.from(document.querySelectorAll('[data-embed-layout]'));
  const fieldGroups = Array.from(document.querySelectorAll('[data-embed-fields-for]'));
  const trackField = document.getElementById('embed-track');
  const statusField = document.getElementById('embed-status');
  const accentField = document.getElementById('embed-accent');
  const trackNote = document.querySelector('[data-track-note]');
  const statusNote = document.querySelector('[data-status-note]');
  const layoutNote = document.querySelector('[data-layout-note]');
  const previewNote = document.querySelector('[data-preview-note]');
  if (!form || !code || !preview) return;
  const KIND_LABEL = { agenda: 'Agenda', sessions: 'Sessions', speakers: 'Speakers', cfp: 'Call for speakers' };
  // Interpolated from EMBED_SNIPPET_HEIGHT_PX so the snippet this page copies
  // and the one the saved-embed API returns cannot drift apart.
  const SNIPPET_STYLE = ${JSON.stringify(Object.fromEntries(EMBED_KINDS.map((kind) => [kind, embedSnippetStyle(kind)])))};
  const SNIPPET_HEIGHT = ${JSON.stringify(EMBED_SNIPPET_HEIGHT_PX)};
  const SNIPPET_NOTE = ${JSON.stringify(Object.fromEntries(EMBED_KINDS.map((kind) => [kind, {
    html: embedSnippetNote(kind, "html"),
    other: embedSnippetNote(kind, "json"),
  }])))};
  // The conference name reaches an HTML attribute here, and this textarea
  // decodes one layer of entities before anyone copies what is in it.
  const escapeAttr = (value) => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const OUTPUT_LABEL = { html: 'Styled HTML', basic: 'Basic HTML', json: 'JSON feed', xml: 'XML feed', ical: 'iCal feed' };
  const allFieldsFor = (kind) => {
    const group = fieldGroups.find((candidate) => candidate.dataset.embedFieldsFor === kind);
    return Array.from(group?.querySelectorAll('[data-embed-field]') || []).map((input) => input.value);
  };
  const selectedFieldsFor = (kind) => {
    const group = fieldGroups.find((candidate) => candidate.dataset.embedFieldsFor === kind);
    return Array.from(group?.querySelectorAll('[data-embed-field]:checked') || []).map((input) => input.value);
  };
  const state = {
    kind: kindButtons.find((b) => b.classList.contains('active'))?.dataset.embedKind || 'agenda',
    output: outputButtons.find((b) => b.classList.contains('active'))?.dataset.embedOutput || 'html',
    layout: layoutButtons.find((b) => b.classList.contains('active'))?.dataset.embedLayout || 'cards',
    savedSlug: null,
    fieldsByKind: {},
  };
  fieldGroups.forEach((group) => { state.fieldsByKind[group.dataset.embedFieldsFor] = selectedFieldsFor(group.dataset.embedFieldsFor); });
  const fieldsFor = (kind) => state.fieldsByKind[kind] || allFieldsFor(kind);
  const saveFieldSelection = () => { state.fieldsByKind[state.kind] = selectedFieldsFor(state.kind); };
  const paintFieldOptions = () => {
    fieldGroups.forEach((group) => {
      const applies = group.dataset.embedFieldsFor === state.kind;
      group.hidden = !applies;
      group.setAttribute('aria-hidden', String(!applies));
      const selected = fieldsFor(group.dataset.embedFieldsFor);
      group.querySelectorAll('[data-embed-field]').forEach((input) => {
        input.checked = selected.includes(input.value);
        input.disabled = !applies;
      });
    });
  };
  const paintControls = () => {
    kindButtons.forEach((b) => { const active = b.dataset.embedKind === state.kind; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    outputButtons.forEach((b) => { const active = b.dataset.embedOutput === state.output; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    const notApplicable = state.kind === 'cfp';
    if (trackField) trackField.disabled = notApplicable;
    if (statusField) statusField.disabled = notApplicable;
    if (trackNote) trackNote.textContent = notApplicable ? 'Not applicable — the block promotes the whole call' : 'Limits the embed to one track';
    if (statusNote) statusNote.textContent = notApplicable ? 'Not applicable — the block promotes the whole call' : 'Limits the embed to one status';
    const layoutApplies = state.kind === 'speakers';
    layoutButtons.forEach((b) => { b.disabled = !layoutApplies; const active = layoutApplies && b.dataset.embedLayout === state.layout; b.classList.toggle('active', active); });
    if (layoutNote) layoutNote.textContent = layoutApplies ? 'Gallery cards or a compact list' : 'Applies to the Speakers format';
    paintFieldOptions();
  };
  const pathFor = (slug, output, params) => {
    if (output === 'json') return '/api/v1/public/embeds/' + encodeURIComponent(slug) + (params.toString() ? '?' + params.toString() : '');
    if (output === 'xml') return '/api/v1/public/embeds/' + encodeURIComponent(slug) + '/xml' + (params.toString() ? '?' + params.toString() : '');
    if (output === 'ical') return '/embed/' + encodeURIComponent(slug) + '.ics' + (params.toString() ? '?' + params.toString() : '');
    if (output === 'basic') { params.set('style', 'basic'); return '/embed/' + encodeURIComponent(slug) + '?' + params.toString(); }
    return '/embed/' + encodeURIComponent(slug) + (params.toString() ? '?' + params.toString() : '');
  };
  const update = () => {
    saveFieldSelection();
    const values = new FormData(form);
    const event = String(values.get('event') || 'conference');
    const kind = state.kind;
    const slug = state.savedSlug && state.kind === kind ? state.savedSlug : event + '-' + kind;
    const params = new URLSearchParams();
    const track = String(values.get('track') || '');
    const status = String(values.get('status') || '');
    const accent = String(values.get('accent') || '');
    if (track && kind !== 'cfp') params.set('track', track);
    if (status && kind !== 'cfp') params.set('status', status);
    if (kind === 'speakers' && state.layout === 'list') params.set('layout', 'list');
    if (accent) params.set('accent', accent);
    params.set('fields', fieldsFor(kind).join(','));
    const src = pathFor(slug, state.output, params);
    const absolute = window.location.origin + src;
    code.value = state.output === 'html'
      ? '<iframe src="' + escapeAttr(absolute) + '" title="' + escapeAttr(event + ' ' + KIND_LABEL[kind].toLowerCase()) + '" loading="lazy" width="100%" height="' + SNIPPET_HEIGHT[kind] + '" style="' + SNIPPET_STYLE[kind] + '"></iframe>'
      : state.output === 'ical' ? '<a href="' + escapeAttr(absolute) + '">Add ' + escapeAttr(event) + ' to calendar</a>' : absolute;
    const previewSrc = src + (src.includes('?') ? '&' : '?') + 'preview=' + encodeURIComponent(state.output);
    preview.src = previewSrc;
    preview.setAttribute('data-preview-output', state.output);
    // The note follows the kind AND the output: only the HTML snippet is a
    // frame with a height, and the others are a link.
    if (previewNote) previewNote.textContent = SNIPPET_NOTE[kind][state.output === 'html' ? 'html' : 'other'];
  };
  kindButtons.forEach((b) => b.addEventListener('click', () => { saveFieldSelection(); state.kind = b.dataset.embedKind; state.savedSlug = null; paintControls(); update(); }));
  outputButtons.forEach((b) => b.addEventListener('click', () => { state.output = b.dataset.embedOutput; outputButtons.forEach((item) => { const active = item.dataset.embedOutput === state.output; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); update(); }));
  layoutButtons.forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; state.layout = b.dataset.embedLayout; paintControls(); update(); }));
  form.querySelectorAll('select, input').forEach((control) => control.addEventListener('input', update));
  copy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.value); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy embed code'; }, 1200); }
    catch (_) { code.focus(); code.select(); copy.textContent = 'Select and copy'; }
  });
  paintControls();
  update();

  const manager = document.querySelector('[data-embed-manager]');
  const managerStatus = document.querySelector('[data-embed-manager-status]');
  const savedList = document.querySelector('[data-saved-embed-list]');
  const nameField = document.querySelector('[data-embed-name]');
  const saveButton = document.querySelector('[data-save-embed]');
  const eventId = String(form.querySelector('[name="event_id"]')?.value || '');
  const apiPath = eventId ? '/api/v1/events/' + encodeURIComponent(eventId) + '/embeds' : '';
  let saved = [];
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const renderSaved = () => {
    if (!savedList) return;
    if (saved.length === 0) { savedList.innerHTML = '<div class="embed-saved-empty">No saved embeds yet. Name the current configuration above to keep its code handy.</div>'; return; }
    savedList.innerHTML = saved.map((item) => '<article class="embed-saved-row" data-saved-id="' + escapeHtml(item.id) + '"><div><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(KIND_LABEL[item.kind] || item.kind) + ' · ' + escapeHtml(OUTPUT_LABEL[item.output_format] || item.output_format) + '</small><code>' + escapeHtml(item.slug) + '</code></div><div class="embed-saved-actions"><span class="' + (item.enabled ? 'is-enabled' : 'is-disabled') + '">' + (item.enabled ? 'Enabled' : 'Disabled') + '</span><button type="button" data-saved-code="' + escapeHtml(item.id) + '">Get code</button><button type="button" data-saved-toggle="' + escapeHtml(item.id) + '">' + (item.enabled ? 'Disable' : 'Enable') + '</button></div></article>').join('');
    savedList.querySelectorAll('[data-saved-code]').forEach((button) => button.addEventListener('click', () => {
      const item = saved.find((candidate) => candidate.id === button.dataset.savedCode); if (!item) return;
      state.kind = item.kind;
      state.output = item.output_format;
      state.layout = item.layout || 'cards';
      state.savedSlug = item.slug;
      state.fieldsByKind[state.kind] = Array.isArray(item.fields) ? item.fields : allFieldsFor(state.kind);
      if (trackField) trackField.value = item.track || '';
      if (statusField) statusField.value = item.status || '';
      if (accentField) accentField.value = item.accent || accentField.defaultValue;
      paintControls();
      update();
      code.focus();
      managerStatus.textContent = 'Configuration loaded for ' + item.name;
    }));
    savedList.querySelectorAll('[data-saved-toggle]').forEach((button) => button.addEventListener('click', async () => {
      const item = saved.find((candidate) => candidate.id === button.dataset.savedToggle); if (!item) return;
      button.disabled = true;
      try { const response = await fetch(apiPath + '/' + encodeURIComponent(item.id), { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !item.enabled }) }); if (!response.ok) throw new Error('save failed'); const payload = await response.json(); const updated = payload.data; saved = saved.map((candidate) => candidate.id === updated.id ? updated : candidate); renderSaved(); managerStatus.textContent = updated.enabled ? 'Embed enabled' : 'Embed disabled'; }
      catch (_) { button.disabled = false; managerStatus.textContent = 'That change could not be saved. Try again.'; }
    }));
  };
  const loadSaved = async () => {
    if (!manager || !apiPath) return;
    try { const response = await fetch(apiPath, { credentials: 'include' }); if (response.status === 401) { managerStatus.textContent = 'Sign in as an organizer to save embeds.'; if (saveButton) saveButton.disabled = true; return; } if (!response.ok) throw new Error('load failed'); const payload = await response.json(); saved = payload.data; managerStatus.textContent = saved.length ? saved.length + ' saved ' + (saved.length === 1 ? 'embed' : 'embeds') : 'Nothing saved yet'; renderSaved(); }
    catch (_) { managerStatus.textContent = 'Saved embeds are unavailable right now.'; if (saveButton) saveButton.disabled = true; }
  };
  saveButton?.addEventListener('click', async () => {
    const name = String(nameField?.value || '').trim();
    if (!name) { managerStatus.textContent = 'Give this embed a name first.'; nameField?.focus(); return; }
    saveButton.disabled = true;
    const values = new FormData(form);
    try { const response = await fetch(apiPath, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind: state.kind, output_format: state.output, track: String(values.get('track') || '') || null, status: String(values.get('status') || '') || null, layout: state.kind === 'speakers' ? state.layout : null, accent: String(values.get('accent') || '') || null, fields: fieldsFor(state.kind) }) }); if (!response.ok) throw new Error('save failed'); const payload = await response.json(); saved = [payload.data, ...saved]; renderSaved(); managerStatus.textContent = 'Saved ' + payload.data.name; if (nameField) nameField.value = ''; }
    catch (_) { managerStatus.textContent = 'That embed could not be saved. Try again.'; }
    finally { saveButton.disabled = false; }
  });
  void loadSaved();
})();
`;

function trackChip(track: PublicTrack): JSX.Element {
  return <span class="embed-track" style={{ "--track-color": track.color }} key={track.id}>{track.name}</span>;
}

function formatDeadline(epochMs: number, timezone: string): string {
  return formatEventDateTime(epochMs, timezone);
}

function speakerHref(slug: string, eventSlug: string): string {
  return `/p/${encodeURIComponent(slug)}?event=${encodeURIComponent(eventSlug)}`;
}

function speakerCards(speakers: PublicEmbedData["speakers"], eventSlug: string, fields: ReadonlySet<EmbedField>): JSX.Element {
  return (
    <section class="embed-speaker-grid" aria-label="Published speakers">
      {speakers.map((speaker) => <a class={fields.has("headshot") ? "embed-speaker" : "embed-speaker no-avatar"} href={speakerHref(speaker.slug, eventSlug)} key={speaker.id}>
        {fields.has("headshot") ? <PublicSpeakerAvatar speaker={speaker} className="embed-speaker-avatar" /> : null}
        <div class="embed-speaker-copy">
          {fields.has("name") ? <h2>{speaker.name}</h2> : <h2>Speaker</h2>}
          {fields.has("title") || fields.has("company") ? <p>{[fields.has("title") ? speaker.title : null, fields.has("company") ? speaker.company : null].filter(Boolean).join(" · ") || "—"}</p> : null}
          {fields.has("bio") ? <p>{speaker.bio || "—"}</p> : null}
          {fields.has("social") ? speakerSocialLinks(speaker) : null}
          {fields.has("sessions") ? <small>{speaker.sessions.length} {speaker.sessions.length === 1 ? "published session" : "published sessions"}</small> : null}
        </div>
      </a>)}
    </section>
  );
}

function speakerList(speakers: PublicEmbedData["speakers"], eventSlug: string, fields: ReadonlySet<EmbedField>): JSX.Element {
  return (
    <ul class="embed-speaker-list" aria-label="Published speakers">
      {speakers.map((speaker) => <li key={speaker.id}>
        <a class={fields.has("headshot") ? "embed-speaker-row" : "embed-speaker-row no-avatar"} href={speakerHref(speaker.slug, eventSlug)}>
          {fields.has("headshot") ? <PublicSpeakerAvatar speaker={speaker} className="embed-speaker-avatar" /> : null}
          <div class="embed-speaker-row-copy">
            <strong>{fields.has("name") ? speaker.name : "Speaker"}</strong>
            {fields.has("title") || fields.has("company") ? <span>{[fields.has("title") ? speaker.title : null, fields.has("company") ? speaker.company : null].filter(Boolean).join(" · ") || "—"}</span> : null}
            {fields.has("bio") ? <p>{speaker.bio || "—"}</p> : null}
            {fields.has("social") ? speakerSocialLinks(speaker) : null}
            {fields.has("sessions") ? <p>{speaker.sessions.length} {speaker.sessions.length === 1 ? "published session" : "published sessions"}</p> : null}
          </div>
        </a>
      </li>)}
    </ul>
  );
}

function speakerSocialLinks(speaker: PublicEmbedData["speakers"][number]): JSX.Element | null {
  const links = speaker.socialLinks.filter((link) => /^https?:\/\//i.test(link));
  if (links.length === 0) return null;
  return <div class="embed-speaker-social" aria-label="Social links">{links.map((link) => <a href={link} target="_blank" rel="noreferrer" key={link}>{link.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</a>)}</div>;
}

function speakerCredits(session: PublicSession): string {
  return session.speakers
    .map((speaker) => [speaker.name, [speaker.title, speaker.company].filter(Boolean).join(", ")].filter(Boolean).join(" — "))
    .join(" · ") || PUBLIC_SPEAKER_EMPTY_LABEL;
}

function SpeakerCredits({ session }: { session: PublicSession }): JSX.Element {
  return <p class="embed-speaker-credits">{speakerCredits(session)}</p>;
}

/** Same bounded snippet + zero-JS expansion the public agenda cards use. */
function sessionAbstract(session: PublicSession, visible = true): JSX.Element | null {
  if (!visible) return null;
  const snippet = publicAbstractSnippet(session.abstract);
  if (!snippet) return <p class="embed-abstract">—</p>;
  return (
    <>
      <p class="embed-abstract">{snippet.head}{snippet.rest ? "…" : ""}</p>
      {snippet.rest ? (
        <details class="embed-more">
          <summary>Show more</summary>
          <p>{snippet.rest}{snippet.clipped ? "…" : ""}</p>
        </details>
      ) : null}
    </>
  );
}

function sessionChips(session: PublicSession, fields: ReadonlySet<EmbedField>): JSX.Element | null {
  if (!fields.has("format") && !fields.has("track")) return null;
  return (
    <div class="embed-tracks">
      {fields.has("format") ? <><span class="embed-meta-label">Format</span><span class="embed-format">{session.format?.name ?? "—"}</span></> : null}
      {fields.has("track") ? <><span class="embed-meta-label">Track</span>{session.tracks.length > 0 ? session.tracks.map(trackChip) : <span class="embed-track">—</span>}</> : null}
    </div>
  );
}

function sessionsFlatList(sessions: PublicEmbedData["sessions"], fields: ReadonlySet<EmbedField>): JSX.Element {
  return (
    <section class="embed-flat-list" aria-label="Published sessions">
      {sessions.map((session) => (
        <article class="embed-session" data-public-session-id={session.id} data-public-session-slug={session.slug} key={session.id}>
          {fields.has("time") ? <time><strong>{session.time}</strong>{session.day}<br />→ {session.endTime}{fields.has("location") ? <><br />{session.roomLabel}</> : null}</time> : fields.has("location") ? <p class="embed-session-location">{session.roomLabel}</p> : null}
          <div>
            {fields.has("title") ? <h2>{session.title}</h2> : null}
            {fields.has("speakers") ? <SpeakerCredits session={session} /> : null}
            {sessionAbstract(session, fields.has("abstract"))}
            {sessionChips(session, fields)}
          </div>
        </article>
      ))}
    </section>
  );
}

function cfpBody(cfp: PublicEmbedData["cfp"], fields: ReadonlySet<EmbedField>, timezone: string): JSX.Element {
  if (!cfp) {
    return <div class="embed-empty"><div><strong>Call for speakers has not opened yet</strong><span>Check back once the conference team publishes a form.</span></div></div>;
  }
  const isOpen = cfp.status === "open";
  const deadline = fields.has("deadline") && cfp.closesAt ? formatDeadline(cfp.closesAt, timezone) : null;
  return (
    <div class="embed-cfp">
      {fields.has("status") ? <strong>Call for speakers is {isOpen ? "open" : "closed"}{deadline && isOpen ? ` · closes ${deadline}` : ""}</strong> : null}
      {!fields.has("status") && deadline ? <p>Closes {deadline}</p> : null}
      {fields.has("formats") && cfp.formats.length > 0 ? <div class="embed-tracks">{cfp.formats.map((name) => <span class="embed-track" key={name}>{name}</span>)}</div> : null}
      {isOpen
        ? fields.has("link") ? <p><a class="public-button primary" href={cfp.url}>Submit a proposal →</a></p> : null
        : fields.has("status") ? <p>Submissions are closed. This block updates automatically — no republish — once the call reopens.</p> : null}
    </div>
  );
}

export function EmbedPage({ data, basic = false }: { data: PublicEmbedData; basic?: boolean }): JSX.Element {
  const accent = data.config.accent ?? data.event.accent ?? "#0b6a72";
  const action = EMBED_KIND_LABEL[data.kind];
  const fields = new Set<EmbedField>(data.config.fields);
  const hasFilters = Boolean(data.filters.track || data.filters.format || data.filters.room || data.filters.status);
  const layout: EmbedLayout = data.filters.layout ?? "cards";
  const agendaHref = `/agenda?event=${encodeURIComponent(data.event.slug)}`;
  return (
    <div class="embed-site" data-embed-kind={data.kind} data-embed-output={basic ? "basic" : "html"} style={basic ? undefined : { "--embed-accent": accent }}>
      <header class="embed-header"><strong>{data.event.name} · {action}{data.venue?.buildingName ? ` · ${data.venue.buildingName}` : ""}</strong><span>Published program</span></header>
      {data.kind !== "cfp" ? (
        <form class="embed-controls" method="get" action={`/embed/${encodeURIComponent(data.slug)}`}>
          <select class="embed-control" name="track" aria-label="Filter embed by track" value={data.filters.track ?? ""}>
            <option value="">All tracks</option>
            {data.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
          </select>
          <select class="embed-control" name="format" aria-label="Filter embed by format" value={data.filters.format ?? ""}>
            <option value="">All formats</option>
            {data.formats.map((format) => <option value={format.id} key={format.id}>{format.name}</option>)}
          </select>
          <select class="embed-control" name="room" aria-label="Filter embed by location" value={data.filters.room ?? ""}>
            <option value="">All locations</option>
            {data.rooms.map((room) => <option value={room.id} key={room.id}>{room.label}</option>)}
          </select>
          <select class="embed-control" name="status" aria-label="Filter embed by status" value={data.filters.status ?? ""}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="accepted">Accepted</option>
            <option value="waitlisted">Waitlisted</option>
          </select>
        </form>
      ) : null}
      {data.kind === "cfp" ? cfpBody(data.cfp, fields, data.event.timezone) : data.kind === "speakers" ? (
        data.speakers.length > 0 ? (layout === "list" ? speakerList(data.speakers, data.event.slug, fields) : speakerCards(data.speakers, data.event.slug, fields))
          : <div class="embed-empty"><div><strong>{hasFilters ? "No published speakers match" : "No published speakers yet"}</strong><span>{hasFilters ? "Clear a filter to bring the gallery back into view." : "The conference team has not published any speakers yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show all speakers" : "Open the conference agenda"}</a></div></div>
      ) : data.kind === "sessions" ? (
        data.sessions.length > 0 ? sessionsFlatList(data.sessions, fields)
          : <div class="embed-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show full agenda" : "Open the conference agenda"}</a></div></div>
      ) : (
        data.sessions.length > 0 ? <section class="embed-list" aria-label="Published agenda">
          {data.sessions.map((session) => (
            <article class="embed-session" data-public-session-id={session.id} data-public-session-slug={session.slug} key={session.id}>
              {fields.has("time") ? <time><strong>{session.time}</strong>{session.day}<br />→ {session.endTime}{fields.has("location") ? <><br />{session.roomLabel}</> : null}</time> : fields.has("location") ? <p class="embed-session-location">{session.roomLabel}</p> : null}
              <div>
                {fields.has("title") ? <h2>{session.title}</h2> : null}
                {fields.has("speakers") ? <SpeakerCredits session={session} /> : null}
                {sessionAbstract(session, fields.has("abstract"))}
                {sessionChips(session, fields)}
              </div>
            </article>
          ))}
        </section> :<div class="embed-empty"><div><strong>{hasFilters ? "No published sessions match" : "No published sessions yet"}</strong><span>{hasFilters ? "Clear a filter to bring the program back into view." : "The conference team has not published the program yet."}</span><a class="public-button primary" href={hasFilters ? `/embed/${encodeURIComponent(data.slug)}` : agendaHref}>{hasFilters ? "Show full agenda" : "Open the conference agenda"}</a></div></div>
      )}
    </div>
  );
}

function embedSlug(event: PublicEvent, kind: EmbedKind): string {
  return `${event.slug}-${kind}`;
}

const EMBED_OUTPUT_LABEL: Record<EmbedOutputFormat, string> = {
  html: "Styled HTML",
  basic: "Basic HTML",
  json: "JSON feed",
  xml: "XML feed",
  ical: "iCal feed",
};

function embedParams(kind: EmbedKind, track: string, status: string, layout: EmbedLayout, accent: string, fields: readonly EmbedField[]): URLSearchParams {
  const query = new URLSearchParams();
  if (track && kind !== "cfp") query.set("track", track);
  if (status && kind !== "cfp") query.set("status", status);
  if (kind === "speakers" && layout === "list") query.set("layout", "list");
  if (accent) query.set("accent", accent);
  query.set("fields", fields.join(","));
  return query;
}

function embedPath(event: PublicEvent, kind: EmbedKind, output: EmbedOutputFormat, query: URLSearchParams): string {
  const slug = embedSlug(event, kind);
  const queryString = query.toString();
  if (output === "json") return `/api/v1/public/embeds/${encodeURIComponent(slug)}${queryString ? `?${queryString}` : ""}`;
  if (output === "xml") return `/api/v1/public/embeds/${encodeURIComponent(slug)}/xml${queryString ? `?${queryString}` : ""}`;
  if (output === "ical") return `/embed/${encodeURIComponent(slug)}.ics${queryString ? `?${queryString}` : ""}`;
  if (output === "basic") {
    query.set("style", "basic");
    return `/embed/${encodeURIComponent(slug)}?${query.toString()}`;
  }
  return `/embed/${encodeURIComponent(slug)}${queryString ? `?${queryString}` : ""}`;
}

function snippet(event: PublicEvent, kind: EmbedKind, track: string, status: string, layout: EmbedLayout, accent: string, fields: readonly EmbedField[], output: EmbedOutputFormat): string {
  const source = `https://marquee.stage11.dev${embedPath(event, kind, output, embedParams(kind, track, status, layout, accent, fields))}`;
  if (output === "json" || output === "xml" || output === "basic") return source;
  if (output === "ical") return embedCalendarLink(source, event.name);
  return embedIframeSnippet(source, `${event.name} ${EMBED_KIND_LABEL[kind].toLowerCase()}`, kind);
}

function previewSrc(event: PublicEvent, kind: EmbedKind, track: string, status: string, layout: EmbedLayout, accent: string, fields: readonly EmbedField[], output: EmbedOutputFormat): string {
  return embedPath(event, kind, output, embedParams(kind, track, status, layout, accent, fields));
}

export function EmbedConfigPage({
  event,
  tracks,
  kind,
  track,
  status,
  layout,
  accent,
  fields,
  output,
  preview,
}: {
  event: PublicEvent;
  tracks: PublicTrack[];
  kind: EmbedKind;
  track: string;
  status: string;
  layout: EmbedLayout;
  accent: string;
  fields: EmbedField[];
  output: EmbedOutputFormat;
  preview: PublicEmbedData;
}): JSX.Element {
  const notApplicable = kind === "cfp";
  const layoutApplies = kind === "speakers";
  const selectedFields = fields;
  // The public session and speaker pages send a visitor back to the agenda,
  // because that is where a visitor came from. This page is the organizer's
  // embed builder, reached from the sidebar's "Embeds" row — it is served
  // outside the admin shell, so the shell's own navigation is not on screen and
  // "← Agenda" was the only way out: a door to the public site from an
  // organizer tool, which is not where the organizer was. Point the way back at
  // the shell they left.
  return (
    <PublicShell event={event} title="Embed configuration" actions={<a class="public-button" href="/dashboard">← Program home</a>}>
      <main class="embed-config">
        <div class="public-kicker">Public surfaces · no login required</div>
        <div class="embed-config-grid">
          <section class="embed-config-panel">
            <h1>Embed the program.</h1>
            <p>Choose a public surface, tune its filters and color, then take the live frame to your own site.</p>
            <form data-embed-config>
              <input type="hidden" name="event" value={event.slug} />
              <input type="hidden" name="event_id" value={event.id} />
              <div class="embed-field">
                <label>Format</label>
                <div class="embed-format-segment" role="group" aria-label="Embed format">
                  {EMBED_KINDS.map((item) => (
                    <button type="button" data-embed-kind={item} class={item === kind ? "active" : ""} aria-pressed={item === kind} key={item}>{EMBED_KIND_LABEL[item]}</button>
                  ))}
                </div>
              </div>
              <div class="embed-field">
                <label>Output</label>
                <div class="embed-output-segment" role="group" aria-label="Output format">
                  {EMBED_OUTPUT_FORMATS.map((item) => <button type="button" data-embed-output={item} class={item === output ? "active" : ""} aria-pressed={item === output} key={item}>{EMBED_OUTPUT_LABEL[item]}</button>)}
                </div>
                <span class="embed-field-note">Styled or basic HTML, JSON/XML feeds, or iCal for a calendar subscription.</span>
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
              <div class="embed-field">
                <label>Fields</label>
                <div class="embed-field-options" data-embed-field-options>
                  {EMBED_KINDS.map((surface) => (
                    <fieldset data-embed-fields-for={surface} hidden={surface !== kind} key={surface}>
                      <legend>Shown in {EMBED_KIND_LABEL[surface]}</legend>
                      <div class="embed-field-option-grid">
                        {embedFieldsForKind(surface).map((option) => <label class="embed-field-option" key={option.value}>
                          <input type="checkbox" data-embed-field name="fields" value={option.value} checked={surface === kind ? selectedFields.includes(option.value) : true} />
                          <span>{option.label}</span>
                        </label>)}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <span class="embed-field-note">Choose the content this surface publishes. Existing embeds default to every field.</span>
              </div>
              <div class="embed-field"><label for="embed-accent">Accent color</label><input id="embed-accent" name="accent" type="color" value={accent} /></div>
              <div class="embed-field"><label for="embed-code">Embed code or feed URL</label><textarea data-embed-code id="embed-code" readOnly value={snippet(event, kind, track, status, layout, accent, selectedFields, output)} /></div>
              <div class="embed-copy"><button type="button" data-copy-embed>Copy embed code</button></div>
            </form>
          </section>
          <section class="embed-config-panel">
            <h2>Live preview</h2>
            {/* The preview is its own viewport and always has been. Saying so
                stops an organizer reading its height as the one they are about
                to paste — the snippet states that number itself. */}
            <p class="embed-preview-note" data-preview-note>{embedSnippetNote(kind, output)}</p>
            <div class="embed-preview"><iframe data-embed-preview title={`${event.name} ${EMBED_KIND_LABEL[kind].toLowerCase()} live preview`} src={previewSrc(event, kind, track, status, layout, accent, selectedFields, output)} /></div>
            <p style={{ margin: "10px 0 0", fontSize: "11px" }}>Published changes are served anonymously and refreshed from a 30-second edge cache.</p>
          </section>
        </div>
        <section class="embed-config-panel embed-saved-panel" data-embed-manager>
          <div class="embed-saved-head"><div><h2>Saved embeds</h2><p>Keep named snippets for the pages your team maintains. Disabling one stops its public URL without editing your site.</p></div><span class="embed-manager-status" data-embed-manager-status role="status">Sign in as an organizer to manage saved embeds.</span></div>
          <div class="embed-save-row"><label for="embed-name">Name this embed<input id="embed-name" data-embed-name type="text" maxLength={120} placeholder="Main conference site" /></label><button type="button" data-save-embed>Save current embed</button></div>
          <div class="embed-saved-list" data-saved-embed-list><div class="embed-saved-empty">Loading saved embeds…</div></div>
        </section>
      </main>
    </PublicShell>
  );
}

export { PUBLIC_SITE_STYLES };

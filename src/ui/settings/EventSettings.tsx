import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { PageHeader } from "../shell/components";
import { DEFAULT_EVENT_ID, loadVenueModel } from "../venues/venue-writer";
import type { VenueModel } from "../../lib/venues";
import "./settings.css";

interface EventDetails {
  id: string;
  name: string;
  tagline: string | null;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue: string | null;
  logo_key: string | null;
  accent: string | null;
  updated_at: number;
}

interface Format {
  id: string;
  event_id: string;
  name: string;
  default_duration_min: number;
  min_duration_min: number;
  max_duration_min: number;
  position: number;
  updated_at: number;
}

interface Track {
  id: string;
  event_id: string;
  name: string;
  color: string;
  position: number;
  updated_at: number;
}

interface SettingsModel {
  event: EventDetails;
  formats: Format[];
  tracks: Track[];
}

type LoadState =
  | { kind: "loading"; model: null }
  | { kind: "ready"; model: SettingsModel }
  | { kind: "error"; model: SettingsModel | null; message: string };

interface Props {
  eventId?: string;
  navigate: (target: string) => void;
}

interface VenueCounts {
  buildings: number;
  rooms: number;
}

function temporaryId(prefix: string): string {
  return `new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestJson<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { credentials: "include", ...init, route });
}

function moveItem<T extends { id: string }>(items: T[], id: string, targetId: string): T[] {
  if (id === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === id);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next.map((entry, position) => ({ ...entry, position }));
}

function moveBy<T extends { id: string }>(items: T[], id: string, delta: number): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  return moveItem(items, id, items[target].id);
}

function formatDuration(value: number): string {
  if (value >= 60 && value % 60 === 0) return `${value / 60} h`;
  return `${value} min`;
}

function reorderFormats(model: SettingsModel, formats: Format[]): SettingsModel {
  return { ...model, formats };
}

function reorderTracks(model: SettingsModel, tracks: Track[]): SettingsModel {
  return { ...model, tracks };
}

function SettingsSkeleton(): JSX.Element {
  return <div class="settings-grid settings-skeleton" aria-busy="true" aria-label="Loading conference settings">
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
  </div>;
}

function Field({ label, children, className = "" }: { label: string; children: ComponentChildren; className?: string }): JSX.Element {
  return <label class={`field ${className}`.trim()}><span>{label}</span>{children}</label>;
}

function FormatRow({
  format,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  onDrop,
}: {
  format: Format;
  index: number;
  count: number;
  onChange: (patch: Partial<Format>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onDrop: (targetId: string) => void;
}): JSX.Element {
  return <article class="settings-row" draggable onDragStart={(event) => { event.dataTransfer?.setData("text/plain", format.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer?.getData("text/plain"); if (id) onDrop(id); }}>
    <div class="settings-row-heading"><span class="drag-handle" aria-label={`Drag ${format.name || "format"} to reorder`} title="Drag to reorder">⠿</span><strong>{format.name || "Unnamed format"}</strong><span class="subtle">{formatDuration(format.default_duration_min)} default</span></div>
    <div class="settings-row-fields">
      <Field label="Format name"><input value={format.name} onInput={(event) => onChange({ name: event.currentTarget.value })} /></Field>
      <Field label="Minimum"><span class="unit-input"><input type="number" min="0" step="5" value={format.min_duration_min} onInput={(event) => onChange({ min_duration_min: Number(event.currentTarget.value) })} /><small>min</small></span></Field>
      <Field label="Default"><span class="unit-input"><input type="number" min="0" step="5" value={format.default_duration_min} onInput={(event) => onChange({ default_duration_min: Number(event.currentTarget.value) })} /><small>min</small></span></Field>
      <Field label="Maximum"><span class="unit-input"><input type="number" min="0" step="5" value={format.max_duration_min} onInput={(event) => onChange({ max_duration_min: Number(event.currentTarget.value) })} /><small>min</small></span></Field>
    </div>
    <div class="settings-row-actions"><button class="button small ghost" type="button" disabled={index === 0} aria-label={`Move ${format.name || "format"} up`} onClick={() => onMove(-1)}>↑</button><button class="button small ghost" type="button" disabled={index === count - 1} aria-label={`Move ${format.name || "format"} down`} onClick={() => onMove(1)}>↓</button><button class="button small danger" type="button" disabled={count <= 1} onClick={onRemove}>Remove</button></div>
  </article>;
}

function TrackRow({
  track,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  onDrop,
}: {
  track: Track;
  index: number;
  count: number;
  onChange: (patch: Partial<Track>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onDrop: (targetId: string) => void;
}): JSX.Element {
  return <article class="settings-row" draggable onDragStart={(event) => { event.dataTransfer?.setData("text/plain", track.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer?.getData("text/plain"); if (id) onDrop(id); }}>
    <div class="settings-row-heading"><span class="drag-handle" aria-label={`Drag ${track.name || "track"} to reorder`} title="Drag to reorder">⠿</span><span class="track-swatch" style={{ backgroundColor: track.color }} aria-hidden="true" /><strong>{track.name || "Unnamed track"}</strong></div>
    <div class="settings-row-fields track-fields"><Field label="Track name"><input value={track.name} onInput={(event) => onChange({ name: event.currentTarget.value })} /></Field><Field label="Track color"><span class="color-field"><input type="color" value={track.color} onInput={(event) => onChange({ color: event.currentTarget.value })} /><input value={track.color} aria-label={`${track.name || "Track"} hex color`} onInput={(event) => onChange({ color: event.currentTarget.value })} /></span></Field></div>
    <div class="settings-row-actions"><button class="button small ghost" type="button" disabled={index === 0} aria-label={`Move ${track.name || "track"} up`} onClick={() => onMove(-1)}>↑</button><button class="button small ghost" type="button" disabled={index === count - 1} aria-label={`Move ${track.name || "track"} down`} onClick={() => onMove(1)}>↓</button><button class="button small danger" type="button" disabled={count <= 1} onClick={onRemove}>Remove</button></div>
  </article>;
}

export function EventSettings({ eventId = DEFAULT_EVENT_ID, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", model: null });
  const [venueCounts, setVenueCounts] = useState<VenueCounts | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removedFormats, setRemovedFormats] = useState<string[]>([]);
  const [removedTracks, setRemovedTracks] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", model: null });
    void requestJson<{ data: SettingsModel }>(`/api/v1/events/${encodeURIComponent(eventId)}`, "/api/v1/events/{eventId}")
      .then((response) => { if (active) { setState({ kind: "ready", model: response.data }); setDirty(false); setRemovedFormats([]); setRemovedTracks([]); } })
      .catch((error: unknown) => { if (active) setState({ kind: "error", model: null, message: errorSummary(error) }); });
    return () => { active = false; };
  }, [eventId, reloadKey]);

  useEffect(() => {
    let active = true;
    void loadVenueModel(eventId).then((model: VenueModel) => {
      if (active) setVenueCounts({ buildings: model.buildings.length, rooms: model.rooms.length });
    }).catch(() => { if (active) setVenueCounts(null); });
    return () => { active = false; };
  }, [eventId]);

  const model = state.model;
  const updateModel = (update: (current: SettingsModel) => SettingsModel): void => {
    setState((current) => current.model ? { kind: "ready", model: update(current.model) } : current);
    setDirty(true);
    setNotice(null);
    setSaveError(null);
  };

  const save = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!model) return;
    setSaveError(null);
    setNotice(null);
    try {
      await requestJson<{ data: SettingsModel }>(`/api/v1/events/${encodeURIComponent(eventId)}`, "/api/v1/events/{eventId}", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(model.event),
      });
      for (const id of removedFormats) {
        if (!id.startsWith("new-")) await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/formats/${encodeURIComponent(id)}`, "/api/v1/events/{eventId}/formats/{formatId}", { method: "DELETE" });
      }
      for (const [position, format] of model.formats.filter((item) => !removedFormats.includes(item.id)).entries()) {
        const body = { name: format.name, default_duration_min: format.default_duration_min, min_duration_min: format.min_duration_min, max_duration_min: format.max_duration_min, position };
        if (format.id.startsWith("new-")) await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/formats`, "/api/v1/events/{eventId}/formats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        else await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/formats/${encodeURIComponent(format.id)}`, "/api/v1/events/{eventId}/formats/{formatId}", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      }
      for (const id of removedTracks) {
        if (!id.startsWith("new-")) await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(id)}`, "/api/v1/events/{eventId}/tracks/{trackId}", { method: "DELETE" });
      }
      for (const [position, track] of model.tracks.filter((item) => !removedTracks.includes(item.id)).entries()) {
        const body = { name: track.name, color: track.color, position };
        if (track.id.startsWith("new-")) await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/tracks`, "/api/v1/events/{eventId}/tracks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        else await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(track.id)}`, "/api/v1/events/{eventId}/tracks/{trackId}", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      }
      const response = await requestJson<{ data: SettingsModel }>(`/api/v1/events/${encodeURIComponent(eventId)}`, "/api/v1/events/{eventId}");
      setState({ kind: "ready", model: response.data });
      setRemovedFormats([]);
      setRemovedTracks([]);
      setDirty(false);
      setNotice("Conference settings saved");
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    }
  };

  if (state.kind === "loading" || !model) {
    return <div class="settings-page"><PageHeader title="Conference settings" copy="Keep the conference record, session formats, and tracks ready for the program team." /><SettingsSkeleton />{state.kind === "error" && <div class="settings-error" role="alert"><strong>Settings unavailable</strong><span>{state.message}</span><button class="button small" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}</div>;
  }

  return <div class="settings-page">
    <PageHeader title="Conference settings" copy="Details, formats, and tracks are the shared source of truth for the conference program." actions={<span class={`settings-dirty ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>} />
    {state.kind === "error" && <div class="settings-error" role="alert"><strong>Settings unavailable</strong><span>{state.message}</span></div>}
    {notice && <div class="settings-banner" role="status">{notice}</div>}
    {saveError && <div class="settings-error" role="alert"><strong>Save failed</strong><span>{saveError}</span></div>}
    <form onSubmit={save}>
      <div class="settings-grid">
        <section class="card settings-details-card">
          <header class="card-head"><div><h2>Conference details</h2><span class="subtle">The record every public and scheduling surface reads</span></div></header>
          <div class="card-body settings-fields">
            <Field label="Conference name" className="span-2"><input value={model.event.name} onInput={(event) => updateModel((current) => ({ ...current, event: { ...current.event, name: event.currentTarget.value } }))} /></Field>
            <Field label="Tagline" className="span-2"><input value={model.event.tagline ?? ""} onInput={(event) => updateModel((current) => ({ ...current, event: { ...current.event, tagline: event.currentTarget.value } }))} /></Field>
            <Field label="Starts"><input type="date" value={model.event.starts_on} onInput={(event) => updateModel((current) => ({ ...current, event: { ...current.event, starts_on: event.currentTarget.value } }))} /></Field>
            <Field label="Ends"><input type="date" value={model.event.ends_on} onInput={(event) => updateModel((current) => ({ ...current, event: { ...current.event, ends_on: event.currentTarget.value } }))} /></Field>
            <Field label="Timezone" className="span-2"><select value={model.event.timezone} onChange={(event) => updateModel((current) => ({ ...current, event: { ...current.event, timezone: event.currentTarget.value } }))}><option value="America/New_York">America/New_York</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="Europe/London">Europe/London</option><option value="UTC">UTC</option></select><small>Agenda and calendar invites inherit this timezone.</small></Field>
            <Field label="Venue" className="span-2"><input value={model.event.venue ?? ""} onInput={(event) => updateModel((current) => ({ ...current, event: { ...current.event, venue: event.currentTarget.value } }))} /></Field>
            <Field label="Conference logo" className="span-2"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) updateModel((current) => ({ ...current, event: { ...current.event, logo_key: file.name } })); }} /><small>{model.event.logo_key ? `Selected: ${model.event.logo_key}` : "PNG, JPG, or WebP"}</small></Field>
          </div>
        </section>

        <section class="card settings-list-card">
          <header class="card-head"><div><h2>Formats</h2><span class="subtle">Duration ranges feed forms and the agenda</span></div><button class="button small" type="button" onClick={() => updateModel((current) => ({ ...current, formats: [...current.formats, { id: temporaryId("format"), event_id: eventId, name: "New format", default_duration_min: 30, min_duration_min: 15, max_duration_min: 60, position: current.formats.length, updated_at: 0 }] }))}>+ Add format</button></header>
          <div class="card-body settings-list">{model.formats.length ? model.formats.map((format, index) => <FormatRow key={format.id} format={format} index={index} count={model.formats.length} onChange={(patch) => updateModel((current) => ({ ...current, formats: current.formats.map((item) => item.id === format.id ? { ...item, ...patch } : item) }))} onRemove={() => { setRemovedFormats((current) => [...current, format.id]); updateModel((current) => ({ ...current, formats: current.formats.filter((item) => item.id !== format.id) })); }} onMove={(delta) => updateModel((current) => reorderFormats(current, moveBy(current.formats, format.id, delta)))} onDrop={(sourceId) => updateModel((current) => reorderFormats(current, moveItem(current.formats, sourceId, format.id)))} />) : <div class="settings-list-empty"><strong>No formats yet</strong><span>Add the first format to give the conference forms and agenda a duration range.</span></div>}</div>
        </section>

        <section class="card settings-list-card">
          <header class="card-head"><div><h2>Tracks</h2><span class="subtle">Colors and order carry through the program</span></div><button class="button small" type="button" onClick={() => updateModel((current) => ({ ...current, tracks: [...current.tracks, { id: temporaryId("track"), event_id: eventId, name: "New track", color: "#7C5CFC", position: current.tracks.length, updated_at: 0 }] }))}>+ Add track</button></header>
          <div class="card-body settings-list">{model.tracks.length ? model.tracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} count={model.tracks.length} onChange={(patch) => updateModel((current) => ({ ...current, tracks: current.tracks.map((item) => item.id === track.id ? { ...item, ...patch } : item) }))} onRemove={() => { setRemovedTracks((current) => [...current, track.id]); updateModel((current) => ({ ...current, tracks: current.tracks.filter((item) => item.id !== track.id) })); }} onMove={(delta) => updateModel((current) => reorderTracks(current, moveBy(current.tracks, track.id, delta)))} onDrop={(sourceId) => updateModel((current) => reorderTracks(current, moveItem(current.tracks, sourceId, track.id)))} />) : <div class="settings-list-empty"><strong>No tracks yet</strong><span>Add the first track to carry color and order through the conference program.</span></div>}</div>
        </section>

        <section class="card settings-venue-link">
          <div><span class="eyebrow">Venues and rooms</span><h2>One place for every door</h2><p class="subtle tabular">{venueCounts ? `${venueCounts.buildings} buildings · ${venueCounts.rooms} rooms` : "Venue counts unavailable"}</p></div>
          <button class="button primary" type="button" onClick={() => navigate("/settings/venues")}>Open Venues →</button>
        </section>
      </div>
      <footer class="settings-savebar"><span class="subtle">Changes apply to the conference record after saving.</span><button class="button primary" type="submit" disabled={!dirty}>{dirty ? "Save event settings" : "Event settings saved"}</button></footer>
    </form>
  </div>;
}

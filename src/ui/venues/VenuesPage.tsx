import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { showsBuildingComparison } from "../../lib/venue-disclosure";
import { roomDisplayLabel, type VenueBuildingInput, type VenueModel, type VenueRoomInput } from "../../lib/venues";
import { PageHeader } from "../shell/components";
import { VenueMap } from "./VenueMap";
import { loadVenueModel, saveVenueModel } from "./venue-writer";
import "./venues.css";

const AV_TAGS = ["Projector", "Confidence monitor", "Mics", "Livestream"];

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function newBuilding(position: number): VenueBuildingInput {
  return { id: newId("building"), name: `New building ${position + 1}`, address: "", position, lat: null, lng: null, access_minutes: 0, access_note: null };
}

function newRoom(buildingId: string, position: number): VenueRoomInput {
  return { id: newId("room"), building_id: buildingId, name: `New room ${position + 1}`, capacity: 100, position, av_capabilities: [], notes: null };
}

function renumber(model: VenueModel): VenueModel {
  return {
    buildings: model.buildings.map((building, position) => ({ ...building, position })),
    rooms: model.rooms.map((room, position) => ({ ...room, position })),
  };
}

function Field({ label, children, className = "" }: { label: string; children: JSX.Element; className?: string }): JSX.Element {
  return <label class={`venue-field ${className}`}><span>{label}</span>{children}</label>;
}

export function VenuesPage({ eventId }: { eventId?: string }): JSX.Element {
  const [model, setModel] = useState<VenueModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    setError(null);
    loadVenueModel(eventId).then(setModel).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Venues could not load"));
  }, [eventId]);
  useEffect(() => { reload(); }, [reload]);

  const updateBuilding = (id: string, patch: Partial<VenueBuildingInput>) => setModel((current) => current && { ...current, buildings: current.buildings.map((building) => building.id === id ? { ...building, ...patch } : building) });
  const updateRoom = (id: string, patch: Partial<VenueRoomInput>) => setModel((current) => current && { ...current, rooms: current.rooms.map((room) => room.id === id ? { ...room, ...patch } : room) });
  const save = async () => {
    if (!model) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      setModel(await saveVenueModel(renumber(model), eventId));
      setNotice("Venues saved · map and room labels updated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Venues could not save");
    } finally { setSaving(false); }
  };
  const addBuilding = () => setModel((current) => current && renumber({ ...current, buildings: [...current.buildings, newBuilding(current.buildings.length)] }));
  const removeBuilding = (id: string) => setModel((current) => {
    if (!current || current.buildings.length <= 1) return current;
    const replacement = current.buildings.find((building) => building.id !== id)?.id ?? "";
    return renumber({ buildings: current.buildings.filter((building) => building.id !== id), rooms: current.rooms.map((room) => room.building_id === id ? { ...room, building_id: replacement } : room) });
  });
  const addRoom = () => setModel((current) => current && renumber({ ...current, rooms: [...current.rooms, newRoom(current.buildings[0]?.id ?? "", current.rooms.length)] }));
  const removeRoom = (id: string) => setModel((current) => current && renumber({ ...current, rooms: current.rooms.filter((room) => room.id !== id) }));
  const toggleAv = (room: VenueRoomInput, tag: string) => updateRoom(room.id, { av_capabilities: room.av_capabilities.includes(tag) ? room.av_capabilities.filter((value) => value !== tag) : [...room.av_capabilities, tag] });
  const pinnedBuildings = model?.buildings.filter((building) => building.lat !== null && building.lng !== null) ?? [];
  const showBuildingComparison = showsBuildingComparison(pinnedBuildings);
  const headerBuilding = !showBuildingComparison ? pinnedBuildings[0]?.name ?? null : null;

  return <div class="venues-page">
    <PageHeader title="Venues" copy={`${headerBuilding ? `${headerBuilding}. ` : ""}A conference can span more than one door. Keep the map, arrival instructions, and room capabilities in one place.`} actions={<button class="button primary" disabled={!model || saving} onClick={save}>{saving ? "Saving…" : "Save venues"}</button>} />
    {error && <div class="venue-message error" role="alert">{error}<button class="button small" onClick={reload}>Retry</button></div>}
    {notice && <div class="venue-message success" role="status">{notice}</div>}
    {!model && !error && <div class="card venue-loading" aria-busy="true">Loading conference venues…</div>}
    {model && <>
      <section class="card venue-map-card"><div class="card-head"><div><h2>Site map</h2><span class="subtle">Pins use verified building coordinates · lines show walking time</span></div><span class="chip">{pinnedBuildings.length} of {model.buildings.length} pinned</span></div><details class="venue-map-fold" open={showBuildingComparison}><summary>{showBuildingComparison ? "Hide site map" : `Show site map${headerBuilding ? ` · ${headerBuilding}` : " · pin a second building to compare"}`}</summary><div class="card-body"><VenueMap buildings={model.buildings} /></div></details>{!showBuildingComparison && <div class="venue-map-reserved">Site map folded until a second building is pinned. Arrival instructions remain below.</div>}</section>
      <div class="venues-editor-grid">
        <section class="card"><div class="card-head"><div><h2>Buildings</h2><span class="subtle">Coordinates drive the map and Transit checks</span></div><button class="button small" onClick={addBuilding}>+ Add building</button></div><div class="card-body venue-list">{model.buildings.length ? model.buildings.map((building) => <article class="building-editor" key={building.id}>
          <div class="venue-row-heading"><span class="drag-handle">{building.position + 1}</span><strong>{building.name || "Unnamed building"}</strong><span class="subtle">{model.rooms.filter((room) => room.building_id === building.id).length} rooms</span><button class="button small" disabled={model.buildings.length <= 1} onClick={() => removeBuilding(building.id)}>Remove</button></div>
          <div class="venue-fields building-fields"><Field label="Building name"><input aria-label="Building name" value={building.name} onInput={(event) => updateBuilding(building.id, { name: event.currentTarget.value })} /></Field><Field label="Street address"><input aria-label="Building address" value={building.address} placeholder="Street address, city, ZIP" onInput={(event) => updateBuilding(building.id, { address: event.currentTarget.value })} /></Field><Field label="Latitude"><input aria-label="Building latitude" inputMode="decimal" value={building.lat ?? ""} placeholder="40.7625188" onInput={(event) => updateBuilding(building.id, { lat: event.currentTarget.value.trim() === "" ? null : Number(event.currentTarget.value) })} /></Field><Field label="Longitude"><input aria-label="Building longitude" inputMode="decimal" value={building.lng ?? ""} placeholder="-73.9814528" onInput={(event) => updateBuilding(building.id, { lng: event.currentTarget.value.trim() === "" ? null : Number(event.currentTarget.value) })} /></Field><Field label="Minutes to get in"><input aria-label="Building access minutes" type="number" min="0" step="1" value={building.access_minutes} onInput={(event) => updateBuilding(building.id, { access_minutes: Number(event.currentTarget.value) })} /></Field><Field label="Entrance note" className="span-2"><input aria-label="Building entrance note" value={building.access_note ?? ""} placeholder="Doors, ID, lifts — shown to speakers" onInput={(event) => updateBuilding(building.id, { access_note: event.currentTarget.value || null })} /></Field></div>
        </article>) : <div class="venue-list-empty"><strong>No buildings yet</strong><span>Add a building to pin the conference map and create a room home.</span></div>}</div></section>
        <section class="card"><div class="card-head"><div><h2>Rooms</h2><span class="subtle">Capacity, AV capability, and day-of notes</span></div><button class="button small" disabled={model.buildings.length === 0} onClick={addRoom}>+ Add room</button></div><div class="card-body venue-list">{model.rooms.length ? model.rooms.map((room) => <article class="room-editor" key={room.id}><div class="venue-row-heading"><span class="drag-handle">{room.position + 1}</span><strong>{roomDisplayLabel(room, model.buildings.find((building) => building.id === room.building_id) ?? null, showBuildingComparison) || "Unnamed room"}</strong><button class="button small" disabled={model.rooms.length <= 1} onClick={() => removeRoom(room.id)}>Remove</button></div><div class="venue-fields room-fields"><Field label="Room name"><input aria-label="Room name" value={room.name} onInput={(event) => updateRoom(room.id, { name: event.currentTarget.value })} /></Field><Field label="Capacity"><input aria-label="Room capacity" type="number" min="0" step="1" value={room.capacity} onInput={(event) => updateRoom(room.id, { capacity: Number(event.currentTarget.value) })} /></Field><Field label="Building" className="span-2"><select aria-label="Room building" value={room.building_id} onChange={(event) => updateRoom(room.id, { building_id: event.currentTarget.value })}>{model.buildings.map((building) => <option value={building.id}>{building.name}</option>)}</select></Field><div class="venue-field span-2"><span>AV capability</span><div class="av-tags">{AV_TAGS.map((tag) => <button class={`av-tag ${room.av_capabilities.includes(tag) ? "on" : ""}`} type="button" aria-pressed={room.av_capabilities.includes(tag)} onClick={() => toggleAv(room, tag)}>{tag}</button>)}</div></div><Field label="Room notes" className="span-2"><textarea aria-label="Room notes" rows={2} value={room.notes ?? ""} placeholder="Load-in, production, or room-specific notes" onInput={(event) => updateRoom(room.id, { notes: event.currentTarget.value || null })} /></Field></div></article>) : <div class="venue-list-empty"><strong>No rooms yet</strong><span>{model.buildings.length ? "Add a room to give the agenda a place to land." : "Add a building before creating its rooms."}</span></div>}</div></section>
      </div>
    </>}
  </div>;
}

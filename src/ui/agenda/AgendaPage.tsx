/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type {
  AgendaConflict,
  AgendaPoolItem,
  AgendaRoom,
  AgendaSession,
  AgendaSnapshot,
  AgendaView,
} from "../../api/agenda";
import { AGENDA_VIEWS, durationIsAllowed, viewNames } from "../../api/agenda";
import { displayRoomLabel, showsBuildingComparison, showsBuildingComparisonCount, visibleVenueConflicts } from "../../lib/venue-disclosure";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Chip, EmptyState, PageHeader } from "../shell/components";
import { localParts, sessionDay, sessionTime, TIME_SLOTS, TrackBoard } from "./track-board";
import "./agenda.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";
const DAY_MS = 86_400_000;
const AGENDA_ROUTE = "/api/v1/events/{eventId}/agenda";
const AGENDA_ITEMS_ROUTE = "/api/v1/events/{eventId}/agenda/items";
const AGENDA_ITEM_ROUTE = "/api/v1/events/{eventId}/agenda/items/{itemId}";

interface Props {
  eventId?: string;
}

interface DayOption {
  value: string;
  label: string;
}

type LoadState =
  | { kind: "loading"; snapshot: null }
  | { kind: "ready"; snapshot: AgendaSnapshot }
  | { kind: "error"; snapshot: AgendaSnapshot | null; message: string };

type DragPayload =
  | { kind: "pool"; id: string }
  | { kind: "session"; id: string };

function dateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function dayOptions(snapshot: AgendaSnapshot): DayOption[] {
  const start = dateAtNoon(snapshot.event.starts_on).getTime();
  const end = dateAtNoon(snapshot.event.ends_on).getTime();
  const options: DayOption[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    const value = new Date(cursor).toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: snapshot.event.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(cursor));
    options.push({ value, label: `${label.split(", ")[0]} · ${label.split(", ")[1]}` });
  }
  return options;
}

/** Convert a conference-local wall-clock value into an instant without using the browser's zone. */
export function zonedStart(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year!, month! - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = localParts(candidate, timezone);
    const renderedTarget = Date.UTC(
      Number(rendered.day.slice(0, 4)),
      Number(rendered.day.slice(5, 7)) - 1,
      Number(rendered.day.slice(8, 10)),
      Number(rendered.time.slice(0, 2)),
      Number(rendered.time.slice(3, 5)),
    );
    candidate += target - renderedTarget;
  }
  return candidate;
}

function speakerLine(session: AgendaSession): string {
  return session.speakers.length ? session.speakers.map((speaker) => speaker.name).join(" · ") : "No speakers listed";
}

function trackColor(snapshot: AgendaSnapshot, session: AgendaSession): string {
  return snapshot.tracks.find((track) => track.id === session.track_id)?.color ?? "#0b6a72";
}

function poolTrackColor(snapshot: AgendaSnapshot, item: AgendaPoolItem): string {
  return snapshot.tracks.find((track) => track.id === item.tracks.find((track) => track.is_primary)?.id)?.color ?? "#0b6a72";
}

function sessionsFor(
  snapshot: AgendaSnapshot,
  day: string,
  track: string,
): AgendaSession[] {
  return snapshot.sessions.filter((session) =>
    (day === "all" || sessionDay(session, snapshot.event.timezone) === day)
    && (!track || session.tracks.some((candidate) => candidate.id === track) || session.track_id === track),
  );
}

type ConflictMarker = "Conflict" | "Transit";
type ConflictMarkers = ReadonlyMap<string, ConflictMarker>;

function conflictMarkers(conflicts: readonly AgendaConflict[]): ConflictMarkers {
  const markers = new Map<string, ConflictMarker>();
  for (const conflict of conflicts) {
    const marker: ConflictMarker = conflict.kind === "transit" ? "Transit" : "Conflict";
    for (const sessionId of conflict.session_ids) {
      if (marker === "Transit" || !markers.has(sessionId)) markers.set(sessionId, marker);
    }
  }
  return markers;
}

function roomFor(snapshot: AgendaSnapshot, roomId: string): AgendaRoom | undefined {
  return snapshot.rooms.find((room) => room.id === roomId);
}

function agendaShowsBuildingComparison(snapshot: AgendaSnapshot): boolean {
  return snapshot.venue
    ? showsBuildingComparisonCount(snapshot.venue.pinned_building_count)
    : showsBuildingComparison(snapshot.rooms.map((room) => room.building));
}

function agendaBuildingHeader(snapshot: AgendaSnapshot): string | null {
  if (snapshot.venue) return snapshot.venue.primary_building_name;
  const pinned = new Map<string, string>();
  for (const room of snapshot.rooms) {
    if (room.building.lat !== null && room.building.lng !== null) pinned.set(room.building.id, room.building.name);
  }
  return pinned.size < 2 ? [...pinned.values()][0] ?? null : null;
}

function RoomHead({
  room,
  onOpen,
  bare = false,
  showBuildingComparison = true,
}: {
  room: AgendaRoom;
  onOpen: (roomId: string) => void;
  bare?: boolean;
  showBuildingComparison?: boolean;
}): JSX.Element {
  const label = bare ? room.name : displayRoomLabel(room.name, room.building.name, showBuildingComparison);
  return <button
    type="button"
    class="agenda-room-head"
    data-room-head={room.id}
    title={`${label} · show room details`}
    onClick={() => onOpen(room.id)}
  >
    <span class="agenda-room-label">{label}</span>
    <span class="agenda-room-info" aria-hidden="true">i</span>
  </button>;
}

function TrackChips({ session }: { session: AgendaSession }): JSX.Element {
  return <span class="agenda-track-chips">
    {session.tracks.map((track) => <Chip key={track.id}>{track.name}{track.is_primary ? " · Primary" : ""}</Chip>)}
  </span>;
}

export function SessionTile({
  snapshot,
  session,
  onDragStart,
  onResize,
  onRoomOpen,
  conflicts,
}: {
  snapshot: AgendaSnapshot;
  session: AgendaSession;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
}): JSX.Element {
  const format = snapshot.formats.find((candidate) => candidate.id === session.format_id);
  const hasConflict = conflicts.has(session.id);
  const hasDeclined = session.has_declined_participant === true;
  const location = displayRoomLabel(session.room, session.building, agendaShowsBuildingComparison(snapshot));
  return <article
    class={`agenda-session-tile${hasConflict ? " has-conflict" : ""}${hasDeclined ? " has-declined" : ""}`}
    draggable={session.kind !== "break"}
    data-session-id={session.id}
    style={{ borderLeftColor: session.kind === "break" ? "#64748b" : trackColor(snapshot, session) }}
    onDragStart={(event) => onDragStart({ kind: "session", id: session.id }, event as unknown as DragEvent)}
  >
    <strong title={session.title}>{session.title}</strong>
    <span class="agenda-tile-meta">{session.kind === "break" ? `${session.duration_min} min reservation` : `${session.format ?? "Session"} · ${speakerLine(session)}`}</span>
    <span class="agenda-tile-location">{location}</span>
    {session.kind !== "break" && <TrackChips session={session} />}
    <span class={`agenda-conflict-flag${hasConflict ? "" : " is-placeholder"}`} aria-hidden={!hasConflict} title={hasConflict ? "This placement needs attention" : undefined}>
      ⚠ {conflicts.get(session.id) ?? "Conflict"}
    </span>
    <span class={`agenda-decline-flag${hasDeclined ? "" : " is-placeholder"}`} aria-hidden={!hasDeclined} title={hasDeclined ? "A speaker role was declined" : undefined}>
      ⚑ Declined role
    </span>
    {session.kind !== "break" && <span class="agenda-tile-actions">
      <button type="button" aria-label={`Shorten ${session.title}`} disabled={Boolean(format && !durationIsAllowed(session.duration_min - 5, format))} onClick={(event) => { event.stopPropagation(); onResize(session, -5); }}>−</button>
      <span class="tabular">{session.duration_min}m</span>
      <button type="button" aria-label={`Lengthen ${session.title}`} disabled={Boolean(format && !durationIsAllowed(session.duration_min + 5, format))} onClick={(event) => { event.stopPropagation(); onResize(session, 5); }}>+</button>
    </span>}
    <button type="button" class="agenda-tile-room-link" onClick={() => onRoomOpen(session.room_id)}>{session.room}</button>
  </article>;
}

function DropCell({
  children,
  class: className = "",
  onDrop,
}: {
  children?: ComponentChildren;
  class?: string;
  onDrop: (event: DragEvent) => void;
}): JSX.Element {
  const [over, setOver] = useState(false);
  return <div
    class={`agenda-drop-cell ${over ? "drag-over" : ""} ${className}`.trim()}
    onDragOver={(event) => { event.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); onDrop(event as unknown as DragEvent); }}
  >{children}</div>;
}

function AgendaList({
  snapshot,
  sessions,
  conflicts,
  onDragStart,
  onResize,
  onRoomOpen,
  onClearFilters,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  conflicts: ConflictMarkers;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onRoomOpen: (roomId: string) => void;
  onClearFilters: () => void;
}): JSX.Element {
  return <div class="agenda-list" role="table" aria-label="Scheduled sessions">
    <div class="agenda-list-head" role="row"><span>Day</span><span>Time</span><span>Title</span><span>Speakers</span><span>Track</span><span>Room</span><span>Format</span></div>
    {sessions.length ? sessions.map((session) => <div
      class="agenda-list-row"
      role="row"
      key={session.id}
      data-session-id={session.id}
      draggable={session.kind !== "break"}
      onDragStart={(event) => onDragStart({ kind: "session", id: session.id }, event as unknown as DragEvent)}
    >
      <strong>{new Intl.DateTimeFormat("en-US", { timeZone: snapshot.event.timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(session.starts_at))}</strong>
      <span class="tabular">{sessionTime(session, snapshot.event.timezone)}</span>
      <div><strong title={session.title}>{session.title}</strong><span class="row-meta">{session.duration_min} minutes</span></div>
      <span title={speakerLine(session)}>{speakerLine(session)}</span>
      <span>{session.track ?? "—"}</span>
      <button type="button" class="agenda-list-room" onClick={() => onRoomOpen(session.room_id)}>{displayRoomLabel(session.room, session.building, agendaShowsBuildingComparison(snapshot))}</button>
      <div class="agenda-list-format">
        <span>{session.format ?? "Break"}</span>
        {session.kind !== "break" && <span class="agenda-list-actions">
          <button type="button" aria-label={`Shorten ${session.title}`} onClick={(event) => { event.stopPropagation(); onResize(session, -5); }}>−</button>
          <span class="tabular">{session.duration_min}m</span>
          <button type="button" aria-label={`Lengthen ${session.title}`} onClick={(event) => { event.stopPropagation(); onResize(session, 5); }}>+</button>
        </span>}
        <span class={`agenda-conflict-flag${conflicts.has(session.id) ? "" : " is-placeholder"}`} aria-hidden={!conflicts.has(session.id)} title={conflicts.has(session.id) ? "This placement needs attention" : undefined}>⚠ {conflicts.get(session.id) ?? "Conflict"}</span>
        <span class={`agenda-decline-flag${session.has_declined_participant ? "" : " is-placeholder"}`} aria-hidden={!session.has_declined_participant} title={session.has_declined_participant ? "A speaker role was declined" : undefined}>⚑ Declined role</span>
      </div>
    </div>) : <div class="agenda-list-empty"><strong>No scheduled Sessions match these filters.</strong><span>Clear the day or track filter to bring scheduled Sessions back into view.</span><Button small variant="primary" onClick={onClearFilters}>Clear filters</Button></div>}
  </div>;
}

function BuildingBand({ rooms }: { rooms: readonly AgendaRoom[] }): JSX.Element {
  const runs: Array<{ id: string; name: string; count: number }> = [];
  for (const room of rooms) {
    const id = room.building.id;
    const last = runs[runs.length - 1];
    if (last && last.id === id) last.count += 1;
    else runs.push({ id, name: room.building.name, count: 1 });
  }
  return <>
    <div class="agenda-building-band-spacer" aria-hidden="true" />
    {runs.map((run) => <div
      class="agenda-building-band"
      key={`${run.id}-${run.count}`}
      style={{ gridColumn: `span ${run.count}` }}
      title={run.name}
    >{run.name}</div>)}
  </>;
}

function DayBoard({
  snapshot,
  sessions,
  day,
  onDrop,
  onDragStart,
  onResize,
  onRoomOpen,
  conflicts,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  day: string;
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
}): JSX.Element {
  const showBuildingBand = agendaShowsBuildingComparison(snapshot);
  return <div class={`agenda-grid${showBuildingBand ? " has-building-band" : ""}`} style={{ gridTemplateColumns: `68px repeat(${Math.max(snapshot.rooms.length, 1)}, minmax(190px, 1fr))` }}>
    {showBuildingBand && <BuildingBand rooms={snapshot.rooms} />}
    <div class="agenda-grid-head agenda-time-head" />
    {snapshot.rooms.map((room) => <div class="agenda-grid-head" key={room.id}><RoomHead room={room} bare={showBuildingBand} showBuildingComparison={showBuildingBand} onOpen={onRoomOpen} /></div>)}
    {TIME_SLOTS.map((time) => <>
      <div class="agenda-time tabular" key={`${time}-label`}>{time}</div>
      {snapshot.rooms.map((room) => <DropCell
        class="agenda-day-cell"
        key={`${time}-${room.id}`}
        onDrop={(event) => onDrop(event, day, time, room.id)}
      >{sessions.filter((session) => session.room_id === room.id && sessionTime(session, snapshot.event.timezone) === time).map((session) => <SessionTile key={session.id} snapshot={snapshot} session={session} onDragStart={onDragStart} onResize={onResize} onRoomOpen={onRoomOpen} conflicts={conflicts} />)}</DropCell>)}
    </>)}
  </div>;
}

function WeekBoard({
  snapshot,
  sessions,
  days,
  onDrop,
  onDragStart,
  onResize,
  onRoomOpen,
  conflicts,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  days: DayOption[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
}): JSX.Element {
  const fallbackRoom = snapshot.rooms[0];
  return <div class="agenda-week-grid" style={{ gridTemplateColumns: `68px repeat(${Math.max(days.length, 1)}, minmax(240px, 1fr))` }}>
    <div class="agenda-grid-head agenda-time-head" />
    {days.map((day) => <div class="agenda-grid-head" key={day.value}>{day.label}</div>)}
    {TIME_SLOTS.map((time) => <>
      <div class="agenda-time tabular" key={`${time}-label`}>{time}</div>
      {days.map((day) => <DropCell key={`${day.value}-${time}`} class="agenda-week-cell" onDrop={(event) => { if (fallbackRoom) onDrop(event, day.value, time, fallbackRoom.id); }}>
        {sessions.filter((session) => sessionDay(session, snapshot.event.timezone) === day.value && sessionTime(session, snapshot.event.timezone) === time).map((session) => <SessionTile key={session.id} snapshot={snapshot} session={session} onDragStart={onDragStart} onResize={onResize} onRoomOpen={onRoomOpen} conflicts={conflicts} />)}
      </DropCell>)}
    </>)}
  </div>;
}

function RoomBoard({
  snapshot,
  sessions,
  days,
  onDrop,
  onDragStart,
  onResize,
  onRoomOpen,
  conflicts,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  days: DayOption[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
}): JSX.Element {
  const showBuildingComparison = agendaShowsBuildingComparison(snapshot);
  return <div class="agenda-room-board" style={{ gridTemplateColumns: `repeat(${Math.max(snapshot.rooms.length, 1)}, minmax(230px, 1fr))` }}>
    {snapshot.rooms.map((room) => <section class="agenda-room-lane" key={room.id}>
      <header><RoomHead room={room} showBuildingComparison={showBuildingComparison} onOpen={onRoomOpen} /></header>
      {days.map((day) => <div class="agenda-room-day" key={day.value}>
        <div class="agenda-day-label">{day.label}</div>
        {sessions.filter((session) => session.room_id === room.id && sessionDay(session, snapshot.event.timezone) === day.value).sort((left, right) => left.starts_at - right.starts_at).map((session) => <div key={session.id} class="agenda-room-session-wrap"><span class="tabular">{sessionTime(session, snapshot.event.timezone)}</span><SessionTile snapshot={snapshot} session={session} onDragStart={onDragStart} onResize={onResize} onRoomOpen={onRoomOpen} conflicts={conflicts} /></div>)}
        <DropCell class="agenda-room-empty" onDrop={(event) => onDrop(event, day.value, "16:00", room.id)}>Drop at 16:00</DropCell>
      </div>)}
    </section>)}
  </div>;
}

function RoomPanel({ room, showBuildingComparison, onClose }: { room: AgendaRoom; showBuildingComparison: boolean; onClose: () => void }): JSX.Element {
  const label = displayRoomLabel(room.name, room.building.name, showBuildingComparison);
  return <aside class="agenda-room-panel" role="dialog" aria-label={`${label} details`}>
    <header><div><span class="eyebrow">Room details</span><h2>{label}</h2></div><button type="button" aria-label="Close room details" onClick={onClose}>×</button></header>
    <div class="agenda-room-panel-body">
      <div class="agenda-panel-section"><span class="agenda-panel-label">Building</span><strong>{room.building.name}</strong><span>{room.building.address}</span></div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">Capacity</span><span class="tabular">{room.capacity.toLocaleString()} seats</span></div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">AV capability</span>{room.av_capabilities.length ? <div class="agenda-panel-tags">{room.av_capabilities.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div> : <span class="subtle">No AV equipment recorded</span>}</div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">Notes</span><p>{room.notes || "No room notes recorded."}</p></div>
    </div>
  </aside>;
}

export function ConflictPanel({ conflicts, sessions, showBuildingComparison = true, onClose, onJump }: { conflicts: AgendaConflict[]; sessions: AgendaSession[]; showBuildingComparison?: boolean; onClose: () => void; onJump: (sessionId: string) => void }): JSX.Element {
  const titleFor = (id: string) => sessions.find((session) => session.id === id)?.title ?? id;
  const visibleConflicts = visibleVenueConflicts(conflicts, showBuildingComparison);
  return <aside class="agenda-conflict-panel" role="dialog" aria-label="Agenda conflicts">
    <header><div><span class="eyebrow">Live detection</span><h2>Agenda conflicts · <span class="tabular">{visibleConflicts.length}</span></h2></div><button type="button" aria-label="Close conflicts" onClick={onClose}>×</button></header>
    <div class="agenda-conflict-list">{visibleConflicts.length ? visibleConflicts.map((conflict, index) => <section key={`${conflict.session_ids.join("-")}-${index}`}>
      <span class="agenda-conflict-icon">!</span><div><strong>{conflict.message}</strong><span>{titleFor(conflict.session_ids[0])} ↔ {titleFor(conflict.session_ids[1])}</span><button type="button" class="agenda-conflict-jump" data-conflict-jump={conflict.session_ids[0]} onClick={() => onJump(conflict.session_ids[0])}>Jump to Session</button></div>
    </section>) : <EmptyState title="No conflicts" copy="The schedule is clear for the current placements." />}</div>
  </aside>;
}

function Pool({
  snapshot,
  query,
  setQuery,
  track,
  onDragStart,
  onDrop,
}: {
  snapshot: AgendaSnapshot;
  query: string;
  setQuery: (value: string) => void;
  track: string;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}): JSX.Element {
  const pool = snapshot.unscheduled.filter((item) =>
    (!track || item.tracks.some((candidate) => candidate.id === track))
    && (!query.trim() || [item.title, item.format ?? "", ...item.speakers.map((speaker) => speaker.name)].some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),
  );
  return <aside class="card agenda-pool" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(event as unknown as DragEvent); }}>
    <header class="card-head"><div><h2>Unscheduled</h2><span class="subtle"><span class="tabular">{snapshot.unscheduled.length}</span> schedulable Sessions ready to place</span></div><Chip>Drag back here to unplace</Chip></header>
    <div class="agenda-pool-search"><input aria-label="Filter Sessions" value={query} placeholder="Filter Sessions" onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} /></div>
    <div class="agenda-pool-list">{pool.length ? pool.map((item) => <article key={item.submission_id} class="agenda-pool-item" draggable data-pool-id={item.submission_id} style={{ borderLeftColor: poolTrackColor(snapshot, item) }} onDragStart={(event) => onDragStart({ kind: "pool", id: item.submission_id }, event as unknown as DragEvent)}>
      <strong title={item.title}>{item.title}</strong><span>{item.format ?? "Session"} · {item.default_duration_min}m · {item.speakers[0]?.name ?? "No speaker"}</span><span class="agenda-track-chips">{item.tracks.map((candidate) => <Chip key={candidate.id}>{candidate.name}</Chip>)}</span>
    </article>) : <span class="subtle">Everything matching is scheduled.</span>}</div>
    <footer><span><span class="tabular">{pool.length}</span> matching Sessions</span><span>Drag →</span></footer>
  </aside>;
}

export function AgendaPage({ eventId = DEFAULT_EVENT_ID }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", snapshot: null });
  const [view, setView] = useState<AgendaView>("day");
  const [day, setDay] = useState("");
  const [track, setTrack] = useState("");
  const [poolQuery, setPoolQuery] = useState("");
  const [roomPanelId, setRoomPanelId] = useState<string | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<AgendaView, { top: number; left: number }>>>({});
  const dragPayload = useRef<DragPayload | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await apiFetch<AgendaSnapshot>(`/api/v1/events/${encodeURIComponent(eventId)}/agenda`, { signal, route: AGENDA_ROUTE });
      setState({ kind: "ready", snapshot });
      setDay((current) => current || dayOptions(snapshot)[0]?.value || "all");
    } catch (error: unknown) {
      if (signal?.aborted) return;
      setState((current) => ({ kind: "error", snapshot: current.snapshot, message: errorSummary(error) }));
    }
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useLayoutEffect(() => {
    const position = scrollPositions.current[view];
    if (boardRef.current && position) {
      boardRef.current.scrollTop = position.top;
      boardRef.current.scrollLeft = position.left;
    }
  }, [view, state.kind]);

  const rememberScroll = () => {
    if (boardRef.current) scrollPositions.current[view] = { top: boardRef.current.scrollTop, left: boardRef.current.scrollLeft };
  };

  const mutate = async (path: string, init: RequestInit, message: string, route = AGENDA_ITEM_ROUTE) => {
    await apiFetch<unknown>(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route });
    setNotice(message);
    await load();
  };

  const onDragStart = (payload: DragPayload, event: DragEvent) => {
    dragPayload.current = payload;
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const readDragPayload = (event: DragEvent): DragPayload | null => {
    const raw = event.dataTransfer?.getData("text/plain");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DragPayload;
        if ((parsed.kind === "pool" || parsed.kind === "session") && typeof parsed.id === "string") return parsed;
      } catch { /* The ref is the fallback for browsers that strip custom data. */ }
    }
    return dragPayload.current;
  };

  const onDrop = async (event: DragEvent, targetDay: string, targetTime: string, roomId: string, trackId?: string) => {
    const current = state.kind === "ready" ? state.snapshot : null;
    const payload = readDragPayload(event);
    if (!current || !payload) return;
    rememberScroll();
    try {
      const startsAt = zonedStart(targetDay, targetTime, current.event.timezone);
      if (payload.kind === "pool") {
        const item = current.unscheduled.find((candidate) => candidate.submission_id === payload.id);
        if (!item) return;
        const primaryTrack = item.tracks.find((candidate) => candidate.is_primary)?.id ?? item.tracks[0]?.id ?? null;
        await mutate(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, {
          method: "POST",
          body: JSON.stringify({ submission_id: item.submission_id, starts_at: startsAt, room_id: roomId, track_id: trackId ?? primaryTrack }),
        }, `${item.format ?? "Session"} placed · changes persist immediately`, AGENDA_ITEMS_ROUTE);
      } else {
        const session = current.sessions.find((candidate) => candidate.id === payload.id);
        if (!session) return;
        const body: Record<string, unknown> = { starts_at: startsAt, room_id: roomId };
        if (trackId) body.track_id = trackId;
        await mutate(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(session.id)}`, {
          method: "PATCH",
          headers: { "If-Match": session.etag },
          body: JSON.stringify(body),
        }, "Placement updated · no save button needed");
      }
    } catch (error: unknown) {
      setNotice(errorSummary(error));
    } finally {
      dragPayload.current = null;
    }
  };

  const onPoolDrop = async (event: DragEvent) => {
    const current = state.kind === "ready" ? state.snapshot : null;
    const payload = readDragPayload(event);
    if (!current || !payload || payload.kind !== "session") return;
    const session = current.sessions.find((candidate) => candidate.id === payload.id);
    if (!session || session.submission_id === null) return;
    try {
      await mutate(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
        headers: { "If-Match": session.etag },
      }, "Session returned to the unscheduled pool");
    } catch (error: unknown) {
      setNotice(errorSummary(error));
    } finally {
      dragPayload.current = null;
    }
  };

  const onResize = async (session: AgendaSession, delta: number) => {
    const current = state.kind === "ready" ? state.snapshot : null;
    if (!current) return;
    const format = current.formats.find((candidate) => candidate.id === session.format_id);
    const duration = session.duration_min + delta;
    if (!durationIsAllowed(duration, format ?? null)) return;
    try {
      await mutate(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "If-Match": session.etag },
        body: JSON.stringify({ duration_min: duration }),
      }, `${session.title} resized to ${duration} minutes`);
    } catch (error: unknown) {
      setNotice(errorSummary(error));
    }
  };

  if (state.kind === "loading" && !state.snapshot) return <div class="agenda-page"><PageHeader title="Agenda builder" copy="Place accepted Sessions directly into the conference schedule." /><div class="agenda-loading instrument" aria-busy="true"><span class="eyebrow">Agenda</span><strong>Reading the working schedule…</strong><span class="subtle">Loading Sessions, rooms, and placement metadata.</span></div></div>;
  if (!state.snapshot) return <div class="agenda-page"><PageHeader title="Agenda builder" copy="Place accepted Sessions directly into the conference schedule." /><EmptyState title="Agenda data unavailable" copy={state.message} action={<Button variant="primary" onClick={() => { setState({ kind: "loading", snapshot: null }); setReloadKey((value) => value + 1); }}>Try again</Button>} /></div>;

  const snapshot = state.snapshot;
  const days = dayOptions(snapshot);
  const selectedDay = day || days[0]?.value || "all";
  const visibleSessions = sessionsFor(snapshot, selectedDay, track);
  const conflicts = conflictMarkers(snapshot.conflicts);
  const showBuildingComparison = agendaShowsBuildingComparison(snapshot);
  const visibleConflictData = visibleVenueConflicts(snapshot.conflicts, showBuildingComparison);
  const presentationConflicts = showBuildingComparison ? conflicts : conflictMarkers(visibleConflictData);
  const headerBuilding = agendaBuildingHeader(snapshot);
  const activeRoom = roomPanelId ? roomFor(snapshot, roomPanelId) : undefined;
  const jumpToSession = (sessionId: string) => {
    const target = snapshot.sessions.find((session) => session.id === sessionId);
    if (!target) return;
    setView("track");
    setTrack("");
    setDay(sessionDay(target, snapshot.event.timezone));
    setConflictsOpen(false);
    window.requestAnimationFrame(() => {
      const tile = [...(boardRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? [])]
        .find((candidate) => candidate.dataset.sessionId === sessionId);
      tile?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    });
  };
  const renderBoard = () => {
    if (view === "list") return <AgendaList snapshot={snapshot} sessions={visibleSessions} conflicts={presentationConflicts} onDragStart={onDragStart} onResize={onResize} onRoomOpen={setRoomPanelId} onClearFilters={() => { setDay("all"); setTrack(""); }} />;
    if (view === "week") return <WeekBoard snapshot={snapshot} sessions={sessionsFor(snapshot, "all", track)} days={days} onDrop={onDrop} onDragStart={onDragStart} onResize={onResize} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} />;
    if (view === "room") return <RoomBoard snapshot={snapshot} sessions={sessionsFor(snapshot, "all", track)} days={selectedDay === "all" ? days : days.filter((candidate) => candidate.value === selectedDay)} onDrop={onDrop} onDragStart={onDragStart} onResize={onResize} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} />;
    if (view === "track") return <TrackBoard
      snapshot={snapshot}
      sessions={sessionsFor(snapshot, "all", track)}
      days={selectedDay === "all" ? days : days.filter((candidate) => candidate.value === selectedDay)}
      onDrop={onDrop}
      renderTile={(session) => <SessionTile key={session.id} snapshot={snapshot} session={session} onDragStart={onDragStart} onResize={onResize} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} />}
    />;
    const dayForBoard = selectedDay === "all" ? days[0]?.value ?? selectedDay : selectedDay;
    return <DayBoard snapshot={snapshot} sessions={sessionsFor(snapshot, dayForBoard, track)} day={dayForBoard} onDrop={onDrop} onDragStart={onDragStart} onResize={onResize} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} />;
  };

  return <div class="agenda-page">
    <PageHeader title="Agenda builder" copy={`${headerBuilding ? `${headerBuilding}. ` : ""}Drag accepted Sessions into a day, time, and room. Format defaults set duration; live conflicts warn without blocking.`} actions={<Button variant="danger" onClick={() => setConflictsOpen(true)}>⚠ <span class="tabular">{visibleConflictData.length}</span> conflicts</Button>} />
    <div class="agenda-toolbar card">
      <div class="segment agenda-view-tabs" role="tablist" aria-label="Agenda views">{viewNames().map((candidate) => <button type="button" role="tab" aria-selected={view === candidate} class={view === candidate ? "active" : ""} key={candidate} onClick={() => { rememberScroll(); setView(candidate); }}>{candidate[0]!.toUpperCase() + candidate.slice(1)}</button>)}</div>
      <label class="agenda-filter"><span class="eyebrow">Day</span><select value={selectedDay} onChange={(event) => { rememberScroll(); setDay((event.currentTarget as HTMLSelectElement).value); }}><option value="all">All days</option>{days.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <label class="agenda-filter"><span class="eyebrow">Track</span><select value={track} onChange={(event) => { rememberScroll(); setTrack((event.currentTarget as HTMLSelectElement).value); }}><option value="">All tracks</option>{snapshot.tracks.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
      <span class="toolbar-spacer" />
      <span class="subtle agenda-status-note">No save button · changes persist as you place</span>
    </div>
    {notice && <div class="agenda-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
    {snapshot.sessions.length === 0 && snapshot.unscheduled.length === 0
      ? <EmptyState title="No Sessions are ready for the agenda" copy="Accepted Sessions will appear here when the conference is ready to place them. Open the submission list to check the next candidates." action={<Button variant="primary" onClick={() => window.location.assign("/submissions?status=accepted")}>Open accepted submissions</Button>} />
      : <div class="agenda-layout">
        <Pool snapshot={snapshot} query={poolQuery} setQuery={setPoolQuery} track={track} onDragStart={onDragStart} onDrop={onPoolDrop} />
        <section class="card agenda-board" ref={boardRef} aria-label={`${view} agenda view`}>{renderBoard()}</section>
      </div>}
    {activeRoom && <RoomPanel room={activeRoom} showBuildingComparison={showBuildingComparison} onClose={() => setRoomPanelId(null)} />}
    {conflictsOpen && <ConflictPanel conflicts={snapshot.conflicts} sessions={snapshot.sessions} showBuildingComparison={showBuildingComparison} onClose={() => setConflictsOpen(false)} onJump={jumpToSession} />}
  </div>;
}

export { AGENDA_VIEWS };

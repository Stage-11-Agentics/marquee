/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type {
  AgendaCalendarDebt,
  AgendaCalendarSpeaker,
  AgendaConflict,
  AgendaPoolItem,
  AgendaPublication,
  AgendaPublishCandidate,
  AgendaRoom,
  AgendaSession,
  AgendaSnapshot,
  AgendaView,
} from "../../api/agenda";
import { AGENDA_VIEWS, durationIsAllowed, MAX_BATCH_PUBLISH_IDS, viewNames } from "../../api/agenda";
import { autoPlaceSummary, planAutoPlacements, type AutoPlaceSlot } from "../../lib/auto-place";
import { zonedStart } from "../../lib/event-time";
import { isVisibleToAudience, PUBLIC_SPEAKER_EMPTY_LABEL } from "../../lib/participants";
import {
  AGENDA_GRID_OPTIONS,
  agendaGridPosition,
  DEFAULT_AGENDA_GRID_GRANULARITY,
  generateAgendaGridSlots,
  readAgendaGridGranularity,
  writeAgendaGridGranularity,
  type AgendaGridGranularity,
  type AgendaGridSlot,
} from "../../lib/agenda-grid";
import { displayRoomLabel, showsBuildingComparison, showsBuildingComparisonCount, visibleVenueConflicts } from "../../lib/venue-disclosure";
import { conferenceDays } from "../../lib/conference-dates";
import { apiFetch, errorSummary } from "../shell/api-client";
import { AgentBriefLauncher } from "../shell/AgentBrief";
import { Button, Chip, EmptyState, PageHeader } from "../shell/components";
import { orderNewestFirst } from "../shell/wide-grid";
import { DemandPanel } from "./DemandPanel";
import { sessionDay, sessionTime, TrackBoard } from "./track-board";
import "./agenda.css";

export { zonedStart } from "../../lib/event-time";

const AGENDA_ROUTE = "/api/v1/events/{eventId}/agenda";
const AGENDA_ITEMS_ROUTE = "/api/v1/events/{eventId}/agenda/items";
const AGENDA_ITEM_ROUTE = "/api/v1/events/{eventId}/agenda/items/{itemId}";
const AGENDA_PUBLISH_ROUTE = "/api/v1/events/{eventId}/agenda/publish";

interface Props {
  eventId: string;
}

interface DayOption {
  value: string;
  label: string;
}

type LoadState =
  | { kind: "loading"; snapshot: null }
  | { kind: "ready"; snapshot: AgendaSnapshot }
  | { kind: "error"; snapshot: AgendaSnapshot | null; message: string };

interface PublicationNotice {
  count: number;
  publicAgendaUrl: string;
}

export type AgendaPlacementPayload =
  | { kind: "pool"; id: string }
  | { kind: "session"; id: string };

type DragPayload = AgendaPlacementPayload;

export interface AgendaPlacementTarget {
  day: string;
  time: string;
  roomId: string;
  trackId?: string;
}

export interface AgendaPlacementRequest {
  path: string;
  init: RequestInit;
  message: string;
  route: string;
}

interface ArmedPlacement {
  payload: AgendaPlacementPayload;
  title: string;
}

function dayOptions(snapshot: AgendaSnapshot): DayOption[] {
  return conferenceDays(snapshot.event.starts_on, snapshot.event.ends_on)
    .map((day) => ({ value: day.id, label: day.label.replace(", ", " · ") }));
}

/**
 * The API write behind both drag-and-drop and click-to-place. Keeping this
 * conversion independent of the gesture means both paths retain the agenda
 * route's persistence, conflict, audit, and optimistic-concurrency behaviour.
 */
export function agendaPlacementRequest(
  snapshot: AgendaSnapshot,
  payload: AgendaPlacementPayload,
  target: AgendaPlacementTarget,
  eventId: string,
): AgendaPlacementRequest | null {
  const startsAt = zonedStart(target.day, target.time, snapshot.event.timezone);
  if (payload.kind === "pool") {
    const item = snapshot.unscheduled.find((candidate) => candidate.submission_id === payload.id);
    if (!item) return null;
    const primaryTrack = item.tracks.find((candidate) => candidate.is_primary)?.id ?? item.tracks[0]?.id ?? null;
    return {
      path: `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`,
      init: {
        method: "POST",
        body: JSON.stringify({
          submission_id: item.submission_id,
          starts_at: startsAt,
          room_id: target.roomId,
          track_id: target.trackId ?? primaryTrack,
        }),
      },
      message: `${item.format ?? "Session"} placed · changes persist immediately`,
      route: AGENDA_ITEMS_ROUTE,
    };
  }

  const session = snapshot.sessions.find((candidate) => candidate.id === payload.id);
  if (!session) return null;
  const body: Record<string, unknown> = { starts_at: startsAt, room_id: target.roomId };
  if (target.trackId) body.track_id = target.trackId;
  return {
    path: `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(session.id)}`,
    init: {
      method: "PATCH",
      headers: { "If-Match": session.etag },
      body: JSON.stringify(body),
    },
    message: "Placement updated · no save button needed",
    route: AGENDA_ITEM_ROUTE,
  };
}

/** Every opening the organizer could drag into, in the order the board lays them out. */
export function autoPlaceSlots(
  snapshot: AgendaSnapshot,
  granularity: unknown = DEFAULT_AGENDA_GRID_GRANULARITY,
): AutoPlaceSlot[] {
  const slots: AutoPlaceSlot[] = [];
  const gridSlots = generateAgendaGridSlots(granularity);
  for (const day of dayOptions(snapshot)) {
    for (const slot of gridSlots) {
      slots.push({ day: day.value, time: slot.time, starts_at: zonedStart(day.value, slot.time, snapshot.event.timezone) });
    }
  }
  return slots;
}

function speakerLine(session: AgendaSession): string {
  return session.speakers.length ? session.speakers.map((speaker) => speaker.name).join(" · ") : "No speakers listed";
}

function publicationDateTime(candidate: AgendaPublishCandidate, timezone: string): string {
  if (!candidate.scheduled || candidate.starts_at === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(candidate.starts_at));
}

export function hasPublicSpeaker(candidate: AgendaPublishCandidate): boolean {
  return candidate.speakers.some((speaker) =>
    speaker.role === undefined || isVisibleToAudience(speaker.role, "public"));
}

function publicationSpeakerLine(candidate: AgendaPublishCandidate): string {
  const hasOnStageParticipant = hasPublicSpeaker(candidate);
  return hasOnStageParticipant
    ? candidate.speakers.map((speaker) => speaker.name).join(" · ")
    : PUBLIC_SPEAKER_EMPTY_LABEL;
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

export type AgendaConflictDetails = ReadonlyMap<string, readonly AgendaConflict[]>;

/** Project the server's conflict pairs onto each affected Session without redetecting them. */
export function conflictDetailsBySession(conflicts: readonly AgendaConflict[]): AgendaConflictDetails {
  const details = new Map<string, AgendaConflict[]>();
  for (const conflict of conflicts) {
    for (const sessionId of conflict.session_ids) {
      const current = details.get(sessionId) ?? [];
      details.set(sessionId, [...current, conflict]);
    }
  }
  return details;
}

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

export function orderedAgendaRooms(rooms: readonly AgendaRoom[]): AgendaRoom[] {
  return orderNewestFirst(rooms, (room) => room.position ?? 0);
}

function conflictCounterpartId(sessionId: string, conflict: AgendaConflict): string {
  return conflict.session_ids[0] === sessionId ? conflict.session_ids[1] : conflict.session_ids[0];
}

function conflictPersonName(session: AgendaSession, counterpart: AgendaSession | undefined, conflict: AgendaConflict): string | null {
  if (!conflict.person_id) return null;
  return [...session.speakers, ...(counterpart?.speakers ?? [])].find((speaker) => speaker.id === conflict.person_id)?.name ?? null;
}

function conflictBadgeLabel(session: AgendaSession, conflict: AgendaConflict, sessions: readonly AgendaSession[]): string {
  const counterpart = sessions.find((candidate) => candidate.id === conflictCounterpartId(session.id, conflict));
  const person = conflictPersonName(session, counterpart, conflict);
  const kind = conflict.kind === "transit" ? "Transit" : "Conflict";
  return `${kind}${person ? ` · ${person}` : ""} · with ${counterpart?.title ?? "another Session"}`;
}

function conflictBadgeTitle(session: AgendaSession, conflicts: readonly AgendaConflict[], sessions: readonly AgendaSession[]): string {
  return conflicts.map((conflict) => {
    const counterpart = sessions.find((candidate) => candidate.id === conflictCounterpartId(session.id, conflict));
    return `${conflict.message} · ${counterpart?.title ?? "another Session"}`;
  }).join(" · ");
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
  sessions = snapshot.sessions,
  onDragStart,
  onResize,
  onMove,
  onUnplace,
  onRoomOpen,
  conflicts,
  conflictsBySession,
  conflictFocus = null,
  onConflictFocus,
}: {
  snapshot: AgendaSnapshot;
  session: AgendaSession;
  sessions?: readonly AgendaSession[];
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onMove: (session: AgendaSession) => void;
  onUnplace: (session: AgendaSession) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
  conflictsBySession?: AgendaConflictDetails;
  conflictFocus?: string | null;
  onConflictFocus?: (sessionId: string | null) => void;
}): JSX.Element {
  const format = snapshot.formats.find((candidate) => candidate.id === session.format_id);
  const sessionConflicts = conflictsBySession?.get(session.id) ?? [];
  const hasConflict = conflicts.has(session.id) || sessionConflicts.length > 0;
  const counterpartIds = sessionConflicts.map((conflict) => conflictCounterpartId(session.id, conflict));
  const conflictLabel = sessionConflicts.length
    ? `${conflictBadgeLabel(session, sessionConflicts[0]!, sessions)}${sessionConflicts.length > 1 ? ` +${sessionConflicts.length - 1}` : ""}`
    : conflicts.get(session.id) ?? "Conflict";
  const conflictTitle = sessionConflicts.length ? conflictBadgeTitle(session, sessionConflicts, sessions) : undefined;
  const hasDeclined = session.has_declined_participant === true;
  const location = displayRoomLabel(session.room, session.building, agendaShowsBuildingComparison(snapshot));
  return <article
    class={`agenda-session-tile${hasConflict ? " has-conflict" : ""}${conflictFocus === session.id ? " is-conflict-focus" : ""}${conflictFocus !== null && counterpartIds.includes(conflictFocus) ? " is-conflict-counterpart" : ""}${hasDeclined ? " has-declined" : ""}`}
    draggable={session.kind !== "break"}
    data-session-id={session.id}
    aria-label={`${session.title} · ${sessionTime(session, snapshot.event.timezone)} · ${location}${conflictTitle ? ` · ${conflictTitle}` : ""}`}
    tabIndex={hasConflict ? 0 : undefined}
    style={{ borderLeftColor: session.kind === "break" ? "var(--break-tint)" : trackColor(snapshot, session) }}
    onDragStart={(event) => onDragStart({ kind: "session", id: session.id }, event as unknown as DragEvent)}
    onMouseEnter={() => { if (hasConflict) onConflictFocus?.(session.id); }}
    onMouseLeave={() => { if (hasConflict) onConflictFocus?.(null); }}
    onFocus={() => { if (hasConflict) onConflictFocus?.(session.id); }}
    onBlur={() => { if (hasConflict) onConflictFocus?.(null); }}
  >
    <strong title={session.title}>{session.title}</strong>
    <span class="agenda-tile-meta">{session.kind === "break" ? `${session.duration_min} min reservation` : `${session.format ?? "Session"} · ${speakerLine(session)}`}</span>
    <span class="agenda-tile-location">{location}</span>
    {session.kind !== "break" && <TrackChips session={session} />}
    <span class={`agenda-conflict-flag${hasConflict ? "" : " is-placeholder"}`} aria-hidden={!hasConflict} title={conflictTitle ?? (hasConflict ? "This placement needs attention" : undefined)}>
      ⚠ {conflictLabel}
    </span>
    <span class={`agenda-decline-flag${hasDeclined ? "" : " is-placeholder"}`} aria-hidden={!hasDeclined} title={hasDeclined ? "A speaker role was declined" : undefined}>
      ⚑ Declined role
    </span>
    {session.kind !== "break" && <span class="agenda-tile-actions">
      <button type="button" aria-label={`Shorten ${session.title}`} disabled={Boolean(format && !durationIsAllowed(session.duration_min - 5, format))} onClick={(event) => { event.stopPropagation(); onResize(session, -5); }}>−</button>
      <span class="tabular">{session.duration_min}m</span>
      <button type="button" aria-label={`Lengthen ${session.title}`} disabled={Boolean(format && !durationIsAllowed(session.duration_min + 5, format))} onClick={(event) => { event.stopPropagation(); onResize(session, 5); }}>+</button>
    </span>}
    {session.kind !== "break" && session.submission_id !== null && <span class="agenda-tile-placement-actions">
      <button type="button" aria-label={`Move ${session.title}`} onClick={(event) => { event.stopPropagation(); onMove(session); }}>Move…</button>
      <button type="button" aria-label={`Unplace ${session.title}`} onClick={(event) => { event.stopPropagation(); onUnplace(session); }}>Unplace</button>
    </span>}
    <button type="button" class="agenda-tile-room-link" onClick={() => onRoomOpen(session.room_id)}>{session.room}</button>
  </article>;
}

function DropCell({
  children,
  class: className = "",
  ariaLabel,
  onDrop,
  placementLabel,
  onPlace,
  placementBusy = false,
}: {
  children?: ComponentChildren;
  class?: string;
  ariaLabel: string;
  onDrop: (event: DragEvent) => void;
  placementLabel?: string;
  onPlace?: () => void;
  placementBusy?: boolean;
}): JSX.Element {
  const [over, setOver] = useState(false);
  return <div
    class={`agenda-drop-cell ${over ? "drag-over" : ""}${placementLabel ? " is-placement-target" : ""} ${className}`.trim()}
    role="group"
    aria-label={ariaLabel}
    data-agenda-drop-target="true"
    onDragOver={(event) => { event.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); onDrop(event as unknown as DragEvent); }}
  >{placementLabel && onPlace
    ? <button type="button" class="agenda-place-cell" aria-label={placementLabel} disabled={placementBusy} onClick={onPlace}>{placementBusy ? "Placing…" : placementLabel}</button>
    : children}</div>;
}

function PositionedSession({
  session,
  timezone,
  slots,
  children,
}: {
  session: AgendaSession;
  timezone: string;
  slots: readonly AgendaGridSlot[];
  children: ComponentChildren;
}): JSX.Element | null {
  const position = agendaGridPosition(sessionTime(session, timezone), slots);
  if (!position) return null;
  return <div
    class="agenda-session-position"
    style={{ top: `${position.offsetRatio * 100}%` }}
  >{children}</div>;
}

function roomSlotIsFree(
  snapshot: AgendaSnapshot,
  day: string,
  time: string,
  roomId: string,
  slots: readonly AgendaGridSlot[],
): boolean {
  const targetStart = zonedStart(day, time, snapshot.event.timezone);
  return !snapshot.sessions.some((session) =>
    session.room_id === roomId
    && (
      (sessionDay(session, snapshot.event.timezone) === day
        && agendaGridPosition(sessionTime(session, snapshot.event.timezone), slots)?.slot.time === time)
      || (session.starts_at <= targetStart
        && session.starts_at + session.duration_min * 60_000 > targetStart)
    ),
  );
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

export function DayBoard({
  snapshot,
  sessions,
  day,
  slots = generateAgendaGridSlots(),
  onDrop,
  onPlace,
  armedPlacement,
  placementBusy,
  onDragStart,
  onResize,
  onMove,
  onUnplace,
  onRoomOpen,
  conflicts,
  conflictDetails,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  day: string;
  slots?: readonly AgendaGridSlot[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onPlace: (target: AgendaPlacementTarget) => void;
  armedPlacement: ArmedPlacement | null;
  placementBusy: boolean;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onMove: (session: AgendaSession) => void;
  onUnplace: (session: AgendaSession) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
  conflictDetails?: AgendaConflictDetails;
}): JSX.Element {
  const showBuildingBand = agendaShowsBuildingComparison(snapshot);
  const rooms = orderedAgendaRooms(snapshot.rooms);
  const conflictsBySession = conflictDetails ?? conflictDetailsBySession(snapshot.conflicts);
  const [conflictFocus, setConflictFocus] = useState<string | null>(null);
  return <>
    <div class="agenda-grid-scroll-note" aria-live="polite"><strong class="tabular">{rooms.length}</strong><span>rooms · newest first{rooms.length > 4 ? " · scroll for more" : ""}</span></div>
    <div class={`agenda-grid wide-grid-content${showBuildingBand ? " has-building-band" : ""}`} data-room-order="newest-first" style={{ gridTemplateColumns: `68px repeat(${Math.max(rooms.length, 1)}, minmax(190px, 1fr))` }}>
      {showBuildingBand && <BuildingBand rooms={rooms} />}
      <div class="agenda-grid-head agenda-time-head" />
      {rooms.map((room) => <div class="agenda-grid-head" key={room.id}><RoomHead room={room} bare={showBuildingBand} showBuildingComparison={showBuildingBand} onOpen={onRoomOpen} /></div>)}
      {slots.map((slot) => <>
        <div class={`agenda-time tabular${slot.isHour ? "" : " is-micro"}`} key={`${slot.time}-label`} aria-label={slot.time}>
          {slot.isHour ? slot.time : <span class="agenda-time-micro-tick" aria-hidden="true" />}
        </div>
        {rooms.map((room) => {
          const cellSessions = sessions.filter((session) => session.room_id === room.id && agendaGridPosition(sessionTime(session, snapshot.event.timezone), slots)?.slot.time === slot.time);
          const placementLabel = armedPlacement && roomSlotIsFree(snapshot, day, slot.time, room.id, slots)
            ? `Place at ${slot.time} · ${room.name}`
            : undefined;
          return <DropCell
            class="agenda-day-cell"
            key={`${slot.time}-${room.id}`}
            ariaLabel={`Place Session on ${day} at ${slot.time} in ${room.name}`}
            onDrop={(event) => onDrop(event, day, slot.time, room.id)}
            placementLabel={placementLabel}
            placementBusy={placementBusy}
            onPlace={placementLabel ? () => onPlace({ day, time: slot.time, roomId: room.id }) : undefined}
          >{cellSessions.map((session) => <PositionedSession key={session.id} session={session} timezone={snapshot.event.timezone} slots={slots}>
            <SessionTile snapshot={snapshot} session={session} sessions={snapshot.sessions} conflictsBySession={conflictsBySession} conflictFocus={conflictFocus} onConflictFocus={setConflictFocus} onDragStart={onDragStart} onResize={onResize} onMove={onMove} onUnplace={onUnplace} onRoomOpen={onRoomOpen} conflicts={conflicts} />
          </PositionedSession>)}</DropCell>;
        })}
      </>)}
    </div>
  </>;
}

export function AgendaDayStatus({ snapshot, day }: { snapshot: AgendaSnapshot; day: string }): JSX.Element {
  const empty = day !== "all" && !snapshot.sessions.some((session) =>
    session.kind === "session" && sessionDay(session, snapshot.event.timezone) === day,
  );
  return <div class={`agenda-day-window-status${empty ? " is-empty" : ""}`} role={empty ? "status" : undefined} aria-live="polite" aria-atomic="true">
    {empty && <><strong>Nothing scheduled on this day yet</strong><span>Choose another day, or place a Session here from the unscheduled pool.</span></>}
  </div>;
}

export function WeekBoard({
  snapshot,
  sessions,
  days,
  slots = generateAgendaGridSlots(),
  onDrop,
  onPlace,
  armedPlacement,
  placementBusy,
  onDragStart,
  onResize,
  onMove,
  onUnplace,
  onRoomOpen,
  conflicts,
  conflictDetails,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  days: DayOption[];
  slots?: readonly AgendaGridSlot[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onPlace: (target: AgendaPlacementTarget) => void;
  armedPlacement: ArmedPlacement | null;
  placementBusy: boolean;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onMove: (session: AgendaSession) => void;
  onUnplace: (session: AgendaSession) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
  conflictDetails?: AgendaConflictDetails;
}): JSX.Element {
  const fallbackRoom = snapshot.rooms[0];
  const conflictsBySession = conflictDetails ?? conflictDetailsBySession(snapshot.conflicts);
  const [conflictFocus, setConflictFocus] = useState<string | null>(null);
  return <div class="agenda-week-grid" style={{ gridTemplateColumns: `68px repeat(${Math.max(days.length, 1)}, minmax(240px, 1fr))` }}>
    <div class="agenda-grid-head agenda-time-head" />
    {days.map((day) => <div class="agenda-grid-head" key={day.value}>{day.label}</div>)}
    {slots.map((slot) => <>
      <div class={`agenda-time tabular${slot.isHour ? "" : " is-micro"}`} key={`${slot.time}-label`} aria-label={slot.time}>
        {slot.isHour ? slot.time : <span class="agenda-time-micro-tick" aria-hidden="true" />}
      </div>
      {days.map((day) => {
        const cellSessions = sessions.filter((session) => sessionDay(session, snapshot.event.timezone) === day.value && agendaGridPosition(sessionTime(session, snapshot.event.timezone), slots)?.slot.time === slot.time);
        const placementLabel = armedPlacement && fallbackRoom && roomSlotIsFree(snapshot, day.value, slot.time, fallbackRoom.id, slots)
          ? `Place at ${slot.time} · ${fallbackRoom.name}`
          : undefined;
        return <DropCell
          key={`${day.value}-${slot.time}`}
          class="agenda-week-cell"
          ariaLabel={`Place Session on ${day.label} at ${slot.time}${fallbackRoom ? ` in ${fallbackRoom.name}` : ""}`}
          onDrop={(event) => { if (fallbackRoom) onDrop(event, day.value, slot.time, fallbackRoom.id); }}
          placementLabel={placementLabel}
          placementBusy={placementBusy}
          onPlace={placementLabel && fallbackRoom ? () => onPlace({ day: day.value, time: slot.time, roomId: fallbackRoom.id }) : undefined}
        >{cellSessions.map((session) => <PositionedSession key={session.id} session={session} timezone={snapshot.event.timezone} slots={slots}>
          <SessionTile snapshot={snapshot} session={session} sessions={snapshot.sessions} conflictsBySession={conflictsBySession} conflictFocus={conflictFocus} onConflictFocus={setConflictFocus} onDragStart={onDragStart} onResize={onResize} onMove={onMove} onUnplace={onUnplace} onRoomOpen={onRoomOpen} conflicts={conflicts} />
        </PositionedSession>)}</DropCell>;
      })}
    </>)}
  </div>;
}

export function RoomBoard({
  snapshot,
  sessions,
  days,
  slots = generateAgendaGridSlots(),
  onDrop,
  onPlace,
  armedPlacement,
  placementBusy,
  onDragStart,
  onResize,
  onMove,
  onUnplace,
  onRoomOpen,
  conflicts,
  conflictDetails,
}: {
  snapshot: AgendaSnapshot;
  sessions: AgendaSession[];
  days: DayOption[];
  slots?: readonly AgendaGridSlot[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string) => void;
  onPlace: (target: AgendaPlacementTarget) => void;
  armedPlacement: ArmedPlacement | null;
  placementBusy: boolean;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onResize: (session: AgendaSession, delta: number) => void;
  onMove: (session: AgendaSession) => void;
  onUnplace: (session: AgendaSession) => void;
  onRoomOpen: (roomId: string) => void;
  conflicts: ConflictMarkers;
  conflictDetails?: AgendaConflictDetails;
}): JSX.Element {
  const showBuildingComparison = agendaShowsBuildingComparison(snapshot);
  const rooms = orderedAgendaRooms(snapshot.rooms);
  const conflictsBySession = conflictDetails ?? conflictDetailsBySession(snapshot.conflicts);
  const [conflictFocus, setConflictFocus] = useState<string | null>(null);
  return <div class="agenda-room-board wide-grid-content" data-room-order="newest-first" style={{ gridTemplateColumns: `repeat(${Math.max(rooms.length, 1)}, minmax(230px, 1fr))` }}>
    {rooms.map((room) => <section class="agenda-room-lane" key={room.id}>
      <header><RoomHead room={room} showBuildingComparison={showBuildingComparison} onOpen={onRoomOpen} /></header>
      {days.map((day) => <div class="agenda-room-day" key={day.value}>
        <div class="agenda-day-label">{day.label}</div>
        {sessions.filter((session) => session.room_id === room.id && sessionDay(session, snapshot.event.timezone) === day.value).sort((left, right) => left.starts_at - right.starts_at).map((session) => <div key={session.id} class="agenda-room-session-wrap"><span class="tabular">{sessionTime(session, snapshot.event.timezone)}</span><SessionTile snapshot={snapshot} session={session} sessions={snapshot.sessions} conflictsBySession={conflictsBySession} conflictFocus={conflictFocus} onConflictFocus={setConflictFocus} onDragStart={onDragStart} onResize={onResize} onMove={onMove} onUnplace={onUnplace} onRoomOpen={onRoomOpen} conflicts={conflicts} /></div>)}
        <div class="agenda-room-slots" aria-label={`Available times in ${room.name} on ${day.label}`}>
          {slots.map((slot) => {
            const placementLabel = armedPlacement && roomSlotIsFree(snapshot, day.value, slot.time, room.id, slots)
              ? `Place at ${slot.time} · ${room.name}`
              : undefined;
            return <DropCell
              class="agenda-room-empty"
              key={slot.time}
              ariaLabel={`Place Session on ${day.label} in ${room.name} at ${slot.time}`}
              onDrop={(event) => onDrop(event, day.value, slot.time, room.id)}
              placementLabel={placementLabel}
              placementBusy={placementBusy}
              onPlace={placementLabel ? () => onPlace({ day: day.value, time: slot.time, roomId: room.id }) : undefined}
            >{slot.isHour ? `Drop at ${slot.time}` : <span class="agenda-room-micro-tick" aria-hidden="true" />}</DropCell>;
          })}
        </div>
      </div>)}
    </section>)}
  </div>;
}

/**
 * Escape and a click outside both close a floating agenda panel.
 *
 * These panels are `position: fixed` over the top-right of the builder, which
 * is where the publication controls live. With no key and no click-outside, the
 * only way past one was a small × in its corner: Escape did nothing, scrolling
 * did nothing (fixed, by design), and every click aimed at the panel underneath
 * landed on the floating layer instead — so opening Room details made publish
 * unreachable. A layer with exactly one exit is a layer that traps the operator
 * on the screen it is covering.
 */
function useDismissablePanel(onClose: () => void): { current: HTMLElement | null } {
  const panel = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    const onPointerDown = (event: MouseEvent) => {
      const node = panel.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) close.current();
    };
    document.addEventListener("keydown", onKey);
    // On mousedown rather than click, so the same gesture that dismisses the
    // panel still reaches the control the operator was aiming at.
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);
  return panel;
}

function RoomPanel({ room, showBuildingComparison, onClose }: { room: AgendaRoom; showBuildingComparison: boolean; onClose: () => void }): JSX.Element {
  const label = displayRoomLabel(room.name, room.building.name, showBuildingComparison);
  const panel = useDismissablePanel(onClose);
  return <aside class="agenda-room-panel" role="dialog" aria-label={`${label} details`} ref={panel as never}>
    <header><div><span class="eyebrow">Room details</span><h2>{label}</h2></div><button type="button" aria-label="Close room details" onClick={onClose}>×</button></header>
    <div class="agenda-room-panel-body">
      <div class="agenda-panel-section"><span class="agenda-panel-label">Building</span><strong>{room.building.name}</strong><span>{room.building.address}</span></div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">Capacity</span><span class="tabular">{room.capacity.toLocaleString()} seats</span></div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">AV capability</span>{room.av_capabilities.length ? <div class="agenda-panel-tags">{room.av_capabilities.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div> : <span class="subtle">No AV equipment recorded</span>}</div>
      <div class="agenda-panel-section"><span class="agenda-panel-label">Notes</span><p>{room.notes || "No room notes recorded."}</p></div>
    </div>
  </aside>;
}

export function ConflictCounter({ count, open, onOpen, children }: { count: number; open: boolean; onOpen: () => void; children?: ComponentChildren }): JSX.Element {
  return <Button
    type="button"
    variant="danger"
    data-conflict-counter="true"
    aria-controls="agenda-conflicts-panel"
    aria-expanded={open}
    aria-label={`Open live agenda conflict details · ${count} active`}
    title="Open live agenda conflict details"
    onClick={onOpen}
  >{children ?? <>⚠ <span class="tabular">{count}</span> conflicts</>}</Button>;
}

export function ConflictPanel({ conflicts, sessions, showBuildingComparison = true, onClose, onJump }: { conflicts: AgendaConflict[]; sessions: AgendaSession[]; showBuildingComparison?: boolean; onClose: () => void; onJump: (sessionId: string) => void }): JSX.Element {
  const titleFor = (id: string) => sessions.find((session) => session.id === id)?.title ?? id;
  const visibleConflicts = visibleVenueConflicts(conflicts, showBuildingComparison);
  const panel = useDismissablePanel(onClose);
  return <aside id="agenda-conflicts-panel" class="agenda-conflict-panel" role="dialog" aria-label="Agenda conflicts" ref={panel as never}>
    <header><div><span class="eyebrow">Live detection</span><h2>Agenda conflicts · <span class="tabular">{visibleConflicts.length}</span></h2></div><button type="button" aria-label="Close conflicts" onClick={onClose}>×</button></header>
    <div class="agenda-conflict-list">{visibleConflicts.length ? visibleConflicts.map((conflict, index) => <section key={`${conflict.session_ids.join("-")}-${index}`}>
      <span class="agenda-conflict-icon">!</span><div><strong>{conflict.message}</strong><span>{titleFor(conflict.session_ids[0])} ↔ {titleFor(conflict.session_ids[1])}</span><button type="button" class="agenda-conflict-jump" data-conflict-jump={conflict.session_ids[0]} onClick={() => onJump(conflict.session_ids[0])}>Jump to Session</button></div>
    </section>) : <EmptyState title="No conflicts" copy="The schedule is clear for the current placements." />}</div>
  </aside>;
}

export function Pool({
  snapshot,
  query,
  setQuery,
  track,
  onDragStart,
  onDrop,
  onArm,
  armedPlacement,
}: {
  snapshot: AgendaSnapshot;
  query: string;
  setQuery: (value: string) => void;
  track: string;
  onDragStart: (payload: DragPayload, event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onArm: (item: AgendaPoolItem) => void;
  armedPlacement: ArmedPlacement | null;
}): JSX.Element {
  const pool = snapshot.unscheduled.filter((item) =>
    (!track || item.tracks.some((candidate) => candidate.id === track))
    && (!query.trim() || [item.title, item.format ?? "", ...item.speakers.map((speaker) => speaker.name)].some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),
  );
  return <aside class="card agenda-pool" aria-label="Unscheduled sessions to place" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(event as unknown as DragEvent); }}>
    <header class="card-head"><div><h2>Unscheduled</h2><span class="subtle"><span class="tabular">{snapshot.unscheduled.length}</span> schedulable Sessions ready to place</span></div><Chip>{armedPlacement ? "Choose an open cell" : "Drag back here to unplace"}</Chip></header>
    <div class="agenda-pool-search"><input aria-label="Filter Sessions" value={query} placeholder="Filter Sessions" onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} /></div>
    <div class="agenda-pool-list" role="list" aria-label="Accepted sessions not yet placed">{pool.length ? pool.map((item) => {
      const isArmed = armedPlacement?.payload.kind === "pool" && armedPlacement.payload.id === item.submission_id;
      return <article key={item.submission_id} class={`agenda-pool-item${isArmed ? " is-armed" : ""}`} role="listitem" aria-label={`${item.title} · ${item.format ?? "Session"} · ${item.speakers[0]?.name ?? "No speaker"}`} draggable data-pool-id={item.submission_id} style={{ borderLeftColor: poolTrackColor(snapshot, item) }} onDragStart={(event) => onDragStart({ kind: "pool", id: item.submission_id }, event as unknown as DragEvent)}>
        <button type="button" class="agenda-pool-place" aria-label={isArmed ? `Placing ${item.title}` : `Place ${item.title}`} aria-pressed={isArmed} onClick={() => onArm(item)}>
          <strong title={item.title}>{item.title}</strong><span>{item.format ?? "Session"} · {item.default_duration_min}m · {item.speakers[0]?.name ?? "No speaker"}</span><span class="agenda-track-chips">{item.tracks.map((candidate) => <Chip key={candidate.id}>{candidate.name}</Chip>)}</span>
        </button>
      </article>;
    }) : <span class="subtle">Everything matching is scheduled.</span>}</div>
    <footer><span><span class="tabular">{pool.length}</span> matching Sessions</span><span>Drag or select →</span></footer>
  </aside>;
}

type PublicationStep = "select" | "review";

export function PublicationCandidateRow({
  candidate,
  timezone,
  selected,
  disabled = false,
  onToggle,
  review = false,
}: {
  candidate: AgendaPublishCandidate;
  timezone: string;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: (id: string) => void;
  review?: boolean;
}): JSX.Element {
  const blockedReason = candidate.blocked_reason ?? "needs a room and time before it can go public";
  const detail = candidate.scheduled
    ? `${publicationDateTime(candidate, timezone)} · ${candidate.room ?? "Room not set"} · ${candidate.building ?? "Building not set"}`
    : "Not scheduled";
  const speakers = publicationSpeakerLine(candidate);
  // Review mode drops the checkbox, so the copy would otherwise land in the
  // checkbox column and ellipsise to a character or two — unreadable on the one
  // step whose whole job is letting the organizer read what is about to go public.
  return <div class={`agenda-publication-candidate${review ? " is-review" : ""}`} role="listitem">
    {!review && <input
      type="checkbox"
      checked={selected === true}
      disabled={disabled || !candidate.can_publish}
      title={!candidate.can_publish ? blockedReason : undefined}
      aria-label={`Select ${candidate.title} for publication${candidate.can_publish ? "" : ` — ${blockedReason}`}`}
      onChange={() => onToggle?.(candidate.submission_id)}
    />}
    <div class="agenda-publication-candidate-copy">
      <strong title={candidate.title}>{candidate.title}</strong>
      <span>{detail}</span>
      {!candidate.can_publish && <span class="agenda-publication-candidate-reason">{blockedReason}</span>}
      {!candidate.can_publish && candidate.reason_details && <span class="agenda-publication-candidate-reason">{candidate.reason_codes?.join(" · ")}</span>}
      <span>{speakers}</span>
      {!hasPublicSpeaker(candidate) && <span class="agenda-publication-candidate-warning" role="alert">No speaking participant attached · the public agenda will show “Speaker to be announced”.</span>}
    </div>
  </div>;
}

function PublicationPanel({
  publication,
  timezone,
  selectedIds,
  step,
  busy,
  onToggle,
  onSelectAll,
  onReview,
  onBack,
  onPublish,
  error,
}: {
  publication: AgendaPublication;
  timezone: string;
  selectedIds: readonly string[];
  step: PublicationStep;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelectAll: (ids: readonly string[]) => void;
  onReview: () => void;
  onBack: () => void;
  onPublish: () => void;
  error: string;
}): JSX.Element {
  const selected = new Set(selectedIds);
  const selectedReviewCandidates = publication.candidates.filter((candidate) => selected.has(candidate.submission_id));
  const selectedCandidates = selectedReviewCandidates.filter((candidate) => candidate.can_publish);
  const selectableCandidates = publication.candidates.filter((candidate) => candidate.can_publish).slice(0, MAX_BATCH_PUBLISH_IDS);
  const allSelectableSelected = selectableCandidates.length > 0 && selectableCandidates.every((candidate) => selected.has(candidate.submission_id));
  const selectAllLabel = `Select all ${selectableCandidates.length} ${selectableCandidates.length === 1 ? "Session" : "Sessions"}`;
  const toggleAll = () => onSelectAll(allSelectableSelected ? [] : selectableCandidates.map((candidate) => candidate.submission_id));
  return <section class="card agenda-publication-panel" aria-labelledby="agenda-publication-title">
    <header class="agenda-publication-head">
      <div>
        <span class="eyebrow">Public agenda</span>
        <h2 id="agenda-publication-title">Publish the program</h2>
        <p class="agenda-publication-counter" aria-live="polite"><strong class="tabular">{publication.live}</strong> live <span aria-hidden="true">·</span> <strong class="tabular">{publication.not_yet_public}</strong> not yet public</p>
      </div>
      <a class="button ghost small" href={publication.public_agenda_url}>View public agenda ↗</a>
    </header>
    {step === "select" ? <>
      <div class="agenda-publication-intro">Every Session with publication work is listed here. Select a ready scheduled Session to make its title, time, room, and speakers visible on the public agenda; withheld rows stay visible with their reason.</div>
      {publication.candidates.length ? <div class="agenda-publication-list" role="list" aria-label="Accepted Sessions and publication readiness">
        <div class="agenda-publication-select-all">
          <label><input type="checkbox" checked={allSelectableSelected} disabled={!selectableCandidates.length} aria-label={selectAllLabel} onChange={toggleAll} />{selectAllLabel}</label>
          {publication.candidates.length > MAX_BATCH_PUBLISH_IDS && <span class="subtle">Publish in batches of up to {MAX_BATCH_PUBLISH_IDS} Sessions.</span>}
        </div>
        {publication.candidates.map((candidate) => <PublicationCandidateRow
          key={candidate.submission_id}
          candidate={candidate}
          timezone={timezone}
          selected={selected.has(candidate.submission_id)}
          disabled={!selected.has(candidate.submission_id) && selectedReviewCandidates.length >= MAX_BATCH_PUBLISH_IDS}
          onToggle={onToggle}
        />)}
      </div> : <div class="agenda-publication-empty" role="status"><strong>{publication.live > 0 ? "Everything ready is live." : "No publication work is waiting."}</strong><span>Withheld, malformed, or reversed rows stay visible here with the reason the public agenda is not changing.</span></div>}
      {publication.anomaly_count ? <div class="agenda-publication-warning" role="alert"><strong>{publication.anomaly_count} live Session{publication.anomaly_count === 1 ? "" : "s"} no longer accepted.</strong><span>They stay out of the attendee agenda until you deliberately remove the retained publication.</span></div> : null}
      {error && <div class="agenda-publication-error" role="alert">{error}</div>}
      <footer class="agenda-publication-actions">
        <span class="subtle"><span class="tabular">{selectedReviewCandidates.length}</span> selected</span>
        <Button variant="primary" disabled={!selectedReviewCandidates.length || busy} onClick={onReview}>Review publication</Button>
      </footer>
    </> : <>
      <div class="agenda-publication-intro"><strong>{selectedCandidates.length} will go live · {Math.max(0, selectedReviewCandidates.length - selectedCandidates.length)} withheld</strong> — reasons named per row. Nothing is visible until you confirm.</div>
      <div class="agenda-publication-list" role="list" aria-label="Publication preview">
        {selectedReviewCandidates.map((candidate) => <PublicationCandidateRow key={candidate.submission_id} candidate={candidate} timezone={timezone} review />)}
      </div>
      {publication.anomaly_count ? <div class="agenda-publication-warning" role="alert"><strong>{publication.anomaly_count} live Session{publication.anomaly_count === 1 ? "" : "s"} no longer accepted.</strong><span>Review the board anomaly before changing the public projection.</span></div> : null}
      {error && <div class="agenda-publication-error" role="alert">{error}</div>}
      <footer class="agenda-publication-actions">
        <Button variant="ghost" disabled={busy} onClick={onBack}>Back to selection</Button>
        <Button variant="primary" disabled={!selectedReviewCandidates.length || busy} onClick={onPublish}>{busy ? "Publishing…" : `Publish ${selectedCandidates.length} to public agenda`}</Button>
      </footer>
    </>}
  </section>;
}

const EMPTY_CALENDAR_DEBT: AgendaCalendarDebt = {
  blocked: [],
  current_count: 0,
  first_invite_count: 0,
  no_op: true,
  speakers: [],
  unsent_update_count: 0,
};

function calendarDebtCount(calendar: AgendaCalendarDebt): number {
  return calendar.first_invite_count + calendar.unsent_update_count;
}

function calendarSpeakerDetail(speaker: AgendaCalendarSpeaker): string {
  const updates = speaker.items.filter((item) => item.kind === "update").length;
  const first = speaker.items.filter((item) => item.kind === "first").length;
  return [
    updates ? `${updates} update${updates === 1 ? "" : "s"} · same UID, SEQUENCE+1` : "",
    first ? `${first} first invite${first === 1 ? "" : "s"} · SEQUENCE 0` : "",
  ].filter(Boolean).join(" · ");
}

function calendarPreviewDate(value: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

export function CalendarBatchModal({
  calendar,
  busy,
  error,
  timezone,
  onClose,
  onConfirm,
}: {
  calendar: AgendaCalendarDebt;
  busy: boolean;
  error: string;
  timezone: string;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const preview = calendar.speakers[0]?.items[0];
  return <div class="modal-backdrop" data-calendar-modal="true">
    <section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="calendar-batch-title">
      <div class="modal-head">
        <div class="eyebrow">Calendar · one batch</div>
        <h2 id="calendar-batch-title">Make every speaker’s calendar match the agenda?</h2>
        <p>{calendar.unsent_update_count} update{calendar.unsent_update_count === 1 ? "" : "s"} and {calendar.first_invite_count} first invite{calendar.first_invite_count === 1 ? "" : "s"}, folded to one email per speaker — a speaker moved three times hears once.</p>
      </div>
      <div class="modal-body">
        <div class="plan-detail calendar-batch-speakers" role="list" aria-label="Calendar batch speakers">
          {calendar.speakers.slice(0, 10).map((speaker) => <div class="plan-detail-row" role="listitem" key={speaker.person_id}>
            <span><strong>{speaker.name}</strong><small>{speaker.email}</small></span>
            <span class="why">{calendarSpeakerDetail(speaker)}</span>
          </div>)}
          {calendar.speakers.length > 10 && <div class="plan-detail-row"><span class="subtle">+ {calendar.speakers.length - 10} more speakers</span></div>}
          {!calendar.speakers.length && <div class="plan-detail-row"><span class="subtle">No sendable speakers.</span></div>}
        </div>
        {calendar.blocked.length > 0 && <div class="calendar-batch-blocked" role="alert">
          <strong>{calendar.blocked.length} speaker{calendar.blocked.length === 1 ? "" : "s"} need an address first.</strong>
          {calendar.blocked.map((recipient) => <div data-calendar-blocked-row="true" key={recipient.person_id}>{recipient.person_name} — {recipient.reason}</div>)}
        </div>}
        {preview && <div class="message-preview calendar-batch-preview">
          <strong>Preview · {preview.title}</strong> <span class="subtle">— brand voice, event timezone</span>
          <div class="divider" />
          The schedule for your session has been updated.<br /><br />
          <strong>When</strong> — {preview.previous_starts_at !== null ? `${calendarPreviewDate(preview.previous_starts_at, timezone)} → ` : ""}{calendarPreviewDate(preview.starts_at, timezone)}<br />
          <strong>Where</strong> — {preview.previous_location && preview.previous_location !== preview.location ? `${preview.previous_location} → ` : ""}{preview.location}<br />
          <span class="subtle">Event timezone: {timezone}. The attached invite updates your existing calendar entry in place.</span>
        </div>}
        {error && <div class="agenda-publication-error" role="alert">{error}</div>}
      </div>
      <div class="modal-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || calendar.speakers.length === 0} onClick={onConfirm}>{busy ? "Sending…" : `Send to ${calendar.speakers.length} speaker${calendar.speakers.length === 1 ? "" : "s"}`}</Button></div>
    </section>
  </div>;
}

export function AgendaAttentionStrip({
  snapshot,
  onCalendarOpen,
  calendarBusy,
}: {
  snapshot: AgendaSnapshot;
  onCalendarOpen: () => void;
  calendarBusy: boolean;
}): JSX.Element {
  const calendar = snapshot.calendar ?? EMPTY_CALENDAR_DEBT;
  const debt = calendarDebtCount(calendar);
  return <div class="agenda-attention-strip" aria-label="Agenda publication and calendar attention">
    <section class="agenda-attention-gauge">
      <div class="agenda-attention-copy"><span class="eyebrow">Publication</span><strong><span class="tabular">{snapshot.publication.live}</span> live · <span class="tabular">{snapshot.publication.not_yet_public}</span> not yet public</strong><span class="subtle">Everything live is still accepted</span></div>
      <a class="button primary small" href="#agenda-publication-panel" style={{ width: "150px" }}>Review and publish</a>
    </section>
    <section class="agenda-attention-gauge" data-calendar-gauge="true">
      <div class="agenda-attention-copy"><span class="eyebrow">Calendar invites</span><strong><span class="tabular">{calendar.current_count}</span> current · <span class="tabular">{calendar.unsent_update_count}</span> unsent updates · <span class="tabular">{calendar.first_invite_count}</span> never invited</strong><span class="subtle">Move a scheduled Session and one batch email covers each speaker</span></div>
      <Button variant="primary" small data-calendar-send="true" disabled={calendar.no_op || calendarBusy} onClick={onCalendarOpen} style={{ width: "190px" }}>{calendarBusy ? "Sending…" : `Send ${debt} calendar update${debt === 1 ? "" : "s"}`}</Button>
    </section>
  </div>;
}

export function AgendaPage({ eventId }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", snapshot: null });
  const [view, setView] = useState<AgendaView>("day");
  const [day, setDay] = useState("");
  const [track, setTrack] = useState("");
  const [poolQuery, setPoolQuery] = useState("");
  const [roomPanelId, setRoomPanelId] = useState<string | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [conflictFocus, setConflictFocus] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [publicationError, setPublicationError] = useState("");
  const [publicationNotice, setPublicationNotice] = useState<PublicationNotice | null>(null);
  const [publishSelection, setPublishSelection] = useState<string[]>([]);
  const [publicationStep, setPublicationStep] = useState<PublicationStep>("select");
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [autoPlaceBusy, setAutoPlaceBusy] = useState(false);
  const [armedPlacement, setArmedPlacement] = useState<ArmedPlacement | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [gridGranularity, setGridGranularity] = useState<AgendaGridGranularity>(() => readAgendaGridGranularity(eventId));
  const [reloadKey, setReloadKey] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<AgendaView, { top: number; left: number }>>>({});
  const dragPayload = useRef<DragPayload | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await apiFetch<AgendaSnapshot>(`/api/v1/events/${encodeURIComponent(eventId)}/agenda`, { signal, route: AGENDA_ROUTE });
      setState({ kind: "ready", snapshot });
      setPublishSelection((current) => current.filter((id) => snapshot.publication.candidates.some((candidate) => candidate.submission_id === id && candidate.can_publish)));
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

  useEffect(() => {
    setGridGranularity(readAgendaGridGranularity(eventId));
  }, [eventId]);

  useEffect(() => {
    if (!armedPlacement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setArmedPlacement(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armedPlacement]);

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

  const armPlacement = (payload: AgendaPlacementPayload, title: string, placementDay?: string) => {
    setNotice("");
    setArmedPlacement({ payload, title });
    // Track is a time × track view, not a time × room view. Move the organizer
    // to the nearest actionable board rather than offering a selected Session
    // with no room target.
    if (view === "track") {
      rememberScroll();
      setView("day");
      if (placementDay) setDay(placementDay);
    }
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

  const place = async (payload: AgendaPlacementPayload, target: AgendaPlacementTarget) => {
    const current = state.kind === "ready" ? state.snapshot : null;
    if (!current || placementBusy || autoPlaceBusy) return;
    const request = agendaPlacementRequest(current, payload, target, eventId);
    if (!request) {
      setArmedPlacement(null);
      setNotice("That Session is no longer available to place. Refresh the agenda and try again.");
      return;
    }
    setPlacementBusy(true);
    rememberScroll();
    try {
      await mutate(request.path, request.init, request.message, request.route);
      setArmedPlacement((armed) => armed?.payload.kind === payload.kind && armed.payload.id === payload.id ? null : armed);
    } catch (error: unknown) {
      setNotice(errorSummary(error));
    } finally {
      setPlacementBusy(false);
    }
  };

  const placeArmed = (target: AgendaPlacementTarget) => {
    if (armedPlacement) void place(armedPlacement.payload, target);
  };

  const onDrop = async (event: DragEvent, targetDay: string, targetTime: string, roomId: string, trackId?: string) => {
    const payload = readDragPayload(event);
    if (!payload) return;
    try {
      await place(payload, { day: targetDay, time: targetTime, roomId, trackId });
    } finally {
      dragPayload.current = null;
    }
  };

  const unplace = async (session: AgendaSession) => {
    if (session.submission_id === null || placementBusy) return;
    setPlacementBusy(true);
    rememberScroll();
    try {
      await mutate(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
        headers: { "If-Match": session.etag },
      }, "Session returned to the unscheduled pool");
      setArmedPlacement((armed) => armed?.payload.kind === "session" && armed.payload.id === session.id ? null : armed);
    } catch (error: unknown) {
      setNotice(errorSummary(error));
    } finally {
      setPlacementBusy(false);
    }
  };

  const onPoolDrop = async (event: DragEvent) => {
    const current = state.kind === "ready" ? state.snapshot : null;
    const payload = readDragPayload(event);
    if (!current || !payload || payload.kind !== "session") return;
    const session = current.sessions.find((candidate) => candidate.id === payload.id);
    if (!session || session.submission_id === null) return;
    try {
      await unplace(session);
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

  /**
   * One action, ordinary writes: the plan is arithmetic over the snapshot, but
   * every placement lands through the same route a drag uses, so what the pass
   * produces is indistinguishable from hand-placed work — and survives reload.
   */
  const autoPlace = async () => {
    const current = state.kind === "ready" ? state.snapshot : null;
    if (!current || autoPlaceBusy || placementBusy) return;
    const plan = planAutoPlacements({
      sessions: current.sessions,
      rooms: current.rooms,
      unscheduled: current.unscheduled,
      slots: autoPlaceSlots(current, gridGranularity),
    });
    if (!plan.placements.length) {
      setNotice(autoPlaceSummary(plan));
      return;
    }
    setAutoPlaceBusy(true);
    rememberScroll();
    let placed = 0;
    try {
      for (const placement of plan.placements) {
        await apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submission_id: placement.submission_id,
            starts_at: placement.starts_at,
            room_id: placement.room_id,
            track_id: placement.track_id,
            duration_min: placement.duration_min,
          }),
          route: AGENDA_ITEMS_ROUTE,
        });
        placed += 1;
      }
      setNotice(autoPlaceSummary({ placements: plan.placements.slice(0, placed), remaining: plan.remaining }));
    } catch (error: unknown) {
      // A partial pass is still real work; say how much landed before the stop.
      setNotice(placed
        ? `Auto-placed ${placed} before stopping · ${errorSummary(error)}`
        : errorSummary(error));
    } finally {
      setAutoPlaceBusy(false);
      await load();
    }
  };

  const publishSelected = async () => {
    if (!publishSelection.length) return;
    setPublicationBusy(true);
    setNotice("");
    setPublicationError("");
    const expectedRevisions: Record<string, { submission_updated_at: number; agenda_updated_at: number | null }> = {};
    for (const submissionId of publishSelection) {
      const revision = state.snapshot?.publication.candidates.find((candidate) => candidate.submission_id === submissionId)?.observed_revision;
      if (revision) expectedRevisions[submissionId] = revision;
    }
    try {
      const result = await apiFetch<{ published_count: number; public_agenda_url: string }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/agenda/publish`,
        {
          method: "POST",
          body: JSON.stringify({ submission_ids: publishSelection, expected_revisions: expectedRevisions }),
          headers: { "content-type": "application/json" },
          route: AGENDA_PUBLISH_ROUTE,
        },
      );
      setPublicationNotice({ count: result.published_count, publicAgendaUrl: result.public_agenda_url });
      setPublishSelection([]);
      setPublicationStep("select");
      await load();
    } catch (error: unknown) {
      setPublicationError(errorSummary(error));
      await load();
    } finally {
      setPublicationBusy(false);
    }
  };

  const sendCalendarBatch = async () => {
    setCalendarBusy(true);
    setCalendarError("");
    try {
      const result = await apiFetch<{ deliveries: Array<{ person_id: string }>; no_op: boolean }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/calendar-invites`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          route: "/api/v1/events/{eventId}/calendar-invites",
        },
      );
      setCalendarModalOpen(false);
      setNotice(result.no_op ? "Every speaker’s calendar already matches the agenda — nothing to send." : `Queued ${result.deliveries.length} speaker${result.deliveries.length === 1 ? "" : "s"} once each.`);
      await load();
    } catch (error: unknown) {
      setCalendarError(errorSummary(error));
      await load();
    } finally {
      setCalendarBusy(false);
    }
  };

  if (state.kind === "loading" && !state.snapshot) return <div class="agenda-page"><PageHeader title="Agenda builder" copy="Place accepted Sessions directly into the conference schedule." /><div class="agenda-loading instrument" aria-busy="true"><span class="eyebrow">Agenda</span><strong>Reading the working schedule…</strong><span class="subtle">Loading Sessions, rooms, and placement metadata.</span></div></div>;
  if (!state.snapshot) return <div class="agenda-page"><PageHeader title="Agenda builder" copy="Place accepted Sessions directly into the conference schedule." /><EmptyState title="Agenda data unavailable" copy={state.message} action={<Button variant="primary" onClick={() => { setState({ kind: "loading", snapshot: null }); setReloadKey((value) => value + 1); }}>Try again</Button>} /></div>;

  const snapshot = state.snapshot;
  const days = dayOptions(snapshot);
  const gridSlots = generateAgendaGridSlots(gridGranularity);
  const selectedDay = day || days[0]?.value || "all";
  const visibleSessions = sessionsFor(snapshot, selectedDay, track);
  const conflicts = conflictMarkers(snapshot.conflicts);
  const showBuildingComparison = agendaShowsBuildingComparison(snapshot);
  const visibleConflictData = visibleVenueConflicts(snapshot.conflicts, showBuildingComparison);
  const presentationConflicts = showBuildingComparison ? conflicts : conflictMarkers(visibleConflictData);
  const presentationConflictDetails = conflictDetailsBySession(showBuildingComparison ? snapshot.conflicts : visibleConflictData);
  const headerBuilding = agendaBuildingHeader(snapshot);
  const activeRoom = roomPanelId ? roomFor(snapshot, roomPanelId) : undefined;
  const armPoolItem = (item: AgendaPoolItem) => armPlacement({ kind: "pool", id: item.submission_id }, item.title);
  const moveSession = (session: AgendaSession) => armPlacement(
    { kind: "session", id: session.id },
    session.title,
    sessionDay(session, snapshot.event.timezone),
  );
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
    if (view === "week") return <WeekBoard snapshot={snapshot} sessions={sessionsFor(snapshot, "all", track)} days={days} slots={gridSlots} onDrop={onDrop} onPlace={placeArmed} armedPlacement={armedPlacement} placementBusy={placementBusy} onDragStart={onDragStart} onResize={onResize} onMove={moveSession} onUnplace={unplace} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} conflictDetails={presentationConflictDetails} />;
    if (view === "room") return <RoomBoard snapshot={snapshot} sessions={sessionsFor(snapshot, "all", track)} days={selectedDay === "all" ? days : days.filter((candidate) => candidate.value === selectedDay)} slots={gridSlots} onDrop={onDrop} onPlace={placeArmed} armedPlacement={armedPlacement} placementBusy={placementBusy} onDragStart={onDragStart} onResize={onResize} onMove={moveSession} onUnplace={unplace} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} conflictDetails={presentationConflictDetails} />;
    if (view === "track") return <TrackBoard
      snapshot={snapshot}
      sessions={sessionsFor(snapshot, "all", track)}
      days={selectedDay === "all" ? days : days.filter((candidate) => candidate.value === selectedDay)}
      slots={gridSlots}
      onDrop={onDrop}
      renderTile={(session) => <SessionTile key={session.id} snapshot={snapshot} session={session} sessions={snapshot.sessions} conflictsBySession={presentationConflictDetails} conflictFocus={conflictFocus} onConflictFocus={setConflictFocus} onDragStart={onDragStart} onResize={onResize} onMove={moveSession} onUnplace={unplace} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} />}
    />;
    const dayForBoard = selectedDay === "all" ? days[0]?.value ?? selectedDay : selectedDay;
    return <DayBoard snapshot={snapshot} sessions={sessionsFor(snapshot, dayForBoard, track)} day={dayForBoard} slots={gridSlots} onDrop={onDrop} onPlace={placeArmed} armedPlacement={armedPlacement} placementBusy={placementBusy} onDragStart={onDragStart} onResize={onResize} onMove={moveSession} onUnplace={unplace} onRoomOpen={setRoomPanelId} conflicts={presentationConflicts} conflictDetails={presentationConflictDetails} />;
  };

  return <div class="agenda-page">
    <PageHeader title="Agenda builder" copy={`${headerBuilding ? `${headerBuilding}. ` : ""}Place accepted Sessions by drag or selection. Format defaults set duration; live conflicts warn without blocking.`} actions={<><AgentBriefLauncher surface="agenda" eventId={eventId} /><ConflictCounter count={visibleConflictData.length} open={conflictsOpen} onOpen={() => setConflictsOpen(true)}>⚠ <span class="tabular">{visibleConflictData.length}</span> conflicts</ConflictCounter></>} />
    {snapshot.schedule_window.outside_window_session_count > 0 && <div class="agenda-notice agenda-schedule-window-warning" role="status"><span><strong class="tabular">{snapshot.schedule_window.outside_window_session_count}</strong> scheduled Session{snapshot.schedule_window.outside_window_session_count === 1 ? "" : "s"} fall outside the conference dates.</span><a href="/settings">Open Conference settings ↗</a></div>}
    {publicationNotice && <div class="agenda-notice agenda-publication-success" role="status"><span>Published <strong class="tabular">{publicationNotice.count}</strong> Session{publicationNotice.count === 1 ? "" : "s"} to the public agenda.</span><span class="agenda-notice-actions"><a href={publicationNotice.publicAgendaUrl}>View public agenda ↗</a><button type="button" onClick={() => setPublicationNotice(null)} aria-label="Dismiss publication confirmation">×</button></span></div>}
    <div class="agenda-toolbar card">
      <div class="segment agenda-view-tabs" role="tablist" aria-label="Agenda views">{viewNames().map((candidate) => <button type="button" role="tab" aria-selected={view === candidate} disabled={candidate === "track" && Boolean(armedPlacement)} title={candidate === "track" && armedPlacement ? "Choose a time and room before returning to the track view." : undefined} class={view === candidate ? "active" : ""} key={candidate} onClick={() => { rememberScroll(); setView(candidate); }}>{candidate[0]!.toUpperCase() + candidate.slice(1)}</button>)}</div>
      <label class="agenda-filter"><span class="eyebrow">Day</span><select value={selectedDay} onChange={(event) => { rememberScroll(); setDay((event.currentTarget as HTMLSelectElement).value); }}><option value="all">All days</option>{days.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <label class="agenda-filter"><span class="eyebrow">Track</span><select value={track} onChange={(event) => { rememberScroll(); setTrack((event.currentTarget as HTMLSelectElement).value); }}><option value="">All tracks</option>{snapshot.tracks.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
      <label class="agenda-filter"><span class="eyebrow">Placement grid</span><select aria-label="Placement grid increment" value={gridGranularity} onChange={(event) => { rememberScroll(); setGridGranularity(writeAgendaGridGranularity(eventId, (event.currentTarget as HTMLSelectElement).value)); }}>{AGENDA_GRID_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <Button
        class="agenda-auto-place"
        data-auto-place="true"
        disabled={autoPlaceBusy || placementBusy || snapshot.unscheduled.length === 0}
        title={snapshot.unscheduled.length === 0
          ? "Nothing to auto-place — every schedulable Session is already on the agenda."
          : "Fill open room and time slots with unscheduled Sessions. Deterministic, not AI — it seats what fits and leaves the judgement to you."}
        onClick={() => void autoPlace()}
      >{autoPlaceBusy ? "Placing…" : "Auto-place"}</Button>
      <span class="toolbar-spacer" />
      <span class="subtle agenda-status-note">No save button · changes persist as you place</span>
    </div>
    <div class={`agenda-placement-status${armedPlacement ? " is-active" : ""}`} role="status" aria-live="polite" aria-atomic="true">{armedPlacement ? `Placing: ${armedPlacement.title}. Choose an open time and room, or press Escape to cancel.` : ""}</div>
    <AgendaAttentionStrip snapshot={snapshot} calendarBusy={calendarBusy} onCalendarOpen={() => { setCalendarError(""); setCalendarModalOpen(true); }} />
    <AgendaDayStatus snapshot={snapshot} day={selectedDay} />
    {notice && <div class="agenda-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
    {snapshot.sessions.length === 0 && snapshot.unscheduled.length === 0
      ? <EmptyState title="No Sessions are ready for the agenda" copy="Accept a submission first. Once a Session is accepted, it will appear here ready to place. Open accepted submissions from the full submissions list." action={<Button variant="primary" onClick={() => window.location.assign("/submissions")}>Open submissions</Button>} />
      : <div class="agenda-layout">
        <Pool snapshot={snapshot} query={poolQuery} setQuery={setPoolQuery} track={track} onDragStart={onDragStart} onDrop={onPoolDrop} onArm={armPoolItem} armedPlacement={armedPlacement} />
        <section class="card agenda-board wide-grid-scroll" ref={boardRef} aria-label={`${view} agenda view`}>{renderBoard()}</section>
      </div>}
    <div id="agenda-publication-panel"><PublicationPanel
      publication={snapshot.publication}
      timezone={snapshot.event.timezone}
      selectedIds={publishSelection}
      step={publicationStep}
      busy={publicationBusy}
      error={publicationError}
      onToggle={(id) => { setPublicationError(""); setPublishSelection((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]); }}
      onSelectAll={(ids) => { setPublicationError(""); setPublishSelection([...ids]); }}
      onReview={() => { setPublicationError(""); setPublicationStep("review"); }}
      onBack={() => { setPublicationError(""); setPublicationStep("select"); }}
      onPublish={() => void publishSelected()}
    /></div>
    <DemandPanel eventId={eventId} timezone={snapshot.event.timezone} />
    {activeRoom && <RoomPanel room={activeRoom} showBuildingComparison={showBuildingComparison} onClose={() => setRoomPanelId(null)} />}
    {conflictsOpen && <ConflictPanel conflicts={snapshot.conflicts} sessions={snapshot.sessions} showBuildingComparison={showBuildingComparison} onClose={() => setConflictsOpen(false)} onJump={jumpToSession} />}
    {calendarModalOpen && <CalendarBatchModal calendar={snapshot.calendar ?? EMPTY_CALENDAR_DEBT} timezone={snapshot.event.timezone} busy={calendarBusy} error={calendarError} onClose={() => setCalendarModalOpen(false)} onConfirm={() => void sendCalendarBatch()} />}
  </div>;
}

export { AGENDA_VIEWS };

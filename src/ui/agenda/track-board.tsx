/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

import type { AgendaSession, AgendaSnapshot } from "../../api/agenda";
import {
  agendaGridPosition,
  DEFAULT_AGENDA_GRID_GRANULARITY,
  generateAgendaGridSlots,
  type AgendaGridSlot,
} from "../../lib/agenda-grid";
import { localParts } from "../../lib/event-time";

export { localParts } from "../../lib/event-time";

/** Default slot labels retained for callers that only need the board's default list. */
export const TIME_SLOTS = generateAgendaGridSlots(DEFAULT_AGENDA_GRID_GRANULARITY).map((slot) => slot.time);

export interface TrackDay {
  value: string;
  label: string;
}

interface DropCellProps {
  children?: ComponentChildren;
  class?: string;
  ariaLabel: string;
  dataTrackDay: string;
  dataTrackTime: string;
  onDrop: (event: DragEvent) => void;
}

function DropCell({
  children,
  class: className = "",
  ariaLabel,
  dataTrackDay,
  dataTrackTime,
  onDrop,
}: DropCellProps): JSX.Element {
  const [over, setOver] = useState(false);
  return <div
    class={`agenda-drop-cell ${over ? "drag-over" : ""} ${className}`.trim()}
    role="group"
    aria-label={ariaLabel}
    data-agenda-drop-target="true"
    data-track-day={dataTrackDay}
    data-track-time={dataTrackTime}
    data-track-slot={`${dataTrackDay}:${dataTrackTime}`}
    onDragOver={(event) => { event.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); onDrop(event as unknown as DragEvent); }}
  >{children}</div>;
}

export interface TrackBoardProps {
  snapshot: AgendaSnapshot;
  sessions: readonly AgendaSession[];
  days: readonly TrackDay[];
  slots?: readonly AgendaGridSlot[];
  onDrop: (event: DragEvent, day: string, time: string, roomId: string, trackId?: string) => void;
  renderTile: (session: AgendaSession) => JSX.Element;
}

export function TrackBoard({
  snapshot,
  sessions,
  days,
  slots = generateAgendaGridSlots(),
  onDrop,
  renderTile,
}: TrackBoardProps): JSX.Element {
  const fallbackRoom = snapshot.rooms[0];
  const slotColumns = `repeat(${Math.max(slots.length, 1)}, minmax(105px, 1fr))`;
  return <div class="agenda-track-board" data-track-board>
    <div class="agenda-track-time-axis" aria-hidden="true" style={{ gridTemplateColumns: `110px ${slotColumns}` }}>
      <span class="agenda-track-axis-label">Track · day</span>
      {slots.map((slot) => <span class={`agenda-track-time tabular${slot.isHour ? "" : " is-micro"}`} key={slot.time} aria-label={slot.time}>
        {slot.isHour ? slot.time : <span class="agenda-track-micro-tick" aria-hidden="true" />}
      </span>)}
    </div>
    {snapshot.tracks.map((track) => {
      const laneSessions = sessions.filter((session) => session.track_id === track.id);
      return <section
        class="agenda-track-lane"
        data-track-lane={track.id}
        data-track-id={track.id}
        key={track.id}
        style={{ borderTopColor: track.color }}
      >
        <header class="agenda-track-lane-head">
          <span class="agenda-track-dot" style={{ backgroundColor: track.color }} aria-hidden="true" />
          <strong>{track.name}</strong>
          <span class="subtle tabular">{laneSessions.length} scheduled</span>
        </header>
        <div class="agenda-track-days">
          {days.map((day) => <div class="agenda-track-day" data-track-day-band={day.value} key={day.value}>
            <div class="agenda-track-day-label"><strong>{day.label.split(" · ")[0]}</strong><span>{day.label.split(" · ").slice(1).join(" · ")}</span></div>
            <div class="agenda-track-slots" style={{ gridTemplateColumns: slotColumns }}>
              {slots.map((slot) => <DropCell
                class="agenda-track-slot"
                ariaLabel={`Place Session in ${track.name} on ${day.label} at ${slot.time}`}
                dataTrackDay={day.value}
                dataTrackTime={slot.time}
                key={`${day.value}-${slot.time}`}
                onDrop={(event) => { if (fallbackRoom) onDrop(event, day.value, slot.time, fallbackRoom.id, track.id); }}
              >{laneSessions
                .filter((session) => sessionDay(session, snapshot.event.timezone) === day.value)
                .flatMap((session) => {
                  const position = agendaGridPosition(sessionTime(session, snapshot.event.timezone), slots);
                  if (!position || position.slot.time !== slot.time) return [];
                  return [<div
                    class="agenda-session-position agenda-session-position-horizontal"
                    key={session.id}
                    style={{ left: `${position.offsetRatio * 100}%` }}
                  >{renderTile(session)}</div>];
                })}
              </DropCell>)}
            </div>
          </div>)}
        </div>
      </section>;
    })}
  </div>;
}

export function sessionDay(session: AgendaSession, timezone: string): string {
  return localParts(session.starts_at, timezone).day;
}

export function sessionTime(session: AgendaSession, timezone: string): string {
  return localParts(session.starts_at, timezone).time;
}

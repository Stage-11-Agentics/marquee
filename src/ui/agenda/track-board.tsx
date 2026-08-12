/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

import type { AgendaSession, AgendaSnapshot } from "../../api/agenda";

export const TIME_SLOTS = Array.from(
  { length: 12 },
  (_, index) => `${String(index + 9).padStart(2, "0")}:00`,
);

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
    role="region"
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
  onDrop: (event: DragEvent, day: string, time: string, roomId: string, trackId?: string) => void;
  renderTile: (session: AgendaSession) => JSX.Element;
}

export function TrackBoard({
  snapshot,
  sessions,
  days,
  onDrop,
  renderTile,
}: TrackBoardProps): JSX.Element {
  const fallbackRoom = snapshot.rooms[0];
  return <div class="agenda-track-board" data-track-board>
    <div class="agenda-track-time-axis" aria-hidden="true">
      <span class="agenda-track-axis-label">Track · day</span>
      {TIME_SLOTS.map((time) => <span class="agenda-track-time tabular" key={time}>{time}</span>)}
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
            <div class="agenda-track-slots">
              {TIME_SLOTS.map((time) => <DropCell
                class="agenda-track-slot"
                ariaLabel={`Place Session in ${track.name} on ${day.label} at ${time}`}
                dataTrackDay={day.value}
                dataTrackTime={time}
                key={`${day.value}-${time}`}
                onDrop={(event) => { if (fallbackRoom) onDrop(event, day.value, time, fallbackRoom.id, track.id); }}
              >{laneSessions
                .filter((session) => sessionDay(session, snapshot.event.timezone) === day.value && sessionTime(session, snapshot.event.timezone) === time)
                .map(renderTile)}
              </DropCell>)}
            </div>
          </div>)}
        </div>
      </section>;
    })}
  </div>;
}

export function localParts(timestamp: number, timezone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    time: `${values.get("hour")}:${values.get("minute")}`,
  };
}

export function sessionDay(session: AgendaSession, timezone: string): string {
  return localParts(session.starts_at, timezone).day;
}

export function sessionTime(session: AgendaSession, timezone: string): string {
  return localParts(session.starts_at, timezone).time;
}

/** @jsxImportSource preact */
import type { JSX } from "preact";

import type { RunOfShow, RunOfShowRoom, RunOfShowSession, RunOfShowSpeaker } from "../../lib/day-of/run-of-show";
import { telHref } from "../../lib/day-of/run-of-show";

/**
 * The green room, drawn once for both doors.
 *
 * A phone held in a corridor at 08:40 is the whole design brief. Everything
 * here answers one of three questions and nothing else answers anything: what
 * is on now and next in this room, is the speaker here, are the slides in. No
 * navigation, no shell, no bundle — the page arrives finished, because the
 * building's wifi is the one thing nobody can fix on the day.
 *
 * `canMark` is the only difference between the crew's view and a volunteer's.
 * A viewer who cannot mark sees the same arrival state and a phone number; a
 * viewer who can sees one control per speaker, and it is the only control on
 * the page.
 */

export interface GreenRoomProps {
  runOfShow: RunOfShow;
  /** The holder's own path, so the day switcher and refresh stay inside their door. */
  basePath: string;
  /**
   * Query the day switcher and refresh must carry forward.
   *
   * The organizer door names its conference here. Dropping it would make a day
   * chip a jump to whichever conference the bare path resolves to — the same
   * defect as an unscoped link, just one click further in.
   */
  carry?: Readonly<Record<string, string>>;
  canMark: boolean;
  /** The name every mark this viewer makes will be stamped with. */
  markerName: string | null;
}

function clockLabel(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(timestamp));
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

const SLIDES_COPY: Record<string, string> = {
  received: "Slides in",
  missing: "No slides yet",
  overdue: "Slides overdue",
  done_without_file: "Marked done, no file",
  not_requested: "No slides requested",
};

function slidesTone(state: string): string {
  if (state === "received") return "is-good";
  if (state === "overdue") return "is-alarm";
  if (state === "not_requested") return "is-quiet";
  return "is-warn";
}

function SpeakerRow({
  speaker,
  session,
  canMark,
  timezone,
}: {
  speaker: RunOfShowSpeaker;
  session: RunOfShowSession;
  canMark: boolean;
  timezone: string;
}): JSX.Element {
  const arrived = speaker.arrived_at !== null;
  return (
    <li
      class={`gr-speaker${arrived ? " is-here" : ""}${speaker.declined && !arrived ? " is-declined" : ""}`}
      data-declined={speaker.declined ? "true" : undefined}
      data-session={session.id}
      data-person={speaker.person_id}
    >
      <div class="gr-speaker-who">
        <span class="gr-speaker-name">{speaker.name}</span>
        {/* The stamp line holds its height whether or not there is a stamp, so
            marking somebody in never moves the speaker below them. */}
        <span class="gr-speaker-stamp" data-stamp data-phone={speaker.phone ?? ""}>
          {arrived
            ? `Here · ${speaker.marked_by_name ?? "an organizer"} · ${clockLabel(speaker.arrived_at!, timezone)}`
            : speaker.declined
              ? "Declined — not expected"
              : speaker.phone
                ? speaker.phone
                : "Not marked in yet"}
        </span>
      </div>
      <div class="gr-speaker-actions">
        {speaker.phone ? (
          <a class="gr-call" href={telHref(speaker.phone)} aria-label={`Call ${speaker.name}`}>Call</a>
        ) : null}
        {canMark ? (
          <button
            class="gr-mark"
            type="button"
            data-mark
            data-state={arrived ? "here" : "away"}
            aria-pressed={arrived ? "true" : "false"}
          >
            {arrived ? "Here" : "Mark in"}
          </button>
        ) : (
          <span class={`gr-flag${arrived ? " is-here" : ""}`} aria-hidden="true">{arrived ? "Here" : speaker.declined ? "No" : "—"}</span>
        )}
      </div>
    </li>
  );
}

function SessionCard({
  session,
  position,
  canMark,
  timezone,
}: {
  session: RunOfShowSession;
  position: "now" | "next" | "later";
  canMark: boolean;
  timezone: string;
}): JSX.Element {
  const speakers = session.speakers;
  return (
    <article class={`gr-session is-${position}`} data-session-card={session.id}>
      <header class="gr-session-head">
        <span class="gr-session-when">
          {position === "now" ? <strong class="gr-live">On now</strong> : null}
          {position === "next" ? <strong class="gr-next">Up next</strong> : null}
          <span class="gr-time tabular">{clockLabel(session.starts_at, timezone)}–{clockLabel(session.ends_at, timezone)}</span>
        </span>
        <h3 class="gr-session-title">{session.title}</h3>
      </header>
      {session.is_break ? null : (
        <>
          <div class="gr-session-meta">
            <span class={`gr-chip ${slidesTone(session.slides.state)}`}>
              {SLIDES_COPY[session.slides.state] ?? "Slides"}
            </span>
            <span class="gr-arrived tabular" data-arrived-count>
              {speakers.length === 0
                ? "Speaker to be announced"
                : session.expected_count === 0
                  ? "Everyone on this session declined"
                  : `${session.arrived_count} of ${session.expected_count} here`}
            </span>
          </div>
          {speakers.length > 0 ? (
            <ul class="gr-speakers">
              {speakers.map((speaker) => (
                <SpeakerRow
                  key={speaker.person_id}
                  speaker={speaker}
                  session={session}
                  canMark={canMark}
                  timezone={timezone}
                />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </article>
  );
}

function RoomSection({
  room,
  canMark,
  timezone,
}: {
  room: RunOfShowRoom;
  canMark: boolean;
  timezone: string;
}): JSX.Element {
  const positionOf = (session: RunOfShowSession): "now" | "next" | "later" =>
    session.id === room.current_session_id ? "now" : session.id === room.next_session_id ? "next" : "later";
  return (
    <section class="gr-room">
      <header class="gr-room-head">
        <h2>{room.name}</h2>
        <span class="gr-room-where">{room.building_name} · seats {room.capacity}</span>
        {room.av_capabilities.length > 0 ? (
          <ul class="gr-av">
            {room.av_capabilities.map((capability) => <li key={capability}>{capability}</li>)}
          </ul>
        ) : null}
        {room.notes ? <p class="gr-room-note">{room.notes}</p> : null}
      </header>
      <div class="gr-sessions">
        {room.sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            position={positionOf(session)}
            canMark={canMark}
            timezone={timezone}
          />
        ))}
      </div>
    </section>
  );
}

export function GreenRoomPage({ runOfShow, basePath, canMark, markerName, carry }: GreenRoomProps): JSX.Element {
  const { event, counts } = runOfShow;
  const timezone = event.timezone;
  const dayHref = (day: string): string => {
    const query = new URLSearchParams({ ...(carry ?? {}), day });
    return `${basePath}?${query.toString()}`;
  };
  return (
    <div class="gr-shell" data-green-room data-day={runOfShow.day}>
      <header class="gr-top">
        <div class="gr-top-line">
          <span class="gr-eyebrow">Green room</span>
          <span class="gr-asof tabular" data-asof>
            as of {clockLabel(runOfShow.generated_at, timezone)}
          </span>
        </div>
        <h1>{event.name}</h1>
        <p class="gr-day">{dayLabel(runOfShow.day)}{runOfShow.is_today ? " · today" : ""}</p>
        {runOfShow.days.length > 1 ? (
          <nav class="gr-days" aria-label="Conference days">
            {runOfShow.days.map((day) => (
              <a
                key={day.id}
                class={`gr-day-chip${day.id === runOfShow.day ? " is-current" : ""}`}
                href={dayHref(day.id)}
                aria-current={day.id === runOfShow.day ? "page" : undefined}
              >
                {day.label}
              </a>
            ))}
          </nav>
        ) : null}
        <dl class="gr-counts">
          <div><dt>Here</dt><dd class="tabular" data-count-arrived>{counts.arrived} of {counts.speakers}</dd></div>
          <div><dt>Slides in</dt><dd class="tabular">{counts.slides_received} of {counts.sessions}</dd></div>
          <div><dt>Still owed</dt><dd class="tabular">{counts.slides_missing}</dd></div>
        </dl>
        {canMark && markerName ? (
          <p class="gr-marker">Marks are recorded as <strong>{markerName}</strong>.</p>
        ) : null}
      </header>
      <main class="gr-main">
        {runOfShow.rooms.length === 0 ? (
          <section class="gr-empty">
            <h2>Nothing is scheduled for this day.</h2>
            <p>
              When sessions are placed on the agenda for {dayLabel(runOfShow.day)}, they appear here in
              the order they run — room by room, with who is on and whether their slides are in.
            </p>
          </section>
        ) : (
          runOfShow.rooms.map((room) => (
            <RoomSection key={room.id} room={room} canMark={canMark} timezone={timezone} />
          ))
        )}
      </main>
      <footer class="gr-foot">
        <span class="gr-status" role="status" aria-live="polite" data-status></span>
        <a class="gr-refresh" href={dayHref(runOfShow.day)}>Refresh</a>
      </footer>
    </div>
  );
}

/**
 * Phone-first, and 390px is the width that matters: the whole layout is one
 * column with room to tap, and the two-column arrangement only appears when
 * there is genuinely a screen to put it on.
 */
export const GREEN_ROOM_STYLES = `
.gr-shell { min-height: 100vh; background: var(--bg); color: var(--ink); display: grid; grid-template-rows: auto 1fr auto; }
.gr-top { padding: 16px 16px 14px; border-bottom: 1px solid var(--line-strong); background: var(--panel); position: sticky; top: 0; z-index: 2; }
.gr-top-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.gr-eyebrow { font: 500 11px/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--accent-dark); }
.gr-asof { font: 400 11px/1.2 var(--mono); color: var(--ink-soft); }
.gr-top h1 { font: 500 20px/1.15 var(--mono); letter-spacing: -.03em; margin: 8px 0 2px; }
.gr-day { margin: 0; font-size: 13px; color: var(--ink-soft); }
.gr-days { display: flex; gap: 6px; overflow-x: auto; margin: 10px 0 0; padding-bottom: 2px; }
.gr-day-chip { flex: 0 0 auto; padding: 5px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius); font: 400 12px/1 var(--mono); color: var(--ink-soft); text-decoration: none; background: var(--sunk); }
.gr-day-chip.is-current { border-color: var(--accent); color: var(--accent-dark); background: var(--accent-soft); }
.gr-counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 0; }
.gr-counts div { border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 8px; background: var(--sunk); }
.gr-counts dt { font: 400 10px/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.gr-counts dd { margin: 3px 0 0; font: 500 14px/1.2 var(--mono); }
.gr-marker { margin: 10px 0 0; font-size: 12px; color: var(--ink-soft); }
.gr-main { padding: 12px 16px 24px; display: grid; gap: 18px; align-content: start; }
.gr-room { border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius); background: var(--panel); }
.gr-room-head { padding: 12px 12px 10px; border-bottom: 1px solid var(--line); }
.gr-room-head h2 { margin: 0; font: 500 17px/1.15 var(--mono); letter-spacing: -.02em; }
.gr-room-where { display: block; margin-top: 3px; font-size: 12px; color: var(--ink-soft); }
.gr-av { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 0; padding: 0; }
.gr-av li { font: 400 10.5px/1 var(--mono); border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 4px 6px; color: var(--ink-soft); }
.gr-room-note { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--ink); border-left: 3px solid var(--warning); padding-left: 8px; }
.gr-sessions { display: grid; }
.gr-session { padding: 12px; border-top: 1px solid var(--line); }
.gr-session:first-child { border-top: 0; }
.gr-session.is-now { background: var(--accent-soft); }
/* Present but not awaited: legible, and visibly not part of the count. */
.gr-speaker.is-declined { opacity: .62; }
.gr-speaker.is-declined .gr-speaker-stamp { font-style: italic; }
.gr-session-head { display: grid; gap: 4px; }
.gr-session-when { display: flex; align-items: center; gap: 8px; }
.gr-live, .gr-next { font: 500 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; padding: 4px 6px; border-radius: var(--radius); }
.gr-live { background: var(--accent); color: var(--on-ink); }
.gr-next { border: 1px solid var(--accent); color: var(--accent-dark); }
.gr-time { font: 400 12px/1 var(--mono); color: var(--ink-soft); }
.gr-session-title { margin: 0; font: 500 15px/1.3 var(--sans); }
.gr-session-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.gr-chip { font: 400 11px/1 var(--mono); padding: 5px 7px; border-radius: var(--radius); border: 1px solid var(--line-strong); color: var(--ink-soft); }
.gr-chip.is-good { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); }
.gr-chip.is-warn { border-color: var(--warning-line); background: var(--warning-soft); color: var(--warning-ink); }
.gr-chip.is-alarm { border-color: var(--danger-line); background: var(--danger-soft); color: var(--danger-ink); }
.gr-chip.is-quiet { opacity: .75; }
.gr-arrived { font: 400 12px/1 var(--mono); color: var(--ink-soft); }
.gr-speakers { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.gr-speaker { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--line); border-radius: var(--radius); padding: 8px; background: var(--sunk); }
.gr-speaker.is-here { border-color: var(--accent); }
.gr-speaker-who { display: grid; gap: 2px; min-width: 0; }
.gr-speaker-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
/* Reserved height: the stamp appears and disappears without moving anything. */
.gr-speaker-stamp { min-height: 15px; font: 400 11px/1.35 var(--mono); color: var(--ink-soft); }
.gr-speaker-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.gr-call { font: 400 12px/1 var(--mono); color: var(--accent-dark); text-decoration: none; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 9px 10px; }
/* Fixed width in both states: "Mark in" and "Here" must occupy the same box. */
.gr-mark { width: 84px; min-height: 38px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--panel); color: var(--ink); font: 500 12px/1 var(--mono); cursor: pointer; }
.gr-mark[data-state="here"] { border-color: var(--accent); background: var(--accent); color: var(--on-ink); }
.gr-mark[aria-busy="true"] { opacity: .6; }
.gr-flag { width: 44px; text-align: right; font: 400 11px/1 var(--mono); color: var(--ink-soft); }
.gr-flag.is-here { color: var(--accent-dark); }
.gr-empty { border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--panel); padding: 18px; }
.gr-empty h2 { margin: 0 0 8px; font: 500 16px/1.2 var(--mono); }
.gr-empty p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--ink-soft); }
.gr-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--line-strong); background: var(--panel); position: sticky; bottom: 0; }
.gr-status { font: 400 11px/1.3 var(--mono); color: var(--ink-soft); min-height: 15px; }
.gr-status.is-error { color: var(--danger-ink); }
.gr-refresh { font: 400 12px/1 var(--mono); color: var(--accent-dark); text-decoration: none; border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 9px 12px; }
@media (min-width: 720px) {
  .gr-main { grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); padding: 16px 24px 32px; }
  .gr-top { padding: 20px 24px 16px; }
}
`;

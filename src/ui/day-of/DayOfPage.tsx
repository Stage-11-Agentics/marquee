/** @jsxImportSource preact */

/**
 * The day-of desk.
 *
 * Two things an organizer needs on the morning of the show and cannot get from
 * any other screen: whether every session's deck is in, in the order the day
 * will actually run; and the links the crew is holding — one green-room link
 * for looking, one named link per volunteer who may mark speakers in.
 *
 * The board is a projection of the run of show rather than a second files
 * query, so it cannot disagree with the green room a volunteer is reading in
 * the corridor. The counts are taken before the state filter, so the number on
 * a chip is the number of rows clicking it produces.
 */

import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { DayOfLinkSummary } from "../../lib/day-of/links";
import type { SlidesBoardSnapshot, SlidesBoardState } from "../../lib/day-of/slides-board";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Chip, EmptyState, PageHeader } from "../shell/components";
import "./day-of.css";

const BOARD_ROUTE = "/api/v1/events/{eventId}/slides-board";
const LINKS_ROUTE = "/api/v1/events/{eventId}/day-of/links";
const SEND_ROUTE = "/api/v1/events/{eventId}/comms/send";

const STATE_LABELS: Record<SlidesBoardState, string> = {
  all: "Every session",
  received: "Slides in",
  missing: "Still owed",
  overdue: "Overdue",
};

const SLIDES_COPY: Record<string, string> = {
  received: "In",
  missing: "Not yet",
  overdue: "Overdue",
  done_without_file: "Done, no file",
  not_requested: "No slides requested",
};

function slidesTone(state: string): "" | "success" | "warning" | "alarm" {
  if (state === "received") return "success";
  if (state === "overdue") return "alarm";
  if (state === "not_requested") return "";
  return "warning";
}

function clock(value: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

/**
 * When a link was last opened, as a whole phrase.
 *
 * A link nobody has opened yet has no "last used", so the phrase carries its own
 * preposition rather than being glued behind one — "last used not used yet" is
 * the sentence that comes out otherwise.
 */
function lastUsed(value: number | null): string {
  if (value === null) return "not used yet";
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  return `last used ${when}`;
}

type BoardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: SlidesBoardSnapshot };

interface AskResult {
  queued: number;
  duplicate: number;
  message: string;
  failed: boolean;
}

export function DayOfPage({ eventId }: { eventId: string }): JSX.Element {
  const [day, setDay] = useState<string | null>(null);
  const [state, setState] = useState<SlidesBoardState>("all");
  const [roomId, setRoomId] = useState("");
  const [board, setBoard] = useState<BoardState>({ kind: "loading" });
  const [links, setLinks] = useState<DayOfLinkSummary[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ name: string; url: string } | null>(null);
  const [volunteerName, setVolunteerName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<Record<string, AskResult>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ state });
    if (day) query.set("day", day);
    if (roomId) query.set("room_id", roomId);
    setBoard((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    apiFetch<{ data: SlidesBoardSnapshot }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/slides-board?${query.toString()}`,
      { signal: controller.signal, route: BOARD_ROUTE },
    )
      .then((body) => setBoard({ kind: "ready", snapshot: body.data }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBoard({ kind: "error", message: errorSummary(error) });
      });
    return () => controller.abort();
  }, [eventId, day, state, roomId, reload]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ data: DayOfLinkSummary[] }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/day-of/links`,
      { signal: controller.signal, route: LINKS_ROUTE },
    )
      .then((body) => setLinks(body.data))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLinkError(errorSummary(error));
      });
    return () => controller.abort();
  }, [eventId, reload]);

  const snapshot = board.kind === "ready" ? board.snapshot : null;
  const timezone = snapshot?.event.timezone ?? "UTC";
  const liveLinks = useMemo(() => links.filter((link) => link.revoked_at === null), [links]);
  const greenRoomLink = liveLinks.find((link) => link.kind === "green_room") ?? null;
  const checkinLinks = liveLinks.filter((link) => link.kind === "checkin");

  const mint = async (kind: "green_room" | "checkin", name: string) => {
    setBusy(kind); setLinkError(null);
    try {
      const body = await apiFetch<{ data: DayOfLinkSummary; url: string }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/day-of/links`,
        {
          method: "POST",
          route: LINKS_ROUTE,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, name }),
        },
      );
      setMinted({ name: body.data.name, url: `${window.location.origin}${body.url}` });
      setVolunteerName("");
      setReload((value) => value + 1);
    } catch (error) {
      setLinkError(errorSummary(error));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (link: DayOfLinkSummary) => {
    setBusy(link.id); setLinkError(null);
    try {
      await apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/day-of/links/${encodeURIComponent(link.id)}`, {
        method: "DELETE",
        route: "/api/v1/events/{eventId}/day-of/links/{linkId}",
      });
      setMinted((current) => (current && current.name === link.name ? null : current));
      setReload((value) => value + 1);
    } catch (error) {
      setLinkError(errorSummary(error));
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Ask again" is the existing reminder path with one session's outstanding
   * speakers selected — the same demo-safe outbox, the same duplicate
   * accounting. The recipient count is on the button before it is pressed, so
   * nobody sends mail to a number they have not seen.
   */
  const askAgain = async (sessionId: string, pairs: { person_id: string; submission_id: string | null }[]) => {
    if (pairs.length === 0) return;
    setBusy(sessionId);
    try {
      const body = await apiFetch<{ queued: number; duplicate: number; selected: number }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/comms/send`,
        {
          method: "POST",
          route: SEND_ROUTE,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selector: { recipient_pairs: pairs, task_state: "open" }, template_key: "task_overdue" }),
        },
      );
      setAsked((current) => ({
        ...current,
        [sessionId]: {
          queued: body.queued,
          duplicate: body.duplicate,
          failed: false,
          message: `${body.queued} queued${body.duplicate > 0 ? ` · ${body.duplicate} already waiting` : ""}`,
        },
      }));
    } catch (error) {
      setAsked((current) => ({
        ...current,
        [sessionId]: { queued: 0, duplicate: 0, failed: true, message: errorSummary(error) },
      }));
    } finally {
      setBusy(null);
    }
  };

  return <>
    <PageHeader
      title="Day of"
      copy="Every session in the order it runs, whether its slides are in, and the links the crew holds."
      actions={<a class="button" href="/green-room" target="_blank" rel="noreferrer">Open the green room</a>}
    />

    {board.kind === "error" ? (
      <EmptyState title="The board could not be read" copy={board.message} action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>} />
    ) : null}

    {snapshot ? <>
      <div class="dayof-bar">
        <div class="dayof-days">
          {snapshot.days.map((entry) => (
            <button
              key={entry.id}
              type="button"
              class={`dayof-day${entry.id === snapshot.day ? " is-current" : ""}`}
              aria-pressed={entry.id === snapshot.day ? "true" : "false"}
              onClick={() => setDay(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <select
          class="dayof-room-filter"
          aria-label="Room"
          value={roomId}
          onChange={(event) => setRoomId((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Every room</option>
          {snapshot.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
      </div>

      <div class="dayof-counts">
        {(Object.keys(STATE_LABELS) as SlidesBoardState[]).map((entry) => (
          <button
            key={entry}
            type="button"
            class={`dayof-count${entry === state ? " is-current" : ""}`}
            aria-pressed={entry === state ? "true" : "false"}
            onClick={() => setState(entry)}
          >
            <strong class="tabular">{snapshot.counts[entry]}</strong> {STATE_LABELS[entry]}
          </button>
        ))}
      </div>

      <section class="card" style="margin-top:12px">
        {snapshot.rows.length === 0 ? (
          <EmptyState
            title="No session here yet"
            copy="Place sessions on the agenda for this day and they appear here in the order they run, each with the state of its deck."
          />
        ) : (
          <table class="dayof-table">
            <thead>
              <tr><th>When</th><th>Session</th><th>Room</th><th>Slides</th><th>Ask again</th></tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => {
                const pairs = row.owed.map((owed) => ({ person_id: owed.person_id, submission_id: row.submission_id }));
                const result = asked[row.session_id];
                return (
                  <tr key={row.session_id}>
                    <td class="dayof-when">{clock(row.starts_at, timezone)}</td>
                    <td>
                      <span class="dayof-title">{row.title}</span>
                      <span class="dayof-speakers">
                        {row.speakers.length === 0 ? "Speaker to be announced" : row.speakers.map((speaker) => speaker.name).join(" · ")}
                      </span>
                    </td>
                    <td>{row.room_name}</td>
                    <td>
                      <Chip tone={slidesTone(row.slides.state)}>{SLIDES_COPY[row.slides.state] ?? row.slides.state}</Chip>
                      {row.slides.expected > 1 ? (
                        <span class="dayof-speakers tabular">{row.slides.received} of {row.slides.expected} in</span>
                      ) : null}
                    </td>
                    <td>
                      <Button
                        small
                        class="dayof-ask"
                        disabled={pairs.length === 0 || busy === row.session_id}
                        onClick={() => void askAgain(row.session_id, pairs)}
                      >
                        {pairs.length === 0 ? "Nothing owed" : busy === row.session_id ? "Sending…" : `Ask ${pairs.length}`}
                      </Button>
                      <span class={`dayof-ask-result${result?.failed ? " is-error" : ""}`} role="status">
                        {result ? result.message : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </> : null}

    <section class="card" style="margin-top:16px">
      <h2 style="margin:0 0 4px">The links the crew holds</h2>
      <p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px">
        One green-room link for anyone who only needs to look, and a named link for each volunteer who may
        mark speakers in. Revoking a link kills every copy of it at once.
      </p>
      {linkError ? <div class="inline-error" role="alert">{linkError}</div> : null}
      <div class="dayof-links">
        <div class="dayof-link-row">
          <div>
            <span class="dayof-link-name">{greenRoomLink ? greenRoomLink.name : "No green-room link yet"}</span>
            <span class="dayof-link-meta">
              {greenRoomLink
                ? `Looks only · ${lastUsed(greenRoomLink.last_used_at)}`
                : "Make one and share it with the crew — it opens the run of show and nothing else."}
            </span>
          </div>
          <div style="display:flex;gap:8px">
            <Button small disabled={busy === "green_room"} onClick={() => void mint("green_room", "Green room")}>
              {busy === "green_room" ? "Working…" : greenRoomLink ? "Rotate" : "Make one"}
            </Button>
            {greenRoomLink ? (
              <Button small variant="danger" disabled={busy === greenRoomLink.id} onClick={() => void revoke(greenRoomLink)}>Revoke</Button>
            ) : null}
          </div>
        </div>
        {checkinLinks.map((link) => (
          <div key={link.id} class="dayof-link-row">
            <div>
              <span class="dayof-link-name">{link.name}</span>
              <span class="dayof-link-meta">Marks speakers in · {lastUsed(link.last_used_at)}</span>
            </div>
            <Button small variant="danger" disabled={busy === link.id} onClick={() => void revoke(link)}>Revoke</Button>
          </div>
        ))}
      </div>
      <div class="dayof-mint">
        <input
          aria-label="Who this link is for"
          placeholder="Sam, front door"
          value={volunteerName}
          maxLength={120}
          onInput={(event) => setVolunteerName((event.currentTarget as HTMLInputElement).value)}
        />
        <Button
          variant="primary"
          small
          disabled={volunteerName.trim().length === 0 || busy === "checkin"}
          onClick={() => void mint("checkin", volunteerName.trim())}
        >
          {busy === "checkin" ? "Minting…" : "Make a check-in link"}
        </Button>
      </div>
      {minted ? (
        <div class="dayof-minted">
          <strong>{minted.name} — copy this now.</strong>
          <code>{minted.url}</code>
          <span class="dayof-link-meta">It is shown once. If it is lost, revoke it and make another.</span>
        </div>
      ) : null}
    </section>
  </>;
}

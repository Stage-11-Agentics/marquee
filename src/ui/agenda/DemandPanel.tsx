/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, EmptyState, Switch } from "../shell/components";

const DEMAND_ROUTE = "/api/v1/events/{eventId}/agenda/demand";
const DEMAND_SETTINGS_ROUTE = "/api/v1/events/{eventId}/agenda/demand/settings";

export interface DemandSession {
  session_id: string;
  title: string;
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
  capacity: number | null;
  count: number;
}

export interface DemandStatsView {
  imported: number;
  synced: number;
  via_agents: number;
  claimed: number;
  advance_picks: number;
}

export interface DemandSnapshot {
  sessions: DemandSession[];
  stats: DemandStatsView;
  public_counts: { enabled: boolean; threshold: number };
}

/**
 * The bar's domain runs to 125%, so an over-subscribed session has somewhere
 * to go and the 100% tick sits inside the track where it can be read against
 * the fill rather than at the edge where it reads as the end of the bar.
 */
const BAR_DOMAIN = 1.25;
const TICK_PERCENT = (1 / BAR_DOMAIN) * 100;

export function capacityRatio(session: DemandSession): number | null {
  if (!session.capacity || session.capacity <= 0) return null;
  return session.count / session.capacity;
}

/** Loud where it matters and quiet everywhere else: only a real squeeze earns colour. */
export function capacityTone(ratio: number | null): "" | "near" | "over" {
  if (ratio === null) return "";
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "near";
  return "";
}

export function capacityLabel(session: DemandSession): string {
  const ratio = capacityRatio(session);
  // An em-dash, not a zero and not a guess: a room with no capacity recorded
  // is a fact about the venue model, and inventing a percentage from it would
  // put a fabricated number on the screen that exists to prevent exactly that.
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}% of room${ratio >= 1 ? " — bigger room?" : ""}`;
}

function timeLabel(session: DemandSession, timezone: string): string {
  if (session.starts_at === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
  }).format(new Date(session.starts_at));
}

function DemandRow({ session, timezone }: { session: DemandSession; timezone: string }): JSX.Element {
  const ratio = capacityRatio(session);
  const tone = capacityTone(ratio);
  const fill = ratio === null ? 0 : Math.min(ratio, BAR_DOMAIN) / BAR_DOMAIN * 100;
  return (
    <div class="agenda-demand-row" role="listitem">
      <span class="agenda-demand-count tabular">{session.count}</span>
      <span class="agenda-demand-title">
        <strong title={session.title}>{session.title}</strong>
        <small>{timeLabel(session, timezone)}{session.duration_min ? ` · ${session.duration_min}m` : ""}</small>
      </span>
      <span class="agenda-demand-room">
        <strong>{session.room ?? "Room not set"}</strong>
        {session.capacity ? <>capacity <span class="tabular">{session.capacity}</span></> : "capacity not recorded"}
      </span>
      <span class="agenda-demand-bar" aria-hidden="true">
        <i class={tone === "over" ? "over" : ""} style={{ width: `${fill.toFixed(1)}%` }} />
        <span class="tick" style={{ left: `${TICK_PERCENT}%` }} />
      </span>
      <span class={`agenda-demand-cap ${tone}`.trim()} title="Advance picks against room capacity">
        {capacityLabel(session)}
      </span>
    </div>
  );
}

/**
 * Session demand, as a panel of the Agenda module.
 *
 * It loads on its own rather than riding the agenda snapshot: the board is the
 * screen an organizer drags sessions around on all afternoon, and two extra
 * aggregate queries on every placement would make placing slower to pay for a
 * number nobody is looking at mid-drag (R7).
 */
export function DemandPanel({ eventId, timezone }: { eventId: string; timezone: string }): JSX.Element {
  const [snapshot, setSnapshot] = useState<DemandSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const path = `/api/v1/events/${encodeURIComponent(eventId)}/agenda/demand`;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<{ data: DemandSnapshot }>(path, { signal, route: DEMAND_ROUTE });
      setSnapshot(result.data);
      setMessage("");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(errorSummary(error));
    }
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const saveSetting = async (next: { enabled: boolean; threshold: number }) => {
    if (!snapshot) return;
    setBusy(true);
    // Painted before the round trip so the switch answers the finger that
    // moved it; the reload below is what makes it true.
    setSnapshot({ ...snapshot, public_counts: next });
    try {
      await apiFetch<unknown>(`${path}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
        route: DEMAND_SETTINGS_ROUTE,
      });
      await load();
    } catch (error: unknown) {
      setMessage(errorSummary(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setting = snapshot?.public_counts ?? { enabled: false, threshold: 3 };

  return (
    <section class="card agenda-demand-panel" aria-labelledby="agenda-demand-title">
      <header class="agenda-demand-head">
        <div>
          <span class="eyebrow">Advance demand</span>
          <h2 id="agenda-demand-title">Session demand</h2>
          <p>
            Anonymous star counts from attendee schedules — the room-planning signal you normally
            get when a room overflows, weeks early. A count is distinct devices plus distinct
            agent-built schedules. A signal, not a vote: it is lightly rate-limited and spoofable
            by someone determined.
          </p>
        </div>
        <Button small onClick={() => void load()}>Refresh</Button>
      </header>

      <div class="agenda-demand-stats">
        <span class="agenda-demand-stat"><strong>{snapshot?.stats.imported ?? 0}</strong><span>attendees imported</span></span>
        <span class="agenda-demand-stat"><strong>{snapshot?.stats.synced ?? 0}</strong><span>synced schedules</span></span>
        <span class="agenda-demand-stat"><strong>{snapshot?.stats.via_agents ?? 0}</strong><span>via agents</span></span>
        <span class="agenda-demand-stat"><strong>{snapshot?.stats.claimed ?? 0}</strong><span>claimed with email</span></span>
        <span class="agenda-demand-stat"><strong>{snapshot?.stats.advance_picks ?? 0}</strong><span>advance picks</span></span>
      </div>

      {message && <div class="agenda-notice" role="status"><span>{message}</span></div>}

      {snapshot && snapshot.sessions.length > 0 ? (
        <div role="list" aria-label="Published sessions ranked by advance demand">
          <div class="agenda-demand-row head" role="presentation">
            <span>★</span>
            <span>Session</span>
            <span class="h-room">Room</span>
            <span class="h-bar" title="Advance picks as a share of room capacity; the tick is 100%">room fullness</span>
            <span style={{ justifySelf: "end" }}>vs capacity</span>
          </div>
          {snapshot.sessions.map((session) => (
            <DemandRow key={session.session_id} session={session} timezone={timezone} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={snapshot ? "No published sessions yet" : "Reading advance demand…"}
          copy={snapshot
            ? "Demand appears once the programme is public and attendees start starring. Nothing here is retrospective — it is the signal before the doors open."
            : "Counting stars against rooms."}
        />
      )}

      <div class="agenda-demand-setting">
        <label>
          Show counts on the public agenda
          <small>Ships off — popularity is a choice, not a given. Your own numbers above are always exact.</small>
        </label>
        <div class="agenda-demand-setting-controls">
          <Switch
            on={setting.enabled}
            label="Show star counts on the public agenda"
            onClick={() => { if (!busy) void saveSetting({ ...setting, enabled: !setting.enabled }); }}
          />
        </div>
      </div>
      <div class="agenda-demand-setting">
        <label>
          Only show once a session has at least
          <small>Below this, attendees see no number at all — the space stays reserved so nothing moves when one crosses.</small>
        </label>
        <div class="agenda-demand-setting-controls">
          <input
            class="agenda-demand-threshold"
            type="number"
            min={1}
            max={99}
            value={setting.threshold}
            aria-label="Minimum picks before the count is public"
            disabled={busy}
            onChange={(event) => {
              const raw = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
              // Floor 1, and a blank or nonsense entry reverts rather than
              // publishing "0 schedules include this session".
              const threshold = Number.isFinite(raw) ? Math.max(1, Math.min(99, raw)) : setting.threshold;
              (event.currentTarget as HTMLInputElement).value = String(threshold);
              if (threshold !== setting.threshold) void saveSetting({ ...setting, threshold });
            }}
          />
        </div>
      </div>
    </section>
  );
}

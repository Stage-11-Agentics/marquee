import type { ComponentChildren, JSX } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";

import { abortInFlightRequests, apiFetch, errorSummary } from "./api-client";
import { EVENT_NAME_CHANGED, loadAuthMe } from "./identity";
import {
  clearStoredEvent,
  readStoredEvent,
  resolveEventSelection,
  writeStoredEvent,
} from "./event-selection";

export const EVENTS_ROUTE = "/api/v1/events";

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  demo_mode: number;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue: string | null;
  role: string;
  submission_count: number;
  past: boolean;
}

export type EventContextStatus = "loading" | "ready" | "empty" | "error";

export interface EventContextValue {
  status: EventContextStatus;
  events: EventSummary[];
  eventId: string | null;
  event: EventSummary | null;
  error: string;
  /** Point this tab at another conference. The caller navigates. */
  switchEvent: (eventId: string) => void;
  refresh: () => Promise<void>;
}

const EMPTY: EventContextValue = {
  status: "loading",
  events: [],
  eventId: null,
  event: null,
  error: "",
  switchEvent: () => {},
  refresh: async () => {},
};

const EventContext = createContext<EventContextValue>(EMPTY);

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The conference every screen in the shell is scoped to.
 *
 * It is mounted in `ShellEntry` rather than inside `AppShell`, and that is not
 * a stylistic choice: `/delivery-health` is a separate render root, and
 * `AppShell` answers the portal, co-speaker and reviewer routes before it draws
 * its own layout. A provider inside the layout would reach neither, which is
 * exactly the set of screens most likely to belong to a seat that can read one
 * conference and not the others.
 *
 * It never blocks rendering. A speaker whose organization holds no conference
 * they can read still needs their portal to open, so children mount
 * immediately and `eventId` is simply null until the list answers.
 */
export function EventProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [status, setStatus] = useState<EventContextStatus>("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    const session = sessionStorageOrUndefined();
    const local = localStorageOrUndefined();
    try {
      const [body, auth] = await Promise.all([
        apiFetch<{ data: EventSummary[] }>(EVENTS_ROUTE, {
          headers: { accept: "application/json" },
          cache: "no-store",
          route: EVENTS_ROUTE,
        }),
        // Module-memoized, so this costs nothing the shell was not already
        // paying for; it is read here only for the demo conference floor.
        loadAuthMe().catch(() => null),
      ]);
      const list = Array.isArray(body?.data) ? body.data : [];
      const requested = new URLSearchParams(window.location.search).get("event");
      const selection = resolveEventSelection(
        [requested, readStoredEvent(session), readStoredEvent(local), auth?.demo_event_id],
        list,
      );
      // A stored id that no longer resolves is forgotten here, not carried into
      // a session of 404s under a conference that was swept away.
      for (const ghost of selection.stale) {
        if (readStoredEvent(session) === ghost) clearStoredEvent(session);
        if (readStoredEvent(local) === ghost) clearStoredEvent(local);
      }
      setEvents(list);
      setEventId(selection.eventId);
      if (selection.eventId) {
        writeStoredEvent(session, selection.eventId);
        writeStoredEvent(local, selection.eventId);
      }
      setError("");
      setStatus(list.length === 0 ? "empty" : "ready");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(errorSummary(caught));
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The rename channel already exists; a second one would only mean two places
  // where the sidebar and the switcher could disagree about the same name.
  useEffect(() => {
    const onRenamed = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (typeof name !== "string" || name.trim().length === 0) return;
      setEvents((current) => current.map((entry) => (entry.id === eventId ? { ...entry, name: name.trim() } : entry)));
    };
    window.addEventListener(EVENT_NAME_CHANGED, onRenamed);
    return () => window.removeEventListener(EVENT_NAME_CHANGED, onRenamed);
  }, [eventId]);

  const switchEvent = useCallback((next: string) => {
    setEventId((current) => {
      if (current === next) return current;
      abortInFlightRequests();
      writeStoredEvent(sessionStorageOrUndefined(), next);
      writeStoredEvent(localStorageOrUndefined(), next);
      // A `?event=` that stays in the address bar re-pins the old conference on
      // the next reload, which reads as the switch quietly undoing itself.
      const url = new URL(window.location.href);
      if (url.searchParams.has("event")) {
        url.searchParams.delete("event");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
      return next;
    });
  }, []);

  const value = useMemo<EventContextValue>(() => ({
    status,
    events,
    eventId,
    event: events.find((entry) => entry.id === eventId) ?? null,
    error,
    switchEvent,
    refresh: load,
  }), [status, events, eventId, error, switchEvent, load]);

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

export function useEventContext(): EventContextValue {
  return useContext(EventContext);
}

/** The current conference id, or null while it is being resolved or when there is none. */
export function useEventId(): string | null {
  return useContext(EventContext).eventId;
}

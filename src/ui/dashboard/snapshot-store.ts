/**
 * One dashboard snapshot, shared by everything that reads it.
 *
 * The Program pipeline row's stage flyout shows the same seven counts the
 * dashboard strip shows, and it has to show them the instant a pointer rests on
 * the row — R7, speed is a feature. A fetch on hover would be a spinner in a
 * menu, so the flyout never fetches: it reads whatever this store last saw.
 *
 * Two producers write here, and only one of them costs a request:
 *
 *   - `DashboardPage` publishes every snapshot its five-second poll already
 *     reads. While an organizer is standing on the dashboard, the counts in the
 *     flyout are that poll's, at no extra cost at all.
 *   - Anywhere else, `useDashboardSnapshot` reads one for itself — after a
 *     short delay, so a cold load of the dashboard does not fetch twice, and
 *     then only when nothing fresher has been published in the meantime.
 */
import type { DashboardSnapshot } from "../../api/dashboard";
import { useEffect, useState } from "preact/hooks";

import { apiFetch } from "../shell/api-client";

const DASHBOARD_ROUTE = "/api/v1/events/{eventId}/dashboard";

/**
 * How old a published snapshot may be before a passive reader reads its own.
 * The dashboard's own poll is six times faster than this, so a reader standing
 * on the dashboard never issues a request of its own.
 */
export const SNAPSHOT_FRESH_MS = 30_000;

/**
 * Long enough for a mounted `DashboardPage`'s first load to land and publish.
 * Without it, opening the dashboard cold would read the same document twice —
 * once for the strip and once for a flyout nobody has hovered yet.
 */
export const FIRST_READ_DELAY_MS = 1_000;

interface CacheEntry {
  eventId: string;
  snapshot: DashboardSnapshot;
  at: number;
}

let cached: CacheEntry | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of [...listeners]) listener();
}

/** A snapshot somebody already paid for. */
export function publishDashboardSnapshot(eventId: string, snapshot: DashboardSnapshot): void {
  cached = { eventId, snapshot, at: Date.now() };
  announce();
}

/** The snapshot this conference last saw, or null. Never a request. */
export function readDashboardSnapshot(eventId: string | null): DashboardSnapshot | null {
  if (!eventId || cached?.eventId !== eventId) return null;
  return cached.snapshot;
}

/** Test seam: a store that remembers a previous test is a test that lies. */
export function resetDashboardSnapshot(): void {
  cached = null;
  inFlight = null;
}

function stale(eventId: string): boolean {
  return cached?.eventId !== eventId || Date.now() - cached.at > SNAPSHOT_FRESH_MS;
}

async function read(eventId: string): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const snapshot = await apiFetch<DashboardSnapshot>(
        `/api/v1/events/${encodeURIComponent(eventId)}/dashboard`,
        { route: DASHBOARD_ROUTE },
      );
      publishDashboardSnapshot(eventId, snapshot);
    } catch {
      // A nav accelerator does not get to raise an error surface. The rows
      // render without their counts and the destinations still work.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Subscribe to the shared snapshot, reading one only when nobody else has.
 */
export function useDashboardSnapshot(eventId: string | null): DashboardSnapshot | null {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(() => readDashboardSnapshot(eventId));

  useEffect(() => {
    const sync = () => setSnapshot(readDashboardSnapshot(eventId));
    sync();
    listeners.add(sync);
    if (!eventId) return () => { listeners.delete(sync); };

    let timer = 0;
    const tick = () => {
      // A hidden tab is a tab whose flyout nobody is about to open.
      if (!stale(eventId) || (typeof document !== "undefined" && document.hidden)) return;
      void read(eventId);
    };
    const first = window.setTimeout(() => {
      tick();
      timer = window.setInterval(tick, SNAPSHOT_FRESH_MS);
    }, FIRST_READ_DELAY_MS);

    return () => {
      listeners.delete(sync);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [eventId]);

  return snapshot;
}

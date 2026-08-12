/**
 * Which conference this tab is looking at.
 *
 * Admin URLs carry no event segment, so the selection lives beside the browser
 * rather than in the path: `?event=` for a link somebody shared, sessionStorage
 * so two tabs can hold two conferences, localStorage so a new tab opens on the
 * one you were last in, and the instance's demo conference as the floor.
 *
 * The rule that matters is the last one. **No stored id is trusted on its own.**
 * A demo reset now sweeps the whole organization, so a conference created ten
 * minutes ago is gone while both storages still name it — and the reset ends in
 * a full page reload straight back through this resolver. An id that no longer
 * appears in the list is not a selection, it is a ghost, and it is cleared
 * rather than carried into a session of 404s.
 */

export const EVENT_STORAGE_KEY = "marquee.event";

export interface SelectableEvent {
  id: string;
}

export interface EventSelection {
  /** The conference to show, or null when this seat can read none. */
  eventId: string | null;
  /** Stored candidates that named a conference that is no longer there. */
  stale: string[];
}

/**
 * Candidates in precedence order; the first one that names a conference in the
 * list wins. Everything before it that named something absent is reported so
 * the caller can forget it.
 */
export function resolveEventSelection(
  candidates: readonly (string | null | undefined)[],
  events: readonly SelectableEvent[],
): EventSelection {
  const known = new Set(events.map((event) => event.id));
  const stale: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (known.has(candidate)) return { eventId: candidate, stale };
    if (!stale.includes(candidate)) stale.push(candidate);
  }
  return { eventId: events[0]?.id ?? null, stale };
}

/** Storage that is absent or refusing (private windows, disabled cookies) is not an error. */
export function readStoredEvent(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(EVENT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredEvent(storage: Storage | undefined, eventId: string): void {
  try {
    storage?.setItem(EVENT_STORAGE_KEY, eventId);
  } catch {
    // A tab that cannot remember its conference still works; it just re-reads
    // the precedence chain next time.
  }
}

export function clearStoredEvent(storage: Storage | undefined): void {
  try {
    storage?.removeItem(EVENT_STORAGE_KEY);
  } catch {
    // Same reasoning as above.
  }
}

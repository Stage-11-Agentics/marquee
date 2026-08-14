/**
 * Hover intent: one timer, two delays.
 *
 * A pointer crossing a nav row on its way somewhere else must not flash a panel
 * at it, and a pointer travelling from the row to the panel it opened must not
 * lose it in the gap. Both are the same mechanism — a short wait before opening,
 * a longer one before closing — and both have to share a single timer, so an
 * arriving open cancels a pending close and vice versa. Two timers is how a
 * panel ends up opening a moment after it was told to close.
 */
export const HOVER_OPEN_MS = 150;
export const HOVER_CLOSE_MS = 220;

export interface HoverIntent {
  /** Pointer arrived, or the row took keyboard focus. */
  enter(): void;
  /** Pointer left, or focus moved on. */
  leave(): void;
  /** Neither — stop whatever was pending (entering the panel itself). */
  cancel(): void;
}

export function createHoverIntent(
  open: () => void,
  close: () => void,
  openMs: number = HOVER_OPEN_MS,
  closeMs: number = HOVER_CLOSE_MS,
): HoverIntent {
  let timer = 0;
  const cancel = () => { clearTimeout(timer); };
  return {
    cancel,
    enter() { cancel(); timer = setTimeout(open, openMs) as unknown as number; },
    leave() { cancel(); timer = setTimeout(close, closeMs) as unknown as number; },
  };
}

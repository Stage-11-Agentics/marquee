import type { JSX } from "preact";

import { useDialogLifecycle } from "./OverlayHosts";

/**
 * What a 401 looks like on a live screen.
 *
 * It raises a wall over the current screen and nothing more: no navigation, no
 * replacement, no redirect. Their work stays visible behind it, which is the
 * whole difference between "your session ended" and "the page you were on is
 * gone". One wall, sticky for the session, so a dashboard whose six panels all
 * fail at once raises one answer rather than six.
 *
 * It reuses the shell's own modal chrome rather than introducing a stylesheet of
 * its own — an authored surface that cannot drift from Flight Deck, and one
 * fewer set of tokens for Night to have to redefine.
 */
export function SessionWall({ next }: { next: string }): JSX.Element {
  // Deliberately inert: the session is gone, so there is nothing behind this to
  // dismiss back to. Both ways out are the two buttons.
  const ref = useDialogLifecycle(true, () => undefined);
  return (
    <div class="modal-backdrop">
      <section
        ref={ref}
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Your session ended"
        tabIndex={-1}
      >
        <header class="modal-head">
          <div>
            <div class="eyebrow">Session</div>
            <h2>Your session ended.</h2>
            <p>Sign in again and you will come back to this page.</p>
          </div>
        </header>
        <footer class="modal-actions">
          <a class="button" href="/">Return to home</a>
          <a class="button primary" href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</a>
        </footer>
      </section>
    </div>
  );
}

import type { JSX } from "preact";
import { useCallback, useState } from "preact/hooks";

import { ErrorBoundary } from "../shell/ErrorSurface";
import { OverlayHost, ToastHost, type OverlayState } from "../shell/OverlayHosts";
import { QuickSearch } from "../shell/QuickSearch";
import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { matchRoute } from "../shell/route-table";
import { DeliveryHealthPage } from "./DeliveryHealthPage";
import { runDemoReset } from "./demo-reset";

/**
 * Delivery health renders the shared Flight Deck chrome around its own screen.
 * Navigation out of it is a real browser navigation rather than a client-side
 * push, so every sidebar destination resolves the same way it does anywhere
 * else — there is no dead end on this screen.
 */
export function DeliveryHealthShell({
  eventName = "AIE NYC 2026",
  userInitials = "MC",
  eventId = "evt_aie-ny-2026",
}: { eventName?: string; userInitials?: string; eventId?: string }): JSX.Element {
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState("");

  const navigate = useCallback((target: string) => { window.location.assign(target); }, []);
  const unavailable = useCallback(
    (title: string, copy: string) => setOverlay({ kind: "modal", title, copy }),
    [],
  );
  const resetDemo = useCallback(async () => {
    if (resetting) return;
    if (!window.confirm("Reset the demo conference? This removes demo edits, submissions, uploads, and queued work.")) return;
    setResetting(true);
    const rebuilt = await runDemoReset(setToast);
    if (rebuilt) window.setTimeout(() => window.location.reload(), 250);
    else setResetting(false);
  }, [resetting]);

  const route = matchRoute("/delivery-health");

  return <>
    <div class="app-shell">
      <Sidebar
        activeId={route?.id}
        eventName={eventName}
        navigate={navigate}
        unavailable={unavailable}
        resetting={resetting}
        onReset={() => void resetDemo()}
      />
      <main class="main">
        <Topbar
          eventName={eventName}
          routeName={route?.label ?? "Delivery health"}
          userInitials={userInitials}
          openSearch={() => setSearchOpen(true)}
          openUser={() => unavailable("Program lead", "Account preferences land with authentication and conference administration.")}
        />
        <div class="page">
          {/* The shell's own boundary, as the admin shell keeps: a screen that
              throws on its first render must not take navigation down with it. */}
          <ErrorBoundary label={route?.label ?? "Delivery health"}>
            <DeliveryHealthPage eventId={eventId} navigate={navigate} />
          </ErrorBoundary>
        </div>
      </main>
    </div>
    <OverlayHost state={overlay} onClose={() => setOverlay(null)} />
    <QuickSearch key={searchOpen ? "open" : "closed"} eventId={eventId} open={searchOpen} onClose={() => setSearchOpen(false)} navigate={navigate} />
    <ToastHost message={toast} />
  </>;
}

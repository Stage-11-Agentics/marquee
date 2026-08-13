import type { JSX } from "preact";
import { useCallback, useState } from "preact/hooks";

import { ErrorBoundary } from "../shell/ErrorSurface";
import { ToastHost } from "../shell/OverlayHosts";
import { QuickSearch } from "../shell/QuickSearch";
import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { useIdentity } from "../shell/identity";
import { useEventContext } from "../shell/event-context";
import { NoConference } from "../shell/NoConference";
import { matchRoute } from "../shell/route-table";
import { DeliveryHealthPage } from "./DeliveryHealthPage";
import { runDemoReset } from "./demo-reset";

/**
 * The health pages render the shared Flight Deck chrome around their own
 * screens. Navigation out of them is a real browser navigation rather than a
 * client-side push, so every sidebar destination resolves the same way it does
 * anywhere else — there is no dead end on either page.
 */
export function DeliveryHealthShell({ eventName }: { eventName: string }): JSX.Element {
  // A separate render root, which is why the conference context lives in
  // `ShellEntry`: this page is one of the surfaces a provider mounted inside
  // `AppShell` would never reach.
  const { eventId } = useEventContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const identity = useIdentity();
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState("");

  const navigate = useCallback((target: string) => { window.location.assign(target); }, []);
  const resetDemo = useCallback(async () => {
    if (resetting) return;
    if (!window.confirm("Reset the demo conference? This removes demo edits, submissions, uploads, and queued work.")) return;
    setResetting(true);
    const rebuilt = await runDemoReset(setToast);
    if (rebuilt) window.setTimeout(() => window.location.reload(), 250);
    else setResetting(false);
  }, [resetting]);

  const systemHealth = new URLSearchParams(window.location.search).get("view") === "system";
  const route = systemHealth
    ? matchRoute("/delivery-health?view=system")
    : matchRoute(window.location.pathname, window.location.search) ?? matchRoute("/delivery-health");
  const mode = systemHealth ? "system-health" : "speaker-followups";

  return <>
    <div class="app-shell">
      <Sidebar
        activeId={route?.id}
        eventName={eventName}
        navigate={navigate}
        resetting={resetting}
        onReset={() => void resetDemo()}
      />
      <main class="main">
        <Topbar
          eventName={eventName}
          routeName={route?.label ?? "Speaker follow-ups"}
          identity={identity}
          userMenuOpen={userMenuOpen}
          openSearch={() => setSearchOpen(true)}
          toggleUser={() => setUserMenuOpen((open) => !open)}
          closeUser={() => setUserMenuOpen(false)}
        />
        <div class="page">
          {/* The shell's own boundary, as the admin shell keeps: a screen that
              throws on its first render must not take navigation down with it. */}
          <ErrorBoundary label={route?.label ?? "Speaker follow-ups"} key={eventId ?? "no-conference"}>
            {eventId === null
              ? <NoConference navigate={navigate} />
              : <DeliveryHealthPage eventId={eventId} navigate={navigate} mode={mode} />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
    {eventId !== null && <QuickSearch key={searchOpen ? "open" : "closed"} eventId={eventId} open={searchOpen} onClose={() => setSearchOpen(false)} navigate={navigate} />}
    <ToastHost message={toast} />
  </>;
}

import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { SubmissionsPage } from "../submissions/SubmissionsPage";
import { EmptyState, PageHeader } from "./components";
import { OverlayHost, ToastHost, type OverlayState } from "./OverlayHosts";
import { matchRoute } from "./route-table";
import { useBrowserRouter } from "./router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommsScreen } from "../comms/CommsScreen";
import { DashboardPage } from "../dashboard/DashboardPage";
import { EvaluationPage } from "../evaluation/EvaluationPage";
import { EventSettings } from "../settings/EventSettings";
import { VenuesPage } from "../venues/VenuesPage";
import { FormsPage } from "../forms/FormsPage";
import { AgendaPage } from "../agenda/AgendaPage";

export function AppShell({ eventName = "AIE NYC 2026", userInitials = "MC" }: { eventName?: string; userInitials?: string }): JSX.Element {
  const [location, navigate] = useBrowserRouter();
  const route = matchRoute(location.pathname, location.search);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const unavailable = useCallback((title: string, copy: string) => setOverlay({ kind: "modal", title, copy }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" || event.key === "/") {
        event.preventDefault();
        unavailable("Global search", "Search becomes available when the conference data API lands.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [unavailable]);

  const routeName = route?.label ?? "Route not found";
  const isSubmissionsList = location.pathname === "/submissions";
  const isEvaluation = location.pathname === "/evaluation";
  const isForms = location.pathname === "/forms";
  const isAgenda = location.pathname === "/agenda-builder";
  return <>
    <div class="app-shell">
      <Sidebar activeId={route?.id} eventName={eventName} navigate={navigate} unavailable={unavailable} />
      <main class="main">
        <Topbar eventName={eventName} routeName={routeName} userInitials={userInitials} openSearch={() => unavailable("Global search", "Search becomes available when the conference data API lands.")} openUser={() => unavailable("Program lead", "Account preferences land with authentication and conference administration.")} />
        <div class="page">
          {isSubmissionsList
            ? <SubmissionsPage search={location.search} navigate={navigate} />
            : route?.id === "dashboard" ? <DashboardPage navigate={navigate} />
            : isEvaluation ? <EvaluationPage />
            : route?.id === "venues" ? <VenuesPage />
            : route?.id === "settings" ? <EventSettings navigate={navigate} />
            : isForms ? <FormsPage />
            : isAgenda ? <AgendaPage />
            : route?.id === "communications" ? <>
            <PageHeader title={routeName} copy="Templates, rendered previews, and a demo-safe delivery log for every message." />
            <CommsScreen />
          </> : <>
            <PageHeader title={routeName} copy="The shared Flight Deck shell is installed. This route's product module will replace the honest empty state below." />
            <EmptyState title={route ? `${route.label} is ready for its module` : "This route is not installed"} copy={route ? "Navigation, layout, overlays, responsive behavior, and accessibility are live; no product data is being simulated." : "Return to Program home or choose a module from the shared navigation."} />
          </>}
        </div>
      </main>
    </div>
    <OverlayHost state={overlay} onClose={closeOverlay} />
    <ToastHost />
  </>;
}

import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { SubmissionsPage } from "../submissions/SubmissionsPage";
import { Button, EmptyState, PageHeader } from "./components";
import { OverlayHost, ToastHost, type OverlayState } from "./OverlayHosts";
import { matchRoute } from "./route-table";
import { useBrowserRouter } from "./router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { QuickSearch } from "./QuickSearch";
import { CommsScreen } from "../comms/CommsScreen";
import { DashboardPage } from "../dashboard/DashboardPage";
import { EvaluationPage } from "../evaluation/EvaluationPage";
import { EventSettings } from "../settings/EventSettings";
import { ApiTokensPage } from "../settings/ApiTokensPage";
import { VenuesPage } from "../venues/VenuesPage";
import { FormsPage } from "../forms/FormsPage";
import { AgendaPage } from "../agenda/AgendaPage";
import { ReviewerPage } from "../review/ReviewerPage";
import { PortalPage } from "../portal/PortalPage";
import { ProgramBoardPage } from "../board/ProgramBoardPage";
import { CreateSubmissionPage } from "../submissions/CreateSubmissionPage";
import { SubmissionRecordPage } from "../submissions/SubmissionRecordPage";
import { OnboardingPage } from "../onboarding/OnboardingPage";
import { SessionizeImportPage } from "../import/SessionizeImportPage";

export function AppShell({ eventName = "AIE NYC 2026", userInitials = "MC" }: { eventName?: string; userInitials?: string }): JSX.Element {
  const [location, navigate] = useBrowserRouter();
  const route = matchRoute(location.pathname, location.search);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const unavailable = useCallback((title: string, copy: string) => setOverlay({ kind: "modal", title, copy }), []);

  useEffect(() => {
    const isNonAdminShell = location.pathname === "/portal" || location.pathname === "/reviewer";
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextControl = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (isNonAdminShell) return;
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === "/" && !isTextControl && !isNonAdminShell) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [location.pathname, openSearch]);

  const routeName = route?.label ?? "Route not found";
  const isSubmissionsList = location.pathname === "/submissions";
  const isProgramBoard = location.pathname === "/board";
  const isSubmissionNew = location.pathname === "/submissions/new";
  const isSubmissionRecord = location.pathname.startsWith("/submissions/") && !isSubmissionNew;
  const isEvaluation = location.pathname === "/evaluation";
  const isForms = location.pathname === "/forms";
  const isAgenda = location.pathname === "/agenda-builder";
  const isOnboarding = location.pathname === "/onboarding";
  const isImport = location.pathname === "/import";
  const isApiTokens = location.pathname === "/settings/api";
  if (location.pathname === "/portal") return <PortalPage />;
  if (location.pathname === "/reviewer") return <ReviewerPage />;
  return <>
    <div class="app-shell">
      <Sidebar activeId={route?.id} eventName={eventName} navigate={navigate} unavailable={unavailable} />
      <main class="main">
        <Topbar eventName={eventName} routeName={routeName} userInitials={userInitials} openSearch={openSearch} openUser={() => unavailable("Program lead", "Account preferences land with authentication and conference administration.")} />
        <div class="page">
          {isSubmissionsList
            ? <SubmissionsPage search={location.search} navigate={navigate} />
            : isProgramBoard ? <ProgramBoardPage navigate={navigate} />
            : isSubmissionNew ? <CreateSubmissionPage navigate={navigate} />
            : isSubmissionRecord ? <SubmissionRecordPage submissionId={decodeURIComponent(location.pathname.slice("/submissions/".length))} navigate={navigate} />
            : route?.id === "dashboard" ? <DashboardPage navigate={navigate} />
            : isEvaluation ? <EvaluationPage />
            : route?.id === "venues" ? <VenuesPage />
            : isApiTokens ? <ApiTokensPage navigate={navigate} />
            : route?.id === "settings" ? <EventSettings navigate={navigate} />
            : isForms ? <FormsPage search={location.search} />
            : isAgenda ? <AgendaPage />
            : isOnboarding ? <OnboardingPage navigate={navigate} />
            : isImport ? <SessionizeImportPage />
            : route?.id === "communications" ? <>
            <PageHeader title={routeName} copy="Templates, rendered previews, and a demo-safe delivery log for every message." />
            <CommsScreen />
          </> : <>
            <PageHeader title={routeName} copy="The shared Flight Deck shell is installed. This route's product module will replace the honest empty state below." />
            <EmptyState title={route ? `${route.label} is ready for its module` : "This route is not installed"} copy={route ? "Navigation, layout, overlays, responsive behavior, and accessibility are live; no product data is being simulated." : "Return to Program home or choose a module from the shared navigation."} action={<Button variant="primary" onClick={() => navigate("/")}>Back to Program home</Button>} />
          </>}
        </div>
      </main>
    </div>
    <OverlayHost state={overlay} onClose={closeOverlay} />
    <QuickSearch key={searchOpen ? "open" : "closed"} eventId="evt_aie-ny-2026" open={searchOpen} onClose={closeSearch} navigate={navigate} />
    <ToastHost />
  </>;
}

import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { SubmissionsPage } from "../submissions/SubmissionsPage";
import { apiFetch, errorSummary } from "./api-client";
import { Button, EmptyState, PageHeader } from "./components";
import { ErrorBoundary } from "./ErrorSurface";
import { OverlayHost, ToastHost, type OverlayState } from "./OverlayHosts";
import { matchRoute } from "./route-table";
import { useBrowserRouter } from "./router";
import { SeatBlockedPage, useSeat } from "./seat";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useIdentity } from "./identity";
import { QuickSearch } from "./QuickSearch";
import { CommsScreen } from "../comms/CommsScreen";
import { DashboardPage } from "../dashboard/DashboardPage";
import { EvaluationPage } from "../evaluation/EvaluationPage";
import { EventSettings } from "../settings/EventSettings";
import { TaskTemplatesPage } from "../settings/TaskTemplatesPage";
import { ApiTokensPage } from "../settings/ApiTokensPage";
import { VenuesPage } from "../venues/VenuesPage";
import { FormsPage } from "../forms/FormsPage";
import { AgendaPage } from "../agenda/AgendaPage";
import { ReviewerPage } from "../review/ReviewerPage";
import { PortalPage } from "../portal/PortalPage";
import { CoSpeakerPage } from "../portal/CoSpeakerPage";
import { ProgramBoardPage } from "../board/ProgramBoardPage";
import { CreateSubmissionPage } from "../submissions/CreateSubmissionPage";
import { SubmissionRecordPage } from "../submissions/SubmissionRecordPage";
import { OnboardingPage } from "../onboarding/OnboardingPage";
import { SessionizeImportPage } from "../import/SessionizeImportPage";

type ResetResponse = {
  job_id?: unknown;
  status?: unknown;
};

const RESET_DEMO_ROUTE = "/api/v1/admin/reset-demo";
const RESET_DEMO_STATUS_ROUTE = "/api/v1/admin/reset-demo/{jobId}";

export function AppShell({ eventName }: { eventName: string }): JSX.Element {
  const [location, navigate] = useBrowserRouter();
  const route = matchRoute(location.pathname, location.search);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const identity = useIdentity();
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState("");
  const { seat, blocked } = useSeat();
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const resetDemo = useCallback(async () => {
    if (resetting) return;
    if (!window.confirm("Reset the demo conference? This removes demo edits, submissions, uploads, and queued work.")) return;

    setResetting(true);
    setToast("Resetting demo…");
    try {
      const body = await apiFetch<ResetResponse>("/api/v1/admin/reset-demo", {
        method: "POST",
        headers: { accept: "application/json" },
        cache: "no-store",
        route: RESET_DEMO_ROUTE,
      });
      if (typeof body?.job_id !== "string" || body.job_id.length === 0) {
        throw new Error("Reset request returned no job id");
      }

      const deadline = Date.now() + 20_000;
      let status = typeof body.status === "string" ? body.status : "queued";
      let job: ResetResponse | null = body;
      while (status !== "done" && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        job = await apiFetch<ResetResponse>(
          "/api/v1/admin/reset-demo/" + encodeURIComponent(body.job_id),
          { headers: { accept: "application/json" }, cache: "no-store", route: RESET_DEMO_STATUS_ROUTE },
        );
        status = typeof job?.status === "string" ? job.status : "unknown";
        if (status === "failed") throw new Error("The demo reset job failed");
      }
      if (status !== "done") throw new Error("The demo reset timed out after 20 seconds");

      setToast("Demo reset complete. Reloading…");
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setResetting(false);
      setToast("Reset failed: " + errorSummary(error));
    }
  }, [resetting]);

  useEffect(() => {
    const isNonAdminShell = location.pathname === "/portal" || location.pathname === "/reviewer" || location.pathname === "/co-speaker";
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
  if (location.pathname === "/co-speaker") return <CoSpeakerPage />;
  if (location.pathname === "/reviewer") return <ReviewerPage />;
  // A seat that cannot use this surface gets an answer, not a full organizer
  // navigation drawn around a wall — the seat's own routes are already handled
  // above, so this only ever replaces admin chrome.
  if (blocked) return <SeatBlockedPage seat={seat} navigate={navigate} />;
  return <>
    <div class="app-shell">
      <Sidebar activeId={route?.id} eventName={eventName} navigate={navigate} resetting={resetting} onReset={() => void resetDemo()} />
      <main class="main">
        <Topbar
          eventName={eventName}
          routeName={routeName}
          pathname={location.pathname}
          navigate={navigate}
          identity={identity}
          userMenuOpen={userMenuOpen}
          openSearch={openSearch}
          toggleUser={() => setUserMenuOpen((open) => !open)}
          closeUser={() => setUserMenuOpen(false)}
        />
        <div class="page">
          {/* The shell's own boundary. Panels inside a screen carry their own,
              but a route module that throws on its first render has none — and
              without this the whole shell, navigation included, goes white. */}
          <ErrorBoundary label={routeName}>
          {isSubmissionsList
            ? <SubmissionsPage search={location.search} navigate={navigate} />
            : isProgramBoard ? <ProgramBoardPage navigate={navigate} />
            : isSubmissionNew ? <CreateSubmissionPage navigate={navigate} />
            : isSubmissionRecord ? <SubmissionRecordPage submissionId={decodeURIComponent(location.pathname.slice("/submissions/".length))} navigate={navigate} />
            : route?.id === "dashboard" ? <DashboardPage navigate={navigate} />
            : isEvaluation ? <EvaluationPage />
            : route?.id === "venues" ? <VenuesPage />
            : isApiTokens ? <ApiTokensPage navigate={navigate} />
            : route?.id === "task-templates" ? <TaskTemplatesPage />
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
          </ErrorBoundary>
        </div>
      </main>
    </div>
    <OverlayHost state={overlay} onClose={closeOverlay} />
    <QuickSearch key={searchOpen ? "open" : "closed"} eventId="evt_aie-ny-2026" open={searchOpen} onClose={closeSearch} navigate={navigate} />
    <ToastHost message={toast} />
  </>;
}

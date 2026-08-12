import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { SubmissionsPage } from "../submissions/SubmissionsPage";
import { apiFetch, errorSummary } from "./api-client";
import { Button, EmptyState, PageHeader } from "./components";
import { ErrorBoundary } from "./ErrorSurface";
import { OverlayHost, TOAST_EVENT, ToastHost, type OverlayState } from "./OverlayHosts";
import { matchRoute } from "./route-table";
import { useBrowserRouter } from "./router";
import { SeatBlockedPage, useSeat } from "./seat";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useIdentity } from "./identity";
import { useEventContext } from "./event-context";
import { NoConference } from "./NoConference";
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
import { SpeakersPage } from "../speakers/SpeakersPage";
import { SessionizeImportPage } from "../import/SessionizeImportPage";
import { FilesPage } from "../files/FilesPage";
import { CreateConferencePage } from "../setup/CreateConferencePage";
import { HandoffPage } from "../setup/HandoffPage";
import { PeoplePage } from "../people/PeoplePage";
import { ListsPage } from "../people/ListsPage";
import { SourcingPipelinePage } from "../people/SourcingPipelinePage";

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
  const { eventId } = useEventContext();
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

  // A screen that is about to navigate away hands its receipt to the host that
  // outlives it.
  useEffect(() => {
    const onAnnounced = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === "string" && message.length > 0) setToast(message);
    };
    window.addEventListener(TOAST_EVENT, onAnnounced);
    return () => window.removeEventListener(TOAST_EVENT, onAnnounced);
  }, []);

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
  const isSpeakers = location.pathname === "/roster";
  const isImport = location.pathname === "/import";
  const isApiTokens = location.pathname === "/settings/api";
  // Four paths, one page: agents guess URLs and each 404 costs turns.
  const isPeople = ["/people", "/crm", "/directory", "/contacts"].includes(location.pathname);
  // The handoff is the second half of the claim, not an admin screen: it is
  // reached seconds after a session first exists, before there is a conference
  // to draw navigation around.
  if (location.pathname === "/handoff") return <HandoffPage navigate={navigate} />;
  if (location.pathname === "/portal") return <PortalPage />;
  if (location.pathname === "/co-speaker") return <CoSpeakerPage />;
  // The review queue is answered before the layout is drawn, which is exactly
  // why the conference context is mounted above this component rather than
  // inside it: a reviewer's one conference has to reach a page the shell never
  // wraps.
  if (location.pathname === "/reviewer") {
    return eventId === null
      ? <div class="page"><NoConference navigate={navigate} /></div>
      : <ReviewerPage eventId={eventId} />;
  }
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
{/*
              `key={eventId}` is the whole cache-invalidation strategy for a
              switch: every screen below re-mounts and re-reads rather than
              each one growing its own "the conference changed" branch. The
              requests the old conference had in flight are aborted by the
              switch itself — a remount hides a late response, it does not
              cancel it.
          */}
          <ErrorBoundary label={routeName} key={eventId ?? "no-conference"}>
          {/* Three screens answer before the conference guard, for the same
              reason the sidebar draws Organization above the switcher: the
              create screen exists precisely when there is no conference yet,
              and People, Lists and the sourcing pipeline are organization-level
              — a person belongs to the organization, not to one conference. */}
          {route?.id === "conference-new"
            ? <CreateConferencePage navigate={navigate} />
            : isPeople ? <PeoplePage search={location.search} navigate={navigate} />
            : route?.id === "lists" ? <ListsPage navigate={navigate} />
            : route?.id === "sourcing" ? <SourcingPipelinePage search={location.search} navigate={navigate} />
            : eventId === null ? <NoConference navigate={navigate} />
            : isSubmissionsList
            ? <SubmissionsPage eventId={eventId} search={location.search} navigate={navigate} />
            : isProgramBoard ? <ProgramBoardPage eventId={eventId} navigate={navigate} />
            : isSubmissionNew ? <CreateSubmissionPage eventId={eventId} navigate={navigate} />
            : isSubmissionRecord ? <SubmissionRecordPage eventId={eventId} submissionId={decodeURIComponent(location.pathname.slice("/submissions/".length))} navigate={navigate} />
            : route?.id === "dashboard" ? <DashboardPage eventId={eventId} navigate={navigate} />
            : isEvaluation ? <EvaluationPage eventId={eventId} />
            : route?.id === "venues" ? <VenuesPage eventId={eventId} />
            : isApiTokens ? <ApiTokensPage eventId={eventId} navigate={navigate} />
            : route?.id === "task-templates" || route?.id === "tasks" ? <TaskTemplatesPage eventId={eventId} />
            : route?.id === "settings" ? <EventSettings eventId={eventId} navigate={navigate} />
            : isForms ? <FormsPage eventId={eventId} search={location.search} />
            : isAgenda ? <AgendaPage eventId={eventId} />
            : isSpeakers ? <SpeakersPage eventId={eventId} search={location.search} navigate={navigate} />
            : isOnboarding ? <OnboardingPage eventId={eventId} search={location.search} navigate={navigate} />
            : route?.id === "files" ? <FilesPage eventId={eventId} navigate={navigate} />
            : isImport ? <SessionizeImportPage eventId={eventId} navigate={navigate} />
            : route?.id === "communications" ? <>
            <PageHeader title={routeName} copy="Templates, rendered previews, and a demo-safe delivery log for every message." />
            <CommsScreen eventId={eventId} />
          </> : <>
            <PageHeader title={routeName} copy="The shared Flight Deck shell is installed. This route's product module will replace the honest empty state below." />
            <EmptyState title={route ? `${route.label} is ready for its module` : "This route is not installed"} copy={route ? "Navigation, layout, overlays, responsive behavior, and accessibility are live; no product data is being simulated." : "Return to Program home or choose a module from the shared navigation."} action={<Button variant="primary" onClick={() => navigate("/")}>Back to Program home</Button>} />
          </>}
          </ErrorBoundary>
        </div>
      </main>
    </div>
    <OverlayHost state={overlay} onClose={closeOverlay} />
    {eventId !== null && <QuickSearch key={searchOpen ? "open" : "closed"} eventId={eventId} open={searchOpen} onClose={closeSearch} navigate={navigate} />}
    <ToastHost message={toast} />
  </>;
}

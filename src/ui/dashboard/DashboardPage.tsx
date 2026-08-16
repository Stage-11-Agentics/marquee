import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { DashboardCount, DashboardSnapshot, DashboardWave } from "../../api/dashboard";
import { apiFetch, backoffDelayMs } from "../shell/api-client";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { clientBuildSha } from "../shell/error-reporting";
import { ErrorBanner, ErrorBoundary, StaleBand } from "../shell/ErrorSurface";
import { chromeFor, useThemeId } from "../shell/register";
import { InstancePanel } from "../setup/InstancePanel";
import { SetupChecklistCard } from "../setup/SetupChecklistCard";
import { DASHBOARD_REVALIDATE_MS } from "./dashboard-constants";
import { publishDashboardSnapshot } from "./snapshot-store";
import { DashboardLink, dueLabel, formatNumber, formatWaveDate } from "./shared";
import {
  AsciiWaveRows,
  BottleneckDeco,
  BOTTLENECK_CAPTION,
  FeedAttention,
  FeedTaskRows,
  KvMetrics,
  KvWaveRows,
  TerminalAttention,
  TimelineTaskRows,
} from "./register-variants";
import "./dashboard.css";

/** The route template, for the log line and the diagnostic report. */
const DASHBOARD_ROUTE = "/api/v1/events/{eventId}/dashboard";

interface LoadState {
  /** Last good data. It stays on screen while a refresh is failing. */
  snapshot: DashboardSnapshot | null;
  /** When that data was read, so the operator is told how old it is. */
  loadedAt: number | null;
  /** The live failure, or null when the last refresh succeeded. */
  error: unknown;
  consecutiveFailures: number;
}

interface Props {
  eventId: string;
  navigate: (target: string) => void;
}

function dashboardMetricLabel(metric: DashboardCount): string {
  const noun = metric.id === "conflicts" ? "active conflicts" : "matching submissions";
  return `Open ${metric.label}: ${formatNumber(metric.count)} ${noun}`;
}

function PipelineStage({ item, navigate, pinch = false }: { item: DashboardCount; navigate: Props["navigate"]; pinch?: boolean }): JSX.Element {
  return <DashboardLink href={item.href} navigate={navigate} class={`dashboard-pipeline-stage${pinch ? " register-pinch" : ""}`} label={`Open ${item.label}: ${formatNumber(item.count)} matching submissions`}>
    <span class="dashboard-pipeline-name">{item.label}</span>
    <strong class="dashboard-pipeline-count">{formatNumber(item.count)}</strong>
    <span class="dashboard-pipeline-note">{item.note} →</span>
  </DashboardLink>;
}

function WaveRow({ wave, navigate }: { wave: DashboardWave; navigate: Props["navigate"] }): JSX.Element {
  const target = Math.max(wave.target_count, 1);
  const percent = Math.min(100, Math.round(wave.accepted_count / target * 100));
  return <div class="dashboard-wave-row">
    <span><strong>{wave.name}</strong><small>{formatWaveDate(wave.decision_on)} · {wave.sent_at === null ? "planned" : "sent"}</small></span>
    <DashboardLink href={wave.href} navigate={navigate} class="dashboard-wave-progress" label={`Open ${wave.name}: ${formatNumber(wave.accepted_count)} accepted`}><span class="dashboard-wave-bar"><i style={{ width: `${percent}%` }} /></span><small>{formatNumber(wave.accepted_count)} accepted</small></DashboardLink>
    <strong class="tabular">{formatNumber(wave.target_count)} target</strong>
  </div>;
}

function DashboardContents({ snapshot, navigate, eventId }: { snapshot: DashboardSnapshot; navigate: Props["navigate"]; eventId: string }): JSX.Element {
  const { attention } = snapshot;
  const calendarUpdates = attention.calendar_updates ?? {
    id: "calendar-updates",
    label: "Unsent schedule updates",
    count: 0,
    href: "/agenda-builder",
    note: "open the agenda builder to send one batch per speaker",
  };
  const hasProgram = snapshot.pipeline.some((item) => item.count > 0);
  // The checklist remains visible after the first program record so an undone
  // setup step cannot disappear at the moment it becomes relevant. Only the
  // instance-level panel stays in the fresh-program phase.
  const inSetup = !hasProgram;
  // Register chrome: palette themes get DEFAULT_CHROME, so every section
  // below renders exactly the Flight Deck markup for Day/Night; register
  // themes swap in their tropes, all wired to the same snapshot.
  const chrome = chromeFor(useThemeId());
  return <>
    <ErrorBoundary label="Conference setup">
      <SetupChecklistCard eventId={eventId} navigate={navigate} inSetup={inSetup} />
    </ErrorBoundary>
    {inSetup && <ErrorBoundary label="The instance panel">
      <InstancePanel />
    </ErrorBoundary>}
    <section class="card instrument dashboard-pipeline-card" aria-label="Seven-stage program pipeline">
      {chrome.pipelineDeco === "bottleneck" && <BottleneckDeco />}
      <div class="dashboard-pipeline">{snapshot.pipeline.map((item) => <PipelineStage key={item.id} item={item} navigate={navigate} pinch={chrome.pipelineDeco === "bottleneck" && item.id === "accepted"} />)}</div>
      <div class="dashboard-pipeline-scroll-note" role="note"><strong>{snapshot.pipeline.length} stages</strong><span>scroll sideways to see later stages</span></div>
      {chrome.pipelineDeco === "bottleneck" && <div class="register-pipeline-caption">{BOTTLENECK_CAPTION}</div>}
    </section>

    {!hasProgram && <EmptyState title="Your program starts here" copy="The pipeline is ready. Add the first session or import a year of conference data from Sessionize." action={<div class="dashboard-empty-actions"><Button variant="primary" onClick={() => navigate("/submissions/new")}>+ Add session</Button><Button onClick={() => navigate("/import")}>Import from Sessionize</Button></div>} />}

    {chrome.attention === "terminal" ? <TerminalAttention snapshot={snapshot} navigate={navigate} />
    : chrome.attention === "feed" ? <FeedAttention snapshot={snapshot} navigate={navigate} />
    : <section class="dashboard-attention" aria-label="Needs attention">
      {attention.next_wave && <DashboardLink href={attention.next_wave.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${attention.next_wave.name}`}>
        <strong>{attention.next_wave.name} planned</strong><span>{formatNumber(attention.next_wave.accepted_count)} accepted · {formatNumber(attention.next_wave.target_count)} target · open planner</span>
      </DashboardLink>}
      {attention.unreviewed_track && <DashboardLink href={attention.unreviewed_track.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${attention.unreviewed_track.label} unreviewed submissions`}>
        <strong>{formatNumber(attention.unreviewed_track.count)} unreviewed in {attention.unreviewed_track.label}</strong><span>Open the exact filtered review work</span>
      </DashboardLink>}
      <DashboardLink href={attention.overdue_submissions.href} navigate={navigate} class="dashboard-attention-item" label="Open submissions with overdue speaker tasks">
        <strong>{formatNumber(attention.overdue_submissions.count)} speaker tasks overdue</strong><span>Open the affected submissions and chase work</span>
      </DashboardLink>
      <DashboardLink href={attention.decided_not_notified.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${formatNumber(attention.decided_not_notified.count)} decided submissions not notified`}>
        <strong>{formatNumber(attention.decided_not_notified.count)} decisions not notified</strong><span>{attention.decided_not_notified.note}</span>
      </DashboardLink>
      <DashboardLink href={calendarUpdates.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${formatNumber(calendarUpdates.count)} unsent schedule updates`}>
        <strong>{formatNumber(calendarUpdates.count)} unsent schedule updates</strong><span>{calendarUpdates.note}</span>
      </DashboardLink>
    </section>}

    {/* One boundary per panel: a card that throws while rendering becomes a
        card-shaped apology, and the three around it keep working. */}
    <div class="dashboard-grid">
      <ErrorBoundary label="The wave planner">
      <section class="card" id="wave-planner">
        <header class="card-head"><div><h2>Wave planner</h2><span class="subtle">Accept while the CFP stays open</span></div><Button small onClick={() => navigate("/submissions?status=waved")}>Plan next wave</Button></header>
        <div class="card-body dashboard-wave-list">{snapshot.waves.length
          ? chrome.waves === "ascii" ? <AsciiWaveRows waves={snapshot.waves} navigate={navigate} />
          : chrome.waves === "kv" ? <KvWaveRows waves={snapshot.waves} navigate={navigate} />
          : snapshot.waves.map((wave) => <WaveRow key={wave.id} wave={wave} navigate={navigate} />)
          : <span class="subtle">No decision waves yet.</span>}</div>
      </section>
      </ErrorBoundary>

      <ErrorBoundary label="Work in motion">
      <section class="card">
        <header class="card-head"><div><h2>Work in motion</h2><span class="subtle">Revalidated every 5 seconds</span></div></header>
        <div class="card-body">
          {chrome.metrics === "kv" ? <KvMetrics snapshot={snapshot} navigate={navigate} /> : <>
          <div class="dashboard-metric-grid">
            {snapshot.metrics.map((metric) => <DashboardLink key={metric.id} href={metric.href} navigate={navigate} class="dashboard-metric" label={dashboardMetricLabel(metric)}>
              <span class="eyebrow">{metric.label}</span><strong>{formatNumber(metric.count)}</strong><span class="subtle">{metric.note}</span>
            </DashboardLink>)}
          </div>
          <div class="divider" />
          <div class="dashboard-mix"><span class="eyebrow">Review pressure by track</span><div>{snapshot.track_pressure.map((item) => <DashboardLink key={item.id} href={item.href} navigate={navigate} class="chip dashboard-mix-link">{item.label} · {formatNumber(item.count)}</DashboardLink>)}</div></div>
          <div class="dashboard-mix"><span class="eyebrow">Program mix by format</span><div>{snapshot.format_mix.map((item) => <DashboardLink key={item.id} href={item.href} navigate={navigate} class="chip dashboard-mix-link">{item.label} · {formatNumber(item.count)}</DashboardLink>)}</div></div>
          </>}
        </div>
      </section>
      </ErrorBoundary>

      <ErrorBoundary label="The speaker task dashboard">
      <section class="card dashboard-task-card">
        <header class="card-head"><div><h2>Speaker task dashboard</h2><span class="subtle">The work organizers need to chase next</span></div><Button small onClick={() => navigate("/submissions?status=onboarding")}>Open onboarding</Button></header>
        <div class="card-body dashboard-task-list">
          {snapshot.task_preview.length
            ? chrome.tasks === "timeline" ? <TimelineTaskRows tasks={snapshot.task_preview} navigate={navigate} />
            : chrome.tasks === "feed" ? <FeedTaskRows tasks={snapshot.task_preview} navigate={navigate} />
            : snapshot.task_preview.map((task) => <DashboardLink key={`${task.submission_id}-${task.task_title}`} href={task.href} navigate={navigate} class="dashboard-task-row" label={`Open ${task.person_name}'s ${task.task_title}`}>
              <strong>{task.person_name}</strong><span title={task.submission_title}>{task.submission_title}</span><span class="subtle">{task.task_title}</span><span class={`chip ${task.overdue ? "alarm" : ""}`}>{dueLabel(task)}</span>
            </DashboardLink>)
            : <span class="subtle">No open speaker tasks. The pipeline is clear.</span>}
        </div>
      </section>
      </ErrorBoundary>
    </div>
  </>;
}

function DashboardLoading(): JSX.Element {
  return <section class="card instrument dashboard-pipeline-card" aria-busy="true" aria-label="Loading seven-stage program pipeline">
    <div class="dashboard-pipeline">{Array.from({ length: 7 }, (_, index) => <div class="dashboard-pipeline-stage dashboard-skeleton" key={index}><span>Loading</span><strong>—</strong><span>Reading D1</span></div>)}</div>
  </section>;
}

export function DashboardPage({ eventId, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({
    snapshot: null,
    loadedAt: null,
    error: null,
    consecutiveFailures: 0,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let timer = 0;
    let controller: AbortController | undefined;
    // Kept outside state so the scheduler reads the current count without
    // waiting for a render.
    let failures = 0;

    const schedule = () => {
      if (!active) return;
      // Healthy: the five-second heartbeat. Failing: exponential backoff with
      // full jitter, so a wounded origin is not hammered by every open tab in
      // the building in lockstep.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), backoffDelayMs(failures, DASHBOARD_REVALIDATE_MS));
    };

    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const snapshot = await apiFetch<DashboardSnapshot>(
          `/api/v1/events/${encodeURIComponent(eventId)}/dashboard`,
          { signal: requestController.signal, route: DASHBOARD_ROUTE },
        );
        if (!active) return;
        failures = 0;
        // The sidebar's stage flyout shows these same seven counts, and it may
        // not spend a request of its own to get them. Publishing what this poll
        // already read is what makes the flyout free.
        publishDashboardSnapshot(eventId, snapshot);
        setState({ snapshot, loadedAt: Date.now(), error: null, consecutiveFailures: 0 });
      } catch (error: unknown) {
        if (!active || requestController.signal.aborted) return;
        failures += 1;
        // The snapshot is deliberately retained: a failed refresh must never
        // take away the data the operator was already reading.
        setState((current) => ({ ...current, error, consecutiveFailures: failures }));
      } finally {
        schedule();
      }
    };

    void load();
    // Coming back online is news, not a reason to sit out the backoff.
    const onOnline = () => { failures = 0; void load(); };
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", onOnline);
    };
  }, [eventId, reloadKey]);

  const hasProgram = state.snapshot?.pipeline.some((item) => item.count > 0) ?? false;
  const retryNow = () => setReloadKey((value) => value + 1);
  const stale = state.error !== null && state.loadedAt !== null;
  return <div class="dashboard-page">
    <PageHeader title="Program pipeline" copy="Every count opens the work behind it. The dashboard keeps the operator’s next move in view." actions={<><Button onClick={() => navigate("/settings")}>Conference settings</Button><Button variant={hasProgram || !state.snapshot ? "primary" : ""} onClick={() => navigate("/submissions")}>Work the pipeline →</Button></>} />
    <StaleBand ageMs={stale && state.loadedAt !== null ? Date.now() - state.loadedAt : null} retrying={state.error !== null} />
    {state.error !== null && <ErrorBanner title="Dashboard refresh failed" error={state.error} onRetry={retryNow} route={DASHBOARD_ROUTE} />}
    <ErrorBoundary label="The pipeline">
      {state.snapshot ? <DashboardContents snapshot={state.snapshot} navigate={navigate} eventId={eventId} /> : <DashboardLoading />}
    </ErrorBoundary>
    <footer class="dashboard-build"><span class="build-stamp">build {clientBuildSha()}</span></footer>
  </div>;
}

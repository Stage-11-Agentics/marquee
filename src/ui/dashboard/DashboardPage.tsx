import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { DashboardCount, DashboardSnapshot, DashboardTaskPreview, DashboardWave } from "../../api/dashboard";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { DASHBOARD_REVALIDATE_MS } from "./dashboard-constants";
import "./dashboard.css";

type LoadState =
  | { kind: "loading"; snapshot: null }
  | { kind: "ready"; snapshot: DashboardSnapshot }
  | { kind: "error"; snapshot: DashboardSnapshot | null; message: string };

interface Props {
  eventId?: string;
  navigate: (target: string) => void;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatWaveDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function dueLabel(task: DashboardTaskPreview): string {
  if (task.overdue) {
    const days = Math.max(1, Math.floor((Date.now() - task.due_at) / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  return `Due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(task.due_at))}`;
}

function DashboardLink({ href, navigate, class: className, children, label }: {
  href: string;
  navigate: (target: string) => void;
  class: string;
  children: ComponentChildren;
  label?: string;
}): JSX.Element {
  return <a class={className} href={href} aria-label={label} onClick={(event) => {
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}

function PipelineStage({ item, navigate }: { item: DashboardCount; navigate: Props["navigate"] }): JSX.Element {
  return <DashboardLink href={item.href} navigate={navigate} class="dashboard-pipeline-stage" label={`Open ${item.label}: ${formatNumber(item.count)} matching submissions`}>
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

function DashboardContents({ snapshot, navigate }: { snapshot: DashboardSnapshot; navigate: Props["navigate"] }): JSX.Element {
  const { attention } = snapshot;
  const hasProgram = snapshot.pipeline.some((item) => item.count > 0);
  return <>
    <section class="card instrument dashboard-pipeline-card" aria-label="Seven-stage program pipeline">
      <div class="dashboard-pipeline">{snapshot.pipeline.map((item) => <PipelineStage key={item.id} item={item} navigate={navigate} />)}</div>
    </section>

    {!hasProgram && <EmptyState title="Your program starts here" copy="The pipeline is ready. Open the submission register to add the first Abstract or Session." action={<Button variant="primary" onClick={() => navigate("/submissions/new")}>+ Add session</Button>} />}

    <section class="dashboard-attention" aria-label="Needs attention">
      {attention.next_wave && <DashboardLink href={attention.next_wave.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${attention.next_wave.name}`}>
        <strong>{attention.next_wave.name} planned</strong><span>{formatNumber(attention.next_wave.accepted_count)} accepted · {formatNumber(attention.next_wave.target_count)} target · open planner</span>
      </DashboardLink>}
      {attention.unreviewed_track && <DashboardLink href={attention.unreviewed_track.href} navigate={navigate} class="dashboard-attention-item" label={`Open ${attention.unreviewed_track.label} unreviewed submissions`}>
        <strong>{formatNumber(attention.unreviewed_track.count)} unreviewed in {attention.unreviewed_track.label}</strong><span>Open the exact filtered review work</span>
      </DashboardLink>}
      <DashboardLink href={attention.overdue_submissions.href} navigate={navigate} class="dashboard-attention-item" label="Open submissions with overdue speaker tasks">
        <strong>{formatNumber(attention.overdue_submissions.count)} speaker tasks overdue</strong><span>Open the affected submissions and chase work</span>
      </DashboardLink>
    </section>

    <div class="dashboard-grid">
      <section class="card" id="wave-planner">
        <header class="card-head"><div><h2>Wave planner</h2><span class="subtle">Accept while the CFP stays open</span></div><Button small onClick={() => navigate("/submissions?status=waved")}>Plan next wave</Button></header>
        <div class="card-body dashboard-wave-list">{snapshot.waves.length ? snapshot.waves.map((wave) => <WaveRow key={wave.id} wave={wave} navigate={navigate} />) : <span class="subtle">No decision waves yet.</span>}</div>
      </section>

      <section class="card">
        <header class="card-head"><div><h2>Work in motion</h2><span class="subtle">Revalidated every 5 seconds</span></div></header>
        <div class="card-body">
          <div class="dashboard-metric-grid">
            {snapshot.metrics.map((metric) => <DashboardLink key={metric.id} href={metric.href} navigate={navigate} class="dashboard-metric" label={`Open ${metric.label}: ${formatNumber(metric.count)} matching submissions`}>
              <span class="eyebrow">{metric.label}</span><strong>{formatNumber(metric.count)}</strong><span class="subtle">{metric.note}</span>
            </DashboardLink>)}
          </div>
          <div class="divider" />
          <div class="dashboard-mix"><span class="eyebrow">Review pressure by track</span><div>{snapshot.track_pressure.map((item) => <DashboardLink key={item.id} href={item.href} navigate={navigate} class="chip dashboard-mix-link">{item.label} · {formatNumber(item.count)}</DashboardLink>)}</div></div>
          <div class="dashboard-mix"><span class="eyebrow">Program mix by format</span><div>{snapshot.format_mix.map((item) => <DashboardLink key={item.id} href={item.href} navigate={navigate} class="chip dashboard-mix-link">{item.label} · {formatNumber(item.count)}</DashboardLink>)}</div></div>
        </div>
      </section>

      <section class="card dashboard-task-card">
        <header class="card-head"><div><h2>Speaker task dashboard</h2><span class="subtle">The work organizers need to chase next</span></div><Button small onClick={() => navigate("/submissions?status=onboarding")}>Open onboarding</Button></header>
        <div class="card-body dashboard-task-list">
          {snapshot.task_preview.length ? snapshot.task_preview.map((task) => <DashboardLink key={`${task.submission_id}-${task.task_title}`} href={task.href} navigate={navigate} class="dashboard-task-row" label={`Open ${task.person_name}'s ${task.task_title}`}>
            <strong>{task.person_name}</strong><span title={task.submission_title}>{task.submission_title}</span><span class="subtle">{task.task_title}</span><span class={`chip ${task.overdue ? "alarm" : ""}`}>{dueLabel(task)}</span>
          </DashboardLink>) : <span class="subtle">No open speaker tasks. The pipeline is clear.</span>}
        </div>
      </section>
    </div>
  </>;
}

function DashboardLoading(): JSX.Element {
  return <section class="card instrument dashboard-pipeline-card" aria-busy="true" aria-label="Loading seven-stage program pipeline">
    <div class="dashboard-pipeline">{Array.from({ length: 7 }, (_, index) => <div class="dashboard-pipeline-stage dashboard-skeleton" key={index}><span>Loading</span><strong>—</strong><span>Reading D1</span></div>)}</div>
  </section>;
}

export function DashboardPage({ eventId = "evt_aie-ny-2026", navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", snapshot: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/dashboard`, { signal: requestController.signal });
        if (!response.ok) throw new Error(`The dashboard request failed (${response.status}).`);
        const snapshot = await response.json() as DashboardSnapshot;
        if (active) setState({ kind: "ready", snapshot });
      } catch (error: unknown) {
        if (!active || requestController.signal.aborted) return;
        setState((current) => ({
          kind: "error",
          snapshot: current.snapshot,
          message: error instanceof Error ? error.message : "The dashboard could not be loaded.",
        }));
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, DASHBOARD_REVALIDATE_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [eventId, reloadKey]);

  return <div class="dashboard-page">
    <PageHeader title="Program pipeline" copy="Every count opens the work behind it. The dashboard keeps the operator’s next move in view." actions={<><Button onClick={() => navigate("/settings")}>Conference settings</Button><Button variant="primary" onClick={() => navigate("/submissions")}>Work the pipeline →</Button></>} />
    {state.snapshot ? <DashboardContents snapshot={state.snapshot} navigate={navigate} /> : <DashboardLoading />}
    {state.kind === "error" && <div class="dashboard-error" role="status"><strong>Dashboard refresh failed</strong><span>{state.message}</span><Button small onClick={() => setReloadKey((value) => value + 1)}>Retry</Button></div>}
  </div>;
}

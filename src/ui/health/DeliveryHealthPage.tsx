import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type {
  CapabilityStatus,
  DeliveryHealthSnapshot,
  HealthLevel,
  OwedMessage,
} from "../../lib/delivery-health";
import { apiFetch, backoffDelayMs } from "../shell/api-client";
import { Button, PageHeader } from "../shell/components";
import { ErrorBanner, ErrorBoundary } from "../shell/ErrorSurface";
import "./health.css";

/** Slower than the dashboard's five seconds: this screen is read, not scanned. */
export const DELIVERY_HEALTH_REVALIDATE_MS = 10_000;

/** The route template, for the log line and the diagnostic report. */
const DELIVERY_HEALTH_ROUTE = "/api/v1/events/{eventId}/delivery-health";

/** The capability list is a fixed shape, so the loading state has the same rows as the loaded one. */
const CAPABILITY_PLACEHOLDERS = [
  "Your conference data",
  "Accepting submissions",
  "Sending email",
  "Calendar invites",
  "Speaker uploads",
  "Airtable sync",
  "Connected tools",
  "Scheduled jobs",
] as const;

const LEVEL_WORD: Record<HealthLevel, string> = {
  ok: "Fine",
  warn: "Watch",
  alarm: "Act now",
  unknown: "Unknown",
};

interface Props {
  eventId?: string;
  navigate: (target: string) => void;
}

interface LoadState {
  /** Last good data. It stays on screen while a refresh is failing. */
  snapshot: DeliveryHealthSnapshot | null;
  /** When that data was read, so the reader is told how old it is. */
  loadedAt: number | null;
  /** The live failure, or null when the last refresh succeeded. */
  error: unknown;
  consecutiveFailures: number;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatClock(value: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDay(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function waitingWord(days: number): string {
  if (days === 0) return "today";
  return `${formatNumber(days)}d`;
}

function LevelMark({ level }: { level: HealthLevel }): JSX.Element {
  return <span class={`health-level level-${level}`}>
    <i class="health-dot" aria-hidden="true" />
    <span class="health-level-word">{LEVEL_WORD[level]}</span>
  </span>;
}

function CapabilityRow({ capability, navigate }: { capability: CapabilityStatus; navigate: Props["navigate"] }): JSX.Element {
  const body = <>
    <LevelMark level={capability.level} />
    <span class="health-capability-body">
      <span class="health-capability-label">{capability.label}</span>
      <strong class="health-capability-headline">{capability.headline}</strong>
      <span class="health-capability-detail">{capability.detail}</span>
    </span>
    <span class="health-capability-go" aria-hidden="true">{capability.href === null ? "" : "→"}</span>
  </>;
  if (capability.href === null) return <div class="health-capability">{body}</div>;
  return <a
    class="health-capability is-link"
    href={capability.href}
    aria-label={`${capability.label}: ${capability.headline} Open the screen behind it.`}
    onClick={(event) => { event.preventDefault(); navigate(capability.href as string); }}
  >{body}</a>;
}

function CapabilitySkeleton(): JSX.Element {
  return <>{CAPABILITY_PLACEHOLDERS.map((label) => <div class="health-capability" key={label}>
    <LevelMark level="unknown" />
    <span class="health-capability-body">
      <span class="health-capability-label">{label}</span>
      <strong class="health-capability-headline">—</strong>
      <span class="health-capability-detail">Reading what the system has recorded.</span>
    </span>
    <span class="health-capability-go" aria-hidden="true" />
  </div>)}</>;
}

function OwedRow({ row, navigate }: { row: OwedMessage; navigate: Props["navigate"] }): JSX.Element {
  return <a
    class="health-owed-row"
    href={row.href}
    aria-label={`Open ${row.submission_title} — ${row.person_name} — ${row.reason}`}
    onClick={(event) => { event.preventDefault(); navigate(row.href); }}
  >
    <LevelMark level={row.level} />
    <span class="health-owed-person">
      <strong>{row.person_name}</strong>
      <small title={row.submission_title}>{row.submission_title}</small>
    </span>
    <span class="health-owed-reason">
      <strong>{row.reason}</strong>
      <small>{row.what_to_do}</small>
    </span>
    <span class="health-owed-decision">{row.decision}<small>{formatDay(row.decided_at)}</small></span>
    <span class="health-owed-age tabular">{waitingWord(row.waiting_days)}</span>
  </a>;
}

function QuotaCard({ snapshot }: { snapshot: DeliveryHealthSnapshot }): JSX.Element {
  const { quota } = snapshot;
  const used = Math.min(100, Math.round(quota.sent_today / Math.max(1, quota.daily_limit) * 100));
  const claimed = Math.min(100 - used, Math.round(quota.waiting / Math.max(1, quota.daily_limit) * 100));
  return <section class={`card health-quota level-${quota.level}`} aria-label="Today's send allowance">
    <header class="card-head"><div><h2>Today's send allowance</h2><span class="subtle">Across every conference on this installation</span></div><LevelMark level={quota.level} /></header>
    <div class="card-body">
      <div class="health-quota-figures">
        <span><span class="eyebrow">Sent today</span><strong class="tabular">{formatNumber(quota.sent_today)}</strong></span>
        <span><span class="eyebrow">Waiting</span><strong class="tabular">{formatNumber(quota.waiting)}</strong></span>
        <span><span class="eyebrow">Left today</span><strong class="tabular">{formatNumber(quota.remaining)}</strong></span>
        <span><span class="eyebrow">Daily ceiling</span><strong class="tabular">{formatNumber(quota.daily_limit)}</strong></span>
      </div>
      <div class="health-quota-bar" role="img" aria-label={`${formatNumber(quota.sent_today)} of ${formatNumber(quota.daily_limit)} sent today`}>
        <i class="health-quota-used" style={{ width: `${used}%` }} />
        <i class="health-quota-claimed" style={{ width: `${claimed}%` }} />
      </div>
      <p class="health-quota-line"><strong>{quota.headline}</strong> {quota.detail}</p>
    </div>
  </section>;
}

function ledgerFoot(snapshot: DeliveryHealthSnapshot): string {
  const urgent = snapshot.owed_urgent === 0
    ? "None need you right now — the rest are in flight or held on purpose."
    : `${formatNumber(snapshot.owed_urgent)} of them need you now.`;
  const partial = snapshot.owed_counted < snapshot.owed_total
    ? ` Counted over the ${formatNumber(snapshot.owed_counted)} that have waited longest.`
    : "";
  if (snapshot.owed_total <= snapshot.owed_shown) return `${formatNumber(snapshot.owed_total)} in total. ${urgent}${partial}`;
  return `Showing the ${formatNumber(snapshot.owed_shown)} that have waited longest of ${formatNumber(snapshot.owed_total)}. ${urgent}${partial}`;
}

function LedgerCard({ snapshot, navigate }: { snapshot: DeliveryHealthSnapshot; navigate: Props["navigate"] }): JSX.Element {
  return <section class="card health-ledger" aria-label="Who is owed a message">
    <header class="card-head">
      <div><h2>Owed a message</h2><span class="subtle">Decided, and not yet told</span></div>
      <Button small onClick={() => navigate(snapshot.owed_href)}>Open the list</Button>
    </header>
    <div class="card-body health-ledger-body">
      {snapshot.owed.length === 0
        ? <p class="health-ledger-clear">Nobody is waiting. Every decision on this conference has reached the person it was about.</p>
        : <>
          <div class="health-owed-reasons" aria-label="Why they are waiting">
            {(snapshot.owed_reasons ?? []).map((reason) => <span class={`health-reason level-${reason.level}`} key={reason.state}>
              <i class="health-dot" aria-hidden="true" />
              <strong class="tabular">{formatNumber(reason.count)}</strong>
              <span>{reason.reason}</span>
            </span>)}
          </div>
          <div class="health-owed-head" aria-hidden="true"><span>Status</span><span>Speaker</span><span>What happened</span><span>Decision</span><span>Waiting</span></div>
          <div class="health-owed-list">{snapshot.owed.map((row) => <OwedRow key={row.submission_id} row={row} navigate={navigate} />)}</div>
          <p class="health-ledger-foot">{ledgerFoot(snapshot)}</p>
        </>}
    </div>
  </section>;
}

function TotalsStrip({ snapshot }: { snapshot: DeliveryHealthSnapshot }): JSX.Element {
  const totals = [
    // "Sent", not "Delivered": the mail provider tells us it accepted these, and
    // nothing tells us they landed. The note says so rather than implying more.
    { id: "sent", label: "Sent", value: snapshot.totals.sent, note: "handed to your mail provider" },
    { id: "waiting", label: "Waiting", value: snapshot.totals.waiting, note: "written, on its way" },
    { id: "held", label: "Held back", value: snapshot.totals.held_back, note: snapshot.demo_mode ? "demo mode is on" : "stopped before sending" },
    { id: "undelivered", label: "Not sent", value: snapshot.totals.undelivered, note: "never left the building" },
  ];
  return <section class="card instrument health-totals" aria-label="Every message this conference has written">
    {totals.map((total) => <div class="health-total" key={total.id}>
      <span class="eyebrow">{total.label}</span>
      <strong class="tabular">{formatNumber(total.value)}</strong>
      <span class="subtle">{total.note}</span>
    </div>)}
  </section>;
}

export function DeliveryHealthPage({ eventId = "evt_aie-ny-2026", navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ snapshot: null, loadedAt: null, error: null, consecutiveFailures: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    let failures = 0;

    const load = async () => {
      try {
        const snapshot = await apiFetch<DeliveryHealthSnapshot>(
          `/api/v1/events/${encodeURIComponent(eventId)}/delivery-health`,
          { signal: controller.signal, headers: { accept: "application/json" }, cache: "no-store", route: DELIVERY_HEALTH_ROUTE },
        );
        if (controller.signal.aborted) return;
        failures = 0;
        setState({ snapshot, loadedAt: Date.now(), error: null, consecutiveFailures: 0 });
      } catch (error) {
        if (controller.signal.aborted) return;
        failures += 1;
        // Last-good data stays on screen; blanking a status screen because one
        // refresh failed takes the information away exactly when it is wanted.
        setState((current) => ({ ...current, error, consecutiveFailures: failures }));
      }
      if (controller.signal.aborted) return;
      timer = window.setTimeout(() => { void load(); }, backoffDelayMs(failures, DELIVERY_HEALTH_REVALIDATE_MS));
    };

    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [eventId, reloadKey]);

  const { snapshot, error } = state;
  const summaryLevel: HealthLevel = snapshot?.summary.level ?? "unknown";
  const checked = state.loadedAt === null
    ? "checking…"
    : error === null ? `checked ${formatClock(state.loadedAt)}` : `as of ${formatClock(state.loadedAt)} · retrying`;

  return <div class="health-page">
    <PageHeader
      title="Delivery health"
      copy="What the system has done on your behalf, and what it has quietly failed to do. Every row opens the record behind it."
      actions={<Button onClick={() => { setReloadKey((value) => value + 1); }}>Check again</Button>}
    />

    <section class={`card health-summary level-${summaryLevel}`} aria-live="polite" aria-label="Overall verdict">
      <LevelMark level={summaryLevel} />
      <div class="health-summary-body">
        <strong>{snapshot?.summary.headline ?? "Reading what the system has recorded."}</strong>
        <span>{snapshot?.summary.detail ?? "This takes a moment on a large conference."}</span>
      </div>
      <span class="health-checked tabular">{checked}</span>
    </section>

    {snapshot === null
      ? <section class="card health-capabilities" aria-label="What the system can do right now" aria-busy={error === null}>
        <CapabilitySkeleton />
      </section>
      : <>
        {/* One boundary per panel: a card that throws becomes a card-shaped
            apology, and the rest of the screen keeps telling the truth. */}
        <ErrorBoundary label="The capability panel">
          <section class="card health-capabilities" aria-label="What the system can do right now">
            {snapshot.capabilities.map((capability) => <CapabilityRow key={capability.id} capability={capability} navigate={navigate} />)}
          </section>
        </ErrorBoundary>
        <ErrorBoundary label="Today's send allowance"><QuotaCard snapshot={snapshot} /></ErrorBoundary>
        <ErrorBoundary label="The message totals"><TotalsStrip snapshot={snapshot} /></ErrorBoundary>
        <ErrorBoundary label="The delivery ledger"><LedgerCard snapshot={snapshot} navigate={navigate} /></ErrorBoundary>
      </>}

    {error !== null && <ErrorBanner
      title={snapshot === null ? "Delivery health could not be read" : "Delivery health could not be refreshed"}
      error={error}
      route={DELIVERY_HEALTH_ROUTE}
      onRetry={() => setReloadKey((value) => value + 1)}
    />}
  </div>;
}

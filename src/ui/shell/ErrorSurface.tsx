/**
 * The shared failure surfaces: one banner, one staleness band, one boundary.
 *
 * Every one of them obeys the house rule that elements never jump. The banner
 * reserves its height, the stale band reserves its row whether or not it has
 * anything to say, and the copy button keeps a fixed width across "Copy
 * diagnostic report" / "Copied" / "Copy failed". A screen that is already
 * failing is the worst possible moment to move the controls under the
 * operator's cursor.
 *
 * Every banner carries a short reference code. That code is a prefix of the
 * server's correlation id, so an organizer reading six characters aloud is
 * handing an engineer a `grep` that lands on the exact log line. It is the
 * whole point of the ticket this file belongs to.
 */
import { Component, type ComponentChildren, type JSX } from "preact";
import { useState } from "preact/hooks";

import { describeError, MarqueeApiError } from "./api-client";
import { copyDiagnosticReport, reporter } from "./error-reporting";
import { Button } from "./components";
import "./error-surface.css";

function relativeAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1_000))} sec ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min ago`;
  return `${Math.round(ageMs / 3_600_000)} hr ago`;
}

/**
 * Stale-while-error: last-good data stays on screen with a quiet band saying
 * how old it is. Blanking a working screen because a background refresh failed
 * takes away the operator's information at exactly the moment they need it.
 */
export function StaleBand({ ageMs, retrying }: { ageMs: number | null; retrying: boolean }): JSX.Element {
  return (
    <div class="stale-band" role="status" aria-live="polite">
      {ageMs === null ? (
        <span class="stale-band-quiet">Live</span>
      ) : (
        <span>
          Showing data as of <strong class="tabular">{relativeAge(ageMs)}</strong>
          {retrying ? " · retrying" : ""}
        </span>
      )}
    </div>
  );
}

export interface ErrorBannerProps {
  /** What failed, in the operator's words — supplied by the screen. */
  title: string;
  error: unknown;
  onRetry?: () => void;
  /** Route template of the screen, for the diagnostic report. */
  route: string;
}

const COPY_LABELS = {
  idle: "Copy diagnostic report",
  copied: "Copied — paste into an issue",
  failed: "Copy failed — select the text",
} as const;

export function ErrorBanner({ title, error, onRetry, route }: ErrorBannerProps): JSX.Element {
  const [copyState, setCopyState] = useState<keyof typeof COPY_LABELS>("idle");
  const described = describeError(error);
  const requestId = error instanceof MarqueeApiError ? error.requestId : undefined;
  const offline = error instanceof MarqueeApiError && error.code === "offline";

  const copy = async () => {
    const ok = await copyDiagnosticReport({
      reference: described.reference,
      requestId,
      route,
      summary: `${title}: ${described.sentence} ${described.recovery}`,
    });
    setCopyState(ok ? "copied" : "failed");
  };

  return (
    <div class={`error-banner ${offline ? "offline" : ""}`} role="alert">
      <span class="error-banner-mark" aria-hidden="true">{offline ? "◌" : "◆"}</span>
      <div class="error-banner-body">
        <strong>{title}</strong>
        <span>{described.sentence} {described.recovery}</span>
      </div>
      <span class="error-banner-ref" title={requestId ?? "no server reference — the request never arrived"}>
        ref <code class="tabular">{described.reference}</code>
      </span>
      <div class="error-banner-actions">
        <Button small class="error-banner-copy" onClick={() => void copy()}>{COPY_LABELS[copyState]}</Button>
        {onRetry ? <Button small onClick={onRetry}>Retry now</Button> : null}
      </div>
    </div>
  );
}

interface BoundaryProps {
  /** Names the panel in the fallback, so the operator knows what is missing. */
  label: string;
  children: ComponentChildren;
}

interface BoundaryState {
  error: unknown;
}

/**
 * A per-panel boundary. One card throwing during render used to white-screen
 * the whole shell; now it becomes one card-shaped apology while everything
 * around it keeps working, and one beacon carrying the stack.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    reporter().report("boundary", error);
  }

  render(): JSX.Element {
    if (this.state.error === null) return <>{this.props.children}</>;
    const described = describeError(this.state.error);
    return (
      <section class="card panel-failure" role="alert">
        <div>
          <span class="panel-failure-mark" aria-hidden="true">◆</span>
          <strong>{this.props.label} could not be drawn</strong>
          <p>{described.sentence} {described.recovery}</p>
          <Button small onClick={() => this.setState({ error: null })}>Try this panel again</Button>
        </div>
      </section>
    );
  }
}

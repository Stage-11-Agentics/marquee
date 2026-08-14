/**
 * The stage flyout — the seven lifecycle stages, restored as an accelerator.
 *
 * The ladder used to be seven permanent rows in the sidebar. It left (the
 * dashboard strip, the board's columns and the list's status filter all say it
 * better), and this is what replaced it: rest on the Program pipeline row and
 * the stages appear beside it with live counts, each a direct jump.
 *
 * Three things keep it honest:
 *
 *   - It is never the only path to anything. Every destination here is also
 *     reachable by clicking through, which is why the panel may disappear
 *     entirely below 1000px without taking a capability with it.
 *   - The first row is Overview, pointing exactly where clicking the row
 *     itself points — so the flyout is one map of the area rather than a second
 *     gesture with a different destination (Atin ruling, 2026-08-14).
 *   - It costs no request. Counts come from the shared dashboard snapshot; if
 *     none has been read yet the rows render with an em dash in a
 *     fixed-width column, and fill in without moving anything.
 *
 * Hover intent is one timer: 150ms before it opens, 220ms before it closes, so
 * an arriving show cancels a pending hide and a pointer crossing the row on its
 * way somewhere else never flashes the panel.
 */
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { DASHBOARD_STAGE_IDS, type DashboardStageId } from "../../api/dashboard";
import { useDashboardSnapshot } from "../dashboard/snapshot-store";
import { useEventContext } from "./event-context";
import { chromeFor, useThemeId } from "./register";
import { routeTable } from "./route-table";

export const FLYOUT_OPEN_MS = 150;
export const FLYOUT_CLOSE_MS = 220;
/** Below this the sidebar is a 68px rail, and a hover panel off it is a trap. */
export const FLYOUT_MIN_WIDTH = 1000;
/** The row the panel hangs off. The Sidebar stamps it; nothing else may. */
export const PIPELINE_ROW_SELECTOR = '[data-nav-id="dashboard"]';

/** Stage → the route that shows it. Onboarding's stage is the chase board. */
const STAGE_ROUTE_ID: Readonly<Record<DashboardStageId, string>> = {
  submitted: "submitted",
  in_review: "in-review",
  waved: "waved",
  accepted: "accepted",
  onboarding: "onboarding",
  scheduled: "scheduled",
  published: "published",
};

export interface StageRow {
  stage: DashboardStageId;
  numeral: string;
  label: string;
  path: string;
}

/**
 * Built from the route table rather than restated here: these are the same
 * seven routes the ladder used to render, and a second list of them is a
 * second thing to keep in step.
 */
export const STAGE_ROWS: readonly StageRow[] = DASHBOARD_STAGE_IDS.map((stage, index) => {
  const route = routeTable.find((candidate) => candidate.id === STAGE_ROUTE_ID[stage]);
  if (!route) throw new Error(`stage flyout: no route for pipeline stage "${stage}"`);
  return { stage, numeral: String(index + 1), label: route.label, path: route.path };
});

export function stageCount(
  snapshot: { pipeline: { id: string; count: number }[] } | null,
  stage: DashboardStageId,
): number | null {
  const entry = snapshot?.pipeline.find((item) => item.id === stage);
  return entry ? entry.count : null;
}

export function StageFlyout({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const { eventId } = useEventContext();
  const snapshot = useDashboardSnapshot(eventId);
  // The AI Engineer register zero-padded the ladder's nav icons. The ladder is
  // gone; the trope follows the numerals to where they now live.
  const zeroPad = chromeFor(useThemeId()).zeroPadNavIcons;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef(0);

  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  const hide = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => setOpen(false), FLYOUT_CLOSE_MS);
  }, [cancel]);

  useEffect(() => {
    const row = document.querySelector<HTMLElement>(PIPELINE_ROW_SELECTOR);
    if (!row) return;
    const narrow = () => typeof window.matchMedia === "function"
      && window.matchMedia(`(max-width: ${FLYOUT_MIN_WIDTH}px)`).matches;
    const show = () => {
      window.clearTimeout(timer.current);
      if (narrow()) return;
      timer.current = window.setTimeout(() => {
        const box = row.getBoundingClientRect();
        // Measured onto the viewport: the sidebar scrolls, and a scroll
        // container clips an absolutely positioned child on both axes.
        setAnchor({ left: Math.round(box.right + 2), top: Math.max(8, Math.round(box.top - 8)) });
        setOpen(true);
      }, FLYOUT_OPEN_MS);
    };
    const away = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpen(false), FLYOUT_CLOSE_MS);
    };
    row.addEventListener("mouseenter", show);
    row.addEventListener("mouseleave", away);
    row.addEventListener("focus", show);
    row.addEventListener("blur", away);
    return () => {
      window.clearTimeout(timer.current);
      row.removeEventListener("mouseenter", show);
      row.removeEventListener("mouseleave", away);
      row.removeEventListener("focus", show);
      row.removeEventListener("blur", away);
    };
  }, []);

  const go = (target: string) => (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    cancel();
    setOpen(false);
    navigate(target);
  };

  const numeral = (row: StageRow) => (zeroPad ? `0${row.numeral}` : row.numeral);

  return <nav
    class={`stage-flyout${open ? " open" : ""}`}
    id="stage-flyout"
    aria-label="Program pipeline stages"
    hidden={!open}
    style={anchor ? { left: `${anchor.left}px`, top: `${anchor.top}px` } : undefined}
    onMouseEnter={cancel}
    onMouseLeave={hide}
  >
    <div class="stage-flyout-cap">Program pipeline</div>
    <a class="flyout-overview" href="/dashboard" onClick={go("/dashboard")}>
      <span class="stage-num" aria-hidden="true" />
      <span>Overview · all stages</span>
    </a>
    {STAGE_ROWS.map((row) => {
      const count = stageCount(snapshot, row.stage);
      return <a key={row.stage} href={row.path} data-stage={row.stage} onClick={go(row.path)}>
        <span class="stage-num" aria-hidden="true">{numeral(row)}</span>
        <span>{row.label}</span>
        {/* Reserved either way: the count arrives without moving the label. */}
        <span class="stage-count">{count === null ? "—" : count.toLocaleString()}</span>
      </a>;
    })}
  </nav>;
}

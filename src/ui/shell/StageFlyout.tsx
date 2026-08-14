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
 *     none has been read yet the rows render an em dash in a fixed-width
 *     column, and the numbers fill in without moving anything.
 */
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { DASHBOARD_STAGE_IDS, type DashboardSnapshot, type DashboardStageId } from "../../api/dashboard";
import { useDashboardSnapshot } from "../dashboard/snapshot-store";
import { useEventContext } from "./event-context";
import { createHoverIntent } from "./hover-intent";
import { chromeFor, useThemeId } from "./register";
import { routeTable } from "./route-table";

/** Below this the sidebar is a 68px rail, and a hover panel off it is a trap. */
export const FLYOUT_MIN_WIDTH = 1000;
/** The row the panel hangs off. The Sidebar stamps it; nothing else may. */
export const PIPELINE_ROW_SELECTOR = '[data-nav-id="dashboard"]';
/** Where the row itself points, and therefore where Overview points. */
export const FLYOUT_OVERVIEW_PATH = "/dashboard";

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

export function stageCount(snapshot: DashboardSnapshot | null, stage: DashboardStageId): number | null {
  const entry = snapshot?.pipeline.find((item) => item.id === stage);
  return entry ? entry.count : null;
}

/**
 * The panel itself: everything it draws comes from its props, so what it says
 * can be read without a browser.
 */
export function StageFlyoutPanel({ snapshot, open, anchor, zeroPad = false, navigate, onCancel, onLeave }: {
  snapshot: DashboardSnapshot | null;
  open: boolean;
  anchor?: { left: number; top: number } | null;
  zeroPad?: boolean;
  navigate: (target: string) => void;
  onCancel?: () => void;
  onLeave?: () => void;
}): JSX.Element {
  const go = (target: string) => (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigate(target);
  };
  return <nav
    id="stage-flyout"
    class={`stage-flyout${open ? " open" : ""}`}
    aria-label="Program pipeline stages"
    style={anchor ? { left: `${anchor.left}px`, top: `${anchor.top}px` } : undefined}
    onMouseEnter={onCancel}
    onMouseLeave={onLeave}
  >
    <div class="stage-flyout-cap">Program pipeline</div>
    <a class="flyout-overview" href={FLYOUT_OVERVIEW_PATH} onClick={go(FLYOUT_OVERVIEW_PATH)}>
      <span class="stage-num" aria-hidden="true" />
      <span>Overview · all stages</span>
    </a>
    {STAGE_ROWS.map((row) => {
      const count = stageCount(snapshot, row.stage);
      return <a key={row.stage} href={row.path} data-stage={row.stage} onClick={go(row.path)}>
        <span class="stage-num" aria-hidden="true">{zeroPad ? `0${row.numeral}` : row.numeral}</span>
        <span>{row.label}</span>
        {/* Reserved either way: the count arrives without moving the label. */}
        <span class="stage-count">{count === null ? "—" : count.toLocaleString()}</span>
      </a>;
    })}
  </nav>;
}

export function StageFlyout({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const { eventId } = useEventContext();
  const snapshot = useDashboardSnapshot(eventId);
  // The AI Engineer register zero-padded the ladder's nav icons. The ladder is
  // gone; the trope follows the numerals to where they now live.
  const zeroPad = chromeFor(useThemeId()).zeroPadNavIcons;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const intent = useMemo(() => createHoverIntent(() => setOpen(true), () => setOpen(false)), []);

  useEffect(() => {
    const row = document.querySelector<HTMLElement>(PIPELINE_ROW_SELECTOR);
    if (!row) return;
    const narrow = () => typeof window.matchMedia === "function"
      && window.matchMedia(`(max-width: ${FLYOUT_MIN_WIDTH}px)`).matches;
    const enter = () => {
      if (narrow()) { intent.cancel(); return; }
      // Measured onto the viewport before the wait, so the panel opens where
      // the row is rather than where it was.
      const box = row.getBoundingClientRect();
      setAnchor({ left: Math.round(box.right + 2), top: Math.max(8, Math.round(box.top - 8)) });
      intent.enter();
    };
    const leave = () => intent.leave();
    row.addEventListener("mouseenter", enter);
    row.addEventListener("mouseleave", leave);
    // Keyboard reaches it too: a row you can tab to is a row you can open.
    row.addEventListener("focus", enter);
    row.addEventListener("blur", leave);
    return () => {
      intent.cancel();
      row.removeEventListener("mouseenter", enter);
      row.removeEventListener("mouseleave", leave);
      row.removeEventListener("focus", enter);
      row.removeEventListener("blur", leave);
    };
  }, [intent]);

  return <StageFlyoutPanel
    snapshot={snapshot}
    open={open}
    anchor={anchor}
    zeroPad={zeroPad}
    navigate={(target) => { intent.cancel(); setOpen(false); navigate(target); }}
    onCancel={intent.cancel}
    onLeave={intent.leave}
  />;
}

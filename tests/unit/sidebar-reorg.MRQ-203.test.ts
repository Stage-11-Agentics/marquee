/**
 * MRQ-203 — the sidebar reorg fold.
 *
 * The nav structure itself is pinned in `route-table.test.ts`. This file covers
 * what the reorg added: the stage flyout that replaced the seven-row ladder,
 * the shared snapshot that makes it free, and the shell chrome around it.
 */
import { readFileSync } from "node:fs";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test, vi } from "vitest";

import type { DashboardSnapshot } from "../../src/api/dashboard";
import { createHoverIntent, HOVER_CLOSE_MS, HOVER_OPEN_MS } from "../../src/ui/shell/hover-intent";
import {
  FLYOUT_MIN_WIDTH,
  FLYOUT_OVERVIEW_PATH,
  PIPELINE_ROW_SELECTOR,
  STAGE_ROWS,
  StageFlyoutPanel,
  stageCount,
} from "../../src/ui/shell/StageFlyout";
import {
  publishDashboardSnapshot,
  readDashboardSnapshot,
  resetDashboardSnapshot,
  SNAPSHOT_FRESH_MS,
} from "../../src/ui/dashboard/snapshot-store";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sidebar = source("src/ui/shell/Sidebar.tsx");
const flyout = source("src/ui/shell/StageFlyout.tsx");
const components = source("src/styles/components.css");

const COUNTS: Record<string, number> = {
  submitted: 41, in_review: 12, waved: 1_204, accepted: 7,
  onboarding: 3, scheduled: 96, published: 0,
};

function snapshot(): DashboardSnapshot {
  return {
    generated_at: 1_760_000_000_000,
    pipeline: Object.entries(COUNTS).map(([id, count]) => ({ id, label: id, count, href: `/submissions?status=${id}`, note: "" })),
    format_mix: [],
    track_pressure: [],
    waves: [],
    attention: {
      next_wave: null,
      unreviewed_track: null,
      overdue_submissions: { id: "overdue", label: "Overdue", count: 0, href: "/submissions", note: "" },
      decided_not_notified: { id: "not-notified", label: "Not notified", count: 0, href: "/submissions", note: "" },
    },
    metrics: [],
    task_preview: [],
  };
}

const render = (props: Parameters<typeof StageFlyoutPanel>[0]) => renderToString(h(StageFlyoutPanel, props));

test("CONTRACT · MRQ-203 · the flyout is one map of the area: Overview leads, then the seven stages", () => {
  const html = render({ snapshot: snapshot(), open: true, navigate: () => {} });
  // Overview points exactly where clicking the row itself points. A flyout
  // whose first row went somewhere else would be a second gesture, not an
  // accelerator for the first one.
  expect(FLYOUT_OVERVIEW_PATH).toBe("/dashboard");
  expect(html.indexOf("Overview · all stages")).toBeGreaterThan(-1);
  expect(html.indexOf("Overview · all stages")).toBeLessThan(html.indexOf("Submitted"));
  expect(STAGE_ROWS.map((row) => row.label)).toEqual([
    "Submitted", "In review", "Waved", "Ready to place", "Onboarding", "Scheduled", "Published",
  ]);
  // Onboarding's stage is the chase board, not a filtered submissions list.
  expect(STAGE_ROWS.find((row) => row.stage === "onboarding")?.path).toBe("/onboarding");
  expect(STAGE_ROWS.map((row) => row.numeral)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
});

test("CONTRACT · MRQ-203 · every count is the dashboard snapshot's own number", () => {
  const live = snapshot();
  const html = render({ snapshot: live, open: true, navigate: () => {} });
  for (const row of STAGE_ROWS) {
    expect(stageCount(live, row.stage)).toBe(COUNTS[row.stage]);
  }
  // Rendered with the reader's separators — 1,204 is a number, 1204 is a string
  // of digits.
  expect(html).toContain(">1,204<");
  expect(html).toContain(">0<");
});

test("CONTRACT · MRQ-203 · with no snapshot yet the rows keep their shape and reserve the count", () => {
  const html = render({ snapshot: null, open: true, navigate: () => {} });
  expect(stageCount(null, "submitted")).toBeNull();
  // Seven em dashes in seven reserved slots: the numbers fill in later without
  // moving a label sideways.
  expect(html.match(/class="stage-count">—</g)).toHaveLength(7);
  expect(html).toContain("Submitted");
});

test("CONTRACT · MRQ-203 · closed is a real state, and the register's zero-padding follows the numerals here", () => {
  expect(render({ snapshot: null, open: false, navigate: () => {} })).not.toContain("stage-flyout open");
  expect(render({ snapshot: null, open: true, navigate: () => {} })).toContain("stage-flyout open");
  const padded = render({ snapshot: null, open: true, zeroPad: true, navigate: () => {} });
  expect(padded).toContain(">01<");
  expect(padded).toContain(">07<");
});

test("CONTRACT · MRQ-203 · a stage click navigates and takes the panel with it", () => {
  const targets: string[] = [];
  // The panel's rows are real anchors — the href is what a middle click and a
  // "copy link" get — and the click handler is what closes the panel.
  const html = render({ snapshot: snapshot(), open: true, navigate: (target) => targets.push(target) });
  expect(html).toContain('href="/submissions?status=waved"');
  expect(html).toContain('href="/onboarding"');
  expect(flyout).toMatch(/navigate=\{\(target\) => \{ intent\.cancel\(\); setOpen\(false\); navigate\(target\); \}\}/);
});

test("CONTRACT · MRQ-203 · hover intent is 150ms in, 220ms out, on one shared timer", () => {
  vi.useFakeTimers();
  try {
    let open = false;
    const intent = createHoverIntent(() => { open = true; }, () => { open = false; });
    expect([HOVER_OPEN_MS, HOVER_CLOSE_MS]).toEqual([150, 220]);

    // A pointer passing over the row on its way somewhere else never sees it.
    intent.enter();
    vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    expect(open).toBe(false);
    intent.leave();
    vi.advanceTimersByTime(1_000);
    expect(open).toBe(false);

    // Resting on it does.
    intent.enter();
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(open).toBe(true);

    // Leaving waits, and the gap between the row and the panel is survivable:
    // one timer means arriving back cancels the pending close outright.
    intent.leave();
    vi.advanceTimersByTime(HOVER_CLOSE_MS - 1);
    expect(open).toBe(true);
    intent.cancel();
    vi.advanceTimersByTime(1_000);
    expect(open).toBe(true);

    intent.leave();
    vi.advanceTimersByTime(HOVER_CLOSE_MS);
    expect(open).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("CONTRACT · MRQ-203 · the flyout opens on keyboard focus, not on the pointer alone", () => {
  expect(flyout).toMatch(/row\.addEventListener\("focus", enter\)/);
  expect(flyout).toMatch(/row\.addEventListener\("blur", leave\)/);
  expect(flyout).toMatch(/row\.addEventListener\("mouseenter", enter\)/);
  // And it hangs off the row the sidebar stamps, so neither side can drift.
  expect(PIPELINE_ROW_SELECTOR).toBe('[data-nav-id="dashboard"]');
  expect(sidebar).toContain("data-nav-id={route.id}");
});

test("CONTRACT · MRQ-203 · the flyout retires on narrow viewports, in the stylesheet and before it opens", () => {
  expect(FLYOUT_MIN_WIDTH).toBe(1000);
  const compact = components.slice(components.indexOf("@media (max-width: 1000px)"));
  expect(compact).toMatch(/\.stage-flyout \{ display: none !important; \}/);
  expect(flyout).toMatch(/matchMedia\(`\(max-width: \$\{FLYOUT_MIN_WIDTH\}px\)`\)/);
  expect(flyout).toMatch(/if \(narrow\(\)\) \{ intent\.cancel\(\); return; \}/);
});

test("CONTRACT · MRQ-203 · the sidebar itself reads nothing from the network", () => {
  // AC-280's rule, restated because the flyout is the first thing in the
  // sidebar that shows live numbers: the fetch lives in the snapshot store,
  // and the sidebar only subscribes.
  expect(sidebar).not.toContain("apiFetch");
  expect(flyout).not.toContain("apiFetch");
});

test("CONTRACT · MRQ-203 · hovering costs nothing: the flyout reads a snapshot somebody already paid for", () => {
  const dashboard = source("src/ui/dashboard/DashboardPage.tsx");
  // The dashboard's own five-second poll publishes what it reads.
  expect(dashboard).toMatch(/publishDashboardSnapshot\(eventId, snapshot\)/);
  // And nothing about opening the panel triggers a read.
  expect(flyout).not.toContain("read(");
  expect(flyout).toContain("useDashboardSnapshot");
});

test("CONTRACT · MRQ-203 · the shared snapshot is per conference, and goes stale rather than lying", () => {
  const now = 1_770_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    resetDashboardSnapshot();
    expect(readDashboardSnapshot("evt_1")).toBeNull();

    publishDashboardSnapshot("evt_1", snapshot());
    expect(readDashboardSnapshot("evt_1")?.pipeline).toHaveLength(7);
    // A switch to another conference must never show the old one's counts.
    expect(readDashboardSnapshot("evt_2")).toBeNull();
    expect(readDashboardSnapshot(null)).toBeNull();
    expect(SNAPSHOT_FRESH_MS).toBe(30_000);
  } finally {
    resetDashboardSnapshot();
    vi.useRealTimers();
  }
});

test("CONTRACT · MRQ-203 · the create action is a `+` on the row that owns the list", () => {
  // Inside the row's link, so the click has to be taken off the row before it
  // becomes a navigation to the list instead of to the create screen.
  expect(sidebar).toMatch(/event\.stopPropagation\(\)/);
  expect(sidebar).toMatch(/navigate\("\/submissions\/new"\)/);
  expect(sidebar).toMatch(/route\.id === "submissions" \? <AddSessionPlus/);
  // Reachable by keyboard: it is a span with a button's role, so it needs the
  // key handling a button would have given it.
  expect(sidebar).toMatch(/tabIndex=\{0\}/);
  expect(sidebar).toMatch(/event\.key === "Enter" \|\| event\.key === " "/);
});

test("CONTRACT · MRQ-203 · the conference picker wears the same group label as everything else", () => {
  const conferenceLabelAt = sidebar.indexOf('<div class="nav-label">Conference</div>');
  const switcherAt = sidebar.indexOf("<EventSwitcher");
  expect(conferenceLabelAt).toBeGreaterThan(-1);
  expect(conferenceLabelAt).toBeLessThan(switcherAt);
  // The eyebrow inside the button said the same word in a second voice.
  expect(source("src/ui/shell/EventSwitcher.tsx")).not.toContain("<small>Conference</small>");
  expect(components).not.toMatch(/\.event-context small \{/);
  // 6px from the picker to the first row below it.
  expect(components).toMatch(/\.event-context-row \{[^}]*margin: 0 4px 6px;/);
});

test("CONTRACT · MRQ-203 · every row reserves the icon column, and the rail falls back to letters", () => {
  // A 16px column that collapses on the rows with no glyph would move every
  // label beside it.
  expect(components).toMatch(/\.nav-icon \{[^}]*flex: none;[^}]*width: 16px;/);
  const compact = components.slice(components.indexOf("@media (max-width: 1000px)"));
  expect(compact).toMatch(/\.nav-icon:empty \{ display: none; \}/);
  expect(compact).toMatch(/\.nav-icon:not\(:empty\) \+ span \{ display: none; \}/);
  expect(compact).toMatch(/max-width: 1\.35ch/);
});

test("CONTRACT · MRQ-203 · the footer carries the system's own entrances", () => {
  expect(sidebar).toContain("API &amp; CLI");
  expect(sidebar).toContain("System health");
  expect(sidebar).toContain("Reset demo");
});

/** The whole point of the reorg: one column, centered, on every admin page. */
test("CONTRACT · MRQ-203 · every admin page shares one centered column", () => {
  expect(components).toMatch(/\.page \{[^}]*margin: 0 auto;[^}]*max-width: 1500px;/);
  // And no screen re-states it. The divergence the sign-off drive found was
  // exactly this: a second `.page` rule with a max-width and no `margin: auto`,
  // which pinned People CRM and Outreach left while conference pages centered.
  const perFeature = [
    "src/ui/people/people.css",
    "src/ui/submissions/submissions.css",
    "src/ui/board/board.css",
    "src/ui/dashboard/dashboard.css",
    "src/ui/settings/settings.css",
    "src/ui/agenda/agenda.css",
    "src/ui/speakers/speakers.css",
  ];
  for (const path of perFeature) {
    expect(source(path), `${path} redefines the shared page column`).not.toMatch(/^\.page\s*\{/m);
  }
});

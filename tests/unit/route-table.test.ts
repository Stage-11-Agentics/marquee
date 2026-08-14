import { expect, test } from "vitest";

import sidebarSource from "../../src/ui/shell/Sidebar.tsx?raw";
import { matchRoute, routesFor, SIDEBAR_GROUPS } from "../../src/ui/shell/route-table";

/**
 * The sidebar the v1.15 prototype signs off on (Atin love pass, 2026-08-14):
 * named groups, ~23 rows, and no numbered ladder. The seven lifecycle stages
 * left the nav for the surfaces that already say them better — the dashboard
 * strip, the board's columns, the list's status filter — and for the stage
 * flyout on the Program pipeline row.
 */
test("CONTRACT · MRQ-203 · the sidebar reproduces the ruled group structure", () => {
  expect(SIDEBAR_GROUPS.map((group) => [group, routesFor(group).map((route) => route.label)])).toEqual([
    // Home is MRQ-209's organization-level row; every row points at a route
    // that exists, so a click never becomes a dead end.
    ["organization", ["Home", "People CRM", "Outreach"]],
    ["conference", ["Program pipeline", "Program board", "Abstracts & sessions", "Agenda", "Speakers"]],
    ["speaker-ops", ["Onboarding", "Tasks", "Communications", "Files", "Follow-ups"]],
    ["cfp", ["Forms", "Evaluation", "Reviewer"]],
    ["public-links", ["Conference site", "Speaker portal", "Embeds"]],
    ["settings", ["Settings"]],
  ]);
});

/**
 * Every path the route table carried before the reorg, listed in full rather
 * than derived from the table this test is checking. Rows left the sidebar;
 * none of them left the product, and an organizer's bookmark, an agent's
 * guessed URL, and a link in an email that went out last month all still land.
 */
const PATHS_BEFORE_THE_REORG = [
  "/people", "/lists", "/pipeline", "/crm", "/directory", "/contacts",
  "/dashboard", "/board", "/submissions", "/submissions/new",
  "/submissions?status=submitted", "/submissions?status=in_review",
  "/submissions?status=waved", "/submissions?status=accepted", "/onboarding",
  "/submissions?status=scheduled", "/submissions?status=published",
  "/roster", "/forms", "/evaluation", "/reviewer", "/reviewer/queue",
  "/agenda-builder", "/files", "/communications", "/tasks", "/portal",
  "/agenda", "/embed/config", "/settings", "/delivery-health",
  "/delivery-health?view=system", "/co-speaker", "/conferences/new",
  "/handoff", "/settings/venues", "/submissions/:id", "/settings/tasks",
  "/settings/api", "/settings/webhooks", "/api/docs", "/import",
] as const;

test("CONTRACT · MRQ-203 · no route that existed loses its reachability", () => {
  for (const path of PATHS_BEFORE_THE_REORG) {
    const [pathname, search] = path.split("?");
    const resolved = matchRoute(
      pathname === "/submissions/:id" ? "/submissions/abc-123" : pathname,
      search ? `?${search}` : "",
    );
    expect(resolved, `${path} no longer resolves`).toBeDefined();
  }
});

test("CONTRACT · MRQ-203 · the seven lifecycle stages keep their routes and lose their rows", () => {
  for (const id of ["submitted", "in-review", "waved", "accepted", "scheduled", "published"]) {
    const route = matchRoute("/submissions", `?status=${id === "in-review" ? "in_review" : id}`);
    expect(route?.id, `${id} lost its route`).toBe(id);
    expect(route?.sidebar, `${id} still takes a sidebar row`).toBeUndefined();
  }
  // Onboarding is the exception: its stage is the chase board, which is a
  // destination of its own under Speaker ops.
  expect(matchRoute("/onboarding")).toMatchObject({ id: "onboarding", group: "speaker-ops", sidebar: true });
});

test("CONTRACT · MRQ-171 · the reviewer queue is a real route outside the organizer shell", () => {
  expect(matchRoute("/reviewer/queue")).toMatchObject({ id: "reviewer-queue", label: "Review queue", group: "utility" });
});

test("CONTRACT · MRQ-115 — the files library is reachable by the noun an organizer searches for", () => {
  // CNT-S3 step 5 enumerates the labels an operator (and the eval agent) will
  // look for. "Files" is one of them, spelled exactly; a cleverer name here is
  // a screen nobody finds.
  expect(matchRoute("/files")).toMatchObject({ id: "files", label: "Files", group: "speaker-ops", sidebar: true });
});

test("CONTRACT · MRQ-106 · the embed builder navigates for real, because the shell does not render it", () => {
  // `app.tsx` treats every `/embed/` path as a public page, so a client-side
  // push would draw the shell's "not installed" empty state over a working
  // server-rendered builder — worse than having no link at all.
  expect(matchRoute("/embed/config")).toMatchObject({ label: "Embeds", external: true, sidebar: true });
});

test("CONTRACT · MRQ-106 · the submissions list is in the sidebar, and its create action is on the row", () => {
  expect(matchRoute("/submissions")).toMatchObject({ id: "submissions", sidebar: true, group: "conference" });
  // The create action left the nav and became the `+` on the row that owns the
  // list it adds to (v1.15): an unnumbered row of its own in the middle of a
  // group read as a broken sequence, and a second row for one list's create
  // action is a longer nav saying less.
  expect(matchRoute("/submissions/new")).toMatchObject({ id: "submission-new" });
  expect(matchRoute("/submissions/new")?.sidebar).toBeUndefined();
  expect(sidebarSource).toContain("/submissions/new");
});

test("AC-1 · speaker follow-ups and system health are real external destinations", () => {
  // "Follow-ups" under "Speaker ops": the group carries the scope, so the row
  // does not have to say "speaker" a second time.
  expect(matchRoute("/delivery-health")).toMatchObject({ label: "Follow-ups", group: "speaker-ops", external: true, sidebar: true });
  expect(matchRoute("/delivery-health", "?view=system")).toMatchObject({ label: "System health", group: "utility", external: true });
  // System health takes no nav row: the sidebar footer renders it beside
  // API & CLI, which is where the system's own entrances belong.
  expect(matchRoute("/delivery-health", "?view=system")?.sidebar).toBeUndefined();
  expect(sidebarSource).toContain("System health");
});

test("CONTRACT · route matching preserves lifecycle query routes and dynamic records", () => {
  expect(matchRoute("/submissions", "?status=accepted")?.id).toBe("accepted");
  expect(matchRoute("/submissions/abc-123")?.id).toBe("submission-detail");
});

test("AC-106 · API tokens and the sidebar API docs link resolve as real routes", () => {
  expect(matchRoute("/settings/api")?.id).toBe("api-tokens");
  expect(matchRoute("/api/docs")?.id).toBe("api-docs");
});

test("CONTRACT · EMB-15 · organizer embeds are discoverable at the mandated builder route", () => {
  expect(matchRoute("/embed/config")).toMatchObject({ id: "embeds", label: "Embeds", external: true });
});

test("CONTRACT · the table installs no route for a module this product does not have", () => {
  // The Airtable mirror was cancelled and the AI first pass was never built.
  // An installed route claims a module exists; these two claimed one and had none.
  expect(matchRoute("/settings/airtable")).toBeUndefined();
  expect(matchRoute("/evaluation/ai")).toBeUndefined();
  // Task templates stays: the onboarding tasks behind it are real and shipped,
  // so its empty state describes an unbuilt screen rather than an absent feature.
  expect(matchRoute("/settings/tasks")?.id).toBe("task-templates");
});

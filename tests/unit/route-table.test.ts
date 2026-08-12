import { expect, test } from "vitest";

import { matchRoute, routesFor } from "../../src/ui/shell/route-table";

/**
 * The prototype's navigation order, plus three rows MRQ-106 adds knowing they
 * are a deviation from it: the submissions list and its create action (both
 * reachable only by typing a URL before this), and the embed builder (which
 * lived two hops away on the public site). The prototype could not have
 * anticipated a discoverability finding; the order it does specify is intact.
 */
test("CONTRACT · the sidebar reproduces the binding prototype navigation order", () => {
  // "Tasks" is the one row the binding prototype does not carry. Task authoring
  // did not exist when the prototype was drawn, and an area reachable only from
  // a settings sub-page is an area an organizer has to already know about. The
  // prototype's order is otherwise untouched, and the new row sits with the
  // other program modules where its siblings are.
  expect([...routesFor("home"), ...routesFor("pipeline"), ...routesFor("modules")].map((route) => route.label)).toEqual([
    "Program home", "Program board", "Abstracts & sessions", "Add a session",
    "Submitted", "In review", "Waved", "Ready to place", "Onboarding", "Scheduled", "Published",
    "CFP forms", "Evaluation plan", "Review queue", "Agenda", "Files", "Communications", "Tasks", "Speaker portal", "Conference site",
    "Embeds", "Conference settings",
    "Speaker follow-ups",
  ]);
});

test("CONTRACT · MRQ-115 — the files library is reachable by the noun an organizer searches for", () => {
  // CNT-S3 step 5 enumerates the labels an operator (and the eval agent) will
  // look for. "Files" is one of them, spelled exactly; a cleverer name here is
  // a screen nobody finds.
  expect(matchRoute("/files")).toMatchObject({ id: "files", label: "Files", group: "modules", sidebar: true });
});

test("CONTRACT · MRQ-106 · the embed builder navigates for real, because the shell does not render it", () => {
  // `app.tsx` treats every `/embed/` path as a public page, so a client-side
  // push would draw the shell's "not installed" empty state over a working
  // server-rendered builder — worse than having no link at all.
  expect(matchRoute("/embed/config")).toMatchObject({ label: "Embeds", external: true, sidebar: true });
});

test("CONTRACT · MRQ-106 · the submissions list and its create action are in the sidebar", () => {
  expect(matchRoute("/submissions")).toMatchObject({ id: "submissions", sidebar: true, group: "home" });
  expect(matchRoute("/submissions/new")).toMatchObject({ id: "submission-new", sidebar: true, group: "home" });
});

test("AC-1 · speaker follow-ups and system health are real external destinations in their binding groups", () => {
  expect(matchRoute("/delivery-health")).toMatchObject({ label: "Speaker follow-ups", group: "modules", external: true });
  expect(matchRoute("/delivery-health", "?view=system")).toMatchObject({ label: "System health", group: "utility", external: true });
  expect(routesFor("utility").map((route) => route.label)).toContain("System health");
});

test("CONTRACT · route matching preserves lifecycle query routes and dynamic records", () => {
  expect(matchRoute("/submissions", "?status=accepted")?.id).toBe("accepted");
  expect(matchRoute("/submissions/abc-123")?.id).toBe("submission-detail");
});

test("AC-106 · API tokens and the sidebar API docs link resolve as real routes", () => {
  expect(matchRoute("/settings/api")?.id).toBe("api-tokens");
  expect(matchRoute("/api/docs")?.id).toBe("api-docs");
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

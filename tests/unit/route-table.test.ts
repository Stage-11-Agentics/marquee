import { expect, test } from "vitest";

import { matchRoute, routesFor } from "../../src/ui/shell/route-table";

test("CONTRACT · the sidebar reproduces the binding prototype navigation order", () => {
  expect([...routesFor("home"), ...routesFor("pipeline"), ...routesFor("modules")].map((route) => route.label)).toEqual([
    "Program home", "Program board", "Submitted", "In review", "Waved", "Accepted", "Onboarding", "Scheduled", "Published",
    "CFP forms", "Evaluation plan", "Review queue", "Agenda", "Communications", "Speaker portal", "Conference site", "Conference settings",
    "Delivery health",
  ]);
});

test("CONTRACT · delivery health is a real sidebar destination the shell resolves", () => {
  expect(matchRoute("/delivery-health")?.label).toBe("Delivery health");
});

test("CONTRACT · route matching preserves lifecycle query routes and dynamic records", () => {
  expect(matchRoute("/submissions", "?status=accepted")?.id).toBe("accepted");
  expect(matchRoute("/submissions/abc-123")?.id).toBe("submission-detail");
});

test("AC-106 · API tokens and the sidebar API docs link resolve as real routes", () => {
  expect(matchRoute("/settings/api")?.id).toBe("api-tokens");
  expect(matchRoute("/api/docs")?.id).toBe("api-docs");
});

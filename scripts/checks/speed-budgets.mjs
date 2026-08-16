export const SPEED_BUDGETS = Object.freeze([
  { id: "dashboard-render", kind: "acceptance", source: "AC-16", metric: "p95", threshold: 1_000, unit: "ms" },
  { id: "cfp-cold-interactive", kind: "acceptance", source: "AC-36", metric: "p95", threshold: 1_000, unit: "ms" },
  { id: "agenda-cold-interactive", kind: "acceptance", source: "AC-85", metric: "p95", threshold: 1_000, unit: "ms" },
  { id: "review-next-interactive", kind: "acceptance", source: "AC-62", metric: "median", threshold: 300, unit: "ms" },
  { id: "global-search-painted", kind: "acceptance", source: "AC-103", metric: "p95", threshold: 200, unit: "ms" },
  { id: "embed-source-reflection", kind: "acceptance", source: "AC-89", metric: "max", threshold: 60_000, unit: "ms" },
  { id: "bulk-accept-completion", kind: "acceptance", source: "AC-69", metric: "completed", threshold: true, unit: "boolean" },
  { id: "bulk-accept-long-task", kind: "objective", source: "client-objective", metric: "max", threshold: 100, unit: "ms" },
  { id: "submissions-first-interactive", kind: "objective", source: "client-objective", metric: "p95", threshold: 1_000, unit: "ms" },
  { id: "submissions-filter-sort", kind: "objective", source: "client-objective", metric: "p95", threshold: 200, unit: "ms" },
  { id: "agenda-view-switch", kind: "objective", source: "client-objective", metric: "p95", threshold: 200, unit: "ms" },
  { id: "admin-route-transition", kind: "objective", source: "client-objective", metric: "p95", threshold: 300, unit: "ms" },
  { id: "speaker-portal-load", kind: "objective", source: "client-objective", metric: "p95", threshold: 1_000, unit: "ms" },
  { id: "chase-board-load", kind: "objective", source: "client-objective", metric: "p95", threshold: 1_000, unit: "ms" },
]);

export function budgetsForScope(scope = "all") {
  if (scope !== "all" && scope !== "acceptance") {
    throw new Error(`check:speed: --scope must be "all" or "acceptance" (got "${scope}")`);
  }
  return scope === "acceptance"
    ? SPEED_BUDGETS.filter((budget) => budget.kind === "acceptance")
    : SPEED_BUDGETS;
}

export function classifySpeedMeasurements(measurements, { gate = false, scope = "all" } = {}) {
  const entries = budgetsForScope(scope).map((budget) => {
    const observed = measurements[budget.id];
    const missing = observed === undefined;
    const met = !missing && (budget.metric === "completed" ? observed === true : Number(observed) <= budget.threshold);
    return {
      ...budget,
      observed: missing ? null : observed,
      verdict: missing ? "missing" : met ? "pass" : budget.kind === "acceptance" ? "fail" : "warn",
      banner: !missing && !met && budget.kind === "objective" ? "⚠ OBJECTIVE MISSED" : null,
    };
  });
  const acceptanceFailures = entries.filter((entry) => entry.verdict === "fail");
  const objectiveWarnings = entries.filter((entry) => entry.verdict === "warn");
  const missing = entries.filter((entry) => entry.verdict === "missing");
  return {
    entries,
    acceptanceFailures,
    objectiveWarnings,
    missing,
    shouldFail: acceptanceFailures.length > 0 || (gate && missing.length > 0),
  };
}

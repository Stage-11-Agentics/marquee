import { describe, expect, test } from "vitest";

import { SPEED_BUDGETS, classifySpeedMeasurements } from "../../scripts/checks/speed-budgets.mjs";

function passingMeasurements(): Record<string, number | boolean> {
  return Object.fromEntries(SPEED_BUDGETS.map((budget) => [budget.id, budget.metric === "completed" ? true : budget.threshold]));
}

const EXPECTED_AC_SOURCED_BUDGETS = Object.freeze({
  "dashboard-render": { source: "AC-16", kind: "acceptance" },
  "cfp-cold-interactive": { source: "AC-36", kind: "acceptance" },
  "agenda-cold-interactive": { source: "AC-85", kind: "acceptance" },
  "review-next-interactive": { source: "AC-62", kind: "acceptance" },
  "global-search-painted": { source: "AC-103", kind: "acceptance" },
  "embed-source-reflection": { source: "AC-89", kind: "acceptance" },
  "bulk-accept-completion": { source: "AC-69", kind: "acceptance" },
});

describe("speed budget authority", () => {
  test("CONTRACT · the manifest has seven failing acceptance budgets and seven warning-only objectives", () => {
    expect(SPEED_BUDGETS.filter((budget) => budget.kind === "acceptance")).toHaveLength(7);
    expect(SPEED_BUDGETS.filter((budget) => budget.kind === "objective")).toHaveLength(7);
  });

  test("CONTRACT · every AC-sourced budget retains its acceptance classification", () => {
    const actual = Object.fromEntries(
      SPEED_BUDGETS
        .filter((budget) => budget.source.startsWith("AC-"))
        .map((budget) => [budget.id, { source: budget.source, kind: budget.kind }]),
    );
    expect(actual).toEqual(EXPECTED_AC_SOURCED_BUDGETS);
  });

  test("CONTRACT · an acceptance breach fails while an objective breach only warns", () => {
    const acceptance = classifySpeedMeasurements({ ...passingMeasurements(), "dashboard-render": 1_001 });
    expect(acceptance.shouldFail).toBe(true);
    const objective = classifySpeedMeasurements({ ...passingMeasurements(), "chase-board-load": 1_001 });
    expect(objective.shouldFail).toBe(false);
    expect(objective.objectiveWarnings[0]?.banner).toBe("⚠ OBJECTIVE MISSED");
  });

  test("CONTRACT · AC-69 completion and the Long Tasks objective are independent", () => {
    const completionFailure = classifySpeedMeasurements({ ...passingMeasurements(), "bulk-accept-completion": false });
    expect(completionFailure.shouldFail).toBe(true);
    const longTaskWarning = classifySpeedMeasurements({ ...passingMeasurements(), "bulk-accept-long-task": 101 });
    expect(longTaskWarning.shouldFail).toBe(false);
    expect(longTaskWarning.objectiveWarnings).toHaveLength(1);
  });

  test("CONTRACT · missing measurements fail only in gate mode", () => {
    expect(classifySpeedMeasurements({}, { gate: false }).shouldFail).toBe(false);
    expect(classifySpeedMeasurements({}, { gate: true }).shouldFail).toBe(true);
  });

  test("CONTRACT · the per-PR acceptance scope excludes warning-only objectives", () => {
    const scoped = classifySpeedMeasurements({ ...passingMeasurements(), "submissions-filter-sort": 999 }, { gate: true, scope: "acceptance" });
    expect(scoped.entries.every((entry) => entry.kind === "acceptance")).toBe(true);
    expect(scoped.entries).toHaveLength(7);
    expect(scoped.objectiveWarnings).toHaveLength(0);
    expect(scoped.shouldFail).toBe(false);
  });

  test("CONTRACT · the per-PR acceptance scope still fails a missing AC measurement", () => {
    const measurements = passingMeasurements();
    delete measurements["global-search-painted"];
    const scoped = classifySpeedMeasurements(measurements, { gate: true, scope: "acceptance" });
    expect(scoped.missing.map((entry) => entry.id)).toEqual(["global-search-painted"]);
    expect(scoped.shouldFail).toBe(true);
  });
});

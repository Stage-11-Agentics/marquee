import { describe, expect, test } from "vitest";

import { SPEED_BUDGETS, classifySpeedMeasurements } from "../../scripts/checks/speed-budgets.mjs";

function passingMeasurements(): Record<string, number | boolean> {
  return Object.fromEntries(SPEED_BUDGETS.map((budget) => [budget.id, budget.metric === "completed" ? true : budget.threshold]));
}

describe("speed budget authority", () => {
  test("CONTRACT · the manifest has seven failing acceptance budgets and seven warning-only objectives", () => {
    expect(SPEED_BUDGETS.filter((budget) => budget.kind === "acceptance")).toHaveLength(7);
    expect(SPEED_BUDGETS.filter((budget) => budget.kind === "objective")).toHaveLength(7);
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
});

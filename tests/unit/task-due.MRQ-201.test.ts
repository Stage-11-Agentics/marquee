import { expect, test } from "vitest";

import { dueAtFromDateInput, isTaskDueWithinDays, isTaskOverdue, taskDaysOverdue } from "../../src/lib/task-due";

const DUE_AT = dueAtFromDateInput("2027-05-01");

test("AC-10 · fixed task due days use the conference clock while relative tasks keep instant semantics", () => {
  expect(DUE_AT).not.toBeNull();
  const fixed = { dueAt: DUE_AT!, templateDueAt: DUE_AT, timezone: "America/New_York" };
  const beforeLocalMidnight = Date.parse("2027-05-01T20:00:00-04:00");
  const afterLocalMidnight = Date.parse("2027-05-02T00:00:01-04:00");

  expect(isTaskOverdue(fixed, beforeLocalMidnight)).toBe(false);
  expect(isTaskOverdue(fixed, afterLocalMidnight)).toBe(true);
  expect(taskDaysOverdue(fixed, afterLocalMidnight)).toBe(1);
  expect(isTaskDueWithinDays(fixed, beforeLocalMidnight, 14)).toBe(true);

  expect(isTaskOverdue({ dueAt: beforeLocalMidnight - 1 }, beforeLocalMidnight)).toBe(true);
  expect(isTaskDueWithinDays({ dueAt: beforeLocalMidnight + 7 * 86_400_000 }, beforeLocalMidnight, 14)).toBe(true);

  const overriddenDueAt = Date.parse("2027-04-30T23:59:59.000Z");
  expect(isTaskOverdue({ dueAt: overriddenDueAt, templateDueAt: DUE_AT, timezone: "America/New_York" }, overriddenDueAt + 1)).toBe(true);

  // A relative task may land exactly on the preserved UTC end-of-day
  // millisecond. Template provenance must keep it an instant, not turn it into
  // a calendar-day task by shape alone.
  expect(isTaskOverdue({ dueAt: DUE_AT!, templateDueAt: null, timezone: "America/New_York" }, DUE_AT! + 1)).toBe(true);
});

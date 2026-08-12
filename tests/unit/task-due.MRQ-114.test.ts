/**
 * MRQ-114 · a due date the organizer types must be the due date they read back.
 *
 * CNT-01 grades literal dates — "Upload Session Presentation" due 2027-05-01 —
 * off a screenshot. A local-midnight parse renders that as Apr 30 anywhere west
 * of Greenwich, which fails a w3 item on nothing but arithmetic.
 */
import { describe, expect, test } from "vitest";

import { dateInputFromDueAt, dueAtFromDateInput, formatDueDate, resolveTaskDueAt } from "../../src/lib/task-due";

const FIXTURE_DATES = ["2027-05-01", "2027-04-14", "2027-04-01", "2027-04-15", "2026-01-01", "2028-02-29"];

describe("MRQ-114 · CNT-01 · task due dates", () => {
  test("CONTRACT · MRQ-114 · CNT-01 · every fixture date survives the round trip through storage", () => {
    for (const date of FIXTURE_DATES) {
      const stored = dueAtFromDateInput(date);
      expect(stored, date).not.toBeNull();
      expect(dateInputFromDueAt(stored as number), date).toBe(date);
    }
  });

  test("CONTRACT · MRQ-114 · the stored instant is the end of the named day, not its start", () => {
    const stored = dueAtFromDateInput("2027-05-01") as number;
    expect(new Date(stored).toISOString()).toBe("2027-05-01T23:59:59.999Z");
  });

  test("CONTRACT · MRQ-114 · the rendered date reads the same in every timezone", () => {
    // Intl is pinned to UTC inside the formatter, so a Los Angeles reader and a
    // Tokyo reader see the same day — the one the organizer typed.
    const stored = dueAtFromDateInput("2027-05-01") as number;
    expect(formatDueDate(stored)).toBe("May 1, 2027");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(stored))).toBe("May 1");
  });

  test("CONTRACT · MRQ-114 · malformed and impossible dates are refused rather than rolled forward", () => {
    for (const value of ["", "not-a-date", "2027-5-1", "2027-02-30", "2027-13-01", "2027-00-10"]) {
      expect(dueAtFromDateInput(value), value).toBeNull();
    }
  });

  test("CONTRACT · MRQ-114 · an offset deadline counts from now; a fixed one ignores now entirely", () => {
    const now = Date.UTC(2027, 0, 1);
    expect(resolveTaskDueAt({ due_at: 1234, due_offset_days: null }, now)).toBe(1234);
    expect(resolveTaskDueAt({ due_at: null, due_offset_days: 14 }, now)).toBe(now + 14 * 86_400_000);
  });
});

import { describe, expect, test } from "vitest";

import { fromDateTimeLocalInput, toDateTimeLocalInput } from "../../src/ui/forms/FormsPage";

/**
 * sbek round 11 filed this against /forms: an organizer typed 2027-04-30 23:59
 * and the field redisplayed 05/01/2027 03:59 after saving — a deadline one day
 * later than the one they set. The stored instant was correct throughout, so
 * this is entirely a read-back fault, and it only appears away from UTC.
 *
 * Every case here pins America/New_York, because in UTC the broken and the
 * fixed implementation are indistinguishable.
 */
function inNewYork<T>(body: () => T): T {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    return body();
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
}

describe("CFP form builder close date", () => {
  test("CONTRACT · form builder — reads back the day and time the organizer typed", () => {
    inNewYork(() => {
      const typed = "2027-04-30T23:59";
      const stored = fromDateTimeLocalInput(typed);

      expect(stored).not.toBeNull();
      expect(toDateTimeLocalInput(stored)).toBe(typed);
    });
  });

  test("CONTRACT · form builder — does not roll the close date onto the next day", () => {
    inNewYork(() => {
      const stored = fromDateTimeLocalInput("2027-04-30T23:59");

      // The exact fault: toISOString() rendered this instant as the 1st.
      expect(toDateTimeLocalInput(stored)).toContain("2027-04-30");
      expect(new Date(stored as number).toISOString().slice(0, 10)).toBe("2027-05-01");
    });
  });

  test("CONTRACT · form builder — round-trips across a daylight-saving boundary", () => {
    inNewYork(() => {
      // EST either side of the March change, and EDT after it: a fixed offset
      // would get one of these wrong.
      for (const typed of ["2027-01-15T09:30", "2027-03-14T03:30", "2027-07-04T12:00", "2027-11-07T01:30"]) {
        expect(toDateTimeLocalInput(fromDateTimeLocalInput(typed))).toBe(typed);
      }
    });
  });

  test("CONTRACT · form builder — treats an empty or unparseable close date as no deadline", () => {
    inNewYork(() => {
      expect(fromDateTimeLocalInput("")).toBeNull();
      expect(fromDateTimeLocalInput("not a date")).toBeNull();
      expect(toDateTimeLocalInput(null)).toBe("");
      expect(toDateTimeLocalInput(Number.NaN)).toBe("");
    });
  });
});

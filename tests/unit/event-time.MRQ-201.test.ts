import { describe, expect, test } from "vitest";

import {
  EVENT_TIMEZONES,
  eventTimeLabel,
  formatEventDateTime,
  instantToLocalDateTime,
  localDateTimeToInstant,
  localParts,
  timeZoneLabel,
  zonedStart,
} from "../../src/lib/event-time";

function inTokyo<T>(body: () => T): T {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    return body();
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
}

describe("MRQ-201 event time seam", () => {
  test("AC-1 · the shared timezone list is the setup and settings source", () => {
    expect(EVENT_TIMEZONES).toEqual([
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Tokyo",
      "Australia/Sydney",
      "UTC",
    ]);
  });

  test("AC-3 · a Tokyo machine round-trips a New York close as the conference clock", () => {
    inTokyo(() => {
      const typed = "2027-04-30T23:59";
      const stored = localDateTimeToInstant(typed, "America/New_York");

      expect(stored).toBe(Date.parse("2027-05-01T03:59:00.000Z"));
      expect(instantToLocalDateTime(stored, "America/New_York")).toBe(typed);
      expect(localParts(stored!, "America/New_York")).toEqual({ day: "2027-04-30", time: "23:59" });
      expect(new Date(stored!).getHours()).not.toBe(23);
    });
  });

  test("AC-11 · wall clocks round-trip across both 2027 New York DST transitions", () => {
    inTokyo(() => {
      for (const typed of [
        "2027-01-15T09:30",
        "2027-03-14T03:30",
        "2027-07-04T12:00",
        "2027-11-07T01:30",
      ]) {
        const stored = localDateTimeToInstant(typed, "America/New_York");
        expect(instantToLocalDateTime(stored, "America/New_York")).toBe(typed);
      }
    });
  });

  test("AC-11 · DST gap settles forward and overlap takes the first occurrence", () => {
    inTokyo(() => {
      const gap = zonedStart("2027-03-14", "02:30", "America/New_York");
      expect(new Date(gap).toISOString()).toBe("2027-03-14T07:30:00.000Z");
      expect(instantToLocalDateTime(gap, "America/New_York")).toBe("2027-03-14T03:30");

      const overlap = zonedStart("2027-11-07", "01:30", "America/New_York");
      expect(new Date(overlap).toISOString()).toBe("2027-11-07T05:30:00.000Z");
      expect(instantToLocalDateTime(overlap, "America/New_York")).toBe("2027-11-07T01:30");
    });
  });

  test("CONTRACT · malformed datetime-local values are absent, not browser-local guesses", () => {
    inTokyo(() => {
      expect(localDateTimeToInstant("", "America/New_York")).toBeNull();
      expect(localDateTimeToInstant("2027-02-30T09:00", "America/New_York")).toBeNull();
      expect(localDateTimeToInstant("2027-04-30T24:00", "America/New_York")).toBeNull();
      expect(instantToLocalDateTime(Number.NaN, "America/New_York")).toBe("");
    });
  });

  test("AC-5 · human event times carry the DST-aware short zone", () => {
    const instant = Date.parse("2027-05-01T03:59:00.000Z");
    expect(timeZoneLabel(instant, "America/New_York")).toBe("EDT");
    expect(formatEventDateTime(instant, "America/New_York")).toContain("Apr 30, 2027");
    expect(formatEventDateTime(instant, "America/New_York")).toContain("EDT");
    expect(eventTimeLabel("America/New_York")).toBe("(America/New_York)");
    expect(eventTimeLabel(null)).toBe("");
  });
});

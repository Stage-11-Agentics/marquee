import { expect, test } from "vitest";

import { conferenceDays, countOutsideConferenceWindow } from "../../src/lib/conference-dates";

test("CONTRACT · MRQ-142 · conference days stay date-only and count scheduled Sessions outside the window", () => {
  expect(conferenceDays("2026-10-12", "2026-10-14")).toEqual([
    { id: "2026-10-12", label: "Mon, Oct 12" },
    { id: "2026-10-13", label: "Tue, Oct 13" },
    { id: "2026-10-14", label: "Wed, Oct 14" },
  ]);

  expect(countOutsideConferenceWindow(
    [Date.UTC(2026, 9, 12, 13), Date.UTC(2026, 9, 15, 13)],
    "2026-10-12",
    "2026-10-14",
    "America/New_York",
  )).toBe(1);
});

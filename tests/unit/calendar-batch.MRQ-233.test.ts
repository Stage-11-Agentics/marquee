import { expect, test } from "vitest";

import { buildCalendarBatchMail } from "../../src/jobs/calendar/ics";

const UID_ONE = "submission-one.person-one@marquee.stage11.dev";
const UID_TWO = "submission-two.person-one@marquee.stage11.dev";

test("AC-375 · batch mail renders one stable ICS link and old-to-new slot material per covered session", () => {
  const mail = buildCalendarBatchMail({
    eventName: "AIE NYC",
    eventTimezone: "America/New_York",
    items: [
      {
        current: {
          durationMin: 30,
          location: "Room B",
          startsAt: Date.parse("2026-09-09T19:30:00.000Z"),
          timezone: "America/New_York",
          title: "Moved session",
          uid: UID_ONE,
        },
        previous: {
          location: "Room A",
          startsAt: Date.parse("2026-09-09T19:00:00.000Z"),
        },
        sequence: 1,
      },
      {
        current: {
          durationMin: 45,
          location: "Room C",
          startsAt: Date.parse("2026-09-09T20:00:00.000Z"),
          timezone: "America/New_York",
          title: "New session",
          uid: UID_TWO,
        },
        sequence: 0,
      },
    ],
  });

  expect(mail.text).toContain(`Calendar file: https://marquee.stage11.dev/i/${encodeURIComponent(UID_ONE)}.ics`);
  expect(mail.text).toContain(`Calendar file: https://marquee.stage11.dev/i/${encodeURIComponent(UID_TWO)}.ics`);
  expect(mail.html.match(/href="https:\/\/marquee\.stage11\.dev\/i\/[^\"]+\.ics"/g)).toHaveLength(2);
  expect(mail.text).toContain("Room A");
  expect(mail.text).toContain("Room B");
  expect(mail.text).toContain("Sequence: 1");
  expect(mail.text).toContain("Sequence: 0");
});

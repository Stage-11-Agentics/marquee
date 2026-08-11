import { expect, test } from "vitest";

import {
  buildCalendarIcs,
  buildCalendarLinks,
  buildCalendarMail,
  buildMultipartAlternative,
  calendarUid,
} from "../../src/jobs/calendar/ics";

const COMMON = {
  attendeeEmail: "ada@example.com",
  attendeeName: "Ada Lovelace",
  description: "A session with a comma, semicolon; and a long description that folds safely across UTF-8 octets.",
  dtstamp: Date.parse("2026-08-11T12:00:00.000Z"),
  durationMin: 30,
  location: "Metropolitan Ballroom · Sheraton New York Times Square",
  organizerEmail: "marquee@stage11.systems",
  organizerName: "Marquee",
  startsAt: Date.parse("2026-09-09T19:00:00.000Z"),
  title: "Reliable multi-agent systems",
  timezone: "America/New_York",
  uid: calendarUid("submission-1", "person-1"),
  url: "https://marquee.stage11.dev/s/submission-1",
} as const;

function assertFoldedIcs(ics: string): void {
  expect(ics.endsWith("\r\n")).toBe(true);
  expect(ics.replaceAll("\r\n", "").includes("\n")).toBe(false);
  for (const line of ics.split("\r\n").filter(Boolean)) {
    expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
  }
}

test("AC-95, AC-96, AC-97 · RFC wire output carries the required request/update/cancel fields and safe folding", () => {
  const series = [
    buildCalendarIcs({ ...COMMON, method: "REQUEST", sequence: 0 }),
    buildCalendarIcs({ ...COMMON, method: "REQUEST", sequence: 1, startsAt: COMMON.startsAt + 3_600_000 }),
    buildCalendarIcs({ ...COMMON, method: "CANCEL", sequence: 2, startsAt: COMMON.startsAt + 3_600_000 }),
  ];

  expect(series.map((ics) => ics.match(/METHOD:(REQUEST|CANCEL)/)?.[1])).toEqual(["REQUEST", "REQUEST", "CANCEL"]);
  expect(series.map((ics) => ics.match(/SEQUENCE:(\d+)/)?.[1])).toEqual(["0", "1", "2"]);
  for (const ics of series) {
    expect(ics).toContain(`UID:${COMMON.uid}\r\n`);
    expect(ics).toContain("DTSTAMP:20260811T120000Z\r\n");
    expect(ics).toContain("TZID:America/New_York\r\n");
    expect(ics).toContain("BEGIN:DAYLIGHT\r\n");
    expect(ics).toContain("BEGIN:STANDARD\r\n");
    expect(ics).toContain("ORGANIZER;CN=Marquee:mailto:marquee@stage11.systems\r\n");
    expect(ics).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;");
    expect(ics).toContain("LOCATION:Metropolitan Ballroom · Sheraton New York Times Square\r\n");
    assertFoldedIcs(ics);
  }
  expect(series[0]).toContain("STATUS:CONFIRMED\r\n");
  expect(series[2]).toContain("STATUS:CANCELLED\r\n");
  expect(series[1]).toContain("DTSTART;TZID=America/New_York:20260909T160000\r\n");
});

test("AC-95, AC-96 · calendar mail exposes exactly one method-matched calendar alternative and both deep links", () => {
  const material = buildCalendarMail({ ...COMMON, method: "REQUEST", sequence: 0, origin: "https://marquee.stage11.dev" });
  expect(material.mime).toContain("Content-Type: multipart/alternative;");
  expect(material.mime.match(/Content-Type: text\/plain; charset=utf-8/gi)).toHaveLength(1);
  expect(material.mime.match(/Content-Type: text\/html; charset=utf-8/gi)).toHaveLength(1);
  expect(material.mime.match(/Content-Type: text\/calendar;[^\r\n]*method=REQUEST/gi)).toHaveLength(1);
  expect(material.mime).not.toContain("method=CANCEL");
  expect(material.text).toContain("Add to Google Calendar:");
  expect(material.text).toContain("Add to Outlook:");
  expect(material.links.stable).toBe(`https://marquee.stage11.dev/i/${encodeURIComponent(COMMON.uid)}.ics`);
  expect(new URL(material.links.google).searchParams.get("action")).toBe("TEMPLATE");
  expect(new URL(material.links.outlook).searchParams.get("rru")).toBe("addevent");
});

test("AC-124 · cancellation MIME and ICS reuse the original UID and increment sequence", () => {
  const request = buildCalendarIcs({ ...COMMON, method: "REQUEST", sequence: 1 });
  const cancel = buildCalendarIcs({ ...COMMON, method: "CANCEL", sequence: 2 });
  expect(cancel).toContain(`UID:${COMMON.uid}\r\n`);
  expect(cancel).toContain("SEQUENCE:2\r\n");
  expect(cancel).toContain("METHOD:CANCEL\r\n");
  const mime = buildMultipartAlternative({ html: "<p>cancel</p>", icsBody: cancel, method: "CANCEL", plain: "cancel", uid: COMMON.uid });
  expect(mime.match(/Content-Type: text\/calendar;[^\r\n]*method=CANCEL/gi)).toHaveLength(1);
  expect(request).not.toBe(cancel);
});

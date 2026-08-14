import { expect, test } from "vitest";

import { submissionScheduleRequest } from "../../src/ui/submissions/SubmissionRecordPage";

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

test("CONTRACT · MRQ-201 · SubmissionRecordPage stores the conference-local session instant", () => {
  inTokyo(() => {
    const request = submissionScheduleRequest({
      starts_at: "2027-04-30T09:00",
      duration_min: "30",
      room_id: "room-new-york",
      track_id: "track-platform",
    }, "America/New_York");

    expect(request).toMatchObject({
      path: "/schedule",
      route: "/api/v1/events/{eventId}/submissions/{submissionId}/schedule",
    });
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      starts_at: Date.parse("2027-04-30T13:00:00.000Z"),
      duration_min: 30,
      room_id: "room-new-york",
      track_id: "track-platform",
    });
    // Tokyo's browser-local answer would be 00:00Z, not the conference's 13:00Z.
    expect(new Date(JSON.parse(String(request?.init.body)).starts_at).getHours()).not.toBe(9);
  });
});

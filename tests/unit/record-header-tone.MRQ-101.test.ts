import { describe, expect, test } from "vitest";

import { headerChipTone } from "../../src/ui/submissions/record-copy";

function record(status: string, stage: string) {
  return { status, stage };
}

describe("CONTRACT · the header state chip tone reads status, not the declined stage bucket", () => {
  test("CONTRACT · a rejected or withdrawn record is a terminal-negative alarm", () => {
    expect(headerChipTone(record("rejected", "declined"))).toBe("alarm");
    expect(headerChipTone(record("withdrawn", "declined"))).toBe("alarm");
  });

  test("CONTRACT · an accepted record reads success even while its stage is still declined-bucketed", () => {
    expect(headerChipTone(record("accepted", "accepted"))).toBe("success");
    expect(headerChipTone(record("submitted", "published"))).toBe("success");
  });

  test("CONTRACT · a waitlisted record is warning, not alarm — Maybe is not a terminal negative", () => {
    // stage.declined is a fallback bucket shared by waitlisted, rejected,
    // withdrawn, and stray drafts (src/api/board.ts) — the chip must not tone
    // a waitlisted record the same alarming red as a rejected one.
    expect(headerChipTone(record("waitlisted", "declined"))).toBe("warning");
    expect(headerChipTone(record("submitted", "waved"))).toBe("warning");
  });

  test("CONTRACT · an in-flight record with no terminal signal stays untoned", () => {
    expect(headerChipTone(record("submitted", "submitted"))).toBe("");
    expect(headerChipTone(record("in_review", "in_review"))).toBe("");
  });
});

import { describe, expect, test } from "vitest";

import { normalizeHelperEmail, normalizeHelperName, resolvePortalSeat } from "../../src/lib/speaker-helpers";

describe("MRQ-286 helper seat resolution", () => {
  const seatCases = [
    [{ hasSpeakerSeat: false, hasSubmitterSeat: false, hasHelperSeat: true }, "helper"],
    [{ hasSpeakerSeat: true, hasSubmitterSeat: false, hasHelperSeat: false }, "speaker"],
    [{ hasSpeakerSeat: false, hasSubmitterSeat: true, hasHelperSeat: false }, "submitter"],
    [{ hasSpeakerSeat: true, hasSubmitterSeat: false, hasHelperSeat: true }, "speaker"],
    [{ hasSpeakerSeat: true, hasSubmitterSeat: false, hasHelperSeat: true, helperView: true }, "helper"],
    [{ hasSpeakerSeat: false, hasSubmitterSeat: true, hasHelperSeat: true }, "submitter"],
  ] as const;

  test("CONTRACT · MRQ-286 · resolves helper, speaker, submitter, and helper-view seats", () => {
    for (const [input, expected] of seatCases) {
      expect(resolvePortalSeat(input)).toBe(expected);
    }
  });

  test("CONTRACT · MRQ-286 · normalizes helper identity without exposing a stored person name", () => {
    expect(normalizeHelperName("  Avery   Chen ")).toBe("Avery Chen");
    expect(normalizeHelperEmail("  Avery@Example.COM ")).toBe("avery@example.com");
  });
});

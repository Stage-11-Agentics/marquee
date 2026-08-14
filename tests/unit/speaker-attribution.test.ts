import { describe, expect, it } from "vitest";

import { hasPublicSpeakingParticipant } from "../../src/ui/submissions/SubmissionRecordPage";

describe("speaker attribution", () => {
  it("warns for submitter-only records while recognizing public speaking roles", () => {
    expect(hasPublicSpeakingParticipant([{ role: "submitter" }])).toBe(false);
    expect(hasPublicSpeakingParticipant([{ role: "sponsor_contact" }])).toBe(false);
    expect(hasPublicSpeakingParticipant([{ role: "speaker" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "co_speaker" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "moderator" }])).toBe(true);
    expect(hasPublicSpeakingParticipant([{ role: "chairperson" }])).toBe(true);
  });
});

import { describe, expect, test } from "vitest";

import { speakerUploadFailureMessage } from "../../src/ui/upload/upload-client";

describe("MRQ-92 speaker upload errors", () => {
  test("CONTRACT · transport errors become a human sentence", () => {
    expect(speakerUploadFailureMessage(new Error("upload PUT network error"))).toBe("We couldn't upload that file. Check your connection and try again.");
    expect(speakerUploadFailureMessage(new Error("upload PUT failed with status 403"))).toBe("We couldn't upload that file. Check your connection and try again.");
    expect(speakerUploadFailureMessage(new Error("upload PUT aborted"))).toBe("We couldn't upload that file. Check your connection and try again.");
  });

  test("CONTRACT · non-transport validation messages remain actionable", () => {
    expect(speakerUploadFailureMessage(new Error("Choose a .pdf file."))).toBeNull();
  });
});

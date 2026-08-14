import { describe, expect, test, vi } from "vitest";

import {
  isUploadAborted,
  putFileToR2,
  speakerUploadAbortedMessage,
  speakerUploadFailureMessage,
  UPLOAD_PUT_TIMEOUT_MS,
  UPLOAD_PUT_TIMED_OUT,
} from "../../src/ui/upload/upload-client";

class HangingXHR {
  static latest: HangingXHR;
  readonly upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  timeout = 0;
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    HangingXHR.latest = this;
  }

  open(): void {}
  setRequestHeader(): void {}
  send(): void {}
  abort(): void { this.onabort?.(); }
}

const signedUpload = {
  attachmentId: "att_mrq177",
  putUrl: "https://media.example/upload",
  requiredHeaders: { "content-type": "application/pdf" },
  expiresAt: Date.now() + 60_000,
  completionToken: "completion-token",
  maxBytes: 10_000,
};

describe("MRQ-92 speaker upload errors", () => {
  test("CONTRACT · transport errors become a human sentence", () => {
    expect(speakerUploadFailureMessage(new Error("upload PUT network error"))).toBe("We couldn't upload that file. Check your connection and try again.");
    expect(speakerUploadFailureMessage(new Error("upload PUT failed with status 500"))).toBe("That upload didn't go through. Retry when you're ready.");
    expect(speakerUploadFailureMessage(new Error("upload PUT aborted"))).toBeNull();
    expect(isUploadAborted(new Error("upload PUT aborted"))).toBe(true);
  });

  test("CONTRACT · non-transport validation messages remain actionable", () => {
    expect(speakerUploadFailureMessage(new Error("Choose a .pdf file."))).toBeNull();
  });

  test("CONTRACT · MRQ-177 · a stalled replacement upload times out and preserves the current version", async () => {
    vi.stubGlobal("XMLHttpRequest", HangingXHR);
    const put = putFileToR2(signedUpload, { name: "slides.pdf", type: "application/pdf", size: 608 } as unknown as File);

    expect(HangingXHR.latest.timeout).toBe(UPLOAD_PUT_TIMEOUT_MS);
    HangingXHR.latest.ontimeout?.();
    await expect(put.promise).rejects.toThrow(UPLOAD_PUT_TIMED_OUT);

    const failure = speakerUploadFailureMessage(new Error(UPLOAD_PUT_TIMED_OUT), { hasPreviousVersion: true });
    expect(failure).toContain("Your previous version is still current");
    expect(failure).toContain("Retry");
    expect(failure).not.toContain("success");
    expect(speakerUploadAbortedMessage(true)).toContain("Your previous version is still current");
  });
});

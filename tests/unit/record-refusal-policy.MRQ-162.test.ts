import { describe, expect, test } from "vitest";

import { errorSummary, MarqueeApiError } from "../../src/ui/shell/api-client";
import { submissionWriteFailure } from "../../src/ui/submissions/SubmissionRecordPage";

function apiError(overrides: Partial<ConstructorParameters<typeof MarqueeApiError>[0]> = {}): MarqueeApiError {
  return new MarqueeApiError({
    code: "conflict",
    message: "reviewer is outside the assigned track scope",
    status: 409,
    route: "/api/v1/events/{eventId}/submissions/{submissionId}/decision",
    ...overrides,
  });
}

describe("CONTRACT · MRQ-162 · refused record writes stay on the record", () => {
  test("a 4xx refusal becomes an action error without depending on object formatting or optional metadata", () => {
    const error = apiError();
    const failure = submissionWriteFailure(error, "assign-round");

    expect(failure.kind).toBe("refusal");
    if (failure.kind !== "refusal") throw new Error("expected a refusal action error");
    expect(failure.actionError.action).toBe("assign-round");
    expect(failure.actionError.message).toBe(errorSummary(error));
    expect(failure.actionError.kind).toBeUndefined();
  });

  test("optional missing-email metadata stays on the action error, while a 404 remains page-level", () => {
    const missingEmail = submissionWriteFailure(apiError({
      code: "unprocessable",
      message: "speaker has no valid email address",
      status: 422,
    }), "approve");
    const missingRecord = submissionWriteFailure(apiError({
      code: "not_found",
      message: "submission not found",
      status: 404,
    }), "approve");

    expect(missingEmail.kind).toBe("refusal");
    if (missingEmail.kind !== "refusal") throw new Error("expected a refusal action error");
    expect(missingEmail.actionError.kind).toBe("missing-decision-email");
    expect(missingEmail.actionError.action).toBe("approve");

    expect(missingRecord).toEqual({
      kind: "page",
      state: { kind: "error", message: errorSummary(apiError({ code: "not_found", message: "submission not found", status: 404 })), notFound: true },
    });
  });
});

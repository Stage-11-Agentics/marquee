import { describe, expect, test } from "vitest";

import {
  isSubmissionReferenceUniqueError,
  submissionReferenceSearchPatterns,
  submissionReferenceSearchSql,
  SUBMISSION_REFERENCE_CODE_SQL,
  withSubmissionReferenceRetry,
} from "../../src/lib/submission-reference";
import { assignSubmissionReferenceCodes } from "../../src/lib/reset-demo/seed-modules";
import type { SeedRow } from "../../scripts/seed/_sql";

describe("MRQ-241 submission reference allocation", () => {
  test("AC-348 · backfill ordering is deterministic and idempotent", () => {
    const makeRows = (): SeedRow[] => [
      { table: "submissions", row: { id: "z", event_id: "event-a", created_at: 20, reference_code: null } },
      { table: "submissions", row: { id: "b", event_id: "event-a", created_at: 10, reference_code: null } },
      { table: "submissions", row: { id: "a", event_id: "event-a", created_at: 10, reference_code: null } },
      { table: "submissions", row: { id: "other", event_id: "event-b", created_at: 1, reference_code: null } },
    ];
    const first = makeRows();
    const second = makeRows();
    assignSubmissionReferenceCodes(first);
    assignSubmissionReferenceCodes(second);
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.row.reference_code)).toEqual(["SUB-3", "SUB-2", "SUB-1", "SUB-1"]);
    assignSubmissionReferenceCodes(first);
    expect(first.map((entry) => entry.row.reference_code)).toEqual(["SUB-3", "SUB-2", "SUB-1", "SUB-1"]);
  });

  test("AC-347 · the allocator SQL is event-scoped and the retry is exactly once", async () => {
    expect(SUBMISSION_REFERENCE_CODE_SQL).toContain("MAX(CAST(substr(reference_code, 5) AS INTEGER))");
    expect(SUBMISSION_REFERENCE_CODE_SQL).toContain("WHERE event_id = ?");
    expect(isSubmissionReferenceUniqueError("UNIQUE constraint failed: submissions.event_id, submissions.reference_code")).toBe(true);
    expect(isSubmissionReferenceUniqueError("UNIQUE constraint failed: people.email")).toBe(false);

    let attempts = 0;
    await expect(withSubmissionReferenceRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("UNIQUE constraint failed: submissions.event_id, submissions.reference_code");
      return "created";
    })).resolves.toBe("created");
    expect(attempts).toBe(2);

    attempts = 0;
    await expect(withSubmissionReferenceRetry(async () => {
      attempts += 1;
      throw new Error("UNIQUE constraint failed: people.email");
    })).rejects.toThrow("people.email");
    expect(attempts).toBe(1);
  });

  test("AC-344 · list and board search patterns normalize the human code", () => {
    expect(submissionReferenceSearchPatterns("SUB 41")).toEqual(["%sub 41%", "%sub41%"]);
    expect(submissionReferenceSearchSql()).toContain("reference_code");
  });
});

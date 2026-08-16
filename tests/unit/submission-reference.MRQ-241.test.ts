import { describe, expect, test } from "vitest";

import {
  isSubmissionReferenceUniqueError,
  submissionReferenceSearchPatterns,
  submissionReferenceSearchSql,
  withSubmissionReferenceRetry,
} from "../../src/lib/submission-reference";
import { assignSubmissionReferenceCodes, submissionReferenceHighWater } from "../../src/lib/reset-demo/seed-modules";
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

  test("AC-347 · the durable seed floor and retry seam are event-scoped", async () => {
    const rows: SeedRow[] = [
      { table: "submissions", row: { id: "one", event_id: "event-a", reference_code: "SUB-41" } },
      { table: "submissions", row: { id: "two", event_id: "event-b", reference_code: "SUB-7" } },
    ];
    expect([...submissionReferenceHighWater(rows).entries()]).toEqual([["event-a", 41], ["event-b", 7]]);
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

  test("AC-344 · punctuation-only search never emits a match-everything pattern", () => {
    expect(submissionReferenceSearchPatterns("!")).toEqual(["%!%", "%!%"]);
  });
});

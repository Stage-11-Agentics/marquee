/**
 * The distribution decision, tested where it lives.
 *
 * MRQ-169 moved "who reviews what" out of a round-robin buried in a route and
 * into a pure function, precisely so the rules an organizer depends on —
 * balance, idempotence, scope, the cap, and honest partial coverage — can be
 * pinned without a Worker isolate or a fixture conference.
 */
import { describe, expect, test } from "vitest";

import { allocateAssignments, type AllocationInput } from "../../src/lib/assignment-allocation";

function submissions(count: number, trackNames: string[] = ["Agents"]): AllocationInput["submissions"] {
  return Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, trackNames }));
}

function everyoneEligible(ids: readonly string[], reviewers: readonly string[]): Map<string, string[]> {
  return new Map(ids.map((id) => [id, [...reviewers]]));
}

function plan(overrides: Partial<AllocationInput> = {}): AllocationInput {
  const targets = overrides.submissions ?? submissions(3);
  return {
    submissions: targets,
    eligible: everyoneEligible(targets.map((target) => target.id), ["r-ada", "r-bo", "r-cy"]),
    existing: new Map(),
    load: new Map([["r-ada", 0], ["r-bo", 0], ["r-cy", 0]]),
    reviewersPerSubmission: 2,
    maxPerReviewer: null,
    ...overrides,
  };
}

describe("MRQ-169 assignment allocation", () => {
  test("CONTRACT · N-per-submission spreads the work evenly and deterministically", () => {
    const first = allocateAssignments(plan({ submissions: submissions(6) }));
    const second = allocateAssignments(plan({ submissions: submissions(6) }));
    expect(first.pairs).toEqual(second.pairs);
    expect(first.assigned_new).toBe(12);
    expect([...first.per_reviewer.values()].sort()).toEqual([4, 4, 4]);
    expect(first.fully_covered).toBe(6);
    expect(first.uncovered).toBe(0);
  });

  test("CONTRACT · every eligible reviewer takes the submission in `everyone` mode", () => {
    const report = allocateAssignments(plan({ submissions: submissions(2), reviewersPerSubmission: null }));
    expect(report.assigned_new).toBe(6);
    expect(report.fully_covered).toBe(2);
    expect(new Set(report.pairs.map(([, reviewer]) => reviewer))).toEqual(new Set(["r-ada", "r-bo", "r-cy"]));
  });

  test("CONTRACT · a re-run tops coverage up instead of doubling it", () => {
    const targets = submissions(2);
    const report = allocateAssignments(plan({
      submissions: targets,
      existing: new Map([["s1", new Set(["r-ada", "r-bo"])], ["s2", new Set(["r-ada"])]]),
      load: new Map([["r-ada", 2], ["r-bo", 1], ["r-cy", 0]]),
    }));
    expect(report.already_assigned).toBe(3);
    // s1 already has its two; s2 needs one more, and it goes to the reviewer
    // carrying the least work rather than to the next name in a rotation.
    expect(report.pairs).toEqual([["s2", "r-cy"]]);
    expect(report.fully_covered).toBe(2);
  });

  test("CONTRACT · an abstract no reviewer is responsible for is reported, never refused", () => {
    const targets = [
      { id: "s1", trackNames: ["Agents"] },
      { id: "s2", trackNames: ["Leadership"] },
    ];
    const report = allocateAssignments(plan({
      submissions: targets,
      eligible: new Map([["s1", ["r-ada", "r-bo", "r-cy"]], ["s2", []]]),
      reviewersPerSubmission: 2,
    }));
    expect(report.assigned_new).toBe(2);
    expect(report.uncovered).toBe(1);
    expect(report.uncovered_tracks).toEqual(["Leadership"]);
    expect(report.fully_covered).toBe(1);
    expect(report.pairs.every(([submissionId]) => submissionId === "s1")).toBe(true);
  });

  test("CONTRACT · a pool too small for the target reports partial coverage", () => {
    const report = allocateAssignments(plan({
      submissions: submissions(2),
      eligible: everyoneEligible(["s1", "s2"], ["r-ada"]),
      load: new Map([["r-ada", 0]]),
      reviewersPerSubmission: 3,
    }));
    expect(report.assigned_new).toBe(2);
    expect(report.partially_covered).toBe(2);
    expect(report.fully_covered).toBe(0);
    expect(report.uncovered).toBe(0);
  });

  test("CONTRACT · the per-reviewer cap binds, and says that it bound", () => {
    const report = allocateAssignments(plan({
      submissions: submissions(4),
      reviewersPerSubmission: 2,
      maxPerReviewer: 2,
    }));
    expect(report.cap_reached).toBe(true);
    expect([...report.per_reviewer.values()].every((count) => count <= 2)).toBe(true);
    expect(report.assigned_new).toBe(6);
    expect(report.partially_covered + report.uncovered).toBeGreaterThan(0);
  });

  test("CONTRACT · an untouched cap is not reported as one", () => {
    const report = allocateAssignments(plan({ submissions: submissions(2), maxPerReviewer: 50 }));
    expect(report.cap_reached).toBe(false);
    expect(report.assigned_new).toBe(4);
  });

  test("CONTRACT · existing load carries into the balance rather than starting from zero", () => {
    const report = allocateAssignments(plan({
      submissions: submissions(1),
      reviewersPerSubmission: 1,
      load: new Map([["r-ada", 9], ["r-bo", 3], ["r-cy", 12]]),
    }));
    expect(report.pairs).toEqual([["s1", "r-bo"]]);
  });
});

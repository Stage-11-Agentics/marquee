/**
 * Who reviews what, decided once.
 *
 * An assignment is a (round, submission, reviewer) row and nothing else, so
 * distribution is the step that turns a reviewer pool into those rows. The
 * decision is pure: the caller reads eligibility, existing rows, and current
 * load out of D1, and this function says which new pairs to write and what to
 * report about the ones it could not.
 *
 * Two rules carry the design:
 *
 *   - **Eligibility is a fact, not an error.** A submission whose tracks no
 *     pool member is responsible for cannot be covered, and refusing the whole
 *     distribution over it leaves an organizer with nothing written and no
 *     idea which abstract was at fault. Partial coverage is reported.
 *   - **Load is balanced, deterministically.** Reviewers are chosen by lowest
 *     current load with the reviewer id as tiebreak, so the same inputs always
 *     produce the same plan — a re-run tops up rather than reshuffles.
 */

export interface AllocationSubmission {
  id: string;
  /** Track names as the organizer reads them, for the uncovered report. */
  trackNames: readonly string[];
}

export interface AllocationInput {
  /** The round's target set, in the order the caller wants it covered. */
  submissions: readonly AllocationSubmission[];
  /** submission id → reviewer ids whose responsibilities intersect its tracks. */
  eligible: ReadonlyMap<string, readonly string[]>;
  /** submission id → reviewers already holding a row in this round. */
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  /** reviewer id → rows they already hold in this round (the load to balance). */
  load: ReadonlyMap<string, number>;
  /** How many reviewers each submission wants; null means every eligible one. */
  reviewersPerSubmission: number | null;
  /** An optional ceiling on what any one reviewer may end up holding. */
  maxPerReviewer: number | null;
}

export interface AllocationReport {
  /** The new rows to write, as [submissionId, reviewerId]. */
  pairs: Array<[string, string]>;
  assigned_new: number;
  already_assigned: number;
  submissions_total: number;
  fully_covered: number;
  partially_covered: number;
  uncovered: number;
  /** Track names carried by submissions nobody in the pool can review. */
  uncovered_tracks: string[];
  /** True when a per-reviewer ceiling — not eligibility — held coverage back. */
  cap_reached: boolean;
  /** reviewer id → rows they hold after this run, for the per-reviewer line. */
  per_reviewer: Map<string, number>;
}

/**
 * Plan one distribution. Nothing here touches the database, which is what
 * makes the balance rule testable without a Worker isolate.
 */
export function allocateAssignments(input: AllocationInput): AllocationReport {
  const load = new Map<string, number>(input.load);
  const pairs: Array<[string, string]> = [];
  const uncoveredTracks = new Set<string>();
  let alreadyAssigned = 0;
  let fullyCovered = 0;
  let partiallyCovered = 0;
  let uncovered = 0;
  let capReached = false;

  for (const submission of input.submissions) {
    const eligible = input.eligible.get(submission.id) ?? [];
    const held = input.existing.get(submission.id) ?? new Set<string>();
    alreadyAssigned += held.size;

    const target = input.reviewersPerSubmission === null
      ? eligible.length
      : Math.min(input.reviewersPerSubmission, eligible.length);
    // Rows already on this submission count toward its target: re-running a
    // distribution tops the submission up rather than doubling it.
    const wanted = Math.max(0, target - held.size);

    const candidates = eligible
      .filter((reviewerId) => !held.has(reviewerId))
      .filter((reviewerId) => {
        if (input.maxPerReviewer === null) return true;
        const atCap = (load.get(reviewerId) ?? 0) >= input.maxPerReviewer;
        if (atCap) capReached = true;
        return !atCap;
      })
      .sort((left, right) => {
        const difference = (load.get(left) ?? 0) - (load.get(right) ?? 0);
        return difference !== 0 ? difference : left < right ? -1 : left > right ? 1 : 0;
      });

    const chosen = candidates.slice(0, wanted);
    for (const reviewerId of chosen) {
      pairs.push([submission.id, reviewerId]);
      load.set(reviewerId, (load.get(reviewerId) ?? 0) + 1);
    }

    // Coverage is measured against what the round asked for, not against what
    // the pool could manage — an abstract two reviewers short is not "done".
    const covered = held.size + chosen.length;
    const asked = input.reviewersPerSubmission ?? eligible.length;
    if (covered === 0) {
      uncovered += 1;
      for (const trackName of submission.trackNames) uncoveredTracks.add(trackName);
    } else if (covered >= asked) {
      fullyCovered += 1;
    } else {
      partiallyCovered += 1;
    }
  }

  return {
    pairs,
    assigned_new: pairs.length,
    already_assigned: alreadyAssigned,
    submissions_total: input.submissions.length,
    fully_covered: fullyCovered,
    partially_covered: partiallyCovered,
    uncovered,
    uncovered_tracks: [...uncoveredTracks].sort(),
    cap_reached: capReached,
    per_reviewer: load,
  };
}

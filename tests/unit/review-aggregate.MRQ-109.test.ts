import { describe, expect, test } from "vitest";

import { orderClause } from "../../src/api/pagination";
import { reviewCountLabel, scoreBasisCell, scoreBasisLabel } from "../../src/lib/review-aggregate";
import { SUBMISSION_SORTS } from "../../src/routes/submissions.queries";

describe("MRQ-109 · the results table's ordering and its honesty about the number", () => {
  test("ABS-10 · the score sort exists in both directions", () => {
    expect(SUBMISSION_SORTS.score.direction).toBe("desc");
    expect(SUBMISSION_SORTS.score_asc.direction).toBe("asc");
    expect(SUBMISSION_SORTS.score_asc.column).toBe(SUBMISSION_SORTS.score.column);
  });

  test("ABS-10 · unscored submissions sort last in BOTH directions", () => {
    // SQLite puts NULLs first ascending. Left alone, "lowest score first"
    // buries every reviewed submission under the unreviewed ones.
    expect(orderClause(SUBMISSION_SORTS.score_asc)).toBe("score IS NULL ASC, score ASC, id ASC");
    expect(orderClause(SUBMISSION_SORTS.score)).toBe("score IS NULL ASC, score DESC, id ASC");
  });

  test("a sort without the flag keeps the plain clause", () => {
    expect(orderClause({ column: "s.updated_at", direction: "desc" })).toBe("s.updated_at DESC, id ASC");
  });

  test("ABS-04 · a score never appears without the reviewer count behind it", () => {
    expect(reviewCountLabel(0)).toBe("No reviews");
    expect(reviewCountLabel(1)).toBe("1 review");
    expect(reviewCountLabel(4)).toBe("4 reviews");
  });

  test("a fallback score is labelled unweighted rather than silently relabelled", () => {
    expect(scoreBasisLabel(4.2, true)).toContain("Weighted");
    expect(scoreBasisLabel(4.2, false)).toContain("Unweighted");
    expect(scoreBasisLabel(null, false)).toBe("Not scored yet");
    expect(scoreBasisCell(4.2, true)).toBe("Weighted");
    expect(scoreBasisCell(4.2, false)).toBe("Unweighted");
    expect(scoreBasisCell(null, true)).toBe("");
  });
});

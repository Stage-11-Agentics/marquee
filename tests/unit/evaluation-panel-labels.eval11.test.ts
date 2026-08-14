import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  EvaluationPanelResult,
  type EvaluationPanelEvaluation,
} from "../../src/ui/submissions/SubmissionRecordPage";
import reviewerPageSource from "../../src/ui/review/ReviewerPage.tsx?raw";

// `?raw` resolves to an empty string for CSS under this pool, which would let a
// stylesheet assertion pass against no stylesheet at all.
const recordStyles = readFileSync(new URL("../../src/ui/submissions/record.css", import.meta.url), "utf8");

/**
 * Operator ruling, 2026-08-14: humans decide acceptance. The scorecard is
 * information for the human judge, never a verdict; no field governs anything,
 * and the decision is the organizer's own Accept/Reject action on the record.
 *
 * Two labelling untruths on the organizer's Evaluation panel followed from
 * pretending otherwise:
 *
 * 1. `evaluations.comment` was headed "Reviewer comment". It is not the
 *    reviewer's review — the reviewer's own control calls it "Committee note
 *    (optional)", and their reasoning about the abstract is whatever they typed
 *    against the rubric's text criterion, rendered separately beneath it.
 * 2. `evaluations.recommendation` printed bare beside the rating, reading as THE
 *    recommendation, when it is one reviewer input among several and can
 *    legitimately disagree with a Recommendation criterion on the scorecard.
 *    That disagreement is exactly what sbek round 11 caught.
 */

const CRITERIA = [
  { id: "crit_fit", name: "Program fit", kind: "numeric" as const, weight_pct: 60, position: 1 },
  { id: "crit_recommendation", name: "Recommendation", kind: "select" as const, weight_pct: 0, position: 2 },
  { id: "crit_comments", name: "Comments", kind: "text" as const, weight_pct: 0, position: 3 },
];

const SCORECARD_REASONING = "The CI walkthrough is concrete and the numbers are the speaker's own; this belongs on the Platform track.";
const COMMITTEE_NOTE = "Heads up for the committee: this speaker also submitted to the workshop track.";

const review = (overrides: Partial<EvaluationPanelEvaluation> = {}): EvaluationPanelEvaluation => ({
  abstained: false,
  id: "evaluation_eval11_labels",
  reviewer_name: "Sam Whitfield",
  reviewer_kind: "human",
  // Deliberately disagreeing with the scorecard's Recommendation criterion:
  // the state the panel used to present one-sidedly.
  recommendation: "Maybe",
  score: 4,
  comment: COMMITTEE_NOTE,
  criteria_scores: { crit_fit: 4, crit_recommendation: "Accept", crit_comments: SCORECARD_REASONING },
  override_score: null,
  override_comment: null,
  override_person_name: null,
  ...overrides,
});

function render(evaluation: EvaluationPanelEvaluation = review()): string {
  return renderToString(h(EvaluationPanelResult, { evaluation, criteria: CRITERIA }));
}

describe("evaluation panel labelling", () => {
  test("CONTRACT · the free-text box is headed what the reviewer was actually asked for", () => {
    // The reviewer's own control is the authority on what that field is.
    expect(reviewerPageSource).toContain("Committee note (optional)");

    const html = render();
    expect(html).toContain("Committee note");
    expect(html).not.toContain("Reviewer comment");
    expect(html).toContain(COMMITTEE_NOTE);
    // The reviewer's actual reasoning is still the scorecard's own text answer.
    expect(html).toContain(SCORECARD_REASONING);
  });

  test("CONTRACT · the disclosure names the note it opens", () => {
    const html = render(review({ comment: `${COMMITTEE_NOTE} ${COMMITTEE_NOTE}` }));
    expect(html).toContain("Read full note");
    expect(html).not.toContain("Read full comment");
  });

  test("CONTRACT · the reviewer's recommendation is presented as their input, not as the verdict", () => {
    const html = render();
    // No longer glued to the score as though the two were one reading.
    expect(html).not.toContain("4.00 · Maybe");
    expect(html).toContain("Reviewer's own recommendation");
    expect(html).toContain("data-evaluation-panel-recommendation");
    expect(html).toContain("Maybe");
    // Both inputs stand, disagreeing, with neither resolved into the other.
    expect(html).toContain("Recommendation");
    expect(html).toContain("Accept");
  });

  test("CONTRACT · a reviewer who recorded no recommendation is reported as such, in the same row", () => {
    // Constant row count: the label never disappears, so nothing below moves.
    const none = render(review({ recommendation: null }));
    expect(none).toContain("Reviewer's own recommendation");
    expect(none).toContain("None recorded");

    const recused = render(review({ abstained: true, recommendation: null, score: null, comment: "", criteria_scores: null }));
    expect(recused).toContain("Reviewer's own recommendation");
    expect(recused).toContain("Conflict declared");
    expect(recused).toContain("Reviewer recused; no recommendation recorded.");
  });

  test("CONTRACT · the new row is styled and height-reserved like the rating it sits under", () => {
    const rule = /\.evaluation-panel-rating[^{]*\.evaluation-panel-recommendation[^{]*\{[^}]*min-height: 20px[^}]*\}/;
    expect(recordStyles).toMatch(rule);
  });
});

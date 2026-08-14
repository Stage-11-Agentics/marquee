import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  EvaluationPanelResult,
  type EvaluationPanelEvaluation,
} from "../../src/ui/submissions/SubmissionRecordPage";
import reviewerPageSource from "../../src/ui/review/ReviewerPage.tsx?raw";
import sessionizeSource from "../../src/lib/sessionize-import.ts?raw";

// The agent evaluator's contract lives outside `src`, so it is read from disk.
const cliRegistrySource = readFileSync(new URL("../../cli/registry.mjs", import.meta.url), "utf8");

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
 *    reviewer's review of the abstract — that is whatever they typed against the
 *    rubric's text criterion, rendered separately beneath it. Nor can the
 *    heading name a single author: a human types it into a control called
 *    "Committee note (optional)", an agent evaluator is told to store its
 *    rationale there, and a Sessionize import maps "Reviewer Comment" into the
 *    same column. What is true of all three is that it did not come from the
 *    rubric, and that is what the heading now says.
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
  reviewer_person_id: "person_sam_whitfield",
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
  test("CONTRACT · the note is headed for the field it is, not for one of its three writers", () => {
    // `evaluations.comment` has more than one writer, and a label naming any one
    // of them is false for the other two.
    expect(reviewerPageSource).toContain("Committee note (optional)");        // human
    expect(cliRegistrySource).toContain("Required rationale shown to the chair verbatim."); // agent
    expect(sessionizeSource).toContain('reviewer_comment: ["reviewer comment"'); // import

    const human = render();
    expect(human).toContain("Note beside the scorecard");
    expect(human).not.toContain("Reviewer comment");
    expect(human).toContain(COMMITTEE_NOTE);
    // The reviewer's actual reasoning is still the scorecard's own text answer.
    expect(human).toContain(SCORECARD_REASONING);

    // An agent evaluator was told to store its rationale in this same column;
    // the heading has to stay true for it.
    const agent = render(review({
      reviewer_kind: "agent", reviewer_name: "Triage agent",
      comment: "Agent rationale: the CI numbers are the speaker's own.",
    }));
    expect(agent).toContain("Note beside the scorecard");
    expect(agent).not.toContain("Committee note");
    expect(agent).toContain("Agent rationale: the CI numbers are the speaker's own.");

    // A Sessionize import maps "Reviewer Comment" into it. Same heading, still true.
    const imported = render(review({ comment: "Imported reviewer comment from the previous system." }));
    expect(imported).toContain("Note beside the scorecard");
    expect(imported).not.toContain("Committee note");
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

  test("CONTRACT · the recommendation row survives an organizer override, and stays the reviewer's", () => {
    // An override is the chair's own number. It must not swallow, replace, or
    // silence what the reviewer recorded — the panel shows both, separately.
    const html = render(review({
      override_score: 2,
      override_comment: "Chair moved this to the backup track.",
      override_person_name: "Avery Chair",
    }));
    expect(html).toContain("Reviewer rating");
    expect(html).toContain("4.00");
    expect(html).toContain("Reviewer's own recommendation");
    expect(html).toContain("Maybe");
    expect(html).toContain('data-evaluation-panel-override="true"');
    expect(html).toContain("Organizer override");
    expect(html).toContain("2.00");
    expect(html).toContain("Chair moved this to the backup track.");
  });

  test("CONTRACT · the new row is styled and height-reserved like the rating it sits under", () => {
    const rule = /\.evaluation-panel-rating[^{]*\.evaluation-panel-recommendation[^{]*\{[^}]*min-height: 20px[^}]*\}/;
    expect(recordStyles).toMatch(rule);
  });
});

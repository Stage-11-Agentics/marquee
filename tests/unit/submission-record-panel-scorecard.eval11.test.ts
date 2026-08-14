import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  EvaluationPanelResult,
  type EvaluationPanelEvaluation,
} from "../../src/ui/submissions/SubmissionRecordPage";
import submissionRecordSource from "../../src/ui/submissions/SubmissionRecordPage.tsx?raw";

// `?raw` resolves to an empty string for CSS under this pool, which would make
// the rail-bounding assertion below pass against no stylesheet at all.
const recordStyles = readFileSync(new URL("../../src/ui/submissions/record.css", import.meta.url), "utf8");

/**
 * A reviewer answers two different things in one sitting: the scorecard the
 * round defines, and the optional committee note beside it. Only the note ever
 * reached the Evaluation panel, so a chair deciding accept or reject read the
 * note under the heading "Reviewer comment" and never saw the reasoning the
 * reviewer typed against the rubric's own text criterion.
 *
 * These fixtures deliberately disagree with each other — a "Maybe" note against
 * an "Accept" scorecard — because that is the state the panel used to render
 * one-sidedly, and the disagreement is what makes the omission visible.
 */
const CRITERIA = [
  { id: "crit_fit", name: "Program fit", kind: "numeric" as const, weight_pct: 40, position: 1 },
  { id: "crit_value", name: "Audience value", kind: "numeric" as const, weight_pct: 35, position: 2 },
  { id: "crit_clarity", name: "Clarity", kind: "numeric" as const, weight_pct: 25, position: 3 },
  { id: "crit_recommendation", name: "Recommendation", kind: "select" as const, weight_pct: 0, position: 4 },
  { id: "crit_comments", name: "Comments", kind: "text" as const, weight_pct: 0, position: 5 },
];

const SCORECARD_COMMENT = "Strong practical content and a clear narrative arc; abstract could name the specific tooling used. Recommend accept for the Platform track.";
const COMMITTEE_NOTE = "Agent review: the 40-minute CI problem is concrete and the monorepo build-caching proposal is promising.";

const review = (overrides: Partial<EvaluationPanelEvaluation> = {}): EvaluationPanelEvaluation => ({
  abstained: false,
  id: "evaluation_eval11_1",
  reviewer_person_id: "person_triage_agent",
  reviewer_name: "Triage agent",
  reviewer_kind: "agent",
  recommendation: "maybe",
  score: 4,
  comment: COMMITTEE_NOTE,
  criteria_scores: {
    crit_fit: 4,
    crit_value: 4,
    crit_clarity: 4,
    crit_recommendation: "Accept",
    crit_comments: SCORECARD_COMMENT,
  },
  override_score: null,
  override_comment: null,
  override_person_name: null,
  ...overrides,
});

function render(evaluation: EvaluationPanelEvaluation): string {
  return renderToString(h(EvaluationPanelResult, { evaluation, criteria: CRITERIA }));
}

describe("evaluation panel surfaces the scorecard the reviewer actually filled in", () => {
  test("CONTRACT · evaluation panel — prints the reviewer's own scorecard reasoning, not only the committee note", () => {
    const html = render(review());

    expect(html).toContain(SCORECARD_COMMENT);
    expect(html).toContain("Comments");
  });

  test("CONTRACT · evaluation panel — shows the recommendation recorded on the scorecard beside the one stored on the review", () => {
    const html = render(review());

    // The stored review row still reads "maybe"; the scorecard says Accept.
    // The chair must be able to see both rather than only the first — each
    // attributed to where the reviewer put it, neither resolved into the other.
    expect(html).toContain("4.00");
    expect(html).toContain("Reviewer's own recommendation");
    expect(html).toContain("maybe");
    expect(html).toContain("Accept");
    expect(html).toContain("Recommendation");
  });

  test("CONTRACT · evaluation panel — carries the weighted criteria through so a rating is traceable to its parts", () => {
    const html = render(review());

    expect(html).toContain("Program fit");
    expect(html).toContain("Audience value");
    expect(html).toContain("Clarity");
  });

  test("CONTRACT · evaluation panel — omits criteria the reviewer left unanswered instead of rendering them empty", () => {
    const html = render(review({
      criteria_scores: { crit_fit: 4, crit_comments: SCORECARD_COMMENT },
    }));

    expect(html).toContain(SCORECARD_COMMENT);
    expect(html).toContain("Program fit");
    expect(html).not.toContain("Audience value");
  });

  test("CONTRACT · evaluation panel — stays silent when no scorecard was recorded rather than inventing an empty rubric", () => {
    const html = render(review({ criteria_scores: null }));

    expect(html).toContain(COMMITTEE_NOTE);
    expect(html).not.toContain("Program fit");
  });

  test("CONTRACT · evaluation panel — keeps a recusal free of scorecard content", () => {
    const html = render(review({ abstained: true, recommendation: null, score: null, comment: "" }));

    expect(html).toContain("Conflict declared");
    expect(html).not.toContain(SCORECARD_COMMENT);
  });

  /**
   * The same fault seen from the other side, filed separately by the same round
   * against abstract-management: a review whose optional overall score and
   * committee note are both blank, but whose scorecard the reviewer did fill
   * in, rendered as "REVIEWER RATING — · approve / REVIEWER COMMENT —". Two
   * dashes read as a review nobody wrote, and the organizer's list view was
   * meanwhile aggregating those very criteria into a weighted 3.34.
   */
  test("CONTRACT · evaluation panel — a blank overall score and note do not present a filled scorecard as empty", () => {
    const html = render(review({
      score: null,
      comment: "",
      criteria_scores: { crit_fit: 4, crit_value: 2, crit_recommendation: "Accept", crit_comments: SCORECARD_COMMENT },
    }));

    expect(html).toContain(SCORECARD_COMMENT);
    expect(html).toContain("Program fit");
    expect(html).toContain("Audience value");
    expect(html).toContain("Accept");
  });

  /**
   * Every case above supplies `criteria` by hand, and the prop defaults to an
   * empty list — so all of them stay green if the panel's own call site quietly
   * stops passing the round's rubric, which is the exact wiring this change is.
   * The call site is therefore asserted directly rather than inferred.
   */
  test("CONTRACT · evaluation panel — passes the round's own rubric at the panel call site", () => {
    const panel = submissionRecordSource.slice(submissionRecordSource.indexOf('title="Evaluation panel"'));

    expect(panel).toContain("<EvaluationPanelResult key=");
    expect(panel).toMatch(/<EvaluationPanelResult[^>]*criteria=\{criteriaByRound\.get\(round\.id\)/);
  });

  /**
   * The rail is 330px. A text criterion accepts as much prose as the reviewer
   * types, so an unbounded block here either widens the column or pushes the
   * assignment controls down it — the failure the reviewer of this change
   * caught by reading the CSS.
   */
  test("CONTRACT · evaluation panel — bounds and wraps the scorecard inside the narrow rail", () => {
    expect(recordStyles).toMatch(/\.record-round-result \.evaluation-scorecard \{[^}]*max-height:[^}]*overflow-y: auto/);
    expect(recordStyles).toMatch(/\.record-round-result \.evaluation-criterion-scores \{[^}]*overflow-wrap: anywhere/);
  });
});

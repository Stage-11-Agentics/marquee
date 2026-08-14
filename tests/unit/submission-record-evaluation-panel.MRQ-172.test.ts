import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  EvaluationPanelResult,
  type EvaluationPanelEvaluation,
} from "../../src/ui/submissions/SubmissionRecordPage";
import submissionRecordSource from "../../src/ui/submissions/SubmissionRecordPage.tsx?raw";

const review = (overrides: Partial<EvaluationPanelEvaluation> = {}): EvaluationPanelEvaluation => ({
  abstained: false,
  id: "evaluation_mrq172_1",
  reviewer_name: "Sam Whitfield",
  reviewer_kind: "human",
  recommendation: "Approve",
  score: 4,
  comment: "Strong practical content and a clear narrative arc; abstract could name the specific tooling used. Recommend accept for the Platform track.",
  // No scorecard recorded, so the panel has nothing to add under the note and
  // every assertion below reads exactly what it read before.
  criteria_scores: null,
  override_score: null,
  override_comment: null,
  override_person_name: null,
  ...overrides,
});

function render(evaluation: EvaluationPanelEvaluation): string {
  return renderToString(h(EvaluationPanelResult, { evaluation }));
}

describe("CONTRACT · MRQ-172 · organizer evaluation panel evidence", () => {
  test("CONTRACT · MRQ-172 — mounts result rows inside the evaluation panel instead of leaving only counts", () => {
    const panel = submissionRecordSource.slice(submissionRecordSource.indexOf('title="Evaluation panel"'));

    expect(panel).toContain('class="record-round-results"');
    expect(panel).toContain("<EvaluationPanelResult key=");
  });

  test("CONTRACT · MRQ-172 — keeps the reviewer's rating and words together where the organizer looks for the review", () => {
    const html = render(review());

    expect(html).toContain('data-evaluation-panel-result="evaluation_mrq172_1"');
    expect(html).toContain("Sam Whitfield");
    expect(html).toContain("4.00");
    expect(html).toContain("Approve");
    expect(html).toContain("Note beside the scorecard");
    expect(html).toContain("Strong practical content and a clear narrative arc");
    expect(html).toContain("Read full note");
  });

  test("CONTRACT · MRQ-172 — labels an organizer override separately from the reviewer's own judgment", () => {
    const html = render(review({ override_score: 2, override_comment: "Chair moved this to the backup track.", override_person_name: "Avery Chair" }));

    expect(html).toContain("Reviewer rating");
    expect(html).toContain("4.00");
    // The reviewer's own recommendation survives the override rather than being
    // swallowed by the chair's number.
    expect(html).toContain("Reviewer's own recommendation");
    expect(html).toContain("Approve");
    expect(html).toContain("Strong practical content and a clear narrative arc");
    expect(html).toContain('data-evaluation-panel-override="true"');
    expect(html).toContain("Organizer override");
    expect(html).toContain("2.00");
    expect(html).toContain("Chair moved this to the backup track.");
  });

  test("CONTRACT · MRQ-172 — keeps a recusal honest instead of manufacturing a rating or comment", () => {
    const html = render(review({ abstained: true, recommendation: null, score: null, comment: "" }));

    expect(html).toContain("Conflict declared");
    expect(html).toContain("Reviewer recused; no recommendation recorded.");
    expect(html).not.toContain("Read full note");
  });
});

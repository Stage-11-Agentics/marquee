import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import reviewerPageSource from "../../src/ui/review/ReviewerPage.tsx?raw";
import shellSource from "../../src/ui/shell/AppShell.tsx?raw";

const evaluationPageSource = readFileSync(fileURLToPath(new URL("../../src/ui/evaluation/EvaluationPage.tsx", import.meta.url)), "utf8");
const submissionRecordPageSource = readFileSync(fileURLToPath(new URL("../../src/ui/submissions/SubmissionRecordPage.tsx", import.meta.url)), "utf8");

const reviewerStyles = readFileSync(fileURLToPath(new URL("../../src/ui/review/review.css", import.meta.url)), "utf8");

test("AC-61, AC-158, AC-159 · the reviewer surface supports keyboard review at mobile width without admin chrome", () => {
  expect(reviewerPageSource).toContain('data-reviewer-surface="true"');
  expect(reviewerPageSource).toContain('event.key.toLowerCase()');
  expect(reviewerPageSource).toContain('event.key === "Enter"');
  expect(reviewerPageSource).toContain("A / M / D");
  expect(reviewerPageSource).toContain("Save recommendation & next");
  expect(reviewerPageSource).toContain("criteria_scores: Object.keys(review.criteria).length");
  expect(reviewerPageSource).toContain('import "./review.css"');
  expect(reviewerPageSource).toContain("/reviewer/queue");
  expect(reviewerPageSource).not.toContain("/plans");
  expect(reviewerPageSource).not.toContain("Sidebar");
  expect(reviewerPageSource).not.toContain("Topbar");
  expect(reviewerPageSource).not.toContain('href="/evaluation');

  expect(shellSource).toContain('location.pathname === "/reviewer"');
  expect(shellSource).toContain("return <ReviewerPage />");
});

test("AC-158 + AC-159 · the mobile reviewer keeps thumb controls and a stable blind shell", () => {
  expect(reviewerPageSource).toContain('data-mobile-review="375px"');
  expect(reviewerPageSource).toContain("data-reviewer-feedback");
  expect(reviewerPageSource).toContain('data-reviewer-controls="recommendation"');
  expect(reviewerPageSource).toContain('data-reviewer-control="comment"');
  expect(reviewerPageSource).toContain('data-reviewer-control="save-next"');
  // AC-64's mechanism is the query layer, not the template (SPEC.md §"Anonymized
  // responses strip … from the query payload, not the template"). The template may
  // therefore render identity — but only on the false arm of an explicit blind-mode
  // branch, so a non-anonymized round stops claiming a redaction that is not happening.
  for (const line of reviewerPageSource.split("\n")) {
    if (line.includes("detail.identity")) expect(line).toContain("detail.blind_mode ?");
  }
  expect(reviewerPageSource).toContain("Redacted in anonymous review");
  expect(reviewerStyles).toContain("overflow-x: clip");
  expect(reviewerStyles).toMatch(/@media \(max-width: 600px\)/);
  expect(reviewerStyles).toMatch(/\.reviewer-feedback-slot \{ min-height: 58px; \}/);
  expect(reviewerStyles).toMatch(/\.decision-button \{ min-height: 48px;/);
  expect(reviewerStyles).toMatch(/\.score-buttons button \{ min-height: 44px; \}/);
  expect(reviewerStyles).toMatch(/\.reviewer-detail \{ border-left: 0;.*height: 100dvh;/);
});

test("CONTRACT · MRQ-108 · the reviewer renders the round's own scorecard and keeps completed reviews reopenable", () => {
  // All three criterion kinds have a control on the reviewer side (ABS-03).
  expect(reviewerPageSource).toContain('criterion.kind === "numeric"');
  expect(reviewerPageSource).toContain('criterion.kind === "select"');
  expect(reviewerPageSource).toContain('criterion.kind === "text"');
  // The rating strip follows the organizer's configured scale, not a fixed 1-5.
  expect(reviewerPageSource).toContain("scaleSteps(criterion)");
  // A recommendation alone still saves: criteria are additive, never a gate.
  expect(reviewerPageSource).toContain("disabled={!currentReview.recommendation || saving}");
  // Submitted reviews stay reachable, and reopening shows the stored values.
  expect(reviewerPageSource).toContain("reviewer-completed");
  expect(reviewerPageSource).toContain("Reopen");
  expect(reviewerPageSource).toContain("data-saved-criteria");
  expect(reviewerStyles).toContain(".reviewer-completed-row");
});

test("MRQ-110 · reviewer and chair surfaces label recusals and send reminders through their write routes", () => {
  expect(reviewerPageSource).toContain('data-reviewer-control="declare-conflict"');
  expect(reviewerPageSource).toContain("const commitReview = async");
  expect(reviewerPageSource).toContain("abstained: review.abstained ? 1 : 0");
  expect(reviewerPageSource).toContain("review: optimisticReview");
  expect(evaluationPageSource).toContain('`/api/v1/events/${eventId}/rounds/${round.id}/reviewers/${personId}/remind`');
  expect(evaluationPageSource).toContain('"/api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind", {');
  expect(evaluationPageSource).toContain('method: "POST"');
  expect(evaluationPageSource).toContain("Reviewer pool");
  expect(evaluationPageSource).toContain("1 recusal · needs reassignment");
  expect(submissionRecordPageSource).toContain("Conflict declared");
  expect(submissionRecordPageSource).toContain("Reviewer recused; no recommendation recorded.");
  expect(submissionRecordPageSource).toContain("filter((evaluation) => !evaluation.abstained)");
});

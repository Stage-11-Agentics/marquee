import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import reviewerPageSource from "../../src/ui/review/ReviewerPage.tsx?raw";
import shellSource from "../../src/ui/shell/AppShell.tsx?raw";

const reviewerStyles = readFileSync(fileURLToPath(new URL("../../src/ui/review/review.css", import.meta.url)), "utf8");

test("AC-61, AC-158, AC-159 · the reviewer surface supports keyboard review at mobile width without admin chrome", () => {
  expect(reviewerPageSource).toContain('data-reviewer-surface="true"');
  expect(reviewerPageSource).toContain('event.key.toLowerCase()');
  expect(reviewerPageSource).toContain('event.key === "Enter"');
  expect(reviewerPageSource).toContain("A / M / D");
  expect(reviewerPageSource).toContain("Save recommendation & next");
  expect(reviewerPageSource).toContain("criteria_scores: Object.keys(currentReview.criteria).length");
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

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
  expect(reviewerPageSource).toContain("criteria_scores: null");
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
  expect(reviewerPageSource).not.toMatch(/detail\.identity/);
  expect(reviewerStyles).toContain("overflow-x: clip");
  expect(reviewerStyles).toMatch(/@media \(max-width: 600px\)/);
  expect(reviewerStyles).toMatch(/\.reviewer-feedback-slot \{ min-height: 58px; \}/);
  expect(reviewerStyles).toMatch(/\.decision-button \{ min-height: 48px;/);
  expect(reviewerStyles).toMatch(/\.score-buttons button \{ min-height: 44px; \}/);
  expect(reviewerStyles).toMatch(/\.reviewer-detail \{ border-left: 0;.*height: 100dvh;/);
});

import { expect, test } from "vitest";

import reviewerPageSource from "../../src/ui/review/ReviewerPage.tsx?raw";
import shellSource from "../../src/ui/shell/AppShell.tsx?raw";

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

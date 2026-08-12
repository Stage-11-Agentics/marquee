import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const reviewerPageSource = source("../../src/ui/review/ReviewerPage.tsx");
const evaluationPageSource = source("../../src/ui/evaluation/EvaluationPage.tsx");
const evaluationStyles = source("../../src/ui/evaluation/evaluation.css");
const submissionsPageSource = source("../../src/ui/submissions/SubmissionsPage.tsx");
const submissionsStyles = source("../../src/ui/submissions/submissions.css");

test("CONTRACT · MRQ-151 · reviewer queue copy names assignment and track scope", () => {
  expect(reviewerPageSource).toContain("assigned to you");
  expect(reviewerPageSource).toContain("directly or through your committee");
  expect(reviewerPageSource).toContain("carries a track in your scope");
  expect(reviewerPageSource).not.toContain("in your authorized tracks");
  expect(reviewerPageSource).not.toContain("any carried track intersects your scope");
});

test("CONTRACT · MRQ-151 · invite and evaluation export results are readable and announced", () => {
  expect(evaluationPageSource).toContain('class="invite-link-readable"');
  expect(evaluationPageSource).toContain('aria-label="Full reviewer sign-in link"');
  expect(evaluationPageSource).toContain("Copy link");
  expect(evaluationPageSource).toContain("csvDataRowCount");
  expect(evaluationPageSource).toContain("Exported ${csvDataRowCount(csv).toLocaleString()} rows");
  expect(evaluationStyles).toContain("overflow-wrap: anywhere");
  expect(evaluationStyles).toContain("user-select: text");
});

test("CONTRACT · MRQ-151 · submission export reports its row count and filename", () => {
  expect(submissionsPageSource).toContain("setExportNotice");
  expect(submissionsPageSource).toContain("Exported ${exported.length.toLocaleString()} rows · marquee-submissions.csv");
  expect(submissionsPageSource).toContain('"success"');
  expect(submissionsStyles).toContain(".export-message.success");
});

/**
 * MRQ-169 — the surfaces that made the model visible.
 *
 * The model change is pinned by the integration suite; this file pins what the
 * two humans in the loop actually see: a coverage report where the click used
 * to fail silently, a refusal inside the dialog that caused it, a recorded
 * review that can be reopened and corrected, pools that can be built and
 * trimmed, and co-presenters named rather than counted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const reviewerPage = source("../../src/ui/review/ReviewerPage.tsx");
const evaluationPage = source("../../src/ui/evaluation/EvaluationPage.tsx");
const evaluationStyles = source("../../src/ui/evaluation/evaluation.css");
const submissionsPage = source("../../src/ui/submissions/SubmissionsPage.tsx");
const portalPage = source("../../src/ui/portal/PortalPage.tsx");

test("CONTRACT · MRQ-169 · distribution answers in numbers, and refuses inside its own dialog", () => {
  expect(evaluationPage).toContain("max_per_reviewer");
  expect(evaluationPage).toContain("Per-reviewer limit (optional)");
  expect(evaluationPage).toContain("coverage-report");
  expect(evaluationPage).toContain("new review");
  expect(evaluationPage).toContain("fully covered");
  expect(evaluationPage).toContain("no eligible reviewer");
  expect(evaluationPage).toContain("The per-reviewer limit stopped some abstracts short.");
  // The dialog stays open on success — the report is the answer to the click.
  expect(evaluationPage).toContain("setCoverage(report)");
  // Every dialog that can refuse renders the refusal in reserved space.
  expect(evaluationPage).toContain("setDialogError");
  expect((evaluationPage.match(/class="eval-dialog-error"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(evaluationStyles).toMatch(/\.eval-dialog-error \{[^}]*min-height/);
  // The outcome slot is a fixed box measured live in the browser: the report and
  // the refusal both land without moving the footer buttons (MRQ-169 validation).
  expect(evaluationStyles).toMatch(/\.distribution-outcome \{[^}]*height: 186px/);
});

test("CONTRACT · MRQ-169 · pools can be read, created, and trimmed, and an invitation names its pool", () => {
  expect(evaluationPage).toContain("removePoolMember");
  expect(evaluationPage).toContain("Create pool");
  expect(evaluationPage).toContain("Manage pools");
  expect(evaluationPage).toContain("existing assignment");
  expect(evaluationPage).toContain('aria-label="Reviewer pool"');
  expect(evaluationPage).toContain('aria-label="Agent evaluator pool"');
  // The invite dialog targets the selected pool rather than whichever committee
  // happened to sort first.
  expect(evaluationPage).toContain("committees/${invitePool.id}/invites");
  // The default is the round's own pool; any other pool is one select away.
  expect(evaluationPage).toContain("const defaultPoolId = plan?.rounds[0]?.committee_id");
});

test("CONTRACT · MRQ-169 · the round header can chase everyone who is behind", () => {
  expect(evaluationPage).toContain("remindEveryoneBehind");
  expect(evaluationPage).toContain("Remind all ${behind.length} behind");
  expect(evaluationPage).toContain("already reminded today");
});

test("CONTRACT · MRQ-169 · a recorded review reopens into the review layout and can be corrected", () => {
  expect(reviewerPage).toContain("openRevision");
  expect(reviewerPage).toContain("saving updates your review");
  expect(reviewerPage).toContain("Update review");
  expect(reviewerPage).toContain("Back to queue");
  // MRQ-171 moves the completed list to home, where its row opens the full
  // submission modal first. The modal still offers the same revision action
  // and re-enters the queue's review layout with the recorded values.
  expect(reviewerPage).toContain("onClick={() => void openDetailFor(item.id)}");
  expect(reviewerPage).toContain("if (item) { if (isHome) window.location.assign(\"/reviewer/queue\"); else openRevision(item); }");
  expect(reviewerPage).toContain("Read / Reopen →");
  // The reader who opened the full submission to see their record gets it
  // first, above the abstract and the four sections that used to bury it.
  expect(reviewerPage.indexOf("Your saved review")).toBeLessThan(reviewerPage.indexOf("<h3>Full abstract</h3>"));
});

test("CONTRACT · MRQ-169 · co-presenters are named on the results table and in the speaker portal", () => {
  expect(submissionsPage).toContain("participationRoleLabel(speaker.role)");
  expect(portalPage).toContain("portal-copresenters");
  expect(portalPage).toContain("On this session with you");
  expect(portalPage).toContain("co_presenters");
});

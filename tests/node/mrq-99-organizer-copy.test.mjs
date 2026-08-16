import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · MRQ-99 organizer copy removes the sidebar dead end", async () => {
  const sidebar = await source("src/ui/shell/Sidebar.tsx");
  const switcher = await source("src/ui/shell/EventSwitcher.tsx");
  const appShell = await source("src/ui/shell/AppShell.tsx");

  // MRQ-99 removed a switcher that opened an "unavailable" overlay, and MRQ-106
  // demoted what was left to a caption. What both were protecting is the rule
  // that survives: a control here must not promise something the build cannot
  // do, and must never be a link back to the page you are already on. The name
  // is a control again — it opens a real list of real conferences — so the rule
  // is asserted rather than the shape it once forced.
  assert.match(switcher, /<button[\s\S]*?class="event-context event-switcher"/);
  assert.match(switcher, /aria-haspopup="listbox"/);
  assert.doesNotMatch(switcher, /<a[^>]*class="event-context/);
  assert.doesNotMatch(switcher, /unavailable\s*\(/);
  assert.doesNotMatch(sidebar, /unavailable\s*\(/);
  assert.doesNotMatch(appShell, /unavailable\s*=\s*useCallback/);
});

test("CONTRACT · MRQ-99 decision copy states the actual speaker message", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const bulk = await source("src/ui/submissions/SubmissionsPage.tsx");
  const plan = await source("src/ui/submissions/DecisionPlanPanel.tsx");

  assert.match(record, /DecisionPlanPanel/);
  assert.match(plan, /Wave decision/);
  assert.match(plan, /Every recipient gets their own render/);
  assert.match(plan, /A waitlist saves the decision and sends no message/);
  assert.match(plan, /Feedback for the speakers \(optional\)/);
  assert.match(bulk, /DecisionPlanPanel/);
  assert.doesNotMatch(bulk, /normalized feedback|decision row|standard conference email/);
});

test("CONTRACT · MRQ-99 optional field labels use the parenthesized convention", async () => {
  const bulk = await source("src/ui/submissions/SubmissionsPage.tsx");
  const plan = await source("src/ui/submissions/DecisionPlanPanel.tsx");
  const reviewer = await source("src/ui/review/ReviewerPage.tsx");

  assert.match(plan, /Feedback for the speakers \(optional\)/);
  assert.match(reviewer, /Overall score \(optional\)/);
  assert.match(reviewer, /Committee note \(optional\)/);
  assert.doesNotMatch(reviewer, /Optional scorecard/);
  assert.doesNotMatch(reviewer, /Optional context for the committee/);
});

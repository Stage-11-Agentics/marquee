import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · MRQ-99 organizer copy removes the sidebar dead end", async () => {
  const sidebar = await source("src/ui/shell/Sidebar.tsx");
  const appShell = await source("src/ui/shell/AppShell.tsx");

  assert.match(sidebar, /<a class="event-switcher" href="\/dashboard"/);
  assert.match(sidebar, /navigate\("\/dashboard"\)/);
  assert.doesNotMatch(sidebar, /unavailable\s*\(/);
  assert.doesNotMatch(appShell, /unavailable\s*=\s*useCallback/);
});

test("CONTRACT · MRQ-99 decision copy states the actual speaker message", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const bulk = await source("src/ui/submissions/SubmissionsPage.tsx");

  assert.match(record, /speaker will see the same words in the decision email/);
  assert.match(record, /A waitlist does not send a message/);
  assert.match(record, /decisionRequest === "maybe" \? "Waitlist"/);
  assert.match(record, /Feedback for the speaker \(optional\)/);
  assert.match(bulk, /Each selected speaker will receive the feedback you add in the decision email/);
  assert.match(bulk, /A waitlist does not send a message/);
  assert.doesNotMatch(bulk, /normalized feedback|decision row|standard conference email/);
});

test("CONTRACT · MRQ-99 optional field labels use the parenthesized convention", async () => {
  const bulk = await source("src/ui/submissions/SubmissionsPage.tsx");
  const reviewer = await source("src/ui/review/ReviewerPage.tsx");

  assert.match(bulk, /Feedback for the speakers \(optional\)/);
  assert.match(reviewer, /Overall score \(optional\)/);
  assert.match(reviewer, /Committee note \(optional\)/);
  assert.doesNotMatch(reviewer, /Optional scorecard/);
  assert.doesNotMatch(reviewer, /Optional context for the committee/);
});

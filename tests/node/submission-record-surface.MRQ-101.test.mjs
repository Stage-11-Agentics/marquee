import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · MRQ-101 the topbar breadcrumb is real links with a Submissions middle crumb", async () => {
  const topbar = await source("src/ui/shell/Topbar.tsx");

  assert.match(topbar, /<a href="\/dashboard" onClick=\{crumbTo\("\/dashboard"\)\}>\{eventName\}<\/a>/);
  assert.match(topbar, /<a href="\/submissions" onClick=\{crumbTo\("\/submissions"\)\}>Submissions<\/a>/);
  // The trailing crumb names the current route but is never itself a link.
  assert.match(topbar, /<strong>\{routeName\}<\/strong>/);
  assert.doesNotMatch(topbar, /<a[^>]*routeName/);
  // Delivery health carries its own chrome and does not pass navigate/pathname
  // (src/ui/health/** is out of scope for this ticket) — both props must stay
  // optional so that call site keeps compiling.
  assert.match(topbar, /pathname\s*=\s*""/);
  assert.match(topbar, /navigate\s*=\s*\(target\)\s*=>/);
});

test("CONTRACT · MRQ-101 the loaded record has one Back to submissions control, kept only on the error state", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  const backButtonCount = (record.match(/Back to submissions/g) ?? []).length;
  assert.equal(backButtonCount, 1, "Back to submissions must survive only on the error branch");
});

test("CONTRACT · MRQ-101 the record title is not duplicated into the gray PageHeader", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.doesNotMatch(record, /PageHeader title=\{record\.title\}/);
  assert.match(record, /PageHeader title="Submission record"/);
  // The white summary card's <h2> is the one place the title still renders.
  assert.match(record, /<h2>\{record\.title\}<\/h2>/);
});

test("CONTRACT · MRQ-101 a standing decision is not offered again, and the cue is content weight", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(record, /record\.status !== "accepted" && <Button variant="primary"/);
  assert.match(record, /record\.status !== "waitlisted" && <Button /);
  assert.match(record, /record\.status !== "rejected" && <Button variant="danger"/);
  assert.match(record, /record\.decisions\.length > 0 \? "record-decision-cue" : "subtle"/);

  const recordCss = await source("src/ui/submissions/record.css");
  assert.match(recordCss, /\.record-decision-cue[^}]*color: var\(--ink\)/);
  assert.match(recordCss, /\.record-decision-cue[^}]*font-weight: 600/);
});

test("CONTRACT · MRQ-101 the header state chip distinguishes a terminal negative from an accepted record", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(record, /Chip tone=\{headerChipTone\(record\)\}/);
});

test("CONTRACT · MRQ-101 the error state distinguishes a real 404 from an unreachable server", async () => {
  const record = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(record, /error instanceof MarqueeApiError && error\.code === "not_found"/);
  assert.match(record, /This record could not be found\./);
  assert.match(record, /This record could not be reached right now\./);
  // Retry stays available in both cases — a 404 does not remove the button.
  assert.match(record, /variant="primary" onClick=\{reload\}>Retry<\/Button>/);
});

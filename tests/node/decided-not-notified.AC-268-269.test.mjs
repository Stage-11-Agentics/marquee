import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const savedViews = readFileSync(new URL("../../src/lib/saved-views.ts", import.meta.url), "utf8");
const columns = readFileSync(new URL("../../src/lib/submission-columns.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../../src/routes/submissions.queries.ts", import.meta.url), "utf8");
const decisions = readFileSync(new URL("../../src/jobs/cascade/decisions.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../src/ui/dashboard/DashboardPage.tsx", import.meta.url), "utf8");
const dashboardRoute = readFileSync(new URL("../../src/routes/dashboard.routes.ts", import.meta.url), "utf8");
const submissions = readFileSync(new URL("../../src/ui/submissions/SubmissionsPage.tsx", import.meta.url), "utf8");

test("AC-268 · the notification gap is a built-in derived view with a fixed reason column and persistent dashboard row", () => {
  assert.match(savedViews, /id: "decided-not-notified"/);
  assert.match(savedViews, /filters: \{ status: "not_notified" \}/);
  assert.match(columns, /id: "notified", label: "Notified"/);
  assert.match(queries, /submission_decisions latest_decision/);
  assert.match(queries, /notification_outbox\.status = 'sent'/);
  assert.match(queries, /Changed in Airtable/);
  assert.match(queries, /Not delivered/);
  assert.match(queries, /No valid address/);
  assert.match(dashboard, /attention\.decided_not_notified/);
  assert.match(dashboardRoute, /Every decision has reached its speaker/);
});

test("AC-269 · notification retry targets the existing decision and uses a fresh outbox identity", () => {
  assert.match(decisions, /decision\.resulting_status IN \('accepted', 'rejected'\)/);
  assert.match(decisions, /entityId: candidate\.decision_id/);
  assert.match(decisions, /idempotencyKey: retryKey/);
  assert.match(decisions, /sha256Hex\(`\$\{templateKey\}:\$\{candidate\.decision_id\}:\$\{newUlid\(now\)\}`\)/);
  assert.doesNotMatch(`${queries}\n${decisions}`, /ALTER TABLE[\s\S]{0,120}\bnotified\b/i);
  assert.doesNotMatch(`${queries}\n${decisions}`, /SET\s+notified\s*=/i);
});

test("AC-268 + AC-269 · the built-in surface explains the actionable count and address exception", () => {
  assert.match(submissions, /title=\{notifiedQueue \? "Decided · not notified"/);
  assert.match(submissions, /Notify \$\{notifiedSummary\?\.sendable/);
  assert.match(submissions, /need an address first/);
  assert.match(submissions, /notification-state/);
});

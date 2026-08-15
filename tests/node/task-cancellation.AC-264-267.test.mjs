import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const decisions = await readFile(new URL("../../src/jobs/cascade/decisions.ts", import.meta.url), "utf8");
const outbox = await readFile(new URL("../../src/jobs/mail/outbox.ts", import.meta.url), "utf8");
const schedule = await readFile(new URL("../../src/jobs/mail/schedule.ts", import.meta.url), "utf8");
const triggers = await readFile(new URL("../../src/jobs/mail/triggers.ts", import.meta.url), "utf8");
const consumer = await readFile(new URL("../../src/jobs/mail/consumer.ts", import.meta.url), "utf8");
const board = await readFile(new URL("../../src/api/board.ts", import.meta.url), "utf8");
const submissions = await readFile(new URL("../../src/routes/submissions.queries.ts", import.meta.url), "utf8");
const audience = await readFile(new URL("../../src/jobs/mail/audience.ts", import.meta.url), "utf8");
// The portal is two files since MRQ-214 extracted the task machinery the sponsor
// portal shares. Read both, so the assertion follows the code.
const portal = [
  await readFile(new URL("../../src/ui/portal/PortalPage.tsx", import.meta.url), "utf8"),
  await readFile(new URL("../../src/ui/portal/task-machinery.tsx", import.meta.url), "utf8"),
].join("\n");
const audit = await readFile(new URL("../../src/lib/audit.ts", import.meta.url), "utf8");

test("AC-264 · cancellation is a timestamp tombstone over open tasks", () => {
  assert.equal((decisions.match(/export async function cancelTaskSet\s*\(/g) ?? []).length, 1);
  assert.match(decisions, /SET cancelled_at = \?, updated_at = \?, last_write_source = 'marquee'/);
  assert.match(decisions, /status = 'open'[\s\S]{0,100}cancelled_at IS NULL/);
  assert.doesNotMatch(decisions, /DELETE\s+FROM\s+speaker_tasks/i);
  assert.doesNotMatch(decisions, /status\s*=\s*['"]cancelled['"]/i);
  assert.match(decisions, /submission\.tasks_\$\{input\.tasks/);
  assert.match(decisions, /submission\.tasks_reconciled/);
});

test("AC-265 · every overdue and active-task reader excludes cancellation tombstones", () => {
  assert.match(schedule, /task\.status = 'open'[\s\S]{0,180}task\.cancelled_at IS NULL/);
  assert.match(triggers, /enqueueOverdueTaskReminderRows/);
  assert.match(consumer, /enqueueOverdueTaskReminderRows\(db, now\)/);
  // Board stage SQL delegates the cancellation-aware onboarding arm to the
  // shared predicate; the next assertion pins the actual tombstone clauses.
  assert.match(board, /submissionStatusPredicate\(\s*"onboarding"[\s\S]{0,100}includeCancelledAt:\s*true/);
  assert.match(submissions, /filtered_task\.status = 'open'[\s\S]{0,120}filtered_task\.cancelled_at IS NULL/);
  assert.match(audience, /candidate\.cancelled_at IS NULL/);
  assert.match(audience, /filtered_task\.cancelled_at IS NULL/);
  assert.match(portal, /const activeTasks = tasks\.filter\(\(task\) => task\.cancelled_at === null\)/);
  assert.match(portal, /function CancelledTaskRow/);
  assert.match(portal, /data-task-cancelled="true"/);
});

test("AC-266 · one reconcile function restores without changing due dates and relies on idempotent writes", () => {
  assert.equal((decisions.match(/export async function reconcileTaskSet\s*\(/g) ?? []).length, 1);
  assert.equal((decisions.match(/reconcileTaskSet\(/g) ?? []).length, 4);
  const restoration = decisions.match(/UPDATE speaker_tasks[\s\S]{0,320}cancelled_at = NULL[\s\S]{0,180}/)?.[0] ?? "";
  assert.match(restoration, /WHERE id = \?/);
  assert.match(restoration, /status = 'open'/);
  assert.match(restoration, /cancelled_at IS NOT NULL/);
  assert.doesNotMatch(restoration, /due_at\s*=/);
  assert.match(outbox, /isUniqueConstraint/);
  assert.match(outbox, /findByIdempotencyKey/);
});

test("AC-267 · reversal and reconciliation write actor-and-time history", () => {
  assert.match(decisions, /submission\.acceptance_reversed/);
  assert.match(decisions, /submission\.tasks_\$\{input\.tasks/);
  assert.match(decisions, /submission\.tasks_reconciled/);
  // The audit INSERT now lives in the one shared writer, so AC-267's guarantee
  // is checked in two halves: the cascade supplies actor and time, and the
  // writer binds them to the actor and time columns.
  assert.match(decisions, /actorPersonId: input\.actor\.personId/);
  assert.match(decisions, /now: input\.now/);
  assert.match(audit, /actor_person_id/);
  assert.match(audit, /created_at/);
  assert.match(audit, /entry\.actorPersonId,/);
  assert.match(audit, /entry\.now,/);
});

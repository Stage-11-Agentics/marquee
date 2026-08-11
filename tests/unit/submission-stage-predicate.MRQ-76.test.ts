import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { submissionStatusPredicate } from "../../src/routes/submissions.queries";

const EVENT_ID = "event-stage-fixture";
const STAGES = [
  "draft",
  "submitted",
  "in_review",
  "unreviewed",
  "waved",
  "accepted",
  "onboarding",
  "scheduled",
  "published",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const;

const database = new DatabaseSync(":memory:");

afterEach(() => {
  database.exec("DELETE FROM agenda_items; DELETE FROM speaker_tasks; DELETE FROM waves; DELETE FROM submissions;");
});

function seedFixture(): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      wave_id TEXT
    );
    CREATE TABLE IF NOT EXISTS waves (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      sent_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agenda_items (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      is_published INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS speaker_tasks (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      status TEXT NOT NULL,
      cancelled_at INTEGER,
      due_at INTEGER NOT NULL
    );
  `);
  database.prepare("INSERT INTO waves (id, event_id, sent_at) VALUES (?, ?, ?), (?, ?, ?)").run(
    "wave-pending", EVENT_ID, null,
    "wave-sent", EVENT_ID, 1,
  );
  const submissions = [
    ["draft", "draft", null],
    ["submitted", "submitted", null],
    ["in-review", "in_review", null],
    ["waved", "accepted", "wave-pending"],
    ["accepted", "accepted", "wave-sent"],
    ["onboarding", "accepted", "wave-sent"],
    ["scheduled", "accepted", "wave-sent"],
    ["published", "accepted", "wave-sent"],
    ["waitlisted", "waitlisted", null],
    ["rejected", "rejected", null],
    ["withdrawn", "withdrawn", null],
  ] as const;
  const insertSubmission = database.prepare("INSERT INTO submissions (id, event_id, status, wave_id) VALUES (?, ?, ?, ?)");
  for (const [id, status, waveId] of submissions) insertSubmission.run(id, EVENT_ID, status, waveId);
  database.prepare("INSERT INTO speaker_tasks (id, event_id, submission_id, status, cancelled_at, due_at) VALUES (?, ?, ?, 'open', NULL, ?)").run(
    "task-onboarding", EVENT_ID, "onboarding", 1,
  );
  database.prepare("INSERT INTO speaker_tasks (id, event_id, submission_id, status, cancelled_at, due_at) VALUES (?, ?, ?, 'open', NULL, ?)").run(
    "task-waved", EVENT_ID, "waved", 1,
  );
  database.prepare("INSERT INTO speaker_tasks (id, event_id, submission_id, status, cancelled_at, due_at) VALUES (?, ?, ?, 'open', ? , ?)").run(
    "task-cancelled", EVENT_ID, "accepted", 1, 1,
  );
  database.prepare("INSERT INTO agenda_items (id, submission_id, kind, is_published) VALUES (?, ?, 'session', ?), (?, ?, 'session', ?)").run(
    "agenda-scheduled", "scheduled", 0,
    "agenda-published", "published", 1,
  );
}

function idsFor(status: (typeof STAGES)[number]): string[] {
  const predicate = submissionStatusPredicate(status, { includeCancelledAt: true });
  return (database.prepare(`
    SELECT s.id
    FROM submissions s
    LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
    WHERE s.event_id = ? AND ${predicate}
    ORDER BY s.id
  `).all(EVENT_ID) as Array<{ id: string }>).map((row) => row.id);
}

test("MRQ-76 · shared stage predicates classify the fixture into distinct literal sets", () => {
  seedFixture();
  const expected: Record<(typeof STAGES)[number], string[]> = {
    draft: ["draft"],
    submitted: ["submitted"],
    in_review: ["in-review"],
    unreviewed: ["in-review", "submitted"],
    waved: ["waved"],
    accepted: ["accepted"],
    onboarding: ["onboarding"],
    scheduled: ["scheduled"],
    published: ["published"],
    waitlisted: ["waitlisted"],
    rejected: ["rejected"],
    withdrawn: ["withdrawn"],
  };
  for (const stage of STAGES) expect(idsFor(stage), stage).toEqual(expected[stage]);
  expect(idsFor("waved")).not.toEqual(idsFor("accepted"));
});

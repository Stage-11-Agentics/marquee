-- Airtable is an audit actor, not a person. Keep provider-originated decision
-- rows in the same history table without attributing them to a human record.
CREATE TABLE submission_decisions_0027_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'maybe', 'deny')),
  resulting_status TEXT NOT NULL CHECK (
    resulting_status IN ('accepted', 'waitlisted', 'rejected')
  ),
  feedback_md TEXT,
  decided_by_person_id TEXT REFERENCES people(id),
  decided_at INTEGER NOT NULL,
  outbox_id TEXT REFERENCES outbox(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO submission_decisions_0027_new
  (id, event_id, submission_id, decision, resulting_status, feedback_md,
   decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
SELECT id, event_id, submission_id, decision, resulting_status, feedback_md,
       decided_by_person_id, decided_at, outbox_id, created_at, updated_at
  FROM submission_decisions;

DROP TABLE submission_decisions;

ALTER TABLE submission_decisions_0027_new RENAME TO submission_decisions;

CREATE INDEX idx_submission_decisions_submission_decided
  ON submission_decisions(submission_id, decided_at);
CREATE INDEX idx_submission_decisions_event_decided
  ON submission_decisions(event_id, decided_at);

-- Settings counts and the bounded live log both filter the append-only audit
-- stream by this action. Keep those reads from scanning every audit row as a
-- conference accumulates ordinary organizer history.
CREATE INDEX idx_audit_log_action_created
  ON audit_log(action, created_at DESC, id DESC);

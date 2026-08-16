-- MRQ-233: one durable ICS part per covered submission in a speaker batch.
-- The owning outbox row is the admission/retry grain; the child is the
-- outbox-to-submission audit mapping and carries the exact material delivered.
CREATE TABLE outbox_calendar_parts (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  ics_uid TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  filename TEXT NOT NULL,
  ics_body TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (outbox_id, part_index),
  UNIQUE (outbox_id, submission_id)
);

CREATE INDEX idx_outbox_calendar_parts_outbox
  ON outbox_calendar_parts(outbox_id, part_index);
CREATE INDEX idx_outbox_calendar_parts_uid
  ON outbox_calendar_parts(ics_uid, outbox_id, part_index);
CREATE INDEX idx_outbox_calendar_parts_submission
  ON outbox_calendar_parts(submission_id, created_at);

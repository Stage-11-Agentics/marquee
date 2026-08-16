-- Internal submission notes are immutable staff annotations. The author is an
-- organization person, never a request-supplied label or an event roster row.
CREATE TABLE submission_notes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  author_person_id TEXT NOT NULL REFERENCES people(id),
  body_md TEXT NOT NULL CHECK (length(trim(body_md)) > 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_submission_notes_submission_created
  ON submission_notes(submission_id, created_at DESC, id DESC);

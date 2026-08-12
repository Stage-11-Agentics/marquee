-- MRQ-116 — comments belong to the deliverable slot, not one upload version.
-- owner_id is a speaker_tasks id when owner_type = 'task_upload'. The
-- attachment is optional context: a comment written against v1 must survive
-- the task's pointer moving to v2.
CREATE TABLE file_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  owner_type TEXT NOT NULL CHECK (owner_type = 'task_upload'),
  owner_id TEXT NOT NULL,
  attachment_id TEXT REFERENCES attachments(id),
  author_person_id TEXT NOT NULL REFERENCES people(id),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_file_comments_slot
  ON file_comments(event_id, owner_type, owner_id, created_at, id);

CREATE INDEX idx_file_comments_attachment
  ON file_comments(event_id, attachment_id);

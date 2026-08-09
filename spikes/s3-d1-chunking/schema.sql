DROP TABLE IF EXISTS submissions;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  form_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('abstract', 'session')),
  bypass_evaluation INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'submitted',
      'in_review',
      'accepted',
      'waitlisted',
      'rejected',
      'withdrawn'
    )
  ),
  format_id TEXT,
  primary_track_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('public', 'admin', 'import')),
  vendor_affiliation TEXT NOT NULL DEFAULT 'none',
  wave_id TEXT,
  submitter_person_id TEXT NOT NULL,
  decided_at INTEGER,
  decided_by_person_id TEXT,
  submitted_at INTEGER,
  last_saved_at INTEGER,
  is_published INTEGER NOT NULL DEFAULT 0,
  external_ref TEXT,
  search_blob TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX submissions_event_status_kind_idx
  ON submissions (event_id, status, kind);

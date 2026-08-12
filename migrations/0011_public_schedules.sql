-- MRQ-132 — an attendee's own schedule, promoted to a short code.
--
-- No identity, no PII, no account: a code is a random handle an attendee
-- chose to create, and the write key is stored only as its SHA-256 so a
-- database dump cannot edit anybody's schedule. Earlier migrations are
-- immutable; this one is additive.

CREATE TABLE public_schedules (
  code TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  session_ids TEXT NOT NULL
    CHECK (json_valid(session_ids) AND json_type(session_ids) = 'array'),
  write_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX public_schedules_event_idx ON public_schedules (event_id, updated_at DESC);

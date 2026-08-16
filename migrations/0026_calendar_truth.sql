-- MRQ-228 — calendar material is durable and self-contained.
--
-- calendar_invites predates the snapshot contract and had no status CHECK. It
-- is rebuilt so existing rows remain readable while every new row has the
-- immutable organizer address and the last delivered REQUEST snapshot.
DROP INDEX IF EXISTS uq_calendar_invites_submission_person;
DROP INDEX IF EXISTS uq_calendar_invites_uid;
DROP INDEX IF EXISTS idx_calendar_invites_submission_status;

CREATE TABLE calendar_invites_0026_new (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  uid TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  last_method TEXT NOT NULL CHECK (last_method IN ('REQUEST', 'CANCEL')),
  last_sent_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  request_snapshot TEXT,
  organizer_email TEXT NOT NULL DEFAULT 'marquee@stage11.systems',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (sequence >= 0)
);

INSERT INTO calendar_invites_0026_new (
  id, submission_id, person_id, uid, sequence, last_method, last_sent_at,
  status, request_snapshot, organizer_email, created_at, updated_at
)
SELECT
  id, submission_id, person_id, uid, sequence,
  CASE WHEN last_method = 'CANCEL' THEN 'CANCEL' ELSE 'REQUEST' END,
  last_sent_at,
  CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'active' END,
  NULL,
  'marquee@stage11.systems',
  created_at, updated_at
FROM calendar_invites;

DROP TABLE calendar_invites;
ALTER TABLE calendar_invites_0026_new RENAME TO calendar_invites;

CREATE UNIQUE INDEX uq_calendar_invites_submission_person
  ON calendar_invites(submission_id, person_id);
CREATE UNIQUE INDEX uq_calendar_invites_uid ON calendar_invites(uid);
CREATE INDEX idx_calendar_invites_submission_status
  ON calendar_invites(submission_id, status);

-- This row is intentionally not tied to a conference or invite row. The
-- highest emitted sequence must survive an invite's deletion and demo reset.
CREATE TABLE calendar_sequence_ledger (
  uid TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  updated_at INTEGER NOT NULL
);

-- Cancellation jobs deliberately have no foreign keys. A conference cascade
-- may remove the subject rows while an already-created job is still durable.
-- the cancellation drain can then suppress it rather than blocking the
-- cascade or rendering from mutable session/person rows.
CREATE TABLE calendar_cancellations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  person_id TEXT,
  uid TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  to_email TEXT NOT NULL,
  organizer_email TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  cancelled_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'suppressed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  outbox_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_calendar_cancellations_status
  ON calendar_cancellations(status, updated_at);
CREATE INDEX idx_calendar_cancellations_uid
  ON calendar_cancellations(uid, sequence);

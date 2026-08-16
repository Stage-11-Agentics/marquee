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
  (
    SELECT json_object(
      'attendee', json_object('email', person.email, 'name', person.name),
      'description', COALESCE(submission.abstract, submission.title),
      'duration_min', agenda.duration_min,
      'geo', CASE
        WHEN building.lat IS NULL OR building.lng IS NULL THEN NULL
        ELSE json_object('lat', building.lat, 'lng', building.lng)
      END,
      'location', COALESCE(
        NULLIF(
          TRIM(
            room.name
            || CASE WHEN TRIM(COALESCE(building.name, '')) <> ''
              THEN CASE WHEN TRIM(room.name) <> '' THEN ', ' ELSE '' END || building.name
              ELSE '' END
            || CASE WHEN TRIM(COALESCE(building.address, '')) <> ''
              THEN CASE WHEN TRIM(room.name) <> '' OR TRIM(COALESCE(building.name, '')) <> '' THEN ', ' ELSE '' END || building.address
              ELSE '' END
          ),
          ''
        ),
        '—'
      ),
      'organizer', json_object('email', 'marquee@stage11.systems', 'name', 'Marquee'),
      'starts_at', agenda.starts_at,
      'timezone', event.timezone,
      'title', submission.title,
      'url', 'https://marquee.stage11.dev/s/' || submission.id
    )
    FROM submissions submission
    JOIN events event ON event.id = submission.event_id
    JOIN agenda_items agenda
      ON agenda.submission_id = submission.id
     AND agenda.event_id = submission.event_id
     AND agenda.kind = 'session'
    JOIN rooms room ON room.id = agenda.room_id AND room.event_id = agenda.event_id
    LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
    JOIN people person ON person.id = legacy.person_id
    WHERE submission.id = legacy.submission_id
    LIMIT 1
  ),
  'marquee@stage11.systems',
  created_at, updated_at
FROM calendar_invites legacy;

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

-- The floor must start at the highest sequence already emitted, or a demo
-- reset could recreate an old UID at SEQUENCE:0 after this migration lands.
INSERT INTO calendar_sequence_ledger (uid, last_sequence, updated_at)
SELECT uid, MAX(sequence), MAX(updated_at)
FROM calendar_invites
GROUP BY uid;

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
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'suppressed', 'failed', 'abandoned')),
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

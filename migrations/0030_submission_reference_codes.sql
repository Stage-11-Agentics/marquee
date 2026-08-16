-- MRQ-241: short, conference-scoped submission references.
-- Keep the column nullable during the additive migration so legacy fixtures
-- can be upgraded before the deterministic backfill completes.
ALTER TABLE submissions ADD COLUMN reference_code TEXT;

-- Rank null rows by the immutable creation tuple, after any already-populated
-- floor in the event. The WHERE clause keeps a rerun from renumbering a
-- populated row and keeps a partially applied backfill collision-free.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY submissions.event_id ORDER BY submissions.created_at, submissions.id)
      + COALESCE(existing.last_sequence, 0) AS sequence
  FROM submissions
  LEFT JOIN (
    SELECT event_id, MAX(CAST(substr(reference_code, 5) AS INTEGER)) AS last_sequence
    FROM submissions
    WHERE reference_code IS NOT NULL
    GROUP BY event_id
  ) AS existing ON existing.event_id = submissions.event_id
  WHERE reference_code IS NULL
)
UPDATE submissions
SET reference_code = 'SUB-' || (
  SELECT ranked.sequence FROM ranked WHERE ranked.id = submissions.id
)
WHERE reference_code IS NULL;

CREATE UNIQUE INDEX uq_submissions_reference
  ON submissions(event_id, reference_code);

-- This ledger deliberately has no event or submission FK. A conference reset
-- deletes its submissions, and deleting a conference must not make an emitted
-- human reference available to a later row with the same durable event id.
CREATE TABLE submission_reference_ledger (
  event_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  updated_at INTEGER NOT NULL
);

-- Seed the floor from the deterministic backfill. Future allocation advances
-- this row in the same D1 batch as the submission insert, so deleting the
-- highest-numbered submission cannot lower the next code.
INSERT INTO submission_reference_ledger (event_id, last_sequence, updated_at)
SELECT event_id, MAX(CAST(substr(reference_code, 5) AS INTEGER)), MAX(updated_at)
FROM submissions
WHERE reference_code IS NOT NULL
GROUP BY event_id;

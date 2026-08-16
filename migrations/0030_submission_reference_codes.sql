-- MRQ-241: short, conference-scoped submission references.
-- Keep the column nullable during the additive migration so legacy fixtures
-- can be upgraded before the deterministic backfill completes.
ALTER TABLE submissions ADD COLUMN reference_code TEXT;

-- Rank null rows by the immutable creation tuple, after any already-populated
-- floor in the event. Restricting to null rows keeps a rerun from renumbering a
-- populated row and keeps a partially applied backfill collision-free.
--
-- The ranking is joined in, never reached through a correlated subquery. That
-- distinction is the whole migration: a scalar subquery correlated to the row
-- being written (`WHERE ranked.id = submissions.id`) is not a materialisation
-- barrier, so SQLite may re-evaluate it per output row -- against rows this same
-- statement has already updated. The window then re-ranks a shrinking set while
-- the floor moves underneath it. On an empty table the effect is invisible,
-- which is why the local migrate-then-seed flow never showed it; on a populated
-- one it is catastrophic. Against a production snapshot of 1008 submissions the
-- correlated form emitted 32 distinct codes and gave `SUB-4` to 940 rows, so
-- `uq_submissions_reference` could not be created. Three rows in one event are
-- enough to reproduce it.
--
-- Here the FROM subquery is uncorrelated -- it never references the outer row --
-- so it is an ordinary join source, computed once before any write lands. Each
-- target matches exactly one ranked row because `id` is the primary key on both
-- sides, which also keeps this clear of SQLite's rule that a multiply-matched
-- UPDATE ... FROM row picks an arbitrary source.
UPDATE submissions
SET reference_code = 'SUB-' || ranked.sequence
FROM (
  SELECT
    candidate.id AS id,
    ROW_NUMBER() OVER (PARTITION BY candidate.event_id ORDER BY candidate.created_at, candidate.id)
      + COALESCE(existing.last_sequence, 0) AS sequence
  FROM submissions AS candidate
  LEFT JOIN (
    SELECT event_id, MAX(CAST(substr(reference_code, 5) AS INTEGER)) AS last_sequence
    FROM submissions
    WHERE reference_code IS NOT NULL
    GROUP BY event_id
  ) AS existing ON existing.event_id = candidate.event_id
  WHERE candidate.reference_code IS NULL
) AS ranked
WHERE submissions.id = ranked.id;

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

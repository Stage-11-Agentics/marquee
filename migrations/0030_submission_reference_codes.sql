-- MRQ-241: short, conference-scoped submission references.
-- Keep the column nullable during the additive migration so legacy fixtures
-- can be upgraded before the deterministic backfill completes.
ALTER TABLE submissions ADD COLUMN reference_code TEXT;

-- Rank by the immutable creation tuple, not row order or a count of current
-- rows. The WHERE clause keeps a rerun from renumbering a populated row.
UPDATE submissions
SET reference_code = 'SUB-' || (
  SELECT COUNT(*)
  FROM submissions earlier
  WHERE earlier.event_id = submissions.event_id
    AND (
      earlier.created_at < submissions.created_at
      OR (earlier.created_at = submissions.created_at AND earlier.id <= submissions.id)
    )
)
WHERE reference_code IS NULL;

CREATE UNIQUE INDEX uq_submissions_reference
  ON submissions(event_id, reference_code);

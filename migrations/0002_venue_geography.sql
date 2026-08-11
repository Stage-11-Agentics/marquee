-- MRQ-58 — venue geography for travel-conflict detection.
-- The MRQ-2 init migration is immutable; this migration is additive.

ALTER TABLE buildings ADD COLUMN lat REAL
  CHECK (lat IS NULL OR lat BETWEEN -90 AND 90);

ALTER TABLE buildings ADD COLUMN lng REAL
  CHECK (lng IS NULL OR lng BETWEEN -180 AND 180);

ALTER TABLE buildings ADD COLUMN access_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (access_minutes >= 0);

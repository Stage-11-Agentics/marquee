-- MRQ-62 — entrance instructions belong to buildings, not rooms.
-- 0001 and 0002 are immutable; this migration is additive.

ALTER TABLE buildings ADD COLUMN access_note TEXT;

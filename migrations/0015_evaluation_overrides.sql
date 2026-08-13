-- MRQ-149 — a chair's override of a recorded score.
--
-- The override lives on the evaluation it overrides rather than as a second
-- peer review, so the reviewer's original judgment survives intact and the
-- record shows both: what the reviewer said, and what the chair decided
-- instead. Clearing an override restores the reviewer's own value.

ALTER TABLE evaluations ADD COLUMN override_score REAL;
ALTER TABLE evaluations ADD COLUMN override_comment TEXT;
ALTER TABLE evaluations ADD COLUMN override_person_id TEXT REFERENCES people(id);
ALTER TABLE evaluations ADD COLUMN override_at INTEGER;

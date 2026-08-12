-- MRQ-110 — attach an event-scoped reviewer pool to each evaluation round.
-- Existing rounds remain unassigned until an organizer selects a committee.
ALTER TABLE evaluation_rounds ADD COLUMN committee_id TEXT REFERENCES committees(id);

CREATE INDEX idx_evaluation_rounds_committee ON evaluation_rounds(committee_id);

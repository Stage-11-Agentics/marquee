-- MRQ-25 — reversal state is additive: completed task work remains immutable,
-- while open work and scheduled outbox rows can be reconciled by ownership.

ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER;
ALTER TABLE outbox ADD COLUMN entity_id TEXT;

CREATE INDEX idx_speaker_tasks_submission_cancelled
  ON speaker_tasks(submission_id, status, cancelled_at);
CREATE INDEX idx_outbox_entity_status
  ON outbox(event_id, entity_id, status);

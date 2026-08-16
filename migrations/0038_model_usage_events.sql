-- MRQ-250: counters-only evidence for model drafting. Prompts, notes, and
-- generated paragraphs deliberately do not have a column in this table.
CREATE TABLE model_usage_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_person_id TEXT NOT NULL REFERENCES people(id),
  operation TEXT NOT NULL CHECK (operation IN ('kind_feedback')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  failure_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_model_usage_events_event_created
  ON model_usage_events(event_id, created_at DESC, id DESC);

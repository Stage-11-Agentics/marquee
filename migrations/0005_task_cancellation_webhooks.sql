-- MRQ-66 / M-61 — task cancellation and outbound webhook persistence.
-- 0001 through 0004 are immutable; this migration is additive. The nullable
-- cancellation tombstone is already present in immutable 0004_calendar_reversal.sql.
-- repeating its ALTER here would make the migration fail on every fresh D1.

-- Amendment 16's six event names are deliberately enforced here as well as by
-- the future webhook writer. SQLite CHECK constraints cannot contain a
-- table-valued subquery, so validate each possible array slot explicitly.
CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  url TEXT NOT NULL CHECK (url LIKE 'https://%'),
  secret_hash TEXT NOT NULL,
  events_json TEXT NOT NULL CHECK (
    json_valid(events_json)
    AND json_type(events_json) = 'array'
    AND json_array_length(events_json) <= 6
    AND (
      json_type(events_json, '$[0]') IS NULL
      OR (json_type(events_json, '$[0]') = 'text' AND json_extract(events_json, '$[0]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
    AND (
      json_type(events_json, '$[1]') IS NULL
      OR (json_type(events_json, '$[1]') = 'text' AND json_extract(events_json, '$[1]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
    AND (
      json_type(events_json, '$[2]') IS NULL
      OR (json_type(events_json, '$[2]') = 'text' AND json_extract(events_json, '$[2]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
    AND (
      json_type(events_json, '$[3]') IS NULL
      OR (json_type(events_json, '$[3]') = 'text' AND json_extract(events_json, '$[3]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
    AND (
      json_type(events_json, '$[4]') IS NULL
      OR (json_type(events_json, '$[4]') = 'text' AND json_extract(events_json, '$[4]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
    AND (
      json_type(events_json, '$[5]') IS NULL
      OR (json_type(events_json, '$[5]') = 'text' AND json_extract(events_json, '$[5]') IN (
        'submission.created', 'submission.status_changed', 'evaluation.completed',
        'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
      ))
    )
  ),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_delivery_at INTEGER
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'submission.created', 'submission.status_changed', 'evaluation.completed',
    'speaker_task.completed', 'agenda.published', 'speaker.confirmed'
  )),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  response_code INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX idx_webhook_deliveries_endpoint_created
  ON webhook_deliveries(endpoint_id, created_at);

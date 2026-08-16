-- MRQ-229: event-scoped routing taxonomy, answer tombstones, and arrival claims.
-- Every taxonomy is event-owned; organization/person tags remain in person_events.

ALTER TABLE form_fields ADD COLUMN deleted_at INTEGER;
ALTER TABLE routing_rules ADD COLUMN deleted_at INTEGER;
ALTER TABLE tracks ADD COLUMN deleted_at INTEGER;
ALTER TABLE tracks ADD COLUMN name_key TEXT;
UPDATE tracks SET name_key = lower(trim(name)) WHERE name_key IS NULL OR name_key = '';

-- Older fixtures and import writers insert the tracks-shaped columns without
-- the routing key. Keep those callers compatible while making every persisted
-- row immediately addressable by the normalized-name index.
CREATE TRIGGER tracks_name_key_after_insert
AFTER INSERT ON tracks
WHEN NEW.name_key IS NULL OR NEW.name_key = ''
BEGIN
  UPDATE tracks SET name_key = lower(trim(name)) WHERE id = NEW.id;
END;

CREATE TRIGGER tracks_name_key_after_name_update
AFTER UPDATE OF name ON tracks
WHEN NEW.name_key IS NULL OR NEW.name_key = '' OR (NEW.name <> OLD.name AND NEW.name_key = OLD.name_key)
BEGIN
  UPDATE tracks SET name_key = lower(trim(name)) WHERE id = NEW.id;
END;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

CREATE TABLE levels (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

ALTER TABLE submissions ADD COLUMN level_id TEXT REFERENCES levels(id);

CREATE TABLE submission_tags (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE submission_arrivals (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  resume_token_hash TEXT,
  applied_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_tags_event_name_key
  ON tags(event_id, name_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_tags_event_position
  ON tags(event_id, position, id);
CREATE UNIQUE INDEX uq_levels_event_name_key
  ON levels(event_id, name_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_levels_event_position
  ON levels(event_id, position, id);
CREATE INDEX idx_form_fields_form_active_position
  ON form_fields(form_id, deleted_at, position, id);
CREATE INDEX idx_routing_rules_event_active_position
  ON routing_rules(event_id, deleted_at, position, id);
CREATE INDEX idx_tracks_event_active_position
  ON tracks(event_id, deleted_at, position, id);
CREATE UNIQUE INDEX uq_tracks_event_name_key
  ON tracks(event_id, name_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_submission_tags_submission_tag
  ON submission_tags(submission_id, tag_id);
CREATE INDEX idx_submission_tags_tag_submission
  ON submission_tags(tag_id, submission_id);
CREATE INDEX idx_submission_arrivals_resume_token
  ON submission_arrivals(resume_token_hash) WHERE resume_token_hash IS NOT NULL;
CREATE INDEX idx_submissions_form_origin_submitted
  ON submissions(form_id, origin, submitted_at DESC, id DESC);

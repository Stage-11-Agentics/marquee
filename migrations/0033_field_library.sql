-- MRQ-236 — event-scoped reusable form questions.
-- Definitions are copied into form_fields; a placement never references a
-- mutable definition for its answer or public-form behavior.
CREATE TABLE field_library (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT,
  type TEXT NOT NULL CHECK (
    type IN (
      'short_text', 'long_text', 'single_select', 'multi_select',
      'url', 'email', 'file', 'number', 'date'
    )
  ),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  condition TEXT CHECK (condition IS NULL OR json_valid(condition)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(event_id, key)
);

ALTER TABLE form_fields ADD COLUMN library_field_id TEXT REFERENCES field_library(id);
ALTER TABLE form_fields ADD COLUMN library_field_version INTEGER
  CHECK (library_field_version IS NULL OR library_field_version >= 1);

CREATE INDEX idx_field_library_event_label
  ON field_library(event_id, label COLLATE NOCASE, id);
CREATE INDEX idx_field_library_event_key
  ON field_library(event_id, key);
CREATE INDEX idx_form_fields_library
  ON form_fields(library_field_id, form_id);

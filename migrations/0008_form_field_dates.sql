-- MRQ-95 — add a date-only form field type.
-- Earlier migrations are immutable. SQLite cannot alter a CHECK constraint,
-- and submission_answers references form_fields, so rebuild both tables while
-- retaining their rows, indexes, and foreign-key relationship.

CREATE TABLE form_fields_new (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id),
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
  position INTEGER NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  condition TEXT CHECK (condition IS NULL OR json_valid(condition)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

INSERT INTO form_fields_new SELECT * FROM form_fields;

CREATE TABLE submission_answers_new (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  field_id TEXT NOT NULL REFERENCES form_fields_new(id),
  value_text TEXT,
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (value_text IS NOT NULL OR value_json IS NOT NULL)
);

INSERT INTO submission_answers_new SELECT * FROM submission_answers;

DROP TABLE submission_answers;
DROP TABLE form_fields;

ALTER TABLE form_fields_new RENAME TO form_fields;
ALTER TABLE submission_answers_new RENAME TO submission_answers;

CREATE UNIQUE INDEX uq_form_fields_form_key ON form_fields(form_id, key);
CREATE INDEX idx_form_fields_form_position ON form_fields(form_id, position);
CREATE UNIQUE INDEX uq_submission_answers_submission_field
  ON submission_answers(submission_id, field_id);
CREATE INDEX idx_submission_answers_field_submission
  ON submission_answers(field_id, submission_id);

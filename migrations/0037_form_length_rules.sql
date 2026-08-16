-- MRQ-246: combined character budgets belong to one form, not to one field.
CREATE TABLE form_length_rules (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_keys TEXT NOT NULL CHECK (json_valid(field_keys)),
  max_chars INTEGER NOT NULL CHECK (max_chars > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_form_length_rules_form_order
  ON form_length_rules(form_id, sort_order, id);

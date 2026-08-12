-- MRQ-108 — scorecard criteria carry a field type.
-- A criterion was name + weight, which made every scorecard a bank of numeric
-- sliders. A real review scorecard mixes numeric ratings, a recommendation
-- dropdown, and free-text comments. Earlier migrations are immutable and SQLite
-- cannot add a CHECK constraint via ALTER TABLE, so rebuild the table while
-- retaining its rows, its foreign key, and its unique round/position index.
--
-- Weights stay a numeric-only concept: select and text criteria carry weight 0
-- and are exempt from the total-100 rule the API enforces.

CREATE TABLE rubric_criteria_new (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'numeric' CHECK (kind IN ('numeric', 'select', 'text')),
  options TEXT CHECK (options IS NULL OR json_valid(options)),
  scale_min REAL,
  scale_max REAL,
  weight_pct REAL NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (weight_pct >= 0 AND weight_pct <= 100),
  CHECK (position >= 0),
  CHECK (scale_min IS NULL OR scale_max IS NULL OR scale_min < scale_max)
);

INSERT INTO rubric_criteria_new (
  id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at
)
SELECT id, round_id, name, 'numeric', NULL, NULL, NULL, weight_pct, position, created_at, updated_at
FROM rubric_criteria;

DROP TABLE rubric_criteria;

ALTER TABLE rubric_criteria_new RENAME TO rubric_criteria;

CREATE UNIQUE INDEX uq_rubric_criteria_round_position
  ON rubric_criteria(round_id, position);

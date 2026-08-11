-- MRQ-75 / M-64 — the embed dialog widens from two kinds to four.
-- 0001 through 0006 are immutable. SQLite cannot ALTER a CHECK constraint,
-- so the table is rebuilt; `embeds` carries zero rows in every environment
-- (no code path writes to it yet — the public embed routes resolve kind and
-- config from the slug/query string, not from a stored row), so this is a
-- pure schema widen with nothing to migrate.

CREATE TABLE embeds_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('agenda', 'sessions', 'speakers', 'cfp')),
  slug TEXT NOT NULL,
  config TEXT NOT NULL CHECK (json_valid(config)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO embeds_new SELECT * FROM embeds;

DROP TABLE embeds;

ALTER TABLE embeds_new RENAME TO embeds;

CREATE UNIQUE INDEX uq_embeds_slug ON embeds(slug);
CREATE INDEX idx_embeds_event_kind ON embeds(event_id, kind);

-- People: the org-level annotations log, and saved Lists.
--
-- ONE append-only table carries notes, tags, the sourcing pipeline's current
-- stage, and the stage history — deliberately, not for economy. Because
-- `person_events` is append-only:
--
--   * the stage HISTORY is free: every earlier `stage` row is the log, so there
--     is no second table to keep in step with the first.
--   * the ACTIVITY FEED is free — the table already is one, in order.
--   * a note can never disagree with "the notes table" — there is one table.
--
-- Current state is a fold over the log, never a stored column:
--
--   kind='note'   value_json {"body": "…"}
--   kind='tag'    value_json {"tag":"AI","op":"add"|"remove"}
--                 → a person carries a tag when the LATEST row for that
--                   (person, tag) says `add`.
--   kind='stage'  value_json {"stage":"identified","score":85,"rationale":"…"}
--                 → the current stage is the LATEST `stage` row; everything
--                   before it is the timestamped history the card detail shows.
--
-- Everything here is org-scoped, keyed on `person_id`, and NEVER on an
-- event-scoped roster row: one person is Confirmed at one conference and
-- Invited at another, and a note about the human belongs to the human.
CREATE TABLE person_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL CHECK (kind IN ('note', 'tag', 'stage')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  actor_person_id TEXT REFERENCES people(id),
  created_at INTEGER NOT NULL
);

-- The drawer reads one person's whole log; the list folds tags and stages for a
-- page of people. Both are (person_id, kind) lookups walked newest-first.
CREATE INDEX idx_person_events_person_kind ON person_events (person_id, kind, created_at DESC);
CREATE INDEX idx_person_events_org_kind ON person_events (org_id, kind, created_at DESC);

-- A List is a named group an organizer addresses more than once.
--
--   kind='live'   config_json is a saved filter. Anyone who newly matches joins.
--   kind='fixed'  config_json records how it was made; membership is the rows in
--                 person_list_members and nothing else.
--
-- Same idea as `saved_views`, for people instead of abstracts — and the reason
-- this is a sibling table rather than a reuse: `saved_views` is event-scoped and
-- submission-shaped, and a list of people is neither.
CREATE TABLE person_lists (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'fixed')),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  created_by TEXT REFERENCES people(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_person_lists_org_name ON person_lists (org_id, name);

CREATE TABLE person_list_members (
  list_id TEXT NOT NULL REFERENCES person_lists(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, person_id)
);

CREATE INDEX idx_person_list_members_person ON person_list_members (person_id);

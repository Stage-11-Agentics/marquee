-- MRQ-134 — an Agent evaluator is an ordinary reviewer seat with a bound
-- bearer credential. The person kind is live authority: token resolution
-- checks it again before loading the seat's memberships.

ALTER TABLE people ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'
  CHECK (kind IN ('human', 'agent'));

ALTER TABLE api_tokens ADD COLUMN acts_as_person_id TEXT REFERENCES people(id);

CREATE INDEX idx_api_tokens_acts_as
  ON api_tokens(acts_as_person_id)
  WHERE acts_as_person_id IS NOT NULL;

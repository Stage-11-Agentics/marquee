-- MRQ-286 — an event-scoped helper seat for a speaker.
--
-- `helper_name` is the name the speaker typed into the invite. It is not a
-- projection of the helper's organization-level people record: the speaker
-- portal must never turn an email lookup into an identity oracle. A removed
-- row remains as history so re-adding the same person reactivates the pair and
-- task attribution can still explain who completed work before removal.
CREATE TABLE speaker_helpers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  speaker_person_id TEXT NOT NULL REFERENCES people(id),
  helper_person_id TEXT NOT NULL REFERENCES people(id),
  helper_name TEXT NOT NULL CHECK (length(trim(helper_name)) > 0),
  added_by TEXT NOT NULL REFERENCES people(id),
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  CHECK (speaker_person_id <> helper_person_id)
);

CREATE UNIQUE INDEX uq_speaker_helpers_pair
  ON speaker_helpers(event_id, speaker_person_id, helper_person_id);

CREATE INDEX idx_speaker_helpers_active_helper
  ON speaker_helpers(event_id, helper_person_id, speaker_person_id)
  WHERE removed_at IS NULL;

CREATE INDEX idx_speaker_helpers_active_speaker
  ON speaker_helpers(event_id, speaker_person_id, helper_person_id)
  WHERE removed_at IS NULL;

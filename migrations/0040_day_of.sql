-- MRQ-285: the day of the show.
--
-- Two tables, and the first one is deliberately not two.
--
-- The crew's green-room share link and a volunteer's named check-in link are
-- the same object — an event-scoped, named, revocable credential that belongs
-- to nobody — differing only in what the holder may do when they arrive. Split
-- across two tables they would need two door resolvers, two revocation paths,
-- and two audit vocabularies, and the second of each is where the drift lives.
-- `kind` is the authority: `green_room` reads, `checkin` reads and marks.
--
-- They are not `magic_links` rows for the opposite reason: every purpose in
-- that table names a person and is spent or expires, while these have a name
-- an organizer wrote ("Sam, front door"), no person at all, no expiry, and a
-- revocation that must kill every copy of the URL at once.
CREATE TABLE day_of_links (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('green_room', 'checkin')),
  -- What the organizer calls this link, and what every mark it makes is
  -- stamped with. A credential nobody can name is a credential nobody dares
  -- revoke.
  name TEXT NOT NULL,
  -- SHA-256 hex of the token. The raw value exists in the response that minted
  -- it and nowhere else, exactly as `magic_links` and `api_tokens` hold theirs.
  token_hash TEXT NOT NULL,
  created_by_person_id TEXT REFERENCES people(id),
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_day_of_links_token ON day_of_links(token_hash);
CREATE INDEX idx_day_of_links_event ON day_of_links(event_id, kind, created_at DESC);

-- One row per speaker per session — never per person per day.
--
-- A panel of four is four arrivals, and the crew asking "is this session ready"
-- needs "2 of 4" rather than a person-level flag that says yes because someone
-- with the same name walked in for a different talk two hours earlier. The
-- unique index is that grain, enforced: a double tap on the volunteer's phone
-- cannot write the same arrival twice.
--
-- Unmarking deletes the row. `audit_log` already keeps the mark and the unmark
-- with the link's name and the minute, so a tombstone column here would be a
-- second, weaker copy of a history that is written anyway.
CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- The link that marked it, kept for the stamp the green room shows. Null
  -- when an organizer marked it from their own session, and null again if the
  -- link row is ever deleted — `marked_by_name` is the copy that survives,
  -- because "who said this person is here" must not become unanswerable.
  link_id TEXT REFERENCES day_of_links(id) ON DELETE SET NULL,
  marked_by_name TEXT NOT NULL,
  marked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_checkins_item_person ON checkins(agenda_item_id, person_id);
CREATE INDEX idx_checkins_event_marked ON checkins(event_id, marked_at DESC);

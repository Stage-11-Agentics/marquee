-- MRQ-208 — the attendee side of a conference: an anonymous demand signal, an
-- opt-in email claim, and attendees as people in the CRM.
--
-- Three rules from the design (sequence/attendee-schedule-design.md §7) are
-- visible in the shapes below.
--
-- Attendees are `people` rows plus an event-scoped join. `participations` is
-- deliberately not reused: it is submission-scoped, and an attendee has no
-- submission. `memberships` is not touched at all, so there is no roles
-- CHECK-rebuild and no grants change — and the 0012 people machinery (notes,
-- tags, lists) applies to attendees the day this lands, with no new UI.
--
-- Stars stay anonymous forever. A beacon row is (event, session, device) and
-- carries no person, no IP, and no time-of-day beyond the row's own created_at.
-- Identity exists only at a verified claim, and only because someone typed
-- their address and then opened the mail.
--
-- Nothing here expires. Codes and feeds persist past the conference (round-4
-- ruling): a feed that goes quiet beats a calendar that breaks.

-- The event-scoped attendance join. `source` separates the two ways a person
-- becomes an attendee, and the unique index is on (person, event, source)
-- rather than (person, event) precisely so an imported ticket-holder who then
-- claims their own schedule holds one row of each — unlinking the claim leaves
-- the organizer's import untouched.
CREATE TABLE event_attendances (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  source TEXT NOT NULL CHECK (source IN ('import', 'claim')),
  schedule_code TEXT,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (source <> 'import' OR schedule_code IS NULL)
);

CREATE UNIQUE INDEX uq_event_attendances_person_event_source
  ON event_attendances (person_id, event_id, source);
CREATE INDEX idx_event_attendances_event_source
  ON event_attendances (event_id, source);

-- The demand beacon. The primary key IS the idempotence: starring twice writes
-- the same row, unstarring deletes it, and the count is a row count.
CREATE TABLE session_star_beacons (
  event_id TEXT NOT NULL REFERENCES events(id),
  session_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, device_hash)
);

-- Wide enough to cover the demand aggregate's GROUP BY, which is the query on
-- the public agenda's hot path: (event_id) alone plans a temp B-tree for every
-- render (R7).
CREATE INDEX idx_session_star_beacons_event ON session_star_beacons (event_id, session_id, device_hash);

-- The email↔code linkage. It exists from the moment the mail is requested, so
-- a pending claim is a real row an organizer never sees: `verified_at` is what
-- promotes it into the CRM, and only opening the mailed link sets it.
--
-- `minted_person` records whether this claim is what created the person row.
-- It is the difference between unlink removing someone the organizer imported
-- and unlink removing only what the attendee themselves brought into being.
CREATE TABLE schedule_claims (
  code TEXT PRIMARY KEY REFERENCES public_schedules(code),
  event_id TEXT NOT NULL REFERENCES events(id),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  -- The write key, in the clear, for as long as this claim lives.
  --
  -- The mail has to be able to hand a new device write access — that is the
  -- recovery gap the claim exists to close — but the composed mail body lives
  -- in `outbox`, which organizers can list. A credential that opens somebody's
  -- schedule must not sit in a table the conference staff can read, so the mail
  -- carries only the verification token and this column carries the key, handed
  -- to whoever presents that token. No API surface selects it, and unlinking
  -- deletes the row. `public_schedules` still stores only the hash.
  pending_write_key TEXT,
  -- A read-only handle for the owner's own calendar feed.
  --
  -- The pins ride the ICS set by ruling, and the webcal URL is derivable from
  -- the share code — so without a second handle, handing a friend a share link
  -- would also tell them which sessions their friend is speaking at. This token
  -- goes in the owner's feed URL and nowhere else; a caller with only the code
  -- gets the picks, exactly as a read-only link should.
  feed_token TEXT,
  person_id TEXT REFERENCES people(id),
  minted_person INTEGER NOT NULL DEFAULT 0 CHECK (minted_person IN (0, 1)),
  requested_at INTEGER NOT NULL,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (verified_at IS NULL OR person_id IS NOT NULL)
);

CREATE INDEX idx_schedule_claims_token ON schedule_claims (token_hash);
CREATE INDEX idx_schedule_claims_event ON schedule_claims (event_id);

-- A schedule created by this site's own module carries the device that owns
-- it, so the code and that device's beacon rows are one voice in the aggregate
-- rather than two. A schedule created by an agent has no device and counts as
-- one — which is the ruled semantics, not an accident of nullability.
ALTER TABLE public_schedules ADD COLUMN device_hash TEXT;

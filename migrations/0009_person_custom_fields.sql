-- Speaker roster: person logistics fields, and a status for the person↔event
-- membership itself.
--
-- `people.custom_fields` is person-scoped on purpose. A speaker's dietary
-- requirement or arrival window follows the person across conferences; putting
-- it on the membership would make an organizer re-enter it every year, which is
-- the CRM shape this product wants to layer on cleanly later.
--
-- `memberships.confirmation_status` answers a question `participations` cannot:
-- "is this person confirmed for the conference?" before any session exists. It
-- deliberately reuses the participation vocabulary (pending | confirmed |
-- declined, with "Invited" rendered as pending + `invited_at`) so the roster
-- badge and the per-session chips speak one language. Precedence between the
-- two lives in one place — `rollupSpeakerStatus` in `speakers.queries.ts` —
-- and the organizer override writes both in one batch, so they cannot diverge.
ALTER TABLE people ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(custom_fields));

ALTER TABLE memberships ADD COLUMN confirmation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (confirmation_status IN ('pending', 'confirmed', 'declined'));

ALTER TABLE memberships ADD COLUMN confirmed_at INTEGER;

ALTER TABLE memberships ADD COLUMN invited_at INTEGER;

-- The roster reads memberships by (event, role) on every list; the seed's three
-- rows never needed an index and the runtime bridge now writes one per accepted
-- speaker.
CREATE INDEX IF NOT EXISTS idx_memberships_event_role ON memberships (event_id, role);

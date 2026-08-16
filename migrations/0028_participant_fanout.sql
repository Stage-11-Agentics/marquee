-- Who a task template is for, and who a public submission says is presenting.
--
-- Two columns, one subject: the product understood that a submission carries
-- several people in several roles everywhere except the two places where that
-- knowledge does work — the task fan-out and the public form.
--
-- `applies_to_roles` is a JSON array of participation roles. "Upload your
-- slides" goes to everyone on stage; "Sign the speaker release" goes to whom
-- the organizer says. The default is the four on-stage roles, which is exactly
-- the population the fan-out already widened to, so an existing conference
-- keeps its current behaviour with no backfill and no organizer decision.
--
-- SQLite cannot add a CHECK to an existing table without rebuilding it, and a
-- rebuild of `task_templates` would relocate every speaker task's FK for a
-- constraint the writers already enforce. `readTaskAppliesToRoles` is the
-- narrowing read: an absent, malformed, or empty value reads as the default
-- rather than as "nobody", because a template that silently reaches no one is
-- the one failure an organizer cannot see.
ALTER TABLE task_templates
  ADD COLUMN applies_to_roles TEXT NOT NULL
  DEFAULT '["speaker","co_speaker","moderator","chairperson"]';

-- The participant roster a public submission was filled in with, including the
-- on-behalf-of disclosure, held on the submission so a resumed draft restores
-- the people the submitter had already named.
--
-- It is not `submission_answers`: those rows are keyed by `form_fields.id`, so
-- a repeatable list can only live there as a fixed pair of columns per slot —
-- which is precisely the `speaker_*` / `co_speaker_*` convention this replaces.
-- Participations remain the record; this is the intake material they are
-- reconciled from, and it stays readable afterwards so an organizer can see
-- what the submitter actually typed.
ALTER TABLE submissions ADD COLUMN participants_json TEXT;

-- A membership row is a SEAT at this event, not a claim to be a speaker
-- (operator ruling, 2026-08-16).
--
-- That row is what gates speaker-portal sign-in, headshot ownership, the
-- onboarding person list and the comms audience, so every accepted on-stage
-- role has to have one — and the acceptance cascade now writes one for
-- moderators and chairpersons too. But `memberships.role` only admitted
-- 'speaker', so seating a moderator meant calling them a speaker, and the
-- speaker roster reads this table. Portal access would have implied a roster
-- row, which is the one thing the roster must not say.
--
-- Widening the vocabulary is what lets the two facts separate: the row records
-- the role the seat was earned in, surfaces that mean "speaker" filter on that
-- role, and surfaces that mean "has a seat here" filter on the on-stage set.
-- `participations.role` is the vocabulary being mirrored, minus the two roles
-- that never earn an event seat: a `submitter` who is not on stage holds no
-- seat, and a `sponsor_contact` is seated through its sponsorship.
--
-- SQLite cannot alter a CHECK in place, so this is the table rebuild. The new
-- table reproduces the live shape exactly — column order, both CHECKs, all
-- three foreign keys, and the three columns added after `0001_init` — with the
-- role list as the single difference. `memberships` has no dependent foreign
-- keys and no triggers, so the drop is safe; all six indexes are recreated
-- below because a rename does not carry them.
CREATE TABLE memberships_0028_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  event_id TEXT REFERENCES events(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (
    role IN (
      'owner', 'program_lead', 'ops', 'reviewer',
      'speaker', 'co_speaker', 'moderator', 'chairperson'
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'confirmed', 'declined')),
  confirmed_at INTEGER,
  invited_at INTEGER,
  CHECK (role <> 'reviewer' OR event_id IS NOT NULL)
);

INSERT INTO memberships_0028_new
  (id, org_id, event_id, person_id, role, created_at, updated_at,
   confirmation_status, confirmed_at, invited_at)
SELECT id, org_id, event_id, person_id, role, created_at, updated_at,
       confirmation_status, confirmed_at, invited_at
  FROM memberships;

DROP TABLE memberships;

ALTER TABLE memberships_0028_new RENAME TO memberships;

CREATE UNIQUE INDEX uq_memberships_event
  ON memberships(org_id, event_id, person_id, role)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_memberships_org
  ON memberships(org_id, person_id, role)
  WHERE event_id IS NULL;
CREATE INDEX idx_memberships_person_event_role
  ON memberships(person_id, event_id, role);
CREATE INDEX idx_memberships_org_event_role
  ON memberships(org_id, event_id, role);
CREATE INDEX idx_memberships_event_role ON memberships (event_id, role);
CREATE INDEX idx_memberships_role_org ON memberships(role, org_id);

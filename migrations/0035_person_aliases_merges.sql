-- MRQ-235 — people identity continuity, durable merge receipts, and deletion guards.
--
-- A merge deletes only the retired people row.  The alias and receipt retain
-- the historical identity without pretending that a historical id is a live
-- foreign-key owner.  The receipt is deliberately org-scoped and eventless:
-- event deletion may block its undo, but must not delete its history.

CREATE TABLE person_merges (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  idempotency_key TEXT NOT NULL,
  retired_person_id TEXT NOT NULL,
  survivor_person_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'clean'
    CHECK (status IN ('clean', 'undone', 'undo_blocked')),
  retired_snapshot_json TEXT NOT NULL CHECK (json_valid(retired_snapshot_json)),
  survivor_before_json TEXT NOT NULL CHECK (json_valid(survivor_before_json)),
  survivor_after_json TEXT NOT NULL CHECK (json_valid(survivor_after_json)),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  alias_changes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alias_changes_json)),
  movement_receipts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(movement_receipts_json)),
  event_scope_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(event_scope_json)),
  undo_result_json TEXT CHECK (undo_result_json IS NULL OR json_valid(undo_result_json)),
  undo_reason TEXT,
  activity_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_person_merges_org_idempotency
  ON person_merges(org_id, idempotency_key);
CREATE INDEX idx_person_merges_org_retired
  ON person_merges(org_id, retired_person_id, created_at);
CREATE INDEX idx_person_merges_org_survivor
  ON person_merges(org_id, survivor_person_id, created_at);

CREATE TABLE person_aliases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  merge_id TEXT NOT NULL REFERENCES person_merges(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_person_aliases_org_email
  ON person_aliases(org_id, lower(email));
CREATE INDEX idx_person_aliases_person
  ON person_aliases(person_id, created_at, id);
CREATE INDEX idx_person_aliases_merge
  ON person_aliases(merge_id, created_at, id);

-- An alias is a current identity pointer, never a cross-tenant join.  The
-- service checks these conditions before its batch; the triggers make the
-- invariant durable for imports, tests, and future writers too.
CREATE TRIGGER person_aliases_org_insert
BEFORE INSERT ON person_aliases
WHEN EXISTS (
  SELECT 1 FROM people
   WHERE people.id = NEW.person_id
     AND people.org_id <> NEW.org_id
)
BEGIN
  SELECT RAISE(ABORT, 'person_alias_org_mismatch');
END;

CREATE TRIGGER person_aliases_org_update
BEFORE UPDATE OF org_id, person_id ON person_aliases
WHEN EXISTS (
  SELECT 1 FROM people
   WHERE people.id = NEW.person_id
     AND people.org_id <> NEW.org_id
)
BEGIN
  SELECT RAISE(ABORT, 'person_alias_org_mismatch');
END;

CREATE TRIGGER person_aliases_active_email_insert
BEFORE INSERT ON person_aliases
WHEN EXISTS (
  SELECT 1 FROM people
   WHERE people.org_id = NEW.org_id
     AND lower(people.email) = lower(NEW.email)
     AND people.id <> NEW.person_id
)
BEGIN
  SELECT RAISE(ABORT, 'person_alias_active_email_collision');
END;

CREATE TRIGGER person_aliases_active_email_update
BEFORE UPDATE OF org_id, email, person_id ON person_aliases
WHEN EXISTS (
  SELECT 1 FROM people
   WHERE people.org_id = NEW.org_id
     AND lower(people.email) = lower(NEW.email)
     AND people.id <> NEW.person_id
)
BEGIN
  SELECT RAISE(ABORT, 'person_alias_active_email_collision');
END;

-- This is the last line of defence for every lifecycle that removes a person.
-- Keep the SQL in lock-step with src/lib/person-references.ts and the five
-- explicit polymorphic families below.  Calendar cancellations are omitted on
-- purpose: they retain a self-contained historical person snapshot.
CREATE TRIGGER people_delete_guard
BEFORE DELETE ON people
WHEN
  EXISTS (SELECT 1 FROM memberships WHERE memberships.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM magic_links WHERE magic_links.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM api_tokens WHERE api_tokens.created_by = OLD.id OR api_tokens.acts_as_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM form_admins WHERE form_admins.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM outbox WHERE outbox.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM submissions WHERE submissions.submitter_person_id = OLD.id OR submissions.decided_by_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM submission_decisions WHERE submission_decisions.decided_by_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM saved_views WHERE saved_views.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM participations WHERE participations.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM committee_members WHERE committee_members.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM reviewer_track_scopes WHERE reviewer_track_scopes.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM round_assignments WHERE round_assignments.reviewer_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM evaluations WHERE evaluations.reviewer_person_id = OLD.id OR evaluations.override_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM comparisons WHERE comparisons.reviewer_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM round_promotions WHERE round_promotions.promoted_by = OLD.id)
  OR EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.person_id = OLD.id OR speaker_tasks.completed_by_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM calendar_invites WHERE calendar_invites.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM file_comments WHERE file_comments.author_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM person_events WHERE person_events.person_id = OLD.id OR person_events.actor_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM person_lists WHERE person_lists.created_by = OLD.id)
  OR EXISTS (SELECT 1 FROM person_list_members WHERE person_list_members.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM event_attendances WHERE event_attendances.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM schedule_claims WHERE schedule_claims.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sponsorship_contacts WHERE sponsorship_contacts.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM mirror_credentials WHERE mirror_credentials.set_by_person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM person_aliases WHERE person_aliases.person_id = OLD.id)
  OR EXISTS (SELECT 1 FROM people other WHERE other.id <> OLD.id AND other.headshot_attachment_id = OLD.headshot_attachment_id AND OLD.headshot_attachment_id IS NOT NULL)
  OR EXISTS (SELECT 1 FROM attachments WHERE attachments.owner_type = 'person_headshot' AND attachments.owner_id = OLD.id)
  OR EXISTS (
    SELECT 1
      FROM forms
     WHERE json_valid(forms.admin_notify_person_ids)
       AND EXISTS (SELECT 1 FROM json_each(forms.admin_notify_person_ids) WHERE json_each.value = OLD.id)
  )
  OR EXISTS (
    SELECT 1
      FROM import_rows
      JOIN imports ON imports.id = import_rows.import_id
      JOIN events ON events.id = imports.event_id
     WHERE import_rows.target_id = OLD.id
       AND import_rows.entity IN ('person', 'speaker')
       AND events.org_id = OLD.org_id
  )
  OR EXISTS (
    SELECT 1 FROM mirror_outbox
     WHERE mirror_outbox.table_name IN ('people', 'person')
       AND mirror_outbox.row_id = OLD.id
  )
  OR EXISTS (
    SELECT 1 FROM audit_log
     WHERE audit_log.entity_type = 'person'
       AND audit_log.entity_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'person_references_remaining');
END;

-- 0025 made set_by_person_id mandatory.  A credential survives removal of the
-- person who configured it; NULL means the historical setter is no longer in
-- the organization, not that another person configured it.
CREATE TABLE mirror_credentials_0035_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  token_ciphertext TEXT NOT NULL,
  webhook_secret_ciphertext TEXT,
  token_fingerprint TEXT NOT NULL,
  base_id TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  set_by_person_id TEXT REFERENCES people(id),
  last_verified_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO mirror_credentials_0035_new (
  id, org_id, token_ciphertext, webhook_secret_ciphertext, token_fingerprint,
  base_id, set_at, set_by_person_id, last_verified_at, last_error, created_at,
  updated_at
)
SELECT id, org_id, token_ciphertext, webhook_secret_ciphertext, token_fingerprint,
       base_id, set_at, set_by_person_id, last_verified_at, last_error, created_at,
       updated_at
  FROM mirror_credentials;

DROP TABLE mirror_credentials;
ALTER TABLE mirror_credentials_0035_new RENAME TO mirror_credentials;
CREATE UNIQUE INDEX uq_mirror_credentials_org ON mirror_credentials(org_id);
CREATE INDEX idx_mirror_credentials_org ON mirror_credentials(org_id);

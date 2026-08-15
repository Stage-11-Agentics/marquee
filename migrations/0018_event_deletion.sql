-- MRQ-204 — a deleted conference still has an audit history.
--
-- `audit_log.event_id` identifies the conference an action belonged to; it is
-- intentionally not a parent-child lifetime constraint.  The deletion row is
-- written in the same batch as the event delete, so retaining the id here is
-- what makes the deletion auditable after the parent is gone.
-- D1 runs a migration as one transaction. The attachment rebuild temporarily
-- removes and restores rows that people, tasks, and file comments reference
-- defer those checks until the replacement table is in place so an existing
-- populated conference migrates with the same referential integrity as a
-- fresh install.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  actor_person_id TEXT REFERENCES people(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'api_token', 'system', 'airtable')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at INTEGER NOT NULL,
  request_id TEXT
);

INSERT INTO audit_log_new (
  id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id,
  before_json, after_json, created_at, request_id
)
SELECT id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id,
  before_json, after_json, created_at, request_id
FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX idx_audit_event_created ON audit_log(event_id, created_at);
CREATE INDEX idx_audit_entity_created ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_actor_created ON audit_log(actor_person_id, created_at);
CREATE INDEX idx_audit_request ON audit_log(request_id, created_at);

-- Portal credentials are event-scoped even though older magic-link rows did
-- not carry the event that minted them.  Backfill the unambiguous outbox and
-- eventId cases, and have new writers supply event_id directly.
CREATE TABLE magic_links_0018_new (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  event_id TEXT REFERENCES events(id),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('login', 'draft_resume', 'cospeaker_profile', 'task_link', 'claim', 'org_invite')
  ),
  redirect_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (purpose IN ('claim', 'org_invite') AND person_id IS NULL)
    OR (purpose NOT IN ('claim', 'org_invite') AND person_id IS NOT NULL)
  )
);

INSERT INTO magic_links_0018_new (
  id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at,
  created_at, updated_at
)
SELECT link.id, link.token_hash, link.person_id,
  COALESCE(
    (SELECT queued.event_id FROM outbox queued
     WHERE queued.entity_id = link.id
       AND (link.redirect_to LIKE '/portal%'
         OR link.redirect_to LIKE '/reviewer%'
         OR link.redirect_to LIKE '/co-speaker%'
         OR link.redirect_to LIKE '/task%')
     ORDER BY queued.created_at DESC LIMIT 1),
    (SELECT conference.id FROM events conference WHERE link.redirect_to LIKE '%eventId=' || conference.id || '%' ORDER BY conference.created_at DESC LIMIT 1)
  ),
  link.purpose, link.redirect_to, link.expires_at, link.used_at, link.created_at, link.updated_at
FROM magic_links link;

DROP TABLE magic_links;
ALTER TABLE magic_links_0018_new RENAME TO magic_links;

CREATE UNIQUE INDEX uq_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_event_created ON magic_links(event_id, created_at);

-- The rebuild below drops `attachments` while `people.headshot_attachment_id`,
-- `speaker_tasks.attachment_id` and `file_comments.attachment_id` still point
-- into it.  `defer_foreign_keys` postpones those checks to COMMIT, but SQLite
-- settles them from a violation *counter*, not a rescan: `DROP TABLE` counts
-- one violation per referencing row and the later `RENAME` never discounts
-- them, so COMMIT fails even though `PRAGMA foreign_key_check` is clean.  The
-- counter only leaves zero when no child row references the table at the
-- moment it is dropped -- which is why an empty database migrates and a
-- populated one does not.  Park the references, rebuild, then put them back.
CREATE TABLE attachments_fk_parked (
  child_table TEXT NOT NULL,
  child_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL
);
INSERT INTO attachments_fk_parked SELECT 'people', id, headshot_attachment_id FROM people WHERE headshot_attachment_id IS NOT NULL;
INSERT INTO attachments_fk_parked SELECT 'speaker_tasks', id, attachment_id FROM speaker_tasks WHERE attachment_id IS NOT NULL;
INSERT INTO attachments_fk_parked SELECT 'file_comments', id, attachment_id FROM file_comments WHERE attachment_id IS NOT NULL;

UPDATE people SET headshot_attachment_id = NULL WHERE headshot_attachment_id IS NOT NULL;
UPDATE speaker_tasks SET attachment_id = NULL WHERE attachment_id IS NOT NULL;
UPDATE file_comments SET attachment_id = NULL WHERE attachment_id IS NOT NULL;

-- `person_headshot` attachments are organization-level subjects in the
-- product model even though the original table required an event_id.  Make
-- that existing wart survivable without introducing a second attachment
-- concept: the event-scoped rows are deleted, and preserved headshots are
-- detached from the deleted event by the shared cascade.
CREATE TABLE attachments_new (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id),
  owner_type TEXT NOT NULL CHECK (
    owner_type IN (
      'person_headshot', 'task_upload', 'event_logo', 'import_file',
      'draft_file', 'submission_file'
    )
  ),
  owner_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  sha256 TEXT,
  r2_etag TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (size_bytes >= 0),
  CHECK (status <> 'ready' OR r2_etag IS NOT NULL)
);

INSERT INTO attachments_new (
  id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes,
  status, sha256, r2_etag, created_at, updated_at
)
SELECT id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes,
  status, sha256, r2_etag, created_at, updated_at
FROM attachments;

DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;

CREATE UNIQUE INDEX uq_attachments_r2_key ON attachments(r2_key);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);
CREATE INDEX idx_attachments_draft_files ON attachments(owner_id, created_at)
  WHERE owner_type = 'draft_file';
CREATE INDEX idx_attachments_submission_files ON attachments(owner_id, created_at)
  WHERE owner_type = 'submission_file';
CREATE INDEX idx_attachments_event_status_created ON attachments(event_id, status, created_at);

UPDATE people SET headshot_attachment_id = (
  SELECT parked.attachment_id FROM attachments_fk_parked parked
  WHERE parked.child_table = 'people' AND parked.child_id = people.id
) WHERE id IN (SELECT child_id FROM attachments_fk_parked WHERE child_table = 'people');

UPDATE speaker_tasks SET attachment_id = (
  SELECT parked.attachment_id FROM attachments_fk_parked parked
  WHERE parked.child_table = 'speaker_tasks' AND parked.child_id = speaker_tasks.id
) WHERE id IN (SELECT child_id FROM attachments_fk_parked WHERE child_table = 'speaker_tasks');

UPDATE file_comments SET attachment_id = (
  SELECT parked.attachment_id FROM attachments_fk_parked parked
  WHERE parked.child_table = 'file_comments' AND parked.child_id = file_comments.id
) WHERE id IN (SELECT child_id FROM attachments_fk_parked WHERE child_table = 'file_comments');

DROP TABLE attachments_fk_parked;

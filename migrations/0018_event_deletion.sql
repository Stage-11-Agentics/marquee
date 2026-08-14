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
CREATE TABLE magic_links_new (
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

INSERT INTO magic_links_new (
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
ALTER TABLE magic_links_new RENAME TO magic_links;

CREATE UNIQUE INDEX uq_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_event_created ON magic_links(event_id, created_at);

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

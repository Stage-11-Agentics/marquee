-- Speaker portal invitations are a distinct credential from ordinary sign-in.
-- They remain valid for the invitation window and may be opened again during
-- it, while ordinary login links keep their short-lived, single-use semantics.
--
-- 0018 added event_id to magic_links. This later migration is intentionally
-- numbered after it so it can apply to databases where 0018 already landed
-- it preserves that event provenance while widening the purpose CHECK.

CREATE TABLE magic_links_0019_new (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  event_id TEXT REFERENCES events(id),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('login', 'draft_resume', 'cospeaker_profile', 'task_link', 'claim', 'org_invite', 'portal_invite')
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

INSERT INTO magic_links_0019_new (
  id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at,
  created_at, updated_at
)
SELECT id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, used_at,
  created_at, updated_at
FROM magic_links;

DROP TABLE magic_links;

ALTER TABLE magic_links_0019_new RENAME TO magic_links;

CREATE UNIQUE INDEX uq_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_event_created ON magic_links(event_id, created_at);

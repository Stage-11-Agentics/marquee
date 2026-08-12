-- MRQ-105 / M-65 — the cold start needs two token purposes that pre-date the
-- person they will belong to.
--
-- A claim token is minted by the deploy against a database with no people in
-- it at all; an organization invite is minted before the invited organizer
-- exists. Both create their person at exchange. Every other purpose stays
-- person-bound, and that is now enforced by the schema rather than by
-- convention: `person_id` is nullable, but a CHECK makes it non-null for
-- exactly the four purposes that name a person up front.
--
-- 0001 through 0008 are immutable. SQLite cannot ALTER a CHECK constraint or
-- relax a NOT NULL, so the table is rebuilt and its rows copied. Live rows are
-- all person-bound, so the copy satisfies the new CHECK by construction.

CREATE TABLE magic_links_new (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
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

INSERT INTO magic_links_new SELECT * FROM magic_links;

DROP TABLE magic_links;

ALTER TABLE magic_links_new RENAME TO magic_links;

CREATE UNIQUE INDEX uq_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);

-- The unclaimed-instance guard and the organizer list both ask the same
-- question of this table — "who owns this instance" — on the landing page's
-- one read, so it is worth an index rather than a scan.
CREATE INDEX idx_memberships_role_org ON memberships(role, org_id);

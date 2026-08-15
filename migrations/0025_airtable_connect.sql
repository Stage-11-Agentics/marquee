-- MRQ-223: the Airtable connection is tenant-owned state, not a deployment
-- secret. The provider token is encrypted before it reaches this table; the
-- fingerprint is the only token-shaped value a read path may expose.
--
-- The webhook MAC secret is encrypted by the same Worker secret. Airtable
-- returns it when a webhook is registered, and keeping it beside the token
-- makes reconnect/disconnect atomic without putting a provider credential in
-- mirror_state or a plaintext column.
CREATE TABLE mirror_credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  token_ciphertext TEXT NOT NULL,
  webhook_secret_ciphertext TEXT,
  token_fingerprint TEXT NOT NULL,
  base_id TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  set_by_person_id TEXT NOT NULL REFERENCES people(id),
  last_verified_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_mirror_credentials_org ON mirror_credentials(org_id);
CREATE INDEX idx_mirror_credentials_org ON mirror_credentials(org_id);

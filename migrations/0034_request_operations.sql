-- MRQ-237: durable request-level operation records.
--
-- A request operation is the audit seam for an admitted mutation, including a
-- valid selector that resolves to zero rows.  The scope is deliberately typed
-- rather than a polymorphic scope_id so SQLite can enforce tenant ownership.
CREATE UNIQUE INDEX uq_events_id_org_request_scope
  ON events(id, org_id);

CREATE TABLE request_operations (
  operation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('org', 'event')),
  event_id TEXT,
  route TEXT NOT NULL,
  idempotency_key TEXT,
  canonical_fingerprint TEXT NOT NULL,
  canonical_request_json TEXT NOT NULL CHECK (json_valid(canonical_request_json)),
  request_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'api_token', 'system', 'airtable')),
  actor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('in_flight', 'dispatch_pending', 'completed', 'failed')),
  response_status INTEGER,
  response_headers_json TEXT CHECK (response_headers_json IS NULL OR json_valid(response_headers_json)),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  outbox_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(outbox_ids_json)),
  claim_token TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  dispatch_claim_token TEXT,
  dispatch_lease_expires_at INTEGER,
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
  dispatch_next_attempt_at INTEGER,
  dispatch_last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK ((scope_kind = 'org' AND event_id IS NULL)
      OR (scope_kind = 'event' AND event_id IS NOT NULL)),
  FOREIGN KEY (event_id, organization_id)
    REFERENCES events(id, org_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX request_operations_org_key
  ON request_operations(organization_id, route, idempotency_key)
  WHERE scope_kind = 'org' AND event_id IS NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX request_operations_event_key
  ON request_operations(organization_id, event_id, route, idempotency_key)
  WHERE scope_kind = 'event' AND event_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE INDEX idx_request_operations_event_state
  ON request_operations(event_id, state, dispatch_next_attempt_at, created_at);

CREATE INDEX idx_request_operations_org_state
  ON request_operations(organization_id, state, dispatch_next_attempt_at, created_at);

CREATE TABLE request_operation_outbox (
  operation_id TEXT NOT NULL REFERENCES request_operations(operation_id) ON DELETE CASCADE,
  outbox_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  dispatch_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (dispatch_state IN ('pending', 'dispatched')),
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
  dispatched_at INTEGER,
  last_dispatch_error TEXT,
  PRIMARY KEY (operation_id, outbox_id),
  UNIQUE (operation_id, ordinal)
);

CREATE INDEX idx_request_operation_outbox_pending
  ON request_operation_outbox(dispatch_state, operation_id, ordinal);

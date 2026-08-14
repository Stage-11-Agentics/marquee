-- MRQ-211 — the audit log learns to hold an action that belongs to no conference.
--
-- One append-only log, three lenses (org admin, person, submission). The org
-- admin lens is the one the table could not answer: an invite minted, a token
-- issued, an organizer removed, ownership transferred — every one of those
-- belongs to the ORGANIZATION, and `event_id` was `NOT NULL`. Worse, a freshly
-- claimed instance has an organization and zero conferences (`claim` creates
-- the org; the first conference comes later), so there is not even a dishonest
-- event id available to borrow. Writing one would be the beginning of a second
-- log living somewhere else, which is exactly what this ticket exists to avoid.
--
-- SQLite cannot relax a NOT NULL, so the table is rebuilt — the pattern 0007,
-- 0008, 0009 and 0011 already use. Nothing references `audit_log`, so the drop
-- takes no foreign key with it.
--
-- The CHECK is the thing that keeps the substrate whole: a row scoped to
-- neither an organization nor a conference is a row no lens can reach, which is
-- the same as not writing it. Every existing row is event-scoped and backfills
-- its `org_id` from that event, so history predating this column is not
-- stranded outside the org lens.

CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY,
  -- Nullable now, and null means exactly one thing: this action was about the
  -- organization itself, not about anything inside one conference.
  event_id TEXT REFERENCES events(id),
  org_id TEXT REFERENCES organizations(id),
  actor_person_id TEXT REFERENCES people(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'api_token', 'system', 'airtable')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at INTEGER NOT NULL,
  request_id TEXT,
  CHECK (event_id IS NOT NULL OR org_id IS NOT NULL)
);

INSERT INTO audit_log_new
  (id, event_id, org_id, actor_person_id, actor_kind, action, entity_type, entity_id,
   before_json, after_json, created_at, request_id)
SELECT entry.id, entry.event_id,
  (SELECT conference.org_id FROM events conference WHERE conference.id = entry.event_id),
  entry.actor_person_id, entry.actor_kind, entry.action, entry.entity_type, entry.entity_id,
  entry.before_json, entry.after_json, entry.created_at, entry.request_id
FROM audit_log entry;

DROP TABLE audit_log;

ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX idx_audit_event_created ON audit_log(event_id, created_at);
CREATE INDEX idx_audit_entity_created ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_actor_created ON audit_log(actor_person_id, created_at);
CREATE INDEX idx_audit_request ON audit_log(request_id, created_at);

-- The org admin lens reads exactly this: one organization's admin actions,
-- newest first. Without it the lens is a scan of every audit row the instance
-- has ever written, and R7 says a slow list is a defect.
CREATE INDEX idx_audit_org_created ON audit_log(org_id, created_at);

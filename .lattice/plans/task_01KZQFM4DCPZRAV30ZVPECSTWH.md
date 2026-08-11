# MRQ-66: Migration 0003 — speaker_tasks.cancelled_at and the webhook tables

M-61. Third migration, additive only — 0002_venue_geography.sql established the pattern; 0001 and 0002 are merged and immutable.

ADD: ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER. The existing CHECK (status IN ('open','done')) stays exactly as it is — cancellation is a nullable timestamp, NOT a third status value. Rationale is binding and stated in SPEC §3.7: a third enum value leaves every existing status='open' read site silently including cancelled work; a timestamp inverts it into a predicate (cancelled_at IS NULL) so an unconverted read site is loudly wrong in review. Same shape as magic_links.used_at and imports.undone_at.

CREATE: webhook_endpoints (event_id, url https-only, secret_hash, events_json, enabled, created_at, last_delivery_at NULL) and webhook_deliveries (endpoint_id, event_type, payload, status queued|delivered|failed, attempts, response_code NULL, error NULL, created_at, delivered_at NULL) exactly as specified in SPEC §3. Index webhook_deliveries(endpoint_id, created_at).

SCOPE DISCIPLINE: this ticket ships the migration and NOTHING else — no read sites, no UI, no routes. It is split out so M-62 and M-54 can start in parallel behind one merged migration, exactly as MRQ-58 did for venue geography. Do NOT add handbook_pages: the Speaker Handbook is ruled if-capacity and a table with no writer is what SPEC §3 forbids.

Serves AC-264 and AC-241. 1 agent-hour.

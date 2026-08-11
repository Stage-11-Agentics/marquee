# MRQ-66: Migration 0003 — speaker_tasks.cancelled_at and the webhook tables

M-61. Third migration, additive only — 0002_venue_geography.sql established the pattern; 0001 and 0002 are merged and immutable.

ADD: ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER. The existing CHECK (status IN ('open','done')) stays exactly as it is — cancellation is a nullable timestamp, NOT a third status value. Rationale is binding and stated in SPEC §3.7: a third enum value leaves every existing status='open' read site silently including cancelled work; a timestamp inverts it into a predicate (cancelled_at IS NULL) so an unconverted read site is loudly wrong in review. Same shape as magic_links.used_at and imports.undone_at.

CREATE: webhook_endpoints (event_id, url https-only, secret_hash, events_json, enabled, created_at, last_delivery_at NULL) and webhook_deliveries (endpoint_id, event_type, payload, status queued|delivered|failed, attempts, response_code NULL, error NULL, created_at, delivered_at NULL) exactly as specified in SPEC §3. Index webhook_deliveries(endpoint_id, created_at).

SCOPE DISCIPLINE: this ticket ships the migration and NOTHING else — no read sites, no UI, no routes. It is split out so M-62 and M-54 can start in parallel behind one merged migration, exactly as MRQ-58 did for venue geography. Do NOT add handbook_pages: the Speaker Handbook is ruled if-capacity and a table with no writer is what SPEC §3 forbids.

Serves AC-264 and AC-241. 1 agent-hour.

## Execution plan

### Scope and non-goals

- Deliver the additive fifth migration in this checkout. `0003_building_access_note.sql` and `0004_calendar_reversal.sql` already exist, so M-61 lands as `migrations/0005_task_cancellation_webhooks.sql`; 0001 through 0004 remain immutable.
- Add only the cancellation tombstone and outbound webhook persistence seam. Do not add read-site predicates, cancellation/reconciliation writers, webhook routes or queue code, UI, handbook tables, or contract-document edits.
- Keep `speaker_tasks.status` exactly `CHECK (status IN ('open','done'))`; `cancelled_at INTEGER` remains nullable and independent of `completed_at`.
- Encode the ratified Amendment 16 six-event allowlist in both delivery `event_type` validation and the `events_json` array subset check: `submission.created`, `submission.status_changed`, `evaluation.completed`, `speaker_task.completed`, `agenda.published`, and `speaker.confirmed`.

### Implementation

1. Add `migrations/0005_task_cancellation_webhooks.sql` with `ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER`, the exact `webhook_endpoints` and `webhook_deliveries` columns/defaults/foreign keys/status checks from SPEC §3, allowlist validation, and an index on `webhook_deliveries(endpoint_id, created_at)`.
2. Extend `src/db/schema.ts` as the physical-schema mirror: webhook event/status constants and types, immutable row interfaces, the table-name/table-row registries, default-column declarations, and insert aliases. Update the schema verifier's initial 46-table assertion to distinguish immutable 0001 tables from the 48-table applied schema, and require the new named index.
3. Add 0005 to `tests/integration/apply-migrations.ts` so Worker-backed tests run the same complete migration sequence. Add both new tables to `WIPE_ORDER` in child-before-parent order (`webhook_deliveries` before `webhook_endpoints`, both before `events`).
4. Add a focused `tests/node` contract test for migration numbering, the unchanged open/done check, nullable cancellation, the two webhook table shapes, the six-event allowlist, and FK-safe wipe order. Add `tests/ac-claims/MRQ-66.json` with explicit empty `owns`/`exercises` because M-61 supplies schema for AC-241 and AC-264; downstream behavior tickets own the auto criteria.

### Verification and handoff

- Run the targeted migration contract test and `node scripts/schema-verify.mjs`; verify fresh application, re-application idempotence, table/index/column mirror parity, FK behavior, status/event checks, and nullable defaults.
- Run `npm test`, type checks/build through `npm run pr-gate -- --ticket MRQ-66`, and record the gate result before pushing the final implementation commit.
- At each lifecycle boundary refresh `forgejo/master`, record the exact base SHA, keep the worktree-root commit guard, push the branch, and verify local HEAD equals `forgejo/mrq-66-migration`.
- Self-review the final diff at the exact branch HEAD for additive-only scope, no contract edits, no `handbook_pages`, no public/internal leakage, and no status-enum drift. Attach PASS review and validation evidence, create the Forgejo PR against `master`, attach its URL, then transition only to `pr_open` and notify the Orchestrator.

# Code Review: MRQ-66 — Migration 0005 (task cancellation seam + webhook tables)

## 1. Verdict

**PASS** — Implementation is correct, matches the corrected plan, and meets the acceptance criteria it serves (schema seam for AC-241 / AC-264). All findings below are minor; none block merge.

## 2. Summary

Reviewed the additive migration `0005_task_cancellation_webhooks.sql`, its TypeScript schema mirror, the schema-verifier extensions, the test-suite migration wiring, WIPE_ORDER, and the node contract test. The flagged deviation — 0004 already ships `speaker_tasks.cancelled_at`, so 0005 creates only the webhook tables — is correct: I verified `migrations/0004_calendar_reversal.sql` contains `ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER` in this checkout, so a repeat ALTER would indeed fail fresh application. I independently applied the new migration in SQLite and probed every CHECK constraint live (see Verification below); all behave as designed, and the table shapes match SPEC §3 (`webhook_endpoints` / `webhook_deliveries`) and Amendment 16's six-event allowlist exactly. The quality is high; the diff-base staleness noted in issue 3 is the only thing worth confirming on the PR itself.

## 3. Issues

**[MINOR] migrations/0005_task_cancellation_webhooks.sql:12 — `url LIKE 'https://%'` is case-insensitive**
SQLite's `LIKE` is case-insensitive for ASCII, so `HTTPS://…` and `hTtPs://…` pass the check (verified live: an `HTTPS://x` insert succeeds). Per RFC 3986 the scheme is case-insensitive, so this is arguably permissive-correct rather than wrong — but any downstream code that string-compares the scheme (the M-54 delivery producer, the Settings UI) could be surprised.
**Fix:** No DB change required. Either note in the migration comment that the writer normalizes URLs to a lowercase scheme before insert, or tighten to `CHECK (url GLOB 'https://*')` (`GLOB` is case-sensitive) if strict lowercase is wanted. If tightened, do it in this migration before merge — 0005 becomes immutable once merged.

**[MINOR] migrations/0005_task_cancellation_webhooks.sql:14 — `events_json` accepts duplicate entries**
`["submission.created","submission.created"]` passes (allowlisted values, length ≤ 6). SPEC §3 says "subset of the six-event allowlist," which implies distinct members. Enforcing uniqueness in a SQLite CHECK would be disproportionately ugly given the already-explicit per-slot expansion, so leaving dedup to the M-54 writer is reasonable — but the contract should say so.
**Fix:** Add one line to the migration's explanatory comment: dedup is the writer's responsibility; the CHECK enforces membership and length only.

**[MINOR] src/db/schema.ts:2 — header comment is now stale**
The file header still reads "Type mirror for migrations/0001_init.sql," but with this change the mirror deliberately covers the full applied schema (48 tables across 0001–0005) — the diff itself distinguishes "0001's 46 tables" from "the 48-table applied schema" in the verifier.
**Fix:** Update the header to "Type mirror for the applied migration chain (migrations/)" or similar. One line.

**[MINOR] PR scope — the review diff is computed against a stale base; confirm the branch contains only MRQ-66 files**
The diff bundles work already merged to master — MRQ-39's mobile reviewer pass (`src/ui/review/*`, reviewer tests), MRQ-48's speed audit (`scripts/checks/speed.ts`, speed-budget tests), and a large volume of `.lattice/` orchestration state. I verified those changes exist on master today (commits `8aa5db7`, `7ff5f62`), so this is almost certainly diff-base noise rather than branch content, and I reviewed only the MRQ-66 payload: `migrations/0005_task_cancellation_webhooks.sql`, `scripts/schema-verify.mjs`, `src/db/schema.ts`, `src/lib/reset-demo/reseed-demo.ts`, `tests/integration/apply-migrations.ts`, `tests/node/mrq-66-migration.test.mjs`, `tests/ac-claims/MRQ-66.json`.
**Fix:** Before merge, confirm the Forgejo PR's file list contains only those seven files (rebase on current master if not). If the branch genuinely re-touches MRQ-39/48 files or `.lattice` state, that is a scope violation to strip first.

## 4. Positive Observations

- **The overlap deviation was handled exactly right.** Instead of blindly following stale ticket wording, the implementer detected that immutable 0004 already ships `cancelled_at`, measured the duplicate-column failure, preserved 0004 untouched, narrowed 0005 to the webhook tables, and flagged the deviation in the plan. The node contract test then locks all of it in: 0004 owns the ALTER, 0005 must not repeat it, no `'cancelled'` string anywhere, and 0001's `open|done` check is asserted verbatim.
- **SPEC parity is exact.** Both table shapes match SPEC §3 column-for-column (including nullability of `last_delivery_at`, `response_code`, `error`, `delivered_at`), `id TEXT PRIMARY KEY` on `webhook_deliveries` provides the replay-idempotency key SPEC calls for, and the six Amendment 16 event names (including the `speaker_task.completed` rename) appear identically in the endpoint allowlist, the delivery `event_type` check, and `WEBHOOK_EVENT_TYPES`.
- **The per-slot `events_json` CHECK is verified working.** I applied the migration in SQLite and probed it: valid arrays accept; a non-allowlisted event, a 7-element array, a non-array JSON value, and a JSON `null` slot all reject; bad `event_type` and bad `status` on deliveries reject; `EXPLAIN QUERY PLAN` confirms `idx_webhook_deliveries_endpoint_created` is used for the deliveries-log query shape. The comment explaining *why* the slot expansion exists (no table-valued subqueries in SQLite CHECKs) is exactly the kind of constraint-documenting comment that earns its keep.
- **The verifier extensions are belt-and-braces.** Splitting "0001 defines 46 tables" from "the applied chain defines 48" keeps both invariants; the FK-graph bump 89 → 91 matches the two new foreign keys exactly; and the new assertions cover defaults (`enabled`, `attempts`, and the four NULLs), the nullable tombstone, the untouched status enum text, four negative constraint probes, and the index query plan.
- **Type-level rigor maintained.** `CORE_TABLE_COUNT`, the `_CoreTableCountIsExact` assert, `CoreTableRows`, `CoreDefaultColumns` (`enabled`/`attempts` only — matching the SQL defaults precisely), and the insert aliases were all extended consistently; the mirror interfaces match SQL column names exactly, which the verifier's parity loop enforces mechanically.
- **FK-safe reset ordering is both implemented and tested** — `webhook_deliveries` before `webhook_endpoints` before `events` in `WIPE_ORDER`, with source-position assertions guarding the order.
- **The empty `owns`/`exercises` AC-claims file with an explanatory note** is the honest move for a schema-only ticket: no green-test theater over behavior this ticket doesn't ship, and scope discipline held — no read sites, no routes, no `handbook_pages`.

---

### Verification performed by this review

- Confirmed `0004_calendar_reversal.sql` contains the `cancelled_at` ALTER and that 0002/0003 create no tables (so 46 + 2 = 48 and the initial/applied split is arithmetically right against this checkout's `0001_init.sql`, which defines exactly 46 tables and the verbatim `open|done` check).
- Extracted the 0005 SQL from the diff and applied it against an in-memory SQLite with a stub `events` table: fresh apply clean; happy-path endpoint + delivery inserts succeed; seven negative probes all rejected by the intended constraint; index confirmed via query plan.
- Cross-checked SPEC §3 (lines ~330–331), §4.2 webhook routes, and Amendment 16 for column and event-name parity.
- Confirmed the out-of-scope diff content (MRQ-39/48 files) is already on master, supporting the stale-base reading in issue 4.

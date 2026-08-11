# Code Review: MRQ-66 — Migration 0005 (task cancellation seam + webhook persistence)

Reviewed at branch `mrq-66-migration`, commit `cc6508a` ("MRQ-66 add webhook persistence migration"), base `1553dfb` (current `master`).

**Review scope note.** The diff embedded in the review prompt was truncated (588 lines omitted) and contained material that is *not* in this branch — a large volume of `.lattice/` orchestration state and changes to `scripts/checks/speed.ts`. The actual commit touches exactly 7 files (`migrations/0005_task_cancellation_webhooks.sql`, `scripts/schema-verify.mjs`, `src/db/schema.ts`, `src/lib/reset-demo/reseed-demo.ts`, `tests/ac-claims/MRQ-66.json`, `tests/integration/apply-migrations.ts`, `tests/node/mrq-66-migration.test.mjs`). I reviewed the full, untruncated branch diff directly from git, so the prompt truncation did not reduce coverage. The `speed.ts` changes are not part of MRQ-66 and were not reviewed here.

## 1. Verdict

**PASS**

## 2. Summary

The branch delivers the additive fifth migration exactly as re-planned: webhook_endpoints and webhook_deliveries with the Amendment 16 six-event allowlist enforced in SQL, the required `idx_webhook_deliveries_endpoint_created` index, and no duplicate `cancelled_at` ALTER (correctly deferring to immutable 0004, which I verified adds that column). The schema mirror, verifier, wipe order, and integration migration list are all extended coherently, and I independently ran the full validation stack — everything passes. The flagged deviation from the stale ticket wording (0005 instead of 0003; no `ALTER TABLE speaker_tasks`) is correct and necessary: repeating the ALTER would fail every fresh apply with `duplicate column name`.

Verification I ran on the branch (not taken on faith from the plan):

- `node --test tests/node/mrq-66-migration.test.mjs` — 2/2 pass.
- `npm test` — 69/69 pass, 14.4s, hermetic (within the 30s budget; the WIPE_ORDER coverage guard from MRQ-53 passes with the two new tables).
- `node scripts/schema-verify.mjs` — passes: 48 tables, 119 named indexes, 91 foreign keys, 3 triggers; fresh apply runs 0001→0005, second apply is idempotent, constraint probes (http URL, bad endpoint event, bad delivery event, bad delivery status) all reject, defaults verified, and the delivery-log query plan uses the new index.
- `npx tsc --noEmit` — clean (the `CORE_TABLE_COUNT = 48` type-level assertions compile).

Conformance spot-checks: the six event names match AC-241 / SPEC Amendment 16 (`sequence/USER_STORIES.md:888`) exactly; the table shapes match the DDL in `sequence/research/state-model-gaps.md` with deliberate hardening (https-only CHECK per the ticket, event/status CHECKs); no `handbook_pages` (correctly excluded per scope discipline); the `open|done` status CHECK is untouched and asserted both in the verifier and the contract test; AC-claims file declares empty `owns`/`exercises` as planned.

## 3. Issues

**[minor] migrations/0005_task_cancellation_webhooks.sql:18 — events_json CHECK permits duplicate event names**
The slot-by-slot CHECK (correctly exhaustive given `json_array_length <= 6`) validates each element against the allowlist but does not enforce uniqueness, so `'["submission.created","submission.created"]'` is accepted. Strict "subset" semantics would reject duplicates. This is harmless at the persistence layer — a duplicate subscription at worst causes a duplicate delivery row, and SQLite CHECK constraints can't express set-uniqueness without unreadable pairwise comparisons — but the writer needs to own it.
**Fix:** No migration change needed (0001–0005 immutability makes a later fix costly, and 21 pairwise inequality clauses would be worse than the gap). Instead, make M-62's endpoint-CRUD writer normalize `events_json` to a deduplicated array before insert/update, and note that requirement in the M-62 ticket so it isn't lost.

No other issues found. Two things I checked that look like issues but aren't: (1) SQLite's `LIKE 'https://%'` is ASCII case-insensitive, so `HTTPS://…` passes — that matches RFC 3986 scheme case-insensitivity and is fine; (2) an element of JSON `null` (`'[null]'`) is correctly rejected, because `json_type(events_json,'$[0]')` returns the string `'null'`, which fails the `= 'text'` arm — the `IS NULL` arm only matches genuinely absent slots.

## 4. Positive Observations

- **The 0004 collision was caught, measured, and documented rather than shipped.** The plan records that a duplicate `ALTER TABLE` was *measured* to fail fresh application, and the migration's header comment explains why `cancelled_at` is absent from 0005 — exactly the right way to handle a stale ticket against a moved codebase. The contract test then pins the resolution both ways (`0004` must contain the ALTER; `0005` must not), so the deviation can't silently regress.
- **The allowlist CHECK is well-engineered for SQLite's constraint limits.** The comment explains why subquery-free slot validation is used, `json_array_length <= 6` makes the six slot checks exhaustive rather than a sampling, and the same six names are enforced at three layers (endpoint subscription, delivery event_type, and the `WEBHOOK_EVENT_TYPES` mirror constant) so drift is loud.
- **The verifier upgrade is a real strengthening, not just a count bump.** Splitting `initialTables` (0001, still 46) from `expectedTables` (applied, 48) preserves the immutability assertion instead of weakening it; the new checks probe live-database behavior — defaults round-trip, four negative constraint probes, an `EXPLAIN QUERY PLAN` assertion that the delivery-log index is actually used, and a regex pin on the `open|done` enum in `sqlite_master`.
- **Type-level guards in `schema.ts` carry their weight.** `CORE_TABLE_COUNT`, the uniqueness/completeness `Assert`s, and the `satisfies` registry mean a missed table or typo is a compile error, and the mirror-parity pass in schema-verify cross-checks the interfaces against the real applied schema.
- **WIPE_ORDER discipline held.** Children before parents (`webhook_deliveries` → `webhook_endpoints`, both before `events`), verified three ways: the MRQ-53 coverage guard, the new ordering contract test, and the verifier's FK check on a fresh database.
- **Scope discipline is exemplary**: no read sites, no routes, no UI, no `handbook_pages`, and an honest AC-claims file that claims nothing — the migration seam only, exactly as the ticket demanded.

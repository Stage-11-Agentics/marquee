# Code Review: MRQ-66 — Migration 0005 (task cancellation + webhook persistence)

Reviewed at branch `mrq-66-migration` HEAD `d98d2f9`, base `61347f6` (merge-base with `master`).

**Note on the review diff:** the diff embedded in the review prompt was generated against a stale base and was ~95% `.lattice/` state files plus already-merged MRQ-69 work, and it was truncated (1,578 lines omitted). I discarded it and reviewed the branch's real diff directly from git. The branch's own commits are clean: exactly 7 code files, 254 insertions, **zero `.lattice/` pollution** — the noise was an artifact of the review harness's diff base, not of this PR.

## 1. Verdict

**PASS**

## 2. Summary

The branch delivers exactly what the corrected plan promised: an additive `0005_task_cancellation_webhooks.sql` creating `webhook_endpoints` and `webhook_deliveries` per SPEC §3 (lines 330–331) with the ratified Amendment 16 six-event allowlist enforced in both tables, the `(endpoint_id, created_at)` index, the schema.ts mirror, verifier updates, wipe-order coverage, and contract tests. The flagged deviation — 0004 already owns `speaker_tasks.cancelled_at`, so 0005 correctly omits the duplicate `ALTER` — is real (verified in `migrations/0004_calendar_reversal.sql:4`) and correctly handled. I independently ran the full verification stack and everything is green.

## 3. Issues

**[MINOR] migrations/0005_task_cancellation_webhooks.sql:14 — `events_json` CHECK admits duplicate entries (multiset, not strict subset)**
SPEC §3 says `events_json` is a "subset of the six-event allowlist." The per-slot CHECK validates membership and caps length at 6, but `'["agenda.published","agenda.published"]'` passes, so the DB-level guarantee is "≤6 valid event names," not "subset." A duplicate subscription could cause double delivery if the future producer iterates the array naively.
**Fix:** No migration change needed (SQLite CHECK can't express uniqueness without severe clause bloat, and this DB-level allowlist is already stronger defense-in-depth than the codebase's other JSON columns get). Instead, make the M-54 endpoint writer (Settings → Webhooks) deduplicate/validate `events_json` before insert — worth a one-line note in the M-54 ticket so it isn't lost.

**[MINOR] tests/node/mrq-66-migration.test.mjs:19 — contract tests are source-text assertions, not executed SQL**
Both tests regex-match the migration file rather than applying it. On their own they'd pass even if the SQL were syntactically invalid. This is acceptable *here* because `scripts/schema-verify.mjs` executes the real migration chain against a fresh D1 (wrangler) plus better-sqlite3 constraint probes — but that verifier is outside the 30s hermetic suite, so the fast suite alone can't catch a broken 0005.
**Fix:** Nothing required for this ticket (the pattern matches the existing per-migration contract tests, and the Workers-backed `tests/integration/apply-migrations.ts` also executes 0005). Noted so the reliance on `schema-verify` as the executing gate stays deliberate.

No critical or major issues found.

## 4. Verification performed (independent, this review)

- `node --test tests/node/mrq-66-migration.test.mjs tests/node/reset-wipe-order.test.mjs` — 3/3 pass.
- `npm test` (hermetic suite) — pass, 16.3s of the 30s budget. (A first run hit the 30s budget with two cancelled tests, `check-repo` and `cli.AC-138-141-250`; re-run passed at 16s and master behaves identically — cold-start load flake, not a branch defect.)
- `node scripts/schema-verify.mjs` — pass: **48 tables, 119 named indexes, 91 foreign keys, 3 triggers**, matching the updated assertions; includes fresh D1 application of 0001→0005, re-application, nullable `cancelled_at` check, unchanged `open|done` status enum check, webhook constraint-violation probes (http URL, non-allowlisted event in both tables, bad status), default-value checks, and an EXPLAIN QUERY PLAN assertion that the deliveries log uses `idx_webhook_deliveries_endpoint_created`.
- `npm run pr-gate -- --ticket MRQ-66` — **full pass**: worker/client/test typechecks, production build, design contract, API contract, hermetic suite, merged AC trace.
- `git merge-tree` against current master (`8ba82bd`, which merged MRQ-69 after this branch was cut) — **no conflicts**; the one-commit-stale base is benign.

## 5. Positive Observations

- **The codebase-overlap deviation was handled exactly right.** The stale ticket text demanded an `ALTER TABLE speaker_tasks ADD COLUMN cancelled_at` that immutable 0004 already ships; a duplicate would fail every fresh D1 apply. The delegator detected it, flagged it in the plan rather than silently deviating, preserved 0004, and added a contract assertion (`assert.doesNotMatch(migration, /ALTER TABLE speaker_tasks ADD COLUMN cancelled_at/)`) that pins the resolution so a future "fix" can't reintroduce the duplicate.
- **Scope discipline is exemplary.** No read sites, no routes, no UI, no `handbook_pages`, no contract-document edits, no status-enum drift — the diff is precisely the persistence seam plus its mirrors and guards. `tests/ac-claims/MRQ-66.json` with explicit empty `owns`/`exercises` and a rationale note is the honest claim for a schema-only ticket.
- **The allowlist is enforced at the database layer in both tables** (per-slot JSON validation on `webhook_endpoints.events_json`, enum CHECK on `webhook_deliveries.event_type`), with the SQLite CHECK-subquery limitation documented in a comment. The verbose six-slot expansion is ugly by necessity and correctly capped by `json_array_length <= 6` so no slot escapes validation; `[null]` elements are rejected by the `= 'text'` type check.
- **Every existing guard was extended, not worked around**: the schema verifier now distinguishes the immutable 0001 46-table count from the 48-table applied schema, the FK-graph count moved 89→91, `WIPE_ORDER` got both tables in child-before-parent position (deliveries → endpoints → … → events, satisfying the MRQ-53 coverage guard), and `schema.ts`'s type-level uniqueness/completeness assertions (`CORE_TABLE_COUNT`, `_CoreRowsAreComplete`) were updated so the mirror can't silently drift.
- The second commit ("keep migration comments splitter-safe") shows attention to the `splitStatements` `;\n` splitter in `tests/integration/apply-migrations.ts` — comment semicolons sit mid-line where the splitter can't bite.

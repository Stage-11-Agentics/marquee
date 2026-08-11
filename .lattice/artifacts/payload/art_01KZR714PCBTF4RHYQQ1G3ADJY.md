# Plan Review: MRQ-66 — Migration for task cancellation + webhook tables

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

Reviewed the execution plan for MRQ-66 against the live checkout (migrations directory, `src/db/schema.ts`, `scripts/schema-verify.mjs`, `tests/integration/apply-migrations.ts`, `WIPE_ORDER`, and SPEC §3 / Amendment 15–16). The plan is well-structured and correctly caught the migration-numbering drift (0005, not 0003), but it missed the deeper half of the same drift: **`0004_calendar_reversal.sql` (MRQ-25, merged, declared immutable by this very plan) already added `speaker_tasks.cancelled_at`**, so the plan's step 1 produces a migration that fails on first apply with a duplicate-column error. The plan must be revised to drop the ALTER and re-scope the ticket to the webhook tables only.

### 3. Issues

**[CRITICAL] Implementation step 1 / Scope — `speaker_tasks.cancelled_at` already exists; the planned ALTER fails on apply**
The plan promises `ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER` in `0005_task_cancellation_webhooks.sql`. But `migrations/0004_calendar_reversal.sql` (MRQ-25) already contains exactly that statement, plus the index `idx_speaker_tasks_submission_cancelled(submission_id, status, cancelled_at)`, and `src/db/schema.ts:512` already carries `cancelled_at: EpochMilliseconds | null` in the row interface. SQLite has no `ADD COLUMN IF NOT EXISTS`; the planned 0005 would abort on every fresh apply, breaking `apply-migrations.ts`, the schema verifier, and every Worker-backed test in one stroke. The plan's own "Plan correction (2026-08-11)" section noticed 0003/0004 exist for *numbering* purposes but did not read 0004's *contents* — the exact overlap it needed to catch. The scaffold's task description predates the MRQ-25 merge; the checkout has moved.
**Recommendation:** Re-scope the ticket: 0005 creates only `webhook_endpoints` and `webhook_deliveries` (plus the `webhook_deliveries(endpoint_id, created_at)` index). Rename the migration accordingly (e.g., `0005_webhooks.sql`). Record in the plan that AC-264's schema (cancelled_at) was delivered by MRQ-25/0004 and that MRQ-66's remaining contribution to the task description is the AC-241 webhook persistence. The contract test may still *assert* the unchanged `CHECK (status IN ('open','done'))` and nullable `cancelled_at` as regression guards, but must not re-create them.

**[MAJOR] Scope and non-goals — the `events_json` allowlist "subset check" is not expressible as a SQLite CHECK constraint**
The plan commits to encoding the Amendment 16 six-event allowlist "in both delivery `event_type` validation and the `events_json` array subset check" inside the migration SQL. `event_type IN (...)` on `webhook_deliveries` is fine. But a subset check over a variable-length JSON array requires iterating the array (`json_each` / a subquery), and SQLite prohibits subqueries and table-valued functions in CHECK constraints. The codebase's own precedent confirms this boundary: 0001 validates JSON columns for *shape* only (`json_valid`, `json_type = 'array'`, e.g. `av_capabilities`, `social_links`, `scopes`) and leaves content validation to the writer. An implementer following the plan literally will either stall or invent a fragile hack.
**Recommendation:** State the mechanism explicitly: SQL enforces shape (`json_valid(events_json) AND json_type(events_json) = 'array'`, plus `url LIKE 'https://%'` and the `status IN ('queued','delivered','failed')` check); the six-event subset is enforced at the writer (Settings → Webhooks route, owned by M-54) and asserted in this ticket's contract test as a schema.ts constant (`WEBHOOK_EVENT_TYPES`) that downstream tickets import — which also keeps Amendment 16's canonical list in exactly one place.

**[MINOR] Implementation step 2 — schema.ts mirror work partially pre-done; verifier claim should be re-checked after re-scope**
Because MRQ-25 already mirrored `cancelled_at` into `schema.ts`, step 2's cancellation-related mirror work is already complete; only the webhook constants, row interfaces, registry entries, and insert aliases remain. The verifier framing ("distinguish immutable 0001 tables from the 48-table applied schema") is directionally right — `scripts/schema-verify.mjs:164` pins 0001 at exactly 46 tables, and the two webhook tables take the applied schema to 48 — but the revised plan should confirm how the verifier derives its applied-table expectation so the 46-assertion stays intact rather than being loosened.
**Recommendation:** In the revision, trim step 2 to webhook-only additions and verify the 46-table assertion is preserved as an 0001-scoped invariant while the applied-schema expectation grows to 48.

**[MINOR] Verification — AC-claims framing should reflect the re-scope**
The plan's `tests/ac-claims/MRQ-66.json` with empty `owns`/`exercises` is consistent with existing schema-only tickets, but after the re-scope the ticket serves AC-241 only in substance; AC-264's schema landed with MRQ-25. Stating this in the claims file's rationale (or the PR body) prevents a later auditor from hunting for MRQ-66's cancellation contribution.
**Recommendation:** Note the MRQ-25 lineage explicitly wherever AC-264 is referenced in the deliverables.

### 4. Positive Observations

- **The numbering correction shows real checkout verification.** Catching that the "third migration" is actually the fifth — against a stale scaffold — is exactly the right instinct; the failure here was stopping one file short of reading 0004's body.
- **Scope discipline is faithfully carried.** The non-goals list (no read sites, no routes, no UI, no `handbook_pages`, no contract edits) mirrors the ticket's binding constraints precisely, including the SPEC §3 no-writer-table rule.
- **The wipe-order and test-harness steps are correct and specific.** Child-before-parent ordering (`webhook_deliveries` → `webhook_endpoints` → before `events`) matches the FK graph and the existing `WIPE_ORDER` convention in `src/lib/reset-demo/reseed-demo.ts`, and wiring 0005 into `tests/integration/apply-migrations.ts` is the right integration point.
- **Verification and handoff are unusually complete** — idempotent re-application, mirror parity, pr-gate before push, base-SHA recording, and a self-review checklist keyed to the ticket's specific risks (enum drift, handbook tables, contract edits).

The plan should return to `in_planning` for the re-scope; with the ALTER removed and the allowlist mechanism stated, this is a fast revision — the webhook-table half of the plan is sound as written.

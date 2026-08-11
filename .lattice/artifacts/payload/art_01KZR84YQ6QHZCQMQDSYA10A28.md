# Plan Review: MRQ-67 — task cancellation and idempotent acceptance reconciliation

Reviewer: Claude (plan review, pre-implementation)
Date: 2026-08-11

## 1. Verdict

**PASS** — Implementation can proceed. One major wording issue (below) must be honored during implementation: the AC-266 call-site enumeration test is mandatory, not conditional.

## 2. Summary

Reviewed the MRQ-67 plan against the task description, AC-264–AC-267 in `EVALUATION.md`, and the actual state of master. The plan is unusually well grounded: I verified its factual claims against the codebase and they hold — migration 0004 shipped the `cancelled_at` column and `(submission_id, status, cancelled_at)` index; `cancelTaskSet` and `reconcileTaskSet` already exist in `src/jobs/cascade/decisions.ts` (from MRQ-25) with the restore-in-place guard the task demands; the outbox idempotency key is exactly `sha256(template_key, entity_id, person_id)` via `buildIdempotencyKey` backed by `uq_outbox_idempotency_key`; and the genuinely open gaps the plan targets are real — `listTasks` in `src/routes/portal.routes.ts:589` neither selects nor filters `cancelled_at`, and `src/ui/portal/` has no cancelled-section rendering at all. The key concern is a single hedge: the plan makes the AC-266 call-site inventory test conditional ("if needed") when the AC makes it binding.

## 3. Issues

**[MAJOR] Implementation step 4 — call-site enumeration test hedged as "if needed"**
AC-266 states verification is "asserted by call-site enumeration, not by behaviour alone," and the task description repeats it: "AC-266 is verified by call-site enumeration, not behaviour alone." No test anywhere in `tests/` currently references `reconcileTaskSet` (the only reference outside the definition is its own module), so the enumeration test does not exist and must be created. The plan's phrasing — "Add a call-site inventory test if needed" — gives the implementer license to skip a binding verification mechanism if the behavioural tests pass.
**Recommendation:** Treat the call-site inventory test as unconditional. Enumerate every acceptance path (first accept at `decisions.ts:714`, the bulk path at `:857`, and any others found in the audit) and assert each traverses the single `reconcileTaskSet` function — an AST/grep-style invariant in the spirit of the existing two-site `always_live` check is the right shape.

**[MINOR] Steps 2 & 4 — restoration audit row not explicitly named**
AC-267 requires that both reversal branches "plus a later restoration" write an `audit_log` row with actor and timestamp surfaced in record history. The plan names history persistence for the cancel and retain branches, but never states that the reconciliation restore path writes an audit row, and step 4's assertion list ("reason/history") doesn't clearly include the restoration row. `decisions.ts` has two `audit_log` insert sites today (lines 254, 877); whether the restore path emits one should be confirmed, not assumed.
**Recommendation:** Add one sentence to step 2 ("restoration writes an audit_log row surfaced in record history") and one assertion to step 4 (re-accept after reversal → new audit row with actor + timestamp visible in the record's history view).

**[MINOR] Step 3 — portal cancelled-section copy under-specified relative to AC-265**
The task fixes specific rendering: the section is titled "Cancelled · N" under a dashed divider, the reason appears once at submission level (not per row), a cancelled row carries no action button, and a row that was already completed "says its work is kept." The plan captures the divider, single reason, no-action-control, and completed-retained points but names neither the "Cancelled · N" label nor the completed-row copy, and does not say it will drive the binding prototype (`prototypes/pipeline-v1.1/index.html` at v1.8) to match. The prototype is binding, so this is recoverable at review time, but stating it in the plan removes a round-trip.
**Recommendation:** Reference the v1.8 prototype as the rendering source of truth for the portal cancelled section and the reversal dialog's branch-naming confirmation state.

## 4. Positive Observations

- **The plan is written against reality, not against the ticket's narrative.** The task description reads as if both functions must be built; the plan correctly recognizes they shipped in MRQ-25 and reframes the work as hardening the seams and closing reader gaps. Every factual claim I spot-checked (migration contents, index name, idempotency key composition, the two-site `always_live` invariant, `src/api/board.ts` as a reader) checks out.
- **The reader audit is the right center of gravity.** The genuinely open work is exactly where the plan points: the portal API (`listTasks` has no `cancelled_at` awareness), portal task completion, and the portal UI's cancelled section — the highest-risk AC-265 surfaces.
- **Non-goals are crisp and mirror the task's guardrails one-for-one:** no migration, no third status value, no second decision writer, no third `always_live` site, no prototype/contract edits. This is the correct fence for a public-repo, deadline-driven build.
- **The test design is strong:** invariant-keyed fixtures with positive controls, absence assertions (zero deletion, zero outbox rows from the overdue trigger), snapshot-around-double-call idempotency for AC-266, second-accepted-session retention, and both AC-267 branches from a common starting state.
- **Operational hygiene is planned, not bolted on:** plan-first commit with worktree-root guard, exact-head rebase with `npm ci` before the full gate, public-repo hygiene in self-review, and explicit orchestrator handoff. Scope at 4 agent-hours is realistic given how much of the backend already exists.

# MRQ-67: task cancellation and idempotent acceptance reconciliation

Actor: `agent:delegator-mrq-67`
Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-67-cancellation`
Base: `forgejo/master`
Owns: AC-264 through AC-267

## Binding scope

- Use the already merged `speaker_tasks.cancelled_at` column and
  `(submission_id, status, cancelled_at)` index from migration 0004. Add no
  migration and do not change the `status IN ('open','done')` check.
- Cancellation is `cancelled_at IS NOT NULL`; cancellation never deletes a
  task or changes a completed task. Every open task in the reversed submission
  receives the cancellation tombstone and the reversal reason is retained in
  the append-only history.
- Keep one `insertDecisions` writer in `src/jobs/cascade/decisions.ts` and one
  `reconcileTaskSet` operation used by first acceptance, re-acceptance after a
  reversal, and acceptance after the assigned template set changes. Existing
  rows are restored in that same operation by clearing `cancelled_at` and
  preserving `due_at`; missing rows are created; completed rows remain done.
- Reconciliation must be safe to run twice. Rely on the unique outbox
  idempotency constraint (`sha256(template_key, entity_id, person_id)`) rather
  than a racing pre-check. No third `always_live` mail site may be added.
- Audit every reader of open task state. Active/owed work means neither done
  nor cancelled. This includes the overdue trigger, communications audience,
  submission status filters, portal, chase board, metrics, facets, severity,
  and task-type filtering. A speaker with another accepted session retains
  that session's chase row.
- Preserve the binding prototype and contract artifacts. Shipped UI uses the
  organizer noun “conference” and contains no internal hostnames, ticket IDs,
  or other private orchestration details.

## Implementation

1. Advance the Lattice lifecycle to `planned` and then `in_progress` after
   this plan is committed and pushed. Reconfirm the clean base and inspect all
   `status = 'open'` task readers before editing.
2. Harden the existing cascade seams in
   `src/jobs/cascade/decisions.ts`: stamp open tasks only, retain completion
   state, persist the reversal reason in record history for both cancel and
   retain branches, and keep all acceptance paths on the same idempotent
   reconciliation function and writer. Ensure restoration is not a separate
   acceptance branch and that repeated reconciliation cannot duplicate rows or
   notifications.
3. Close reader gaps in the existing seams: exclude cancelled work from
   `src/api/board.ts`, submission status queries, portal active/progress
   projections and task completion, and any other open-task reads found by the
   invariant audit. Render cancelled portal work below a dashed divider with a
   single submission-level reason and no action control; leave completed work
   visibly retained. Make the reversal dialog name the selected branch before
   confirmation while preserving the existing cancel/retain choices.
4. Add focused integration and node guardrails. They will use invariant-keyed
   fixtures with positive controls and assert both response/status and absence:
   reversal counts, zero deletion, untouched done rows, reason/history;
   portal/chase/metric/filter behavior; overdue and communications suppression;
   second-session retention; and both cancellation branches. Snapshot task and
   outbox counts around two reconciliation calls and assert the second call
   changes neither, while also proving cancellation restoration preserves due
   dates and does not resurrect done work. Add a call-site inventory test if
   needed to prove every acceptance path uses the one reconciliation function
   and retain the existing two-site `always_live` AST invariant.
5. Add `tests/ac-claims/MRQ-67.json` for AC-264 through AC-267. Run focused
   `tests/node` and integration tests, then the full gate after the final
   rebase (run `npm ci` after rebasing):
   `npm run pr-gate -- --ticket MRQ-67`.

## Expected files and non-goals

Expected source seams are the existing cascade, portal, board, and submission
query/UI files plus narrowly scoped tests and the claims file. Exact files may
expand only when the open-task reader audit identifies a required consumer.
Do not add a migration, new tables, a third task status, a second decision
writer, a third `always_live` site, or unrelated contract/prototype changes.

## Handoff evidence

- First branch commit is this plan, committed with the worktree-root guard and
  pushed to `forgejo/mrq-67-cancellation`.
- Lifecycle status and plan path are visible to the Orchestrator.
- Self-review covers the invariant audit, idempotency, public-repo hygiene,
  exact-head rebase, focused tests, and the full PR gate.
- Opening the PR against `master` is the final action; then set `pr_open` and
  send the Orchestrator the PR and gate result at workspace `9`, surface `60`.

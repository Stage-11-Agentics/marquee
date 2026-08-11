# MRQ-52: Audit — bulk-write path and chunking

BUILDPLAN: A-10 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Bulk-write audit — every bulk path through the one chunking helper; 150- and 1,000-record drives.
Starts when (verbatim): After M-18.

Trap 11: D1's 100-bound-parameter cap throws only under real data, only at scale. S-3 settled the pattern, M-07 built the single helper, and this audit proves nothing bypassed it. Guardrail G11 is the 150/1,000-record drive.

ACs: — (underwrites AC-66 – AC-69)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-18
Plan: filled in by delegator's plan phase

## Contract and scope

- Audit A-10 at the real Worker/D1 boundary. The headline path is a 150-submission bulk accept; the scale guard is a 1,000-record drive. The audit must prove completion and exactly-once notification behavior, not merely a green unit test.
- Treat `src/api/bulk.ts`'s `runBulkByIds` as the single ID-set bulk-write transport. Inventory every bulk decision, reminder, rejection, assignment-distribution, category-routing, and import path and classify each write as either a call through that helper or a fixed-binding statement/batch whose binding count is independent of the selected-row count. Any hand-rolled ID placeholder expansion or unbounded statement binding is a finding.
- Exercise AC-66–AC-69, AC-117, and the empty-selection contract without claiming ownership of an automatic AC. Add the explicit `tests/ac-claims/MRQ-52.json` manifest with `owns: []`, the exercised criteria, and the remaining owners.
- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`. Do not fork `insertDecisions`, the mail/outbox seam, or the list/route-manifest seams. Product fixes are out of scope for this fast-track audit; record any source/runtime defect with the owning path, exact reproduction, and severity for the Orchestrator.

## Method

1. Establish the exact post-M-18 baseline at `forgejo/master`, read the S-3 verdict and `runBulkByIds`, then build a semantic inventory of all bulk entry points and writes. Use an AST/source guard keyed by operation/helper/table names, not line numbers. Include positive controls for the shared helper, at least one bulk decision, one reminder, and one import/assignment/category path so an empty inventory cannot pass.
2. Drive the real local Worker path with scratch D1 state and deterministic IDs: bulk accept 150 and 1,000 submissions, rejection at scale, reminder sends, assignment distribution, category routing, and import. Capture request/response, D1 statement/query counts where observable, durable operation state, per-table counts, and any failed/partial rows. Do not substitute a direct helper call for the route/job path.
3. Fire the same bulk action twice with the same template/entity/person tuple. Assert `outbox.idempotency_key` is the SHA-256 identity tuple, the unique row count is one, and the delivery count is one. Run a positive control with a distinct tuple so a zero-row or disabled path cannot make the duplicate assertion pass vacuously. Keep demo suppression separate from idempotency evidence.
4. Assert AC-69 completion from durable state after the 150 accept: selected equals succeeded plus failed, terminal state is `completed` or `completed_with_failures` as appropriate, all expected decision/status rows survive, and no operation remains `queued`/`running`. If a bounded kill/interruption is safe in the local harness, perform it once and inspect what survives; otherwise record why interruption evidence is unavailable and do not label completion as transactional.
5. Exercise `recipientsFor` through every bulk reminder entry point with `submission_ids: []`, `person_ids: []`, and `recipient_pairs: []`; assert no recipient, outbox row, queue message, or delivery is created. Follow each with a non-empty positive selection and assert it does create exactly the expected side effect. Repeat equivalent empty-selection checks for any other bulk selector found by the inventory.
6. Add the machine guard in `tests/node/bulk-paths.AC-66-69.test.mjs` (or the existing nearest bulk contract test if that is the only non-duplicative home). It must fail on a new direct placeholder expansion, a new ID-set bulk writer that bypasses the helper, a missing semantic path, or a duplicate helper seam; it must assert file/table/operation identity and counts rather than coordinates. Keep fixed-binding per-row/batch imports explicitly documented in the inventory so the guard does not conflate safe constant-binding work with unsafe ID-set expansion.
7. Run focused bulk/mail/import tests, the real local drives, `npm test`, `npm run trace:ac -- --ticket MRQ-52`, and the mandatory `npm run pr-gate -- --ticket MRQ-52`. Self-review the exact diff for dead-path evidence, vacuous controls, duplicate notification accounting, partial completion, empty-selection widening, public-repo hygiene, and unowned AC claims. Attach a PASS review artifact only for the final HEAD after every finding is either resolved in-scope or explicitly routed.

## Expected artifacts

- `tests/node/bulk-paths.AC-66-69.test.mjs`: semantic AST/source inventory and future-proof guard for all ID-set bulk writers and safe fixed-binding classifications.
- `tests/ac-claims/MRQ-52.json`: explicit no-auto-AC declaration; exercises AC-66, AC-67, AC-68, AC-69, and AC-117 only where the evidence actually covers them.
- Lattice review/validation evidence: the 150/1,000 drive results, operation-state and row-count vectors, D1 statement/binding observations, duplicate outbox/delivery counts with positive controls, empty-selection before/after counts, and any routed findings with `file:line` plus reproduction.
- The completion/review comment and PR body must include the mandatory local `pr-gate` result and distinguish observed runtime proof from source/test inference.

## Verification and handoff

- Refresh `forgejo/master` and record its exact SHA at each phase boundary. The first branch commit contains only this plan, is made from this worktree after the exact-top-level guard, and is pushed to `forgejo/mrq-52-audit-bulk` before implementation.
- Transition `in_planning → planned → in_progress → review → in_validation → pr_open` with actor `agent:auditor-mrq-52`, verifying each state via `lattice show MRQ-52 --json`. `pr_open` is terminal for this delegator; the Orchestrator merges.
- This is a runtime audit, so validation is required. Use local scratch bindings only; no deployed mutation, real mail, operator data, or public credentials. If the local Worker cannot reach a path, record the exact boundary and route that as a finding rather than claiming it passed.
- Before `pr_open`, push the final branch, open the Forgejo PR against `master`, attach the PR URL, bump Lattice to `pr_open`, and c11-send the terminal handoff to `workspace:9` / `surface:60`.

## Non-goals

- No implementation rewrite of the bulk helper, decision cascade, mail/outbox, import, assignment, routing, or category code in this audit ticket unless the Orchestrator explicitly reroutes a finding.
- No public deployment, production mail, Airtable mutation, merge, or changes to binding contract documents.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review verdict: PASS. The plan covers every named bulk family, both scale drives, real route/job execution, exactly-once outbox/delivery counting, durable completion, deliberate empty selection, positive controls, and a coordinate-independent guard.
- The helper inventory distinguishes ID-set writes from constant-binding row/batch work; a fixed-binding import loop is not silently treated as a D1 parameter-limit bypass, while any unbounded ID-set statement is a finding.
- MRQ-52 owns no automatic AC. The claim manifest will state that explicitly and only list ACs actually exercised by the evidence.

## Reset 2026-08-11 by agent:auditor-mrq-52

## Reset 2026-08-11 by agent:auditor-mrq-52

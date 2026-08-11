# MRQ-19: Bulk and record-owned decisions with cascade

BUILDPLAN: M-18 — Wave 1 (§4), walkthrough step 9

Scope (verbatim): Select-all-matching as server selector; bulk accept/reject/waitlist/withdraw, **each transition into `accepted|waitlisted|rejected` writing a `submission_decisions` row (feedback null) so bulk and record decisions share one render path**; per-record results; record-owned Approve/Maybe/Deny confirmation **invoking M-52's decision write** (M-52 owns AC-235/236 end to end — schema use, render-once, portal display, record log — and M-18 calls it); cascade (status → portal → rendered mail → tasks), CFP stays open.

Every bulk path goes through M-07's single chunking helper (S-3's verdict); guardrail G11 and audit A-10 drive 150 and 1,000 records against it (trap 11 — D1's 100-bound-parameter cap).

File surface: `src/routes/submissions-bulk.routes.ts`, `src/routes/submission-decisions.routes.ts`, `src/jobs/cascade/*`

ACs: AC-66 – AC-69, AC-114 – AC-117, **AC-243**
Hours: 6
Workflow: inline-full
Shared files: none — module-local. **Do not fork a second decision-write path**; call M-52's.
Deps: M-11, S-3
Speed: AC-69 is AC-sourced for completion; the ≤100 ms longest-main-thread-task figure is the *proposed instrument* — measured and reported, not a gate.
Audit that keys off this ticket: A-10 (bulk-write audit), after M-18
Plan: filled in by delegator's plan phase

## Plan

### Working contract

- Authoritative worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-19-decisions`, branch `mrq-19-decisions`, working against `forgejo/master @ 9da8a3b06f20d960f0728bd5805445c9966e4a43` after a clean rebase and `npm ci`.
- Scope is limited to the decision routes and cascade jobs named above, plus AC-tagged tests and the claim manifest. Contract documents and the binding prototype are read-only.
- Preserve the client ruling in AC-243: the board remains a read-only overview; no board-card drag or lifecycle control is added. Agenda drag remains outside this ticket.
- Use the existing M-11 outbox and queue path. No direct Resend call, alternate send path, or pre-check for outbox idempotency is permitted.

### Implementation shape

1. Reuse the M-08 submission filter vocabulary for the bulk selector. Export the filter schema/query selection seam from `submissions.queries.ts` only as needed, and feed `bulkSelectorWireSchema` the same typed filters used by the list. The request accepts exactly one server-side `ids` or `filter` arm; the filter arm resolves the full match set in D1, independent of the visible page.
2. Keep one decision-transition writer in `src/jobs/cascade/decisions.ts` (exported for the record route and the bulk route). It validates the event-owned submission, maps Approve/Maybe/Deny to accepted/waitlisted/rejected, updates the lifecycle fields, and writes the `submission_decisions` row. The record-owned route calls this writer after the caller's confirmation; bulk never forks a second decision-write path. Feedback is accepted only through the M-52 seam and bulk passes `null`.
3. Add `src/jobs/cascade/` helpers for the downstream effects. Acceptance/waitlist/rejection use the existing `enqueueOutbox`/`enqueueTrigger` rendering path and `enqueueMailMessage`; acceptance assigns the event's auto-assign task templates to the submission's participants without duplicate task rows. Withdrawal clears the decision-wave association and applies the existing reversal-safe task policy without sending an unconfigured second notification. All rendered content is captured at enqueue time, and outbox uniqueness remains the only duplicate-notification guard.
4. Add `src/routes/submission-decisions.routes.ts` for the record-owned decision endpoint and `src/routes/submissions-bulk.routes.ts` for bulk actions `accept`, `reject`, `waitlist`, and `withdraw`. Both use `defineApiRoute`, `*.routes.ts` naming, the `program:write` grant, the standard error envelope, and the durable bulk result shape. Bulk responses include selected/succeeded/failed counts, an operation id, outbox count, and bounded per-record failures/results; a missing speaker email is a per-record failure and leaves that record unchanged.
5. Route every set update through `runBulkByIds` and `json_each(?)`; do not construct placeholder lists or add a competing chunker. Dependent decision/task writes use fixed-shape D1 statements/batches bounded by the same selected IDs, preserving the ≤100-binding rule at 150- and 1,000-record scale. Record a durable operation summary in the existing audit surface rather than changing the schema.

### Verification

- Add `tests/integration/api/submission-decisions.AC-66-69-114-117.test.ts` covering authenticated bulk accept/reject/waitlist/withdraw, filter-wide selection beyond one page, open CFP preservation, per-record partial failure, decision rows for every accepted/waitlisted/rejected transition, rendered speaker/title merge fields, rejected portal-visible state via the decision row, repeated bulk notification idempotency, and queue messages/outbox rows.
- Add a static `AC-243` test under `tests/` that scopes the board-card markup in the v1.7 binding prototype: no `draggable` or lifecycle controls on cards, while the agenda drag surface remains present. The test is an exercise for AC-243; this ticket does not claim the board's full implementation.
- Add `tests/ac-claims/MRQ-19.json` with ownership for AC-66–AC-69 and AC-114–AC-116, and exercise entries for AC-117/AC-243 (AC-117 already has its foundation owner in MRQ-12; AC-66 is also exercised by MRQ-9). Every new test title is static and begins with its AC tag(s).
- Run the focused AC tests, `npm test`, typechecks/build as appropriate, `npm run trace:ac -- --scope=all --ticket=MRQ-19`, and the required `npm run pr-gate -- --ticket MRQ-19`. For validation, run the real Worker/curl route flow if the local bindings permit it and attach explicit N/A evidence only for any unavailable browser/deployed-only step.

### Non-goals and risks

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, `sequence/USER_STORIES.md`, or `prototypes/pipeline-v1.1/index.html`.
- M-52 remains the owner of AC-235/236's feedback render-once, portal, and record-log surfaces. This ticket exposes/calls the shared writer seam and does not duplicate those surfaces.
- The existing schema has no bulk-operation table; the plan uses `audit_log` for the durable operation summary. If the implementation discovers that this cannot preserve the contract without a migration, stop and flag the exact divergence rather than silently adding a contract-doc or shared-schema change.

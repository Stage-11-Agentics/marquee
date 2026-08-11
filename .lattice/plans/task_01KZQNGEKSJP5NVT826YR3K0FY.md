# MRQ-70: Test harness: cut per-file Worker boot so the fast suite stays under budget

## Scope and ownership

MRQ-70 owns the integration-test harness cost only. It owns no acceptance criteria and will not add `tests/ac-claims/MRQ-70.json`; the PR body will say this explicitly. Existing tests are the proof surface, especially auth, presign, demo-mode, reviewer event/track isolation, hidden-field persistence in `public-form.AC-25-42-...`, and AC-259 Transit. No test assertions or test files are to be changed.

The hard 30-second limits remain untouched:

- `scripts/checks/run-test.mjs` remains the source of the `npm test` limit.
- `scripts/checks/pr-gate.mjs` remains the source of the full-gate limit.
- No test is skipped, deleted, weakened, or moved to change the clock.

The worktree was rebased to the fetched `forgejo/master` at `246311f2a8642fff8de4e015256d97d144aa5811` before this plan. The branch cut point supplied by the orchestrator was `19f8f1d`; the intervening commit is the dispatch/board update only.

## Evidence gathered before implementation

The clean baseline on this worktree was:

- `npm test`: 38 files / 201 tests passed; runner JSON `elapsedMs: 22571`, shell wall-clock `22.81s`.
- The Cloudflare pool portion reported 15.57s and the 38 Node tests reported 3.13s.
- `--fileParallelism=false`: 38 files / 201 tests passed but took `36.07s` wall-clock. This is a negative result: serializing files loses the parallelism that currently keeps the suite viable.
- `--isolate=false`: `12.25s` wall-clock, but it failed `tests/integration/api/dashboard.AC-14-15-240.test.ts` from a stale/shared schema and failed `tests/unit/r2/uploads-routes.test.ts` with `table organizations already exists`; 11 tests were skipped. This is a negative result and cannot be used.
- `--maxWorkers=4`: 38 files / 201 tests passed in `18.71s` for the Cloudflare pool alone. This is a control to remeasure after the migration change, not a substitute for preserving per-file Worker isolation.

These measurements establish that the cost is the repeated setup around the roughly 1,000-line schema (993 lines across the four migration files), not a reason to remove the Worker runtime or serialize the suite. The Node-suite wall clock was 3.13s in this run versus the ticket's earlier 1.4s report; that variance is recorded rather than treated as a code change.

## Chosen approach

Keep Worker isolation for every integration test and the one unit test that explicitly provisions D1, but run Worker-free unit tests in a normal Vitest Node project. `vitest.config.ts` will include `tests/integration/**/*.test.ts` plus `tests/unit/r2/uploads-routes.test.ts`; a new `vitest.node.config.ts` will include the other unit files with the existing setup file. `scripts/checks/run-test.mjs` will run both Vitest configs before the existing native `tests/node` suite.

This removes twelve unnecessary Miniflare boots without sharing a D1 database, changing an assertion, or moving a test file. `tests/integration/apply-migrations.ts` remains unchanged: the timing experiment showed that DDL batching would be a small optimization against the actual startup bottleneck and is not part of this implementation.

This is the smallest harness-only change that attacks the per-file Worker boot cost without sharing mutable databases across files. The success bar is named: repeated `npm test` and full `npm run pr-gate -- --ticket MRQ-70` runs must stay at or below 27s (at least 3s under the hard 30s limit), with the current 39 Vitest files / 204 tests still passing plus the existing 38 native Node tests. Do not consolidate integration files, move integration assertions to `tests/node`, or alter Worker isolation; those choices create avoidable conflicts with the six active test-file delegators.

## Implementation and proof steps

1. After this plan is committed and pushed, move MRQ-70 through `planned` and `in_progress`, refreshing the c11 title/description at the phase boundary.
2. Record the temporary profiling evidence already gathered: a representative integration file took 7.90s wall-clock while `applyMigrations()` took 238ms; `--no-file-parallelism --no-isolate` took 17.76s but failed three suites (36 passed, 17 skipped) through shared-schema, foreign-key, duplicate-table, and missing-secret failures.
3. Implement the harness split in `vitest.config.ts`, new `vitest.node.config.ts`, `scripts/checks/run-test.mjs`, and `tsconfig.test.json`. Keep the Worker config's integration and D1-dependent unit coverage unchanged; the Node config must exclude only `tests/unit/r2/uploads-routes.test.ts`.
4. Run type checks and the full existing `npm test`; compare repeated before/after wall clocks and test/file counts. Re-run any candidate Vitest pool setting separately and report a plainly labeled negative result when it does not help.
5. Extend `recordSpeedHarness` in `scripts/checks/lib/command.mjs` (and its caller only if needed) so `harness.pr_gate` preserves the latest measurement plus a small bounded `history` array with timestamp/commit context; preserve the existing latest-value fields and the 30s budget. This is the required trend, not a single overwritten observation.
6. Perform self-review and the required Lattice review artifact against the exact branch HEAD. The review must confirm that no guardrail assertions changed and that no AC claim file was fabricated.
7. Enter validation and run the actual local gate: `npm run pr-gate -- --ticket MRQ-70`. Record its complete result, including the `pr-gate` wall-clock, in the Lattice completion evidence and c11 update.
8. Push the committed implementation, open a Forgejo PR against `master`, attach the PR reference, bump the ticket to terminal `pr_open`, and stop for the Orchestrator to merge.

## Acceptance evidence

The completion report must include:

- before/after `npm test` wall-clock and emitted elapsed values;
- before/after full `npm run pr-gate -- --ticket MRQ-70` wall-clock;
- the current 39 Vitest files / 204 tests and 38 native Node tests still passing (or an exact explanation if master changes the count before validation);
- the rejected `--fileParallelism=false` and `--isolate=false` experiments above;
- the resulting `speed-report.json` latest harness entry and bounded pr-gate history;
- explicit statement that MRQ-70 owns no AC directly and therefore has no claims file;
- the exact pre-PR gate result pasted into the completion comment.

## Non-goals

Do not raise either budget, weaken/delete tests, alter contract documents, mint AC IDs, broadly consolidate integration files, alter production code, or merge the PR. The Orchestrator owns merge and final lifecycle completion after `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **FAIL / MAJOR — speed trend not delivered:** Accepted. The existing `recordSpeedHarness` overwrites `harness.pr_gate`; implementation now explicitly extends `scripts/checks/lib/command.mjs` to preserve a bounded `history` array while retaining the latest-value shape and budget fields.
- **FAIL / MAJOR — batching win unquantified:** Accepted. Step 2 now requires temporary local-only timing of a representative `applyMigrations()` call, removed before the implementation commit, and the plan now names a 3-second-under-budget success bar for both `npm test` and full pr-gate.
- **FAIL / MINOR — DDL batch semantics unnamed:** Accepted. Step 3 explicitly verifies Miniflare D1 DDL batching, preserves statement/trigger order, and documents that a failed chunk may leave only a disposable partial schema in the failed isolate.
- **FAIL / MINOR — factual drift:** Accepted. The plan now identifies the four migration files as 993 total lines and records the measured 3.13s Node-suite result as run variance against the ticket's earlier 1.4s figure.

## Implementation Measurement Update (AUTHORITATIVE)

The required timing probe supersedes the initial batch hypothesis. The representative Worker file took 7.90s wall-clock while its schema apply took 238ms, so batching DDL would not cut the dominant per-file boot cost. The combined `--no-file-parallelism --no-isolate` experiment was also rejected: it took 17.76s but failed three suites with shared-schema contamination and skipped 17 tests. The safe measured win is the project split: a temporary Worker config ran 27 files / 148 tests in 13.67s, while a normal Node Vitest config ran 12 Worker-free unit files / 56 tests in 0.51s. No test files or assertions move; only the harness selects the runtime.

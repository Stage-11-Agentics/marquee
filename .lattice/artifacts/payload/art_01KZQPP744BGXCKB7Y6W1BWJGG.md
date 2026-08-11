# Plan Review: MRQ-28 (M-27 Two-round funnel + M-46 Comparison mode)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are minor clarifications the implementer should absorb; none require returning to `in_planning`.

## 2. Summary

Reviewed the MRQ-28 plan covering ACs AC-98–100 and AC-163–166 against the live codebase at `5a10caa`. Every load-bearing claim in the plan verifies: the schema (`evaluation_rounds.mode` with a `scorecard`/`comparison` CHECK and `scorecard` default, `comparisons` with a `json_array_length = 3` constraint, `round_promotions`), the reuse targets (`bulkSelectorWireSchema`/`normalizeBulkSelector` in `src/api/bulk.ts`, `runBulkByIds`, `submissionFilterSchema`/`selectSubmissionIds` in `src/routes/submissions.queries.ts`, `reviewerCanBeAssignedToSubmission` and `authorizeReviewerScope` in `src/lib/reviewer-scope.ts`), the extension points (`evaluation.routes.ts` with its existing `promoteRound`, `review.routes.ts`, `submission-record.routes.ts` which already returns round-grouped evaluations, the three named UI pages), the AC-claims mechanism (`exercises` is a real field consumed by `trace-ac-core.mjs`, and `tests/ac-claims/MRQ-17.json` does own AC-98 exactly as the plan states), and the verification commands (`trace:ac` with `--scope`/`--ticket`, `check:api`, `pr-gate` all exist in `package.json`). This is an unusually well-grounded plan. The key residual concern is a definitional one: what "filtered round-1 list" means for the promotion source universe (issue 1).

## 3. Issues

**[MINOR] Implementation plan §2 — "Filtered round-1 list" source universe left implicit**
The current `promoteRound` (src/routes/evaluation.routes.ts:740–742) selects from the **event-wide** `submissions` table (`status = 'in_review'` when the selection is empty), not from any round-1-scoped membership set (e.g., `round_assignments`). Swapping the selector to `submissionFilterSchema`/`selectSubmissionIds` inherits those event-wide semantics. AC-99 reads "bulk promote from a **filtered round-1 list**; promoted set appears in round 2, unpromoted does not." In this product round 1 is the intake round, so event-wide-in-review is a defensible reading of "the round-1 list" — but the plan never says which universe it intends, and the AC-99 test's "unpromoted does not appear" assertion is only meaningful once that universe is pinned.
**Recommendation:** State explicitly in the implementation (and encode in the AC-99 test) which membership set defines the round-1 promotion source — event submissions in review, or a round-scoped set — so the negative assertion measures against the right universe. The plan's existing rule ("the round-two membership query must include promoted IDs only, never unpromoted IDs") is the right complement; pair it with an explicit source definition.

**[MINOR] Evidence §5 — `e2e:`-tagged ACs covered only by integration tests, deferral not stated**
EVALUATION.md tags AC-99, AC-100, and AC-164 as `e2e:` (Playwright, per the §1 suite-ref key), but the plan's evidence section proposes only Vitest integration coverage plus manual `in_validation` exercising. There is established precedent for this (MRQ-33 owns e2e-tagged AC-118 via integration tests; `tests/e2e/` does not exist yet anywhere in the repo despite `playwright.config.ts` pointing at it, so `trace:ac` will pass either way). This is a fleet-wide pattern, not an MRQ-28 defect — but the plan silently treats integration coverage as equivalent rather than acknowledging the gap.
**Recommendation:** Add one line to the Evidence section noting that Playwright coverage for AC-99/100/164 is deferred to the project-wide e2e suite (whichever ticket lands `tests/e2e/`), so the deferral is a recorded decision rather than an omission a later gate has to rediscover.

**[MINOR] Ground truth §1 — pinned base commit is one commit stale**
The plan pins `62b8748` as the working base; `master` has since advanced to `5a10caa`. Verified: that commit touches only `.lattice/` orchestration state (board-filter tick), so there is no code impact — but the plan's "clean branch tip" language will be one commit behind at implementation time.
**Recommendation:** Rebase the worktree onto the current `master` tip at implementation start, exactly as the plan already did once for the `8a39b4b` → `62b8748` drift. No other change needed.

**[MINOR] Implementation plan §2 — legacy `promoteInput` compatibility scope unnamed**
The plan keeps "a narrow compatibility interpretation for the current UI's empty legacy selection" while replacing the primary selector. The current wire contract (`preview` defaulting true, `submission_ids` defaulting `[]` meaning "all in-review") is exercised by existing integration tests and the current `EvaluationPage` UI. The plan doesn't enumerate which existing callers/tests will need updating versus which the compatibility shim must keep green.
**Recommendation:** Before changing the schema, grep for existing callers of the promote endpoint (tests and UI) and decide per-caller: migrate to the typed selector or rely on the shim. Keeping `preview` semantics intact should be an explicit invariant.

## 4. Positive Observations

- **The plan is grounded in the real codebase, not an imagined one.** Every symbol, file, table, npm script, and route it names was verified to exist under exactly the stated name — including subtle ones like the `exercises` field in ac-claims manifests and the `--scope=merged --ticket=` flags on `trace:ac`. This is the single strongest predictor of a clean implementation pass.
- **The AC-98 ownership conflict is caught and resolved correctly.** Noticing that MRQ-17 already owns AC-98 and structuring MRQ-28's manifest as `owns` = AC-99/100/163–166, `exercises` = AC-98 is precisely how the trace machinery is designed to be used, and would otherwise have been a guaranteed gate failure.
- **AC-166 is engineered structurally, not procedurally.** Keeping scorecard and comparison evidence in their existing separate tables and making mode switch a single-column update on `evaluation_rounds.mode` makes the load-bearing AC true by construction; the test then confirms rather than carries the invariant.
- **Reuse discipline is explicit.** "Do not add a third bulk writer, duplicate reviewer-scope predicate, or new record surface" names the three most likely architectural regressions in this module and forecloses each with a specific existing seam (MRQ-19 selectors, MRQ-8 `runBulkByIds`, MRQ-33 record route, M-16 reviewer scope).
- **Negative tests assert absence of state, not just status codes** — the 422-plus-zero-`round_assignments`-rows check with an in-scope positive control is exactly the right shape for authorization tests, and the plan says so unprompted.
- **Scope hygiene is strong.** Non-goals restate the EVALUATION §5 boundary, the cut-line contingency for M-46 is carried forward, and no migrations or contract-doc edits are proposed against a schema that verifiably already supports the feature.

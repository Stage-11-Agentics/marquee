# Plan Review: MRQ-28 (M-27 Two-round funnel + M-46 Comparison mode)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the merged M-27 + M-46 plan against the ticket, EVALUATION.md, and the live codebase. Every load-bearing claim in the plan was verified against ground truth: the schema in `migrations/0001_init.sql` is already fully round-aware (`evaluation_rounds` carries a `mode` column defaulting to `'scorecard'` with a `CHECK (mode IN ('scorecard','comparison'))`, `comparisons` enforces exactly-three submission arrays at the database level, `round_promotions` exists), all named reuse seams exist (`bulkSelectorWireSchema`/`normalizeBulkSelector`/`runBulkByIds` in `src/api/bulk.ts`, `reviewerCanBeAssignedToSubmission` and `authorizeReviewerScope` in `src/lib/reviewer-scope.ts`), and the AC-98 ownership collision with MRQ-17 is real (`tests/ac-claims/MRQ-17.json` owns AC-98) and correctly resolved via the `exercises` field, which `trace-ac-core.mjs` supports and other tickets already use. The only concerns are minor: base-commit drift since the plan was written, and two small clarifications worth carrying into implementation.

### 3. Issues

**[MINOR] Ground truth and boundary — Base commit has drifted one commit ahead**
The plan pins `forgejo/master` at `62b8748`, but master is now at `d872b8f` ("Rule the comms.routes.ts seam"). The new commit touches only `comms.routes.ts` territory, and MRQ-28 declares no shared files, so conflict risk is near zero — but the verification/handoff section promises a PR against `master`, and a stale base invites a needless rebase at PR time.
**Recommendation:** Rebase the worktree onto the current master tip (or whatever the tip is at implementation start) before building, and name the actual HEAD in the review artifact rather than the plan's pinned SHA.

**[MINOR] Step 1 — "Two-round/position invariant" needs a precise definition before it's enforced in a PATCH**
The schema permits any number of rounds (`position >= 0`, no cap), and rounds are created through the existing `POST /plans/{planId}/rounds`. The plan says the new `PATCH /rounds/{roundId}` will "enforce the two-round/position invariant," but doesn't say what that means operationally: reject settings edits when a plan has >2 rounds? Refuse position changes? Only validate ordering for promotion? An ambiguous invariant in an admin mutation is where scope creep or an accidental behavior change to existing round creation could sneak in (the ticket's non-goal is multi-round *features*, not a new hard cap on round creation).
**Recommendation:** State the invariant concretely in the implementation: the PATCH validates round ordering for mode/settings changes and never mutates position across rounds; do not retrofit a round-count cap onto the existing round-creation endpoint.

**[MINOR] Step 2 — Legacy-selector compatibility should be pinned down as "preview vs. apply" behavior**
The existing `promoteRound` (`evaluation.routes.ts:718`) takes `submission_ids` + `preview` and rejects a non-preview empty list with 422. The plan's "narrow compatibility interpretation for the current UI's empty legacy selection" is the right instinct but is the one place in the plan where behavior is described vaguely enough to drift — an over-generous interpretation (empty selection = promote everything) would be an AC-99 violation in the opposite direction.
**Recommendation:** Make the compatibility rule explicit in code and test: an empty legacy selection never promotes anything; only a typed selector (ids or filter) can select, and the filter path must go through `normalizeBulkSelector`/`selectSubmissionIds` so list semantics and promotion semantics cannot diverge.

No critical or major issues found.

### 4. Positive Observations

- **Every reuse claim is real.** This plan names ten-plus specific seams (functions, files, npm scripts, schema tables) and all of them exist exactly as described. That precision is rare and dramatically de-risks the implementation pass: `check:api`, `trace:ac`, `pr-gate` are real scripts; `EvaluationPage.tsx`, `ReviewerPage.tsx`, `SubmissionRecordPage.tsx`, `evaluation.test.ts` all exist; the new `PATCH /rounds/{roundId}` and comparison endpoints conflict with nothing in the current route manifests.
- **The AC-98 ownership collision was caught at plan time.** MRQ-17 already owns AC-98; the plan's `owns`/`exercises` split matches the tracer's actual semantics rather than guessing at them. This is exactly the kind of cross-ticket collision that normally surfaces as a failed gate after implementation.
- **AC-166 is treated as the load-bearing criterion it is.** The design insight — mode switch mutates only `evaluation_rounds.mode` while scorecard and comparison evidence live in separate tables that are never rewritten — makes AC-166 hold by construction, not by careful deletion-avoidance. The schema already supports this; no migration is correctly identified as needed.
- **Authorization risk is named and tested for absence, not just status codes.** The plan's commitment to assert zero `round_assignments` rows on out-of-scope committee distribution (with an in-scope positive control) and absence of leaked IDs/titles is the right standard for the reviewer-scope surface, and it routes every reviewer-facing read/write through the existing `authorizeReviewerScope`/`reviewerCanBeAssignedToSubmission` predicates rather than duplicating them.
- **Evidence strategy matches project precedent.** The `e2e:`-tagged ACs (AC-99, AC-100, AC-164) are covered the way this repo already covers e2e-tagged criteria (cf. `agenda.AC-70-74-252-253.test.ts` for AC-70/74): AC-tagged integration tests plus a live Worker/fixture pass during `in_validation`. The comparison win-count rule (tied cards score no win over each other; a win per lower-ranked opponent) is stated precisely enough to be deterministic, satisfying AC-165's "aggregate order equals win count."
- **Non-goals and cut-line are carried forward faithfully** — no third round, no parallel mode, no new bulk writer, no new record surface — and the plan extends the MRQ-33-owned `submission-record.routes.ts` rather than forking a parallel record view.

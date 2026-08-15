# Code Review: MRQ-169

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the MRQ-169 branch (`mrq-169-assignment-model`, commits `1691d2d3`..`5602103d` on top of already-merged `main` work) against its plan and the round-5 defect list. The rebuild does what it says: `round_assignments` is now always a `(round, submission, reviewer)` row, distribution is a pure, unit-tested allocator (`src/lib/assignment-allocation.ts`) driven by set-based eligibility/existing/load queries instead of ~2,000 per-pair D1 round trips, the queue/dashboard/reminders all read the same direct-row predicate, reviews are a real upsert-and-reopen flow, refusals are server-authored and rendered inside the dialog that caused them, and pools are a first-class CRUD surface. The one non-obvious writer of blanket rows outside the ticket's named files — `writeRoutingPoolAssignment` (auto-routing) — was correctly migrated too, which the plan didn't call out by name but the design requires. `npm run pr-gate` passes clean (215/215 tests, trace:ac clean) in this worktree, and the new/updated tests (allocator unit suite, an ~280-line MRQ-169 integration block, and updates to reviewer-isolation/reviewer-provisioning/bulk-paths/reviewer-boundary fixtures that depended on the old blanket-row shape) verify the acceptance-floor scenarios directly, including the promoted-round targeting, partial-coverage reporting, direct-refusal wording, and revision upsert.

Note on process: the diff attached to this review's prompt was truncated by the Lattice tooling at 5,000 of 7,255 lines and — because the local `main` this worktree diffs against is stale relative to `github/main` — was also polluted with ~20 already-merged, unrelated tickets' changes (deploy freeze, Sessionize import fixes, theme thumbnails, etc.). Neither affected the verdict: I reviewed the actual worktree directly (`git diff cb2794d7...HEAD`, the true MRQ-169-only diff) and ran the real test suite rather than relying on the prompt's diff text.

## 3. Issues

No issues found.

Two sub-critical observations, neither blocking:

**[MINOR] tests/node/reviewer-boundary.AC-214-246.test.mjs / assignment-allocation.MRQ-169.test.ts — allocator's `everyone` mode isn't cap-tested**
The per-reviewer cap (`maxPerReviewer`) is well covered in `n_per_submission` mode (`the per-reviewer cap binds, and says that it bound`), but there's no unit case combining `reviewersPerSubmission: null` (everyone mode) with a binding `maxPerReviewer`. Reading `allocateAssignments`, the cap filter applies identically regardless of mode, so this is very likely fine — just noting the gap for completeness rather than as a defect.
**Fix:** optional — add one more `CONTRACT` case pairing `everyone` mode with a small `maxPerReviewer` if this path is exercised by real conferences.

**[MINOR] src/routes/evaluation.routes.ts distributeAssignments — dropped explicit "target exceeds committee size" refusal**
The pre-existing check `if (body.mode === "n_per_submission" && target > reviewers.length) throw ApiError.unprocessable(...)` is gone; an organizer who asks for 5 reviewers per submission from a 3-person pool now silently gets `partially_covered` in the report instead of an upfront refusal. This is a deliberate and correct consequence of the design principle "partial coverage is a REPORT, not an error" (D1), and the coverage-report UI does surface it — just flagging that it's a behavior change from today's main, not an oversight.
**Fix:** none needed; this is working as designed. Consider it only if an organizer workflow specifically wants the earlier upfront guardrail back.

## 4. Positive Observations

- **The allocator is genuinely pure and well-isolated.** `allocateAssignments` in `src/lib/assignment-allocation.ts` takes plain Maps/arrays and returns a report with no D1 access, so the balance/idempotence/cap/partial-coverage rules are pinned by 8 fast unit tests with no Worker isolate — exactly what the plan asked for.
- **The bulk write path is properly bounded.** Eligibility, existing rows, and load are each fetched in one set-based query (submission×reviewer joined through `submission_tracks`/`reviewer_track_scopes`), and writes go out in 500-row batches via `json_each`/`json_extract` rather than one prepared statement per pair — the exact fix for the "~2,000 D1 round trips, fails on first miss" defect.
- **The queue/dashboard/reminder disagreement is closed at the root**, not patched per-surface: `REVIEWER_ASSIGNMENT_SCOPE_SQL`, `assignedSubmissionIds`, `completedSubmissionIds`, `comparisonCandidateIds`, and the comparison-ranking write guard all dropped the `committee_members`/`committees` LEFT JOIN in the same way, and the bind-parameter counts were correctly reduced to match.
- **Found and fixed the same bug in a place the plan didn't name.** `writeRoutingPoolAssignment` (auto-routing rules) used to write the same kind of blanket `committee_id` row `distributeAssignments` did; this diff migrates it to per-reviewer materialization too, with a test (`category-routing.AC-135-137-234.test.ts`) updated to assert the new shape. That's the kind of completeness the "one idea of an assignment" framing demands and is easy to miss.
- **Refusal messages are honest and specific**, not just relocated: `trackScopeRefusal` names the reviewer's actual responsibilities and the abstract's actual tracks ("Sam Whitfield reviews Evals and Infra; this abstract carries RAG/Retrieval..."), and `AUTHORED_CODES` on the client deliberately limits server-sentence passthrough to `unprocessable`/`conflict` — verified by a test that `forbidden` still gets the taxonomy sentence even with a server message present, so a genuine permission error doesn't get mistaken for an actionable rule violation.
- **UI reserved-space discipline is enforced by both a CSS assertion test and browser validation** (`.distribution-outcome { height: 186px }`, `.eval-dialog-error { min-height: 16px }`, checked in `abstract-management.MRQ-169.test.ts`, with the last commit message noting live browser confirmation) — directly satisfying the project's "elements never jump" rule.
- **Test fixtures that encoded the old model were updated with explanatory comments, not just changed silently** — e.g. `reviewer-boundary.AC-214-246.test.mjs` now asserts the scope SQL *doesn't* reference `committee_members`, and `bulk-paths.AC-66-69.test.mjs` asserts the new `json_each`-based batch write pattern — so a future reader can see the model change was deliberate, not drift.
- Ran `npm run pr-gate` directly in the worktree: 215/215 tests pass, `trace:ac` reports zero uncovered claims (one pre-existing `felt` AC pending operator review, unrelated to this ticket).

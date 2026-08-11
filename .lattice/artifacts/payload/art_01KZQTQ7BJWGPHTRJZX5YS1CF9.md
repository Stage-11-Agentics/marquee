# Code Review: MRQ-28 — Two-round funnel and comparison mode

Reviewed branch: `mrq-28-rounds` at `8f13355` ("MRQ-28 implement two-round evaluation funnel"), diffed against `master`. Review was grounded in the live worktree: focused evaluation integration tests (16/16 pass, 4.4s), full suite (`npm test` → pass, 10.3s, hermetic), `check:api` (no findings), `trace:ac --scope=merged --ticket=MRQ-28` (no errors, no uncovered), and `pr-gate --ticket MRQ-28` (pass, 14.5s / 45s budget) were all run and pass.

### 1. Verdict

**FAIL (implementation-level)** — The plan is sound and almost all of it is implemented faithfully, but the reviewer comparison queue hard-fails (403 for the entire queue) when any single candidate assignment falls outside the reviewer's current track scope — a reachable state the codebase's own scorecard queue explicitly tolerates by skipping. One small, well-localized fix; the task should return to `in_progress`.

### 2. Summary

The implementation covers all seven ACs with real tests, reuses the mandated bulk contracts (MRQ-19 selector, MRQ-8 `runBulkByIds`), implements the legacy-selector no-op exactly per the Cycle-1 resolution, and keeps mode switches settings-only so AC-166's round trip genuinely preserves both evidence tables. The one defect that forces the verdict is an authorization-failure handling divergence between the new comparison queue and the existing scorecard queue: the scorecard path skips unauthorized candidates, the comparison path throws, turning a stale assignment into a reviewer-facing dead end. Everything else found is minor.

### 3. Issues

**[MAJOR] src/routes/review.routes.ts:492 (`comparisonQueuePayload`) — One out-of-scope candidate 403s the entire comparison queue**
`comparisonCandidateIds` filters by assignment only, not by current track scope. The loop then calls `authorizeReviewerScope(...)` bare — no try/catch — so the first candidate outside the reviewer's scope throws 403 and the whole `/rounds/{roundId}/comparisons/next` response fails. The existing scorecard path (`reviewerQueue`, review.routes.ts:203–211) handles exactly this case with an explicit catch-403-and-continue, with a comment stating an out-of-scope direct assignment "must not prevent other authorized cards from loading." The state is reachable through a supported flow: AC-246's manager scope-edit changes a reviewer's track scopes while preserving existing assignments, leaving stale assignments outside the new scope. When that happens in a comparison round, the ReviewerPage shows only the error state — a dead end for the reviewer, against the project's zero-dead-ends rule. (Note `reviewerQueuePayload`'s equivalent bare call at line 426 is safe only because its ids were pre-filtered by `reviewerQueue`; the comparison payload consumes the *unfiltered* candidate list, so the same shape is not equivalent.)
**Fix:** In `comparisonQueuePayload`, wrap the `authorizeReviewerScope` call in the same `try { … } catch (error) { if (error instanceof ApiError && error.status === 403) continue; throw error; }` pattern used by `reviewerQueue`, and compute `eligible_count` from the authorized set rather than the raw candidate list. Add a test: narrow a reviewer's scope after assignment, then assert the comparison queue still returns the remaining authorized cards.

**[MINOR] src/routes/review.routes.ts:543–560 (`writeComparisonRoute`) — No idempotency on comparison writes; duplicates inflate the chair aggregate**
The insert is unconditional and `comparisons` has no uniqueness constraint on (round, reviewer, submission set). The UI's `saving` flag prevents double-clicks, but a retry after a network timeout whose first request actually landed records the same triple twice, and every duplicate double-counts wins in the AC-165 aggregate. The queue excludes already-compared submissions, but the write path doesn't check. (The AC-165 test itself posts two comparisons over the same triple from the same reviewer, so today's behavior is codified — flagging as a design risk rather than a broken AC.)
**Fix:** Either reject a second comparison by the same reviewer covering any already-compared submission in the round (mirroring the queue's NOT EXISTS predicate) with a 409, or dedupe to latest-per-reviewer-per-triple inside `comparisonWinCounts`. If double-voting is intended, say so in a comment at the insert.

**[MINOR] src/lib/evaluation-comparisons.ts:61 (`comparisonWinCounts`) — `ranking.indexOf(group)` inside the per-submission loop**
Recomputing the group's index by reference-equality `indexOf` for every submission in the group is wasted work and fragile (it silently depends on group arrays being unique references). Harmless at three cards, but the idiomatic form is also clearer.
**Fix:** Iterate `for (const [groupIndex, group] of ranking.entries())` and compute `lowerCards` once per group from `groupIndex`.

**[MINOR] src/routes/evaluation.routes.ts:247–255 (`planDetail`) — Sequential per-round awaits embedded in the object literal**
The new `comparisons` COUNT and `promotions` list run as inline `await`s inside the literal, per round, serially — an N+1 shape stitched into a property expression. With exactly two rounds it's cheap, but it cuts against the surrounding code's batched style and against speed-as-a-graded-feature (R7) if rounds ever grow.
**Fix:** Hoist both queries above the literal (a single grouped query over all round ids, or at minimum `Promise.all` per round) and reference the results.

**[MINOR] src/routes/evaluation.routes.ts:957 (`listRoundComparisons`) — Duplicate `submissionIds`/`submission_ids` fields on the wire**
Each evidence object carries the same array twice, once camelCase (needed internally for `comparisonWinCounts`'s `ComparisonEvidence` shape) and once snake_case (the API surface). Shipping both to clients is accidental API surface.
**Fix:** Keep the internal camelCase copy out of the response — map to the wire shape (snake_case only) when building `comparisons`, or strip `submissionIds` before `context.json`.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:295 — Missing `key` on the round `<option>` list**
`plan.rounds.map((round) => <option value={round.id}>…)` renders a keyless list.
**Fix:** `<option key={round.id} value={round.id}>`.

**[MINOR] src/routes/evaluation.routes.ts:462–500 (`updateRound`) — Read-modify-write PATCH with `concurrency: "none"`**
The handler reads the current round, merges, and UPDATEs; two concurrent PATCHes interleave and the loser's fields silently revert (e.g., a mode switch racing a rename). Low likelihood for a single program lead, and consistent with some existing routes, so minor.
**Fix:** Either single-statement `COALESCE`-style partial update, or use the route policy's concurrency guard as done on routes that already opt in.

### 4. Positive Observations

- **The Cycle-1 resolutions were implemented to the letter.** The legacy `{submission_ids: []}` path is a genuine no-op — preview reports 0/0, apply 422s, and the AC-99 test proves no rows were written by comparing `round_promotions` counts before and after, not just status codes. The round PATCH (`roundPatch`, `.strict()`) omits `position` and criteria exactly as ruled, and `evidence_preserved` semantics hold because a mode switch touches only `evaluation_rounds.mode`.
- **A real cross-event leak was fixed in passing**: the submission-record evaluations query gained a `plan.event_id` filter (submission-record.routes.ts), so evaluations from another event's round can no longer surface on a record.
- **Authorization discipline on the write paths is right.** All three comparison cards are authorized *before* any insert (with a comment explaining why order matters), and the new committee-distribution guard validates every reviewer/submission pair before constructing any statement — with the AC-98 test asserting both 422 and zero rows, plus an in-scope positive control, exactly as the plan demanded.
- **No third bulk writer, no duplicate predicate.** Promotion runs through `bulkSelectorWireSchema`/`normalizeBulkSelector`/`selectSubmissionIds`/`runBulkByIds`; I verified `runBulkByIds` is a single-statement JSON-set write, so `meta.changes` as the promoted count is trustworthy.
- **The chair aggregate is deterministic and tie-correct**: wins desc, then title, then id, with standard-competition ranks (tied wins share a rank), and tied cards granting no win over each other — matching the documented 2/1/0 contract in `evaluation-comparisons.ts`.
- **Test quality is strong throughout**: AC-tagged names, behavior-level assertions (row counts, record payload shapes), a tied-ranking storage round-trip, and the AC-166 both-ways mode switch verifying both evidence tables. The whole suite stays hermetic at ~10s, and `check:api`, `trace:ac`, and `pr-gate` all pass on the exact reviewed HEAD.

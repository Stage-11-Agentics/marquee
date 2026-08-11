# Code Review: MRQ-28 — Two-round funnel + comparison mode

**Branch:** `mrq-28-rounds` · **HEAD reviewed:** `d4d7691` · **Base (merge-base with forgejo/master):** `b42f658`

Note on the embedded diff: the prompt's diff was truncated at 5,000 lines and included unrelated fleet artifacts (MRQ-34 Lattice files, agenda-track-board tests) from the branch's ancestry. I reviewed the true scoped diff — `git diff b42f658..d4d7691` in the `mrq-28-rounds` worktree — which is 14 files, +863/−68, entirely within the ticket's stated module boundary.

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the full MRQ-28 diff (evaluation/review/record routes, the new `evaluation-comparisons` helper, three UI surfaces, and AC-tagged integration tests) against the plan, the plan-review resolutions, and ACs AC-98–100 / AC-163–166. The implementation is faithful to the plan in every load-bearing respect — typed selector promotion through MRQ-19/MRQ-8 contracts, per-card `authorizeReviewerScope` before any comparison read/write, mode switches that touch only `evaluation_rounds.mode`, and zero-row assertions on the security paths. All gates verified green in the worktree at `d4d7691`: `npm test` (pass, hermetic, 14 s), focused `evaluation.test.ts` 17/17, `check:api` zero findings, `trace:ac --scope=merged --ticket=MRQ-28` 0 uncovered / 0 errors, `pr-gate --ticket MRQ-28` pass, `tsc --noEmit` clean. Remaining findings are minor performance and craft notes, none blocking.

## 3. Issues

**[MINOR] src/routes/review.routes.ts:227 — `activeRoundForEvent` authorizes candidates one query at a time on the hot queue read**
For each round of the open plan, the function loads all candidate submission IDs and then calls `authorizeReviewerScope` (a DB round-trip each) sequentially until one authorizes. A reviewer with many stale assignments — or none authorized — costs O(rounds × candidates) sequential queries on every `/reviewer/queue` load. Speed is a graded feature (R7). It's functionally correct, follows the codebase's documented "candidate pre-filter + per-ID authorize" pattern, and short-circuits on the first hit, so this is a note, not a defect.
**Fix:** Cap the per-round probe (e.g., authorize at most the first N candidates before falling through), or push the track-intersection predicate into the candidate SQL so the authorization loop only confirms the head.

**[MINOR] src/routes/review.routes.ts:492 — `comparisonQueuePayload` pays one authorization query per candidate just to compute `eligible_count`**
Cards beyond the first three contribute nothing to the payload except the count, but each still costs a full `authorizeReviewerScope` round-trip. Same shape as the issue above; same mitigation. If `eligible_count` beyond "≥3" isn't load-bearing for the UI, clamp it.
**Fix:** Stop authorizing once three cards are loaded and report `eligible_count` as a floor, or compute the count with one set-based query.

**[MINOR] src/routes/evaluation.routes.ts:714 — committee distribution validates reviewer/submission pairs via `Promise.all` of per-pair queries**
`everyone` mode on a large committee × submission set fires pairs-many `reviewerCanBeAssignedToSubmission` queries before the batch write. The plan explicitly mandated per-pair validation before any write, so this is plan-compliant, and it correctly leaves zero rows on rejection (verified by the AC-98 test).
**Fix:** When it matters, replace the per-pair loop with one set-intersection query returning the first invalid pair; keep the same 422 shape.

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:415 — comparison evidence rendered as raw `JSON.stringify(ranking)`**
The record card shows `[["sub-a"],["sub-b","sub-c"]]` verbatim. That's machine notation on an organizer surface — off-voice for the Flight Deck language rules ("the organizer's language") even if the information is correct and correctly scoped.
**Fix:** Render ranks as ordinals with titles or short IDs ("1 · …, 2 (tie) · …"), matching how the scorecard rows are humanized on the same card.

**[MINOR] src/ui/review/ReviewerPage.tsx:342 — comparison cards pre-select ranks 1/2/3 by load order, so one click records an unconsidered ranking**
"Save comparison & next" is enabled immediately with default ranks assigned by queue position. A reviewer who mis-clicks records real evidence (2/1/0 wins) they never chose, and the chair aggregate counts it. Not an AC violation — AC-164/165 only require ties and deterministic aggregation — but it's an evidence-quality footgun.
**Fix:** Start ranks unset and enable save once each card has a rank (ties still allowed), or visibly mark the default as "unranked" until touched.

## 4. Positive Observations

- **AC-166, the load-bearing criterion, is structurally guaranteed, not just tested.** Mode switches go through a `.strict()` PATCH that can only touch settings columns; scorecards and comparisons live in their own tables and no code path deletes or rewrites either on a mode change. The round-trip test (scorecard → comparison → scorecard with both evidence kinds asserted on the record) confirms it end to end.
- **Security posture is consistently "absence of rows, not just error status."** The AC-98 round-2 out-of-scope test asserts 422 *and* a before/after row-count equality with an in-scope positive control; the comparison write authorizes all three cards before the insert so a scope failure can't leave partial evidence or reveal which card was out of scope; the legacy `{submission_ids: []}` promotion payload is provably a no-op (preview 0/0, apply 422, row count unchanged) — exactly what the plan-review resolution demanded, closing the old "empty array means promote everything in review" hazard.
- **Reuse discipline is exactly what the plan asked for:** promotion runs through MRQ-19's `bulkSelectorWireSchema`/`normalizeBulkSelector` + `selectSubmissionIds` and MRQ-8's `runBulkByIds` (single `json_each` statement, so the `meta.changes` promoted count is exact), rather than a third bulk writer. The `already_promoted`/`selected`/`promoted` response makes idempotent re-promotion legible to the UI.
- **`comparisonWinCounts` is small, pure, documented, and correct** — tie groups get no wins over each other, lower groups are counted by size, and the chair aggregate's `wins desc → title → id` sort plus competition-style shared ranks makes ordering fully deterministic (verified by the AC-165 fixture: 3/2/0).
- **A latent cross-event leak was fixed in passing:** the record's evaluations query now joins through `evaluation_plans` and filters on `plan.event_id`, where it previously keyed on `submission_id` alone.
- **The chair aggregate read defensively drops malformed comparison rows** (bad JSON or non-covering ranking) instead of crashing the endpoint — sensible, since every row written through the new route is validated at the boundary.
- Test names carry their AC IDs and the fixture additions (a third in-scope card) are minimal and reused across the comparison tests; the suite stays inside the fast-test budget (13.9 s of a 30 s budget, hermetic).

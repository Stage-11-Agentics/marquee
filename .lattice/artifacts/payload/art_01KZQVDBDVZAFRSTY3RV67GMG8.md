# Code Review: MRQ-28 — Two-round funnel + comparison mode

**Reviewed artifact:** branch `mrq-28-rounds`, HEAD `92589fb`, diffed against its merge-base `b94f099` (current `forgejo/master` tip).

> **Note on the review bundle:** the diff embedded in the review prompt was generated against a stale base and is contaminated with already-merged work from other tickets (MRQ-21 agenda files, MRQ-70 vitest split, `scripts/checks/*`, and a large amount of `.lattice` fleet bookkeeping from MRQ-34/others). None of that is MRQ-28's. I reviewed the true branch boundary instead: **14 files, ~860 insertions**, all module-local, matching the plan's "shared files: none" claim exactly. Reviewers of subsequent tickets should regenerate diffs against the live merge-base.

## 1. Verdict

**PASS**

## 2. Summary

The implementation delivers all seven ACs (AC-98 exercised; AC-99, AC-100, AC-163–AC-166 owned): a typed-selector funnel promotion through MRQ-19/MRQ-8's shared bulk contracts, a settings-only round PATCH that provably preserves evidence across mode switches, reviewer-scoped three-card comparison queue/write with tie support, a deterministic chair win-count aggregate, and a record surface that groups both rounds' scorecard and comparison evidence. I independently re-ran the evidence: focused integration suite **17/17 passing**, `check:api` clean (all new routes in the manifest), `trace:ac --scope=merged --ticket=MRQ-28` clean (no uncovered ACs, no duplicate owners), and `pr-gate --ticket MRQ-28` **PASS in 14.6 s** against the 45 s budget. The issues found are all minor — mostly performance fan-out patterns and one latent UI inconsistency — none blocking.

## 3. Issues

**[MINOR] src/routes/evaluation.routes.ts:714 — Per-pair authorization fan-out in committee distribution**
The pre-write guard fires one `reviewerCanBeAssignedToSubmission` query per (submission, reviewer) pair via `Promise.all(pairs.map(...))`. In `everyone` mode this is S×R concurrent D1 queries — a 200-submission, 20-reviewer event issues 4,000 simultaneous statements on one request. Correctness is right (validate-all-before-any-write, satisfying AC-98's zero-rows requirement), but R7 makes speed a graded feature and this is the most fan-out-prone hot path in the diff.
**Fix:** collapse to one set-based query — bind the pair list as JSON and select the first pair failing the track-scope EXISTS via `json_each`, mirroring the `runBulkByIds` idiom already used three lines later.

**[MINOR] src/routes/review.routes.ts:489–507 — Comparison queue re-authorizes every candidate individually, including past the 3-card cutoff**
`comparisonQueuePayload` loops all candidates calling `authorizeReviewerScope` (2 queries each) to compute `eligible_count`, even after the three cards are filled; `activeRoundForEvent` runs the same per-candidate loop per round until one authorizes. A reviewer with a large backlog pays ~2N queries per queue GET. The re-authorize-each-ID pattern is a deliberate pre-existing invariant (the candidate query is only a pre-filter), so this is consistency, not a defect — but the unbounded `eligible_count` sweep is new cost with low display value.
**Fix:** either cap the eligibility sweep (e.g., stop at the first authorized candidate for `activeRoundForEvent`, and report `eligible_count` from the pre-filter count), or batch the scope check into one set-based query per round.

**[MINOR] src/routes/review.routes.ts:544 — Direct API posts can double-count the chair aggregate**
The queue excludes submissions the reviewer has already compared, but `POST /comparisons` itself has no uniqueness guard, so a buggy or adversarial reviewer client can save the same trio repeatedly and inflate win counts in the AC-165 aggregate. The code comment declares repeat comparisons intentional evidence, so this is a design stance, not an oversight — flagging it because the chair-facing ordering is a decision input.
**Fix (optional):** unique index or upsert on `(round_id, reviewer_person_id, sorted submission_ids)` if the chairs' aggregate should be one voice per reviewer per trio; otherwise document the every-record-counts semantics on the aggregate endpoint.

**[MINOR] src/ui/review/ReviewerPage.tsx:296 vs :337 — Divergent rank fallbacks between display and save**
The rank select renders `comparisonRanks[item.id] ?? index + 1` while `saveComparison` groups by `comparisonRanks[id] ?? 1`. Today `load()` seeds all three ranks so the fallbacks are unreachable, but if the seeding path ever changes, the UI would show 1/2/3 while silently saving an all-tied `[[a,b,c]]`.
**Fix:** use the same fallback expression in both places (extract a `rankOf(id, index)` helper).

**[MINOR] src/routes/evaluation.routes.ts:988 — Aggregate exposes `wins` but not the plan-promised `win_count` alias**
The plan committed to "expose both `wins`/`win_count`". Only `wins` ships; tests and UI consume `wins`, so nothing breaks — this is a small contract deviation worth either adding or striking from the plan record.
**Fix:** add `win_count: item.wins` to the aggregate items, or note the narrowing in the ticket.

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:104 — Progress bar reads scorecard counts in comparison mode**
The round card's progress track is computed from `progress.evaluations` regardless of mode, so a comparison round shows 0% while the adjacent caption correctly reports comparison counts. Cosmetic; the numbers shown are truthful, just the bar is inert.
**Fix:** drive the bar from `progress.comparisons` when `round.mode === "comparison"`.

## 4. Positive Observations

- **AC-166 is preserved structurally, not procedurally.** Mode switches touch only `evaluation_rounds.mode` via a `.strict()` PATCH schema that cannot even express `position` or criteria changes; scorecard and comparison evidence live in separate tables that no code path in this diff deletes or rewrites. The round-trip test asserts survival through the record surface, which is the right observation point.
- **The legacy promotion selector was retired exactly as the cycle-1 resolution specified.** `{submission_ids: []}` previews to zeros, applies to 422 with a row-count-unchanged assertion, and a non-empty legacy array is a hard 400 — the "empty never broadens to all" trap is tested with before/after row counts, not just status codes.
- **Bulk discipline is genuinely reused, not re-implemented.** Promotion routes through `bulkSelectorWireSchema`/`normalizeBulkSelector`/`selectSubmissionIds`/`runBulkByIds`, counts promotions from `meta.changes` (making the pre-check race benign under `INSERT OR IGNORE`), and never materializes a filter result in the response — the durable-bulk amendments are honored without a third writer appearing.
- **Authorization is checked at the right layer everywhere.** Comparison writes authorize all three submissions through `authorizeReviewerScope` *before* the insert, so a scope failure can't leave partial evidence or reveal which card was out of scope; the AC-246 test proves a narrowed track scope shrinks the comparison queue live; the record's evaluations query gained an event-boundary join it previously lacked — a small unprompted hardening.
- **The pairwise-wins helper is clean and its math is verified.** `comparisonWinCounts` handles tie groups correctly (tied cards earn no win over each other), and the AC-165 test pins a non-trivial two-comparison aggregate (3/2/0) including a tied group, with deterministic tiebreak ordering by title then id.
- **Test evidence goes beyond status codes.** Nearly every negative case asserts database row counts unchanged alongside the error status, and positive controls accompany rejections (the out-of-scope 422 is paired with a 3-row in-scope insert). All 17 tests, `check:api`, `trace:ac`, and the full `pr-gate` were re-run cold for this review and pass.

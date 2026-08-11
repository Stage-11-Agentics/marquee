# MRQ-28: Two-round funnel and comparison mode

BUILDPLAN: M-27 (Tier B rank 4, US-30) + M-46 (Tier B rank 27, US-71) — Wave 2 (§5) · MERGED at mint (4 h + 4 h = 8 h; same evaluation-round module, M-46 depends only on M-27)

**M-27 — Two-round funnel** (4 h, ACs AC-98 – AC-100, dep M-16)
Scope (verbatim): per-round scorecard and evaluator set, bulk promote from a filtered round-1 list, both rounds' scores together on the record.

**M-46 — Comparison mode** (4 h, ACs AC-163 – AC-166, dep M-27)
Scope (verbatim): three-card ranking/ties, win aggregate, mode switch preserves evidence.
AC-166 is the load-bearing one: switch a round's mode both ways and scores recorded in the other mode survive intact.

ACs (union): AC-98 – AC-100, AC-163 – AC-166
Hours: 8 (4 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local; consumes `src/lib/reviewer-scope.ts` (M-16's) on every reviewer-facing route.
Deps: M-16
Non-goal (EVALUATION §5): multi-round beyond two — parallel mode, per-round anonymity variation, and round-specific visibility layers are post-competition.
Cut-line note: M-46 sits at **rank 27**, second from the bottom of the band. If the capacity calculation cuts it, the merged ticket ships its M-27 half and gate 19 must name US-71 with AC-163 – AC-166 and the reason.
## Ground truth and boundary

- The initial plan was written against `62b874873655b34d5f6aa24dfa20874c0c79551a`; Forgejo advanced during planning. At the implementation boundary, the branch is based on current `forgejo/master` at `c2293f1`; after any further rebase, run `npm ci` before trusting tests. The requested clean branch tip `8a39b4b` was one commit behind after the fleet dispatch commit.
- MRQ-17 already owns AC-98 in `tests/ac-claims/MRQ-17.json`; MRQ-28 will exercise AC-98 and own AC-99, AC-100, and AC-163 through AC-166. The MRQ-28 test names will still carry every ticket AC so `trace:ac` sees the complete union without duplicate owners.
- The existing first-migration schema is sufficient: `evaluation_rounds`, `round_assignments`, `evaluations`, `comparisons`, and `round_promotions` are already round-aware. Do not edit contract docs or `migrations/0001_init.sql`.

## Outcome

Extend the merged evaluation/reviewer/record module so a program lead can run exactly two ordered rounds with independent scorecards and reviewer assignments, promote exactly a server-filtered round-1 set into round 2, and see both rounds' evidence on one submission record. A reviewer can switch a round between scorecard and comparison mode without losing evidence, compare exactly three authorized submissions with ties, and the review chair can read deterministic win-count ordering.

## Implementation plan

1. **Evaluation domain helpers and round administration**
   - Add module-local pure comparison helpers for validating/normalizing the three-card ranking and computing pairwise win counts; preserve tie groups and make aggregate ordering deterministic.
   - Extend `src/routes/evaluation.routes.ts` with an admin round-settings mutation (`PATCH /api/v1/events/{eventId}/rounds/{roundId}`) for mode/settings. Default newly-created rounds to `scorecard`, enforce the two-round/position invariant, and never delete or rewrite `evaluations` or `comparisons` during a mode switch.
   - Extend plan detail with per-round promotion membership and comparison/score progress needed by the existing evaluation screen; retain the existing round-local criteria and evaluator-set/assignment seams.

2. **Filtered funnel promotion through the existing bulk contracts**
   - Replace the promotion request's primary selector with MRQ-19's `bulkSelectorWireSchema`/`normalizeBulkSelector`, reusing `submissionFilterSchema` and `selectSubmissionIds` so list and select-all filter semantics remain identical. Keep a narrow compatibility interpretation for the current UI's empty legacy selection while moving the UI to the typed selector.
   - Use MRQ-8's `runBulkByIds` for the one server-side `round_promotions` insert. Validate event ownership, the source/next-round ordering, and idempotency before writing; return selected/newly-promoted counts and never materialize an unbounded filter result in the response. The round-two membership query must include promoted IDs only, never unpromoted IDs.
   - Validate every reviewer/submission pair in committee distribution with `reviewerCanBeAssignedToSubmission` before any batch write. This applies equally to round 2; an out-of-track reviewer must return 422 and leave zero `round_assignments` rows. Preserve existing direct-assignment idempotency and assignment modes.

3. **Reviewer comparison mode**
   - Extend `src/routes/review.routes.ts` with reviewer-scoped comparison queue/read and `POST /api/v1/events/{eventId}/rounds/{roundId}/comparisons`. The candidate and write paths must call `authorizeReviewerScope` for every submission before loading or writing data, enforce one event/round and exactly three distinct submissions, and accept normalized ranking groups with ties.
   - Add the chair-facing comparison aggregate read to the evaluation route module. Count a pairwise win for every lower-ranked opponent, give tied cards no win over each other, and expose both `wins`/`win_count` plus stable rank/title data.
   - Keep scorecard writes and comparison writes in their existing evidence tables. Mode changes only change `evaluation_rounds.mode`, so AC-166's scorecard → comparison → scorecard round trip preserves both records.

4. **Record and screens**
   - Extend `src/routes/submission-record.routes.ts`—the MRQ-33-owned record surface—to return round mode, round-grouped evaluations, and comparison evidence/aggregate references together with the existing evaluation panel. Do not create a parallel record view or leak reviewer-only fields.
   - Update `src/ui/evaluation/EvaluationPage.tsx` to expose stable per-round mode controls and a real filtered promotion selector/apply action, preserving the Flight Deck geometry/copy (the organizer noun remains “conference”). Update `src/ui/review/ReviewerPage.tsx` to render exactly three comparison cards and a tie-capable rank control using the new API. Update `src/ui/submissions/SubmissionRecordPage.tsx` to label both rounds' score/comparison evidence on the existing record card.

5. **Evidence**
   - Extend the existing lean `tests/integration/api/evaluation.test.ts` fixture/tests with AC-tagged coverage for filtered promotion membership/idempotency, both-round score record output, default/selectable modes, exactly-three/tied comparison storage, chair aggregate order, and mode switching with intact score evidence. Add the round-2 out-of-scope assignment assertion with both status and zero-row checks plus an in-scope positive control.
   - Add `tests/ac-claims/MRQ-28.json` with `owns` = AC-99, AC-100, AC-163, AC-164, AC-165, AC-166 and `exercises` = AC-98. Run `trace:ac` and `check:api`; every new API module/route must be a `*.routes.ts` entry in the generated manifest.

## Non-goals and risks

- No third round, parallel mode, per-round anonymity variation, or round-specific visibility layer; no migration or contract-document edits.
- Do not add a third bulk writer, duplicate reviewer-scope predicate, or new record surface. The main risk is accidentally allowing filter selection or committee distribution to bypass round/event/track authorization; tests will assert absence of leaked IDs/titles and absence of rows, not only error status.

## Verification and handoff

- After implementation: self-review the exact branch diff and run the focused evaluation integration tests, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope=merged --ticket=MRQ-28`, and `npm run pr-gate -- --ticket MRQ-28`.
- During `in_validation`, exercise the built API path against a running Worker/fixture for promotion, comparison, mode round-trip, record output, and round-2 scope rejection; attach the validation evidence. Before `pr_open`, attach a PASS review artifact naming the exact branch HEAD, push, create the Forgejo PR against `master`, attach its URL, and stop at `pr_open` for the Orchestrator.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Base drift (minor):** accepted. Re-fetch and rebase immediately before implementation, record the exact current `forgejo/master` SHA in the implementation commit/comment, and run `npm ci` after that rebase. Repeat the same boundary check before validation/PR if master advances.
- **Round invariant (minor):** clarified. The new round PATCH changes only settings (`mode`, name, anonymity, target, and open/close timestamps); it validates the owning round's existing position and plan relationship but never changes `position` or adds/removes rounds. Existing creation behavior remains the two-round feature boundary; no new schema-level third-round prohibition is introduced.
- **Legacy promotion selector (minor):** clarified. The old `{submission_ids: []}` shape is retained only as a compatibility no-op: preview reports zero selected/promoted and apply returns the existing validation conflict/422, with no writes. Only a non-empty typed `selector: {ids: [...]}` or `selector: {filter: {...}}` is normalized through MRQ-19's selector helper and can promote records. Add an explicit test so an empty legacy selection never broadens to “all.”

## Reset 2026-08-11 by agent:delegator-mrq-28

# MRQ-97 plan — accepted fact filter and categorized status control

## Contract and scope

- Repository/worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-97-accepted-filter`
- Task: `MRQ-97`, sole delegator
- Own: the submission filter query vocabulary, `STATUS_OPTIONS`, the status select and its styling, and consumers that need label or href consistency.
- Do not touch MRQ-98 surfaces: search, loading/skeleton behavior, saved-view strip, or toolbar layout.
- Do not deploy; local browser validation only, with the deployed site read-only for reproduction if needed.

## Approach

1. Preserve the MRQ-76 invariant by retaining `status=accepted` as the shared derived pipeline-stage predicate used by the submissions list, dashboard stage tile, program board, and agenda placement flow. Add an explicit `accepted_any` filter whose predicate is the stored acceptance fact (`s.status = 'accepted'`).
2. Make both query semantics explicit: `submissionStatusPredicate('accepted_any')` emits the stored fact in the derived/list path, and the `statusSemantics: 'stored'` path maps `accepted_any` to stored value `accepted` so bulk/evaluation/comms selectors cannot silently return zero rows. Split the API response item-status enum from the filter enum so the new filter value is never advertised as a returned list-item status.
3. Audit and update every app entry point, not just predicate consumers:
   - Keep the dashboard pipeline accepted count and its `status=accepted` href paired, but relabel both the tile and its stage destination vocabulary `Ready to place`; point the Unscheduled metric’s count and href together at `accepted_any` plus `placement=unplaced`, so accepted sessions in a wave or onboarding are not silently omitted. Add/extend a test for both count-to-destination pairings.
   - Keep the numbered pipeline sidebar route on the stage query but relabel it `Ready to place`; keep the board stage label equally qualified. Repoint the agenda and onboarding empty-state actions that promise “accepted” records to `status=accepted_any`, because those are organizer-language fact entry points.
   - Leave agenda’s schedulable-status configuration and existing saved views with `status=accepted` intact as the stage contract. New/personal saved views using `accepted_any` must count through the same list query and existing saved-view configuration schema.
   - Requalify the public landing preview’s stage count as `Ready to place`; leave its predicate as the shared stage projection. Leave Communications’ explicit `Accepted` selector unchanged because that screen already uses stored semantics, but record that it is intentionally the fact vocabulary.
4. Rework the status select into a neutral `All statuses` default plus optgroups with concrete labels: Stored decision facts (`Draft`, `Submitted`, `In review`, `Accepted (any stage)`, `Maybe`, `Rejected`, `Withdrawn`); Pipeline stages (`Unreviewed`, `Waved`, `Onboarding`, `Ready to place`, `Scheduled`, `Published`); and Attention queue (`Decided · not notified`). Make the default visibly distinct with a new status-filter class/state, without changing MRQ-98 toolbar layout. No existing filter is removed; `accepted_any` is additive.
5. Add regression coverage at the running API boundary in `tests/integration/api/submission-decisions.AC-66-69-114-117.test.ts` (keep the existing Worker file rather than adding an isolate startup cost). Drive the real accept/bulk-accept action against a seeded event whose task template has `auto_assign`, query `accepted_any` while the acceptance cascade has a pending wave, then assert the same record remains in the fact filter after the wave is sent with onboarding tasks open, after scheduling, and after publishing. Assert the returned stage moves while the fact filter holds, and exercise the stored selector path. Extend MRQ-76 stage coverage, dashboard/list checks, and `tests/unit/route-table.test.ts` so the derived stage sets, qualified labels, and paired href/count contract remain unchanged.
6. Run focused tests, type/build/static checks as proportionate, then the required `npm test` within the project budget. Start the local Worker with the repository recipe, drive the actual submissions screen with c11 browser automation, exercise the categorized control/default styling and `Accepted (any stage)` result, and capture a screenshot. Do not run `wrangler deploy`.
7. Keep the binding prototype’s corresponding pipeline and dashboard labels aligned or call the correction out explicitly as a deliberate fix to the prototype’s category confusion. Before the PR, fetch `github`, rebase this isolated branch onto the current `github/main` if needed, reinstall with `npm ci`, and re-run exact-head gates plus the local browser check because MRQ-98 is editing the neighboring page surface. Commit the implementation/tests, push only to the `github` remote, open `gh pr create --repo Stage-11-Agentics/marquee --base main`, and state the judgment call, href/count decisions, preserved saved-view and Communications semantics, prototype alignment, evidence, screenshot path, and deferred deployment. Human merges.

## Judgment call

The ticket offers either a full status/stage split or a smaller explicit fact entry. I choose the latter because the existing `accepted` stage is a deliberate MRQ-76 shared projection consumed by multiple surfaces; naming the stored fact separately fixes the operator’s mental model without inventing parallel stage derivations. The new filter is labeled `Accepted (any stage)`, while the transient stage is labeled `Ready to place` wherever it appears as a standalone pipeline choice. Existing user-created saved views with `status=accepted` intentionally retain their stage meaning; the built-in saved-view set has no accepted view to migrate. The persisted `accepted_any` token is the stored fact and must remain an accepted alias if a future status/stage split renames it.

## Status checkpoints

- `in_planning`: consumer mapping and this revised plan are being recorded after plan-review feedback.
- `planned`: revised plan is written and accepted before implementation.
- `in_progress`: source/tests edited and local gates running.
- `in_validation`: local browser flow and screenshot captured.
- `pr_open`: exact-head GitHub PR opened; deployment remains deferred.

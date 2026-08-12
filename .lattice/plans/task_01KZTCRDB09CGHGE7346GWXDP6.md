# MRQ-110: Per-round reviewer pools, recusal, reviewer reminders

# Contract

- Rubric: ABS-02 (w2), ABS-12 (w1), ABS-09 (w1); register rows 7, 12, and 14; full scope T-C2.
- Base fallback: parent ref `github/mrq-108-review-depth` is not published at planning time, so this branch is cut from `github/main`. Rebase onto the parent as soon as it exists, then run `npm ci` and re-gate the exact head.
- Stacked PR body must say: `stacked on MRQ-108 — merge that first; this rebases.`
- Do not edit contract docs, mint AC IDs, add per-round membership rows, or widen the participation-shaped communications audience engine.

## Outcomes

1. Each evaluation round can reference one event-scoped committee pool through nullable `evaluation_rounds.committee_id`. The round detail/card renders the selected pool, and distribution uses that round's pool while preserving the existing committee membership and track-scope machinery.
2. A reviewer can choose `Declare conflict` beside the save action. The existing evaluation write records `abstained: 1`, clears recommendation/score/criteria values for the abstention, marks the assignment complete so it leaves the queue, and allows an optional comment. The reviewer detail and chair-facing evidence identify the recusal truthfully.
3. Chair aggregates and denominators exclude abstained evaluations. The chair-facing progress/results surface shows the exact outstanding signal, e.g. `1 recusal · needs reassignment`, without silently counting a recusal as a review. This must compose with MRQ-109's shared aggregate helper rather than creating a second aggregate implementation.
4. Each reviewer progress row with outstanding assignments has a narrow `Remind` action. It validates the round/reviewer and outstanding count, queues exactly one reviewer-specific outbox message through the existing enqueue path with an idempotent reviewer template, and exposes the logged message. It does not route through `recipientsFor` or permit speaker/audience selectors to address reviewers.

## Files and implementation sequence

1. Add the smallest migration needed for nullable `evaluation_rounds.committee_id`, update `src/db/schema.ts`, and preserve existing rows with `NULL`.
2. Extend `src/routes/evaluation.routes.ts` round input/patch/detail/create paths and round pool validation; have distribution consume the selected round pool. Add the narrow reviewer reminder endpoint beside `listRoundAssignments`, deriving assigned/reviewed/outstanding counts from that query's same data seam and using the shared mail/outbox helpers.
3. Extend `src/routes/review.routes.ts` evaluation input/read projection and upsert semantics for abstention. Keep authorization and queue completion behavior intact; a recusal must not become a recommendation or a numeric result.
4. Add a reviewer-only default mail template in `src/jobs/mail/templates.ts` and the merge fields needed for recipient name, round name, and outstanding count. Keep it out of `recipientsFor` and the general audience-role enum.
5. After rebasing onto MRQ-108, add the `ReviewerPage.tsx` conflict control adjacent to the existing save control, with stable feedback space and no false claim that a message was sent. Update the chair/progress UI (`EvaluationPage.tsx` and the parent result surface as applicable) to render round pool, outstanding counts, Remind, and the recusal reassignment label. Resolve any MRQ-109 aggregate collision by using its helper.

## Verification

- Targeted API/integration tests cover: round committee create/read/update and event scoping; distribution uses the round pool; abstention accepts no recommendation, persists `abstained=1`, completes the assignment, and is repeat-safe; aggregates/counts ignore abstentions; reminder rejects completed/nonexistent reviewers, queues a reviewer template to the correct recipient, is idempotent, and leaves speaker audience behavior unchanged.
- Targeted UI/source tests cover visible `Declare conflict`, `Remind`, round pool labeling, and the exact `1 recusal · needs reassignment` copy. The reviewer action must be reachable within the judge's 70-turn budget.
- Run targeted Vitest only for touched files during implementation. Before the PR gate, check `uptime`; if 1-minute load exceeds 24, wait 2–3 minutes and retry. Run `npm run pr-gate -- --ticket MRQ-110`, paste the passing output into the completion comment, attach review and live validation evidence, open the GitHub PR against `main`, attach its URL, and stop at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Verdict: PASS-WITH-NITS (self-review, 2026-08-12).

- The original plan left the chair result file implicit. Resolved: after the parent/sibling rebase, inspect the exact MRQ-109 result projection and update its aggregate consumer(s), including `src/routes/submissions.queries.ts` / the submissions results UI when those are the landed surfaces; use the existing shared helper and do not fork it.
- The reminder path must not accidentally become a general audience feature. Resolved: implement it as a program-authorized evaluation route that directly loads the event-scoped reviewer person and `listRoundAssignments`-equivalent outstanding count, then calls the canonical outbox enqueue helper; do not add `reviewer` to `reminderSelectorSchema.role`.
- The round pool must remain optional for existing plans. Resolved: validate any supplied committee belongs to the round's event, preserve `NULL` on old rounds, and make distribution's UI/API input select the round's persisted pool rather than inventing membership rows.

## Reset 2026-08-12 by agent:delegator-mrq-110

## Plan-Review Cycle 6 Resolutions (AUTHORITATIVE)

Verdict: FAIL from independent exact-head review; all implementation findings are accepted for this focused remediation.

- Raise the mobile `Declare conflict` control to the same 48px target as Save and add a source-level regression assertion for the mobile rule. Align the two save-row controls by moving the 12px top spacing to `.review-save-actions` and neutralizing the standalone Save margin inside that row; preserve the comparison-card Save spacing.
- Keep the chair coverage state tri-partite: `undefined` means the round summary is still loading, `null` means the fetch failed, and an empty object means a successful empty result. Render a reserved loading label for the first state, one coverage sentence only for empty/failed states, and an action-column dash when there is no action.
- Correct the duplicate reminder notice to say `Reviewer reminder already queued today`, matching the event-local-day idempotency key.
- Make round create/update committee scoping failures field-addressable 422s for `committee_id`, while retaining the generic committee route's 404 semantics. Add/update the integration assertion for cross-event round pool input.
- Defer the reviewer's suggested split of `listRoundAssignments?summary=1` into a separate operation: it is a broader generated-client contract redesign outside T-C2, and the current route shape is covered by the existing API contract. Carry it as a later API-contract note rather than expanding this PR.
- Re-run targeted tests, TypeScript, schema/seed checks, the full MRQ-110 gate, and an exact-head review after committing and pushing these changes. Do not reuse the FAIL artifact as the final review evidence.

## Plan-Review Cycle 3 Resolutions (AUTHORITATIVE)

Verdict: FAIL findings addressed before final re-review.

- Move the shared review draft update into the successful POST path. A failed `Declare conflict` must leave the reviewer's entered score, criteria, and recommendation intact; optimistic completion remains after the awaited write.
- Make the row-level `Remind` refresh quiet so it does not replace the whole chair surface with a loading screen; use round-scoped reviewed progress for the completed fallback instead of the plan-wide member counter.
- Derive reminder idempotency's day key in the event timezone by carrying the event timezone through the existing round lookup; the one-per-day boundary must match the organizer's calendar.
- Remove the dead CSS fallback from the recusal status token.
- Keep the current inline abstention filters until MRQ-109's shared aggregate helper lands, and name that merge-order obligation in the PR body. Leave the reviewer-without-assignments 409 and duplicate migration ordinal as non-blocking stack-owned nits.
- Normalize all touched test titles to existing registered `AC-nnn` prefixes without minting criteria; the merged trace must pass before the PR.

## Plan-Review Cycle 4 Resolutions (AUTHORITATIVE)

Verdict: FAIL findings addressed before rebase and final re-gate.

- Rebase the stacked implementation onto the published `github/mrq-108-review-depth` tip, using the old MRQ-108 tip as the explicit cut point. Drop MRQ-108-owned census and test-title rewrites when the parent already carries them; regenerate `cli/api-registry.json` rather than hand-resolving generated output, run `npm ci`, and re-gate the rebased exact head.
- Keep the parent-owned `CONTRACT · MRQ-108 · …` tests and remove the MRQ-110 `AC-93` reminder claim. Add `tests/ac-claims/MRQ-110.json` with no owned criteria, exercises for the existing review criteria it deepens, and an explicit note that reviewer reminders are outside AC-93's speaker audience engine.
- Preserve the narrow communications allowlist hardening and call out in the PR body that auth-template overrides are no longer accepted by the organizer communications routes; this is deliberate defense-in-depth, not a reviewer-audience expansion.
- Distinguish successful empty reviewer coverage from a failed round summary fetch in the chair UI; only the latter says `Coverage unavailable`.
- Keep the event-timezone reminder key internal and strip it from any round response payload. Keep one-click recusal as an explicit product action for this ticket; the existing stable completion notice and reopen path are sufficient, and a confirmation modal would expand the UI scope after the parent rebase.
- Carry the remaining advisory facts into the PR body: the distinct-count correction, no seeded recusal in the deterministic demo, and the committee-scoped assignment counting boundary. MRQ-109's shared aggregate-helper obligation remains a merge-order note.

## Plan-Review Cycle 5 Resolutions (AUTHORITATIVE)

Verdict: final validation found and fixed one rebased verifier expectation.

- The published MRQ-108 parent does not carry the old `0009_file_comments` migration. Keep MRQ-110's actual migration set authoritative: 48 product tables and 92 foreign keys after the new round-to-committee FK. Remove the absent file-comments first-apply assertion while retaining the criterion-kinds and evaluation-round-committee checks.
- Re-run schema verification, seed validation, the full gate, and an exact-head review after this verifier correction; do not treat the earlier gate as final evidence.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

Verdict: FAIL findings addressed before re-gate.

- Re-render the chair committee/progress card for every displayed round and resolve the pool from that round's persisted `committee_id`; the single first-round/first-committee rendering is not sufficient.
- Fix the mobile committee action grid and widen the desktop action track so the `Remind` affordance remains inside the row at narrow widths.
- Keep the recusal count visible as an explicit aggregate note while avoiding an orphan fifth tile in the two-column metric grid.
- Make optimistic reviewer completion preserve the submitted recusal/review state, and share the network commit path between Save and Declare conflict.
- Make reminders idempotent per reviewer/round/day and make progress loading degrade per round so a secondary coverage failure does not hide the plan.
- Add focused branch coverage for validation, round-pool event scoping, round-trip recusal/review semantics, and distribution with a cleared pool where the existing test seams permit it.
- The review artifact also noted two merge-order facts to carry into the PR body: the MRQ-109 aggregate helper is not yet on this branch, so abstention filtering remains at the current consumer seam; the communications allowlist change intentionally keeps `reviewer_reminder` out of the audience engine and therefore changes the comms route's accepted template set.

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

## Reset 2026-08-12 by agent:delegator-mrq-110

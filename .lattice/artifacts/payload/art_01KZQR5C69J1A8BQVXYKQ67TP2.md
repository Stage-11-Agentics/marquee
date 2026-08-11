# Plan Review: MRQ-38 — Role confirm/decline and decision feedback

Reviewer: plan-review actor (Claude) · Reviewed against worktree at `835967d` (forgejo/master) and seam branch `forgejo/mrq-24-chase` @ `b11982c`

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The three issues below are minor and can be resolved as dispositions in the Plan-Review Cycle 1 Resolutions section without returning to `in_planning`.

## 2. Summary

Reviewed the merged M-42 + M-52 plan covering AC-152–154 and AC-235/236 against the task description, SPEC.md, and the live codebase. The plan is unusually well-grounded: every named symbol was verified to exist where the plan says it does (`insertDecisions` / `writeBulkSubmissionDecisions` / `enqueueDecisionMail` in `src/jobs/cascade/decisions.ts`; `enqueueOutbox` with `demo_safe` default in `src/jobs/mail/outbox.ts`; `recipientsFor`, exported `ReminderSelector`, and `renderAdHocMail` on the MRQ-24 seam branch; `confirmation_status`/`confirmed_at` already in `migrations/0001_init.sql:420-422`; the `StatusHero` slot in `PortalPage.tsx`; the conflict-marker pattern in `AgendaPage.tsx`; the `owns`/`exercises` claim-file shape). The single-writer / render-once discipline for AC-235 is correctly identified and enforced. The key remaining concern is a small coordination gap: what happens if MRQ-24 is still unmerged when this ticket's PR opens.

## 3. Issues

**[MINOR] Slice 3 / Verification step 2 — Unstated ordering assumption if MRQ-24 is unmerged at PR time**
The plan builds against `forgejo/mrq-24-chase` (`b11982c`, a WIP-labeled commit) and says to adopt the branch at the implementation rebase and rebase "onto the latest master/MRQ-32 result before the PR." If MRQ-24 has not merged to master by then, the `mrq-38-confirm → master` PR will carry MRQ-24's foreign commits in its diff, which breaks per-ticket review hygiene and could double-merge the seam. The plan handles interface mismatch (escalate, don't fork) but not merge-ordering.
**Recommendation:** State the assumption explicitly: if MRQ-24 is unmerged when MRQ-38 reaches `pr_open`, either hold the PR and report to the Orchestrator, or open it explicitly marked as stacked on `mrq-24-chase` with the dependency-only files enumerated — Orchestrator rules which. Do not silently include the seam commits in the reviewed diff.

**[MINOR] Boundary contract / Tests — Suite already at the 30 s ceiling; new tests will push it over**
Baseline `npm test` measured 29,249 ms against the 30,000 ms harness budget. This ticket adds a five-AC integration file plus node tests; the default suite will almost certainly exceed the budget after this lands. The plan mitigates for *its own* validation (targeted suites) but is silent on the suite it leaves behind, and project policy treats a slow default suite as a defect to raise, not absorb.
**Recommendation:** After adding tests, measure the full default suite once. If it exceeds 30 s, report the overage to the Orchestrator as a suite-budget defect (with the measured number) in the completion comment rather than leaving it for the next ticket to discover.

**[MINOR] Proof case 4 (AC-235) — "byte-equivalent" comparison target is underspecified**
The outbox row stores a fully rendered email (subject/body with surrounding template content); the portal serves normalized feedback markdown from the decision row. These are not byte-comparable artifacts as stored, so the test must extract/normalize before comparing — and if the test grows its own extraction logic, it risks becoming the second renderer the AC forbids.
**Recommendation:** Name the comparison precisely in the test: assert both projections derive from the same `submission_decisions.feedback_md` value (same row ID), and that the rendered outbox body contains the `{{decision.feedback}}` merge output of that exact value via the production `mergeTemplate`/`renderMail` path — no test-local rendering helper.

## 4. Positive Observations

- **Verified, not assumed.** The plan's file and symbol references are all real: the decision path, outbox idempotency key, seam exports at `b11982c`, the schema's per-row `confirmation_status` (which is exactly what makes AC-153's per-role independence a projection problem, not a migration), and the existing portal `decision_feedback` read at `portal.routes.ts:253-264` that slice 1 correctly extends rather than duplicates. This is the difference between a plan and a wish.
- **Single-writer / render-once discipline is explicit and testable.** Keeping `insertDecisions` as the only writer, forbidding a direct-insert positive control in the AC-235 test, and requiring bulk-accept-3 → 3 rows → 3 portal reads from those rows directly operationalizes the "no second render path" headline.
- **Negative tests carry teeth.** Every rejection asserts status *plus* unchanged state *plus* a positive control proving the fixture was writable — this closes the classic false-green where a 403 masks a broken fixture.
- **Seam citizenship.** Preserving MRQ-24's empty-selection no-op guard (with a dedicated test), converging duplicate sends on the existing idempotency key, refusing to mint `/messages/send`, and the escalate-don't-fork rule for interface mismatch all respect the published seam contract and the additive-conflict ruling on `comms.routes.ts`.
- **Ownership hygiene is exact.** Claims file shape matches the existing convention, AC-235/236 are claimed by no other ticket (verified across `tests/ac-claims/`), and the one-file-per-concern rule for the shared `src/ui/portal/*` surface is restated with M-15's structure held inviolate.
- **Design-system compliance is planned in, not bolted on**: reserved-height/width action rows and flag slots honor the elements-never-jump rule at plan time.

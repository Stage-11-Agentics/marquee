# Plan Review: MRQ-140 — session linkage for picker-assigned tasks

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are refinements the implementer should resolve in passing, not gaps that require re-planning.

## 2. Summary

Reviewed the MRQ-140 plan against the actual source at `github/main` (the plan's stated base; note the primary checkout's local `main` is ~109 commits behind, so verification was done via `git show github/main:…`). Every factual claim in the plan is accurate — I independently confirmed each cited line: the SESSION column driven solely by `task.submission_id` (`files.queries.ts` ~162), `assignBody.submission_id` accepted/validated/written (`task-templates.routes.ts` ~95, ~634-638, ~647), both UI doors omitting it (`src/ui/settings/TaskTemplatesPage.tsx`, `createTask` ~361 and `assignTemplate` ~405), the cascade setting it (`jobs/cascade/decisions.ts` ~370-390), and both doors funneling through `assignmentStatements` (~264). The plan's key insight — that the API's `submission_id` is batch-wide while assignment is many-person, so resolution must be per-person — is a genuine catch the ticket missed and is the correct design. The one concern worth naming: attaching `submission_id` to manual tasks newly exposes them to `cancelTaskSet` (cascade cancellation on acceptance reversal), a behavior change the plan doesn't mention.

## 3. Issues

**[MINOR] Shape §1 — Newly attached tasks become subject to cascade cancellation, unstated**
`cancelTaskSet` (`jobs/cascade/decisions.ts` ~661) cancels every open `speaker_tasks` row matching a `submission_id` when an acceptance is reversed with the "cancel" choice. Today, manually assigned tasks survive reversal because their `submission_id` is null; after this fix they will be swept up. That is arguably the *correct* semantics ("the task follows the session") and consistent with the ticket's intent, but it is a behavior change the plan doesn't acknowledge, and it also interacts with the auto-attach rule: a task auto-attached to a not-yet-accepted session inherits this lifecycle.
**Recommendation:** State the intended semantics in the plan/PR description and add one integration assertion (or at least a comment in the test file) covering a reversal against a manually attached task, so the choice is deliberate rather than incidental.

**[MINOR] Shape §1 — Batch `submission_id` fallback is not validated per-person**
The plan validates explicit `session_assignments` choices against each person's session set ("a deck cannot be filed under a session its speaker is not on"), but the retained batch `submission_id` fallback is today validated only against the conference. A batch value applied to N speakers who are not all on that session reproduces exactly the misfiling class this ticket exists to close, through the legacy field.
**Recommendation:** Decide and state the batch-field behavior: either validate it per-person too (attach only for people on that session, null for the rest) or explicitly document that the legacy field keeps conference-level validation for API compatibility. Either is defensible; silence is not.

**[MINOR] Shape §2/§3 — Session-set rule diverges from the existing `accepted_session_count` surface**
The plan's per-person session query uses "status not rejected/withdrawn" (matching the assignee list's does-not-wait-for-acceptance philosophy), but `/task-assignees` today also returns `accepted_session_count`, which counts *accepted only*. After the change, the picker could show a selectable session for a person whose count column reads 0. Also confirm the exact status vocabulary against the schema (e.g., whether a draft/submitted distinction exists) so the filter is written against real values.
**Recommendation:** Keep the broader rule (it matches the endpoint's stated philosophy and the ticket's chase-work framing), but make the two surfaces coherent in the UI — or note in the plan why the divergence is acceptable.

**[MINOR] Export honesty §4 — Existing export tests and the ticket's "silently dropping" wording**
Verified: the export query LEFT JOINs submissions, so no-session tasks are *not* dropped — they land in `Unscheduled_<Speaker>` via `sessionFolder`. The plan's rename to `No_Session_<Speaker>` is the right honesty fix and quietly corrects the ticket's slightly-off claim. Two follow-ons: `tests/integration/api/files-export.MRQ-117.test.ts` may assert the current `Unscheduled_` naming for null-session rows and will need updating, and `missingLine` also routes through `sessionFolder`, so the missing-files manifest changes wording too (desirable, but check its assertions).
**Recommendation:** Add "update existing files-export test expectations" to the plan's test section so a red MRQ-117 test isn't misread as a regression.

**[MINOR] Whole plan — No remediation for already-unattached rows**
The live defect rows (e.g., the uploaded `slides.pdf` reading "No session — Priya Raman") stay unattached after this ships; the plan adds no backfill or re-attach affordance. The ticket's FIX SHAPE doesn't demand one, and the export-honesty change makes the residue legible, so this is acceptable — but it should be a stated non-goal rather than an omission.
**Recommendation:** Add one line declaring existing unattached tasks out of scope (or, if cheap, note that re-assignment through the fixed picker is the remediation path).

**[MINOR] Shape §1 — `session_assignments` schema unspecified**
The plan names the new body field but not its shape or bounds (presumably `[{person_id, submission_id}]`, capped like `MAX_ASSIGNEES`, entries required to be a subset of `person_ids`/`assign_to`). Also note the create-template door's body (`assign_to`, ~line 79) has no session field at all today, so `session_assignments` must be added to *both* request schemas — the plan implies this but doesn't say it.
**Recommendation:** One sentence pinning the shape and that both `createBody` and `assignBody` gain the field; this also keeps the OpenAPI surface (the agent-facing contract the plan rightly mentions) deliberate.

## 4. Positive Observations

- **The premise was independently re-verified, and it held everywhere.** Every file:line citation in the plan matched the actual source at `github/main` — this is the standard plans should meet, and it made review fast and high-confidence.
- **The batch-wide vs per-person catch is the plan's best moment.** The ticket's fix shape ("offer a session picker") would have been implemented naively against the existing batch `submission_id` and been wrong for multi-speaker assignment. Spotting that the API primitive doesn't match the UI's cardinality, and resolving per-person, is exactly the kind of plan-level thinking that saves a code-review round trip.
- **Both doors fixed at one seam.** Routing the fix through `assignmentStatements` — which the code itself documents as the single choke point for both assignment paths — respects the existing architecture, fixes the create-with-`assign_to` door for free, and keeps the agent-facing API in step with the UI.
- **Fails-at-base tests, named to convention.** The proposed test files match the repo's established `*.MRQ-N.test.ts` / `*-ui.MRQ-N.test.mjs` patterns (MRQ-96/114 precedents verified to exist), and the "fails at base" framing makes the regression claim checkable.
- **Export honesty is scoped correctly.** Distinguishing `No_Session_` from `Unscheduled_` fixes the actual lie (the plan even quietly corrects the ticket's inaccurate "silently dropping" claim — files were mislabeled, not dropped) without inventing new export machinery.
- **Auto-attach is labeled, not silent.** Preselecting the single session and marking it automatic respects the operator (per PHILOSOPHY.md) instead of doing invisible magic.

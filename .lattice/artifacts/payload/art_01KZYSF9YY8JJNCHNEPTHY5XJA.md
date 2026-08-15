# Plan Review: MRQ-180

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

The submitted "Plan" is a verbatim, word-for-word copy of the task description — including its headings, its constraints block, and even the instruction "First establish which of the two this is," which is a question the plan was supposed to answer. No planning work has been done: there is no diagnosis of whether the drop is real or the count is wrong, no files named, no proposed approach, and no test design. The task should return to `in_planning`.

### 3. Issues

**[CRITICAL] Whole plan — The plan contains no plan**
Lines 59–103 of the submission are byte-identical to the task description (lines 59–103 mirror 13–56). A plan review exists to catch design problems before implementation; there is no design here to review. Approving this would mean the first real design decisions get made mid-implementation with no checkpoint, which is exactly what this gate exists to prevent.
**Recommendation:** Return to `in_planning`. The plan must be authored content: diagnosis result, chosen approach, file list, test plan.

**[CRITICAL] "What to build" — The diagnostic fork is unresolved**
The task explicitly says the fix differs depending on whether one recipient was genuinely skipped (reporting defect) or both were queued and the count is wrong (counting defect). Resolving that fork is the first planning act — it is answerable by reading code and reproducing the send locally, without any implementation. A plan that leaves it open is a plan to figure things out later.
**Recommendation:** Reproduce the CNT-S3 scenario (two speakers selected, "Queue reminder (2)") in the local dev environment, trace the queueing path, and state in the plan which failure mode this is, with evidence (e.g., the outbox rows produced, or the dedupe/suppression branch taken). A plausible early hypothesis worth checking: the "already in outbox" dedupe classifying the second recipient as a duplicate but the confirmation reporting `0 already in outbox` — i.e., a recipient falling into an unreported bucket. The plan should confirm or refute this from code, not guess.

**[CRITICAL] Completeness — No files identified**
The plan names zero files. The relevant surface is discoverable in minutes: the confirmation string "already in outbox" lives in `src/ui/onboarding/OnboardingPage.tsx`, the queueing machinery in `src/jobs/mail/outbox.ts`, the send endpoints in `src/routes/comms.routes.ts` / `src/routes/org-comms.routes.ts`, and bulk operations in `src/api/bulk.ts`. Note that `src/ui/evaluation/EvaluationPage.tsx` carries similar confirmation copy — the plan must state whether the fix is shared or whether that surface has the same defect and is in or out of scope.
**Recommendation:** List the files to be read, the files to be modified, and explicitly state whether the API response shape for the queue endpoint changes (it almost certainly must, to carry per-recipient skip reasons) — that is a contract change other callers may depend on, and the plan should enumerate those callers.

**[MAJOR] Acceptance — No test design**
The acceptance criteria require a regression test for the mixed case (one queueable recipient, one not) that fails on `main` and passes on the branch. The plan says nothing about where that test lives, what fixture produces a non-queueable recipient (missing email? suppression? existing outbox row?), or how the sum-to-N invariant is asserted. Since the failure mode is not yet diagnosed, the "one not queueable" fixture cannot even be chosen yet — another consequence of Issue 2.
**Recommendation:** After diagnosis, specify: test file location (following the existing suite layout under the 45s suite budget), the fixture that makes a recipient unqueueable for the *actual* reason found in production code, and assertions that (a) queued + skipped + already-in-outbox = N and (b) the skipped recipient is named with a reason in the response/UI.

**[MAJOR] UI scope — The named-skip surface is undesigned**
Acceptance point 2 requires a skipped recipient be named with a reason *in the drawer at send time*. That is new UI in a project with a binding design language (DESIGN.md, Flight Deck tokens) and a hard "elements never jump" rule — the confirmation line growing into a per-recipient list is exactly the kind of swap that must have reserved space. The plan does not mention the UI at all.
**Recommendation:** The plan should sketch the confirmation state: the reconciliation line ("1 queued · 1 skipped · 0 already in outbox"), the per-recipient skip list ("Marcus Okafor — no email address on file"), and how space is reserved so queueing does not shift the drawer's controls.

**[MINOR] Constraints — No verification-of-fix step against the judged scenario**
The defect was found by an eval judge driving the real UI. The plan should close the loop the same way: drive the dashboard flow (filtered outstanding set → select 2 → queue) and confirm the drawer now reconciles, not just that unit tests pass. Green tests against seeded state are not the artifact the judge scores.
**Recommendation:** Add a smoke-validation step that exercises the real drawer flow end-to-end in the dev build before the PR is opened.

### 4. Positive Observations

The task description being carried forward is itself excellent — it pre-identifies the diagnostic fork, gives concrete acceptance criteria with a sum-to-N invariant, names the exact confirmation string observed, and states the philosophy stake ("a skip the organizer cannot see is a speaker who never gets chased"). A real plan built on this foundation has everything it needs. But none of that credit belongs to the plan author: copying the assignment into the answer sheet is not planning, and this gate should not pass it.

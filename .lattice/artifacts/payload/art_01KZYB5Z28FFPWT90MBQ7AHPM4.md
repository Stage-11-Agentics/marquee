# Plan Review: MRQ-162

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The "plan" submitted for this task is byte-for-byte identical to the task description — no proposed approach, no decision on the fork the acceptance criteria explicitly demand (copy fix vs. membership bridge), no concrete new copy, and no test outline. Every technical claim in the description checks out against the current code (`src/ui/portal/PortalPage.tsx:807`, `src/lib/speaker-membership.ts:87`, `src/routes/portal.routes.ts:1058-1061` all read exactly as described), so the diagnosis is sound — but a diagnosis is not a plan, and AC2 makes the decision itself part of the deliverable. This has to go back for an actual plan before implementation starts.

## 3. Issues

**[CRITICAL] Whole document — The plan is a copy of the task description, not a plan**
`.lattice/plans/task_01KZWJDGTYFXM88K5GX4G3XNNY.md` is identical, word for word, to the task description in `.lattice/tasks/task_01KZWJDGTYFXM88K5GX4G3XNNY.json`. The task moved `backlog → in_planning → planned` in 21 seconds (`19:55:23` to `19:55:44` per the event log), consistent with no planning work having happened between those transitions. A plan needs to state the chosen approach, the exact new copy, and the file-by-file diff shape; restating the bug report is not that.
**Recommendation:** Return to `in_planning`. Require the plan to name the decision made under AC2 and spell out the resulting change before it's marked `planned` again.

**[CRITICAL] AC2 — The plan does not make the decision AC2 requires**
AC2 is explicit: "If the product wants the promise to be true instead, the fix is the membership bridge, not the copy — decide which, and say so in the ticket before writing either." This is a fork in the implementation, not a nice-to-have — a copy fix and a membership-bridge fix touch different files, different risk surfaces, and different test shapes. The plan is silent on which was chosen. Given the severity note ("the branch is rare... not judge-facing") and that the described fix is scoped to `PortalPage.tsx` + a test file (no route/DB files listed), the implied choice is the copy fix, but the plan should say so explicitly rather than leaving it to be inferred from the file list.
**Recommendation:** Add a sentence to the plan: "Choosing the copy fix, not the membership bridge, because [reason — e.g. bridging submitter-only participants into a speaker seat is a product decision with broader consequences than this ticket's scope]." That sentence is itself the AC2 deliverable and should exist before code is written.

**[MAJOR] Files — The plan doesn't propose the actual replacement copy**
The task names the two false-promise call sites (`:807`, and the description's own citation of `:921` where `submitterOutcomeDetail` is rendered) but the plan never proposes what the accepted-submitter copy should say instead. `submitterOutcomeCopy('accepted')` — "The program team accepted this abstract for the conference." — already exists and is cited in the description as the pre-#169 text, but the plan doesn't say whether the fix is to fall through to that string, write new copy, or something else. Leaving this to be improvised during implementation risks copy that doesn't match the PHILOSOPHY.md voice rules or that reintroduces a different unsupportable claim.
**Recommendation:** Plan should propose exact replacement text (or explicitly say "revert to `submitterOutcomeCopy('accepted')`'s behavior for this branch") so review can check it before code is written.

**[MAJOR] Risk — A second, un-scoped instance of the same false promise exists nearby**
`src/ui/portal/PortalPage.tsx:916` (the `isAwaitingReview` branch's three-step list, "If it is accepted...This page becomes your speaker portal — your tasks, profile, headshot, and session time all arrive here.") makes the identical unreachable promise, to the identical audience (a submitter-only participant currently awaiting review will hit this exact same wall once accepted). It is not in the ticket's `Files:` list or acceptance criteria. The plan doesn't note it as in-scope, out-of-scope-but-related, or explain why it's excluded — it's simply not mentioned, because the plan is a copy of a description that also doesn't mention it.
**Recommendation:** Plan should explicitly decide: fix both occurrences under this ticket (they're the same defect, same root cause, same fix), or explicitly scope this one out and file a follow-up. Silently leaving it unaddressed reintroduces the exact defect class this ticket exists to close, in a different sentence twenty lines away.

**[MINOR] Acceptance Criteria Coverage — AC3's test plan is asserted, not designed**
AC3 asks for a unit test that "asserts the absence of any claim about tasks, session details, or the page becoming a speaker portal." The plan doesn't sketch what the new test case looks like (e.g., which `submission()` override drives the accepted branch, what `expect(html).not.toContain(...)` assertions are needed alongside the existing `not.toContain("Speaker portal")` pattern already used in the MRQ-150 test file for the empty-state case). Given the sibling test file already has an established idiom for this, the omission is low-risk, but a plan claiming to cover AC3 should show it understood the target file's pattern.
**Recommendation:** Name the specific negative assertions the new test needs (e.g. not-contains "speaker portal", "Tasks", "session details" in the accepted-submitter render), matching the idiom already used for MRQ-150's "Your abstract is in" case.

## 4. Positive Observations

The underlying diagnosis is rigorous and independently verified: the four-step reachability chain (`portalSnapshot` → `findSpeakerEvent` → the acceptance-cascade `role IN ('speaker','co_speaker')` filter → the residual submitter-only audience) matches the code exactly at every cited line number, and the regression framing against PR #169 and its prior `submitterOutcomeCopy('accepted')` text is accurate. The severity note correctly scopes this as follow-up, non-deploy-blocking work rather than inflating urgency. The problem statement itself is genuinely plan-ready — what's missing is the plan.

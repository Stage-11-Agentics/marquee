# Plan Review: MRQ-177

### 1. Verdict

**FAIL (plan-level)** — The plan is a verbatim copy of the task description with a title line added. It contains no plan content: no root-cause finding, no named files, no proposed mechanism, no test strategy. The task should return to `in_planning`.

### 2. Summary

I reviewed the submitted plan for MRQ-177 (silent failure of the speaker-portal "Upload a new version" path, the round's only CRITICAL defect) against the task description and the codebase. The submitted plan restates the task description word-for-word — lines that in the description say "What to build" reappear unchanged, with nothing added beneath them. The task's own first instruction is "Find the actual failure. Root-cause it before changing anything," and the plan gives no evidence that any investigation happened; nothing in it could be checked against the code, so there is nothing here for a plan review to de-risk.

### 3. Issues

**[CRITICAL] Entire plan — The plan is the task description, not a plan**
The plan body (from the title through the Constraints section) is byte-identical to the task description above it. A plan's job is to convert "what to build" into "how, where, and in what order" — which files change, what the failure actually is, what the states and transitions are, what the regression test asserts. None of that exists. Approving this would move the ticket to implementation with every open question still open, which is exactly the failure mode plan review exists to catch.
**Recommendation:** Return to `in_planning`. The revised plan must be authored content: root-cause findings, an enumerated change list with file paths, a state-machine sketch for the upload panel, and a test plan.

**[CRITICAL] What to build §1 — No root-cause investigation was performed or recorded**
The task explicitly gates everything on root-causing the silent failure ("A fix you cannot explain will not survive the next round"). The plan records no hypothesis tested against the code. The upload path is small and inspectable — the panel state, progress state (`loaded`/`total`), the Cancel affordance, and the existing `canRetry`/`error` rendering all live in `src/ui/portal/PortalPage.tsx` (upload state around line 315, progress line and actions around lines 381–382). The judge's evidence (stuck at "0% · 0 B / 608 B" for ~15 s, no error, nothing written, identical retry succeeded) already narrows the space: the request either never progressed or its failure/abort branch is swallowed without setting `error`. A plan should say which it is, or at minimum name the two or three candidate mechanisms and how the first implementation step will discriminate between them.
**Recommendation:** The revised plan states the root cause (or a concrete discrimination procedure as step 1), citing the specific request path — how the upload request is issued (fetch vs XHR), whether upload progress events are wired, where errors/aborts/timeouts are (or are not) caught, and whether a completion call can fail after the byte transfer succeeds.

**[MAJOR] Missing entirely — No file inventory or change decomposition**
The review checklist asks "does the plan identify which files will be created or modified?" — it identifies none. From the code, the plausible surface is at least: `src/ui/portal/PortalPage.tsx` (upload state machine, timeout, failure state, progress rendering), `src/ui/portal/portal.css` (reserved space for the failure/retry state — the "elements never jump" constraint), possibly the server upload/completion endpoints in `src/index.ts` or wherever the version-write is committed, and a new or extended test file exercising the failure branch.
**Recommendation:** List the files with a sentence each on what changes in them, and flag explicitly whether the fix is client-only or also touches the server completion path — that distinction changes review scope and risk.

**[MAJOR] Acceptance — No test plan for the regression test the task requires**
The task requires "a regression test that fails on `main` and passes on your branch," exercising the replacement path's failure branch. The plan does not say what the test simulates (network error mid-PUT? completion call rejected? timeout?), at what layer (component test with a mocked transport? integration against the dev server?), or what it asserts (failure state rendered, no success state, no phantom version row). Without this, "fails on main" is unverifiable at review time — and the suite budget (45s) constrains what kind of test is even admissible.
**Recommendation:** Specify the failure injection point, the test layer, the exact assertions, and how the test stays inside the suite budget.

**[MINOR] What to build §5 — "Post-upload state read from the server" has an unstated design decision**
Re-reading server state after upload is the right anti-false-success move, but the plan doesn't say how it composes with the existing `onRefresh` flow already present in the portal, or what happens when the confirmation read itself fails (upload succeeded, confirm request lost). That ambiguity is cheap to resolve now and expensive to discover mid-implementation.
**Recommendation:** One paragraph: success is only rendered after a re-fetch shows the new version in the list; a failed confirmation read renders a distinct "we can't confirm your upload — reload to check" state, not a failure and not a success.

### 4. Positive Observations

The task description embedded in the plan is excellent — judge reasoning quoted verbatim, the harm articulated ("the product quietly discards work a human did and reports success by saying nothing"), constraints that encode real prior incidents (stash swap, deploy freeze, gate serialization), and acceptance criteria that are genuinely testable. If the eventual plan simply answers the questions this description poses, in order, it will be a strong one. None of the criticism above is of the ticket; all of it is of the absence of a plan underneath it.

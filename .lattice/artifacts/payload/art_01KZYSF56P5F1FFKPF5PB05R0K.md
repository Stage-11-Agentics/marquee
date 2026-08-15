# Plan Review: MRQ-179

### 1. Verdict

**FAIL (plan-level)** — The plan is a verbatim copy of the task description with a title line added. No planning has occurred: no approach, no files, no data-model decision, no test strategy. The task should return to `in_planning`.

### 2. Summary

I reviewed the MRQ-179 plan (widen the "Publish the program" panel to list accepted-but-unscheduled sessions as disabled-with-reason, surface publication status on the session record, without loosening the public-agenda gate). The submitted "plan" reproduces the task description word-for-word — every section from the rubric quotes through the constraints is identical — so it demonstrates zero investigation of the codebase and answers none of the questions the description explicitly poses to the planner. Most critically, the description's own item 4 flags a decision ("derive the status vs. add a per-session field — say so on the ticket **before** building") that a plan must resolve, and this one doesn't mention it.

### 3. Issues

**[CRITICAL] Entire plan — It is the task description, not a plan**
Lines 61–107 of the submission are byte-identical to the task description above them (only a `# MRQ-179: …` heading was added). There is no proposed approach, no sequencing, no identification of files to touch, and no evidence the planner opened the repository. A reviewer cannot evaluate feasibility, alignment, or risk because there is nothing to evaluate; an implementer starting from this document would be planning from scratch mid-implementation, which is exactly what plan review exists to prevent.
**Recommendation:** Return to `in_planning`. The revised plan must contain, at minimum: the concrete surfaces to change, the derivation-vs-field decision (see next issue), the test plan, and the ordering of work.

**[CRITICAL] What to build, item 4 — The schema question is unanswered, and it gates everything else**
The description requires the planner to decide whether publication/content status is *derived* from existing state or becomes a *genuine per-session field* — and if the latter, to stop and raise it on the ticket before building, because migrations stop at the operator. The plan takes no position. This is the single decision the rest of the implementation hangs on: requirement 2 ("the session record carries its publication/content status visibly") can be satisfied by deriving a status from existing facts (accepted? scheduled? published?) with no schema change, which keeps the ticket inside the no-migration constraint. A plan that doesn't commit here can't be checked against the migration constraint at all.
**Recommendation:** The plan should state the intended model explicitly. The scope-narrowing guidance in the description strongly suggests deriving a display status (e.g., "Public" / "Ready to publish" / "Needs a room and time") from existing columns, with no new field and no migration — and reserving the per-session status field as the escalation path item 4 describes. Whatever the choice, it must be written down before implementation starts.

**[MAJOR] Missing — No files or surfaces identified**
The plan names nothing in the tree. The work is well-localized and discoverable: the "Publish the program" panel, its scheduled-only candidate filter, and the "Review publication" action all live in `src/ui/agenda/AgendaPage.tsx` (panel around line 793; the empty-state copy "Accepted Sessions will appear here after they are placed on the agenda" at ~line 813 is itself part of what must change, since accepted sessions will now appear *before* placement). A complete plan also needs to identify: whatever server-side query feeds the panel its candidates (widening it to accepted-but-unscheduled sessions), the session detail/record surface for requirement 2, and the public agenda query that must be proven unchanged.
**Recommendation:** Enumerate the files: the panel component and its candidate-selection logic in `AgendaPage.tsx`, the backing API/query, the session record surface, and the test files. Confirm the public-agenda output path is read-only in this change.

**[MAJOR] Acceptance — No test plan for the two-halves regression test**
Acceptance requires one regression test covering both halves — an accepted, unscheduled session is visible-but-disabled in the panel *and* absent from public output — and constraints require it to fail on `main` and pass on the branch. The plan says nothing about where this test lives, at what layer (API response shape vs. rendered UI), or how "fails on main" will be demonstrated. Note the fail-on-main property comes from the *visibility* half (main omits unscheduled sessions from the panel), since the exclusion half already passes on main; a plan should show it understands that.
**Recommendation:** Specify the test file and layer, and the two assertions: (1) panel/candidate output includes the accepted-unscheduled session marked disabled with the stated reason; (2) public agenda output excludes it. State explicitly that assertion 1 is the one that fails on `main`. Keep it inside the 45s suite budget.

**[MINOR] Missing — UI stability constraints not planned for**
The constraints include "elements never jump," and newly listing disabled rows in the publication panel changes that panel's population and the select-all/"Review publication" affordances (disabled rows must not be selectable or counted in the candidate tally at `AgendaPage.tsx:817`). None of this interaction detail is addressed.
**Recommendation:** One or two sentences in the plan on how disabled rows render (fixed row height, reason text with reserved space, excluded from selection and from the select-all count) would close this.

### 4. Positive Observations

The task description embedded in the plan is genuinely excellent — tightly scoped, with the judge's reasoning quoted verbatim, an explicit anti-scope-creep instruction ("do not build an approval subsystem"), a named escalation path for the schema question, and testable acceptance criteria. That quality is precisely why the copy-paste is recoverable cheaply: a real plan needs only to answer the questions the description already asks (derivation vs. field, which files, which test), and the strong framing means a revised plan can likely be produced in a single short pass.

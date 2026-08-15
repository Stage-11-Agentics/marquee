# Plan Review: MRQ-192

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted plan is a verbatim copy of a **superseded revision of the task description** — it
restates the ticket's narrative, scope, acceptance, and constraints, and contains no implementation
approach: no steps, no ordering, no triage method, no file list, no verification sequence. Beyond
being a non-plan, it is stale in three load-bearing ways that were each verified against the repo:
it pins the sweep size at **20** (the task now says 31; `github/main` measures **36**), it carries
the `migrations/` control the task description explicitly documents as *incapable of returning
anything but zero*, and its central premise — "the degraded code is still shipped at
`PortalPage.tsx:593`" — **is no longer true on `github/main`**, where the generic is restored and the
regex is already widened. The single most valuable thing a plan could have surfaced here, and did
not, is that AC-2 and AC-3 pull in opposite directions.

## 3. Issues

**[CRITICAL] Whole document — The plan is the task description, not a plan**

Lines 157–250 of the prompt reproduce the ticket's own sections (`What happened`, `Why this is a
ticket and not a note`, `Scope`, `What to do with each finding`, `Acceptance`, `Constraints`)
essentially word-for-word. Nothing in it is planning output. There is no enumeration of files to be
created or modified, no order of work, no method for triaging 31–36 test files, no statement of
where the regression test will live or what it will be called, no batching or stopping rule, and no
description of how the constraints (gate-lock path, push-before-verification) map to actual steps.
The review checklist question "does the plan identify which files will be created or modified" has
no answer to evaluate.

This matters more than usual for this ticket: the work is a **judgment sweep**, not a code change.
Its hard part is the per-file decision procedure — *what evidence makes a file "bent" rather than
"brittle"?* — and that procedure is exactly what a plan is for. Without it, 31+ files get triaged ad
hoc by a tiring implementer, and the sweep's output is unreproducible.

**Recommendation:** Return to `in_planning` and write an actual plan containing, at minimum: (a) the
decision procedure that separates *bent* from *brittle* from *fine*, stated as a rule an implementer
can apply mechanically — e.g. "bent" requires naming the production line and the safer form it would
take absent the assertion; (b) the batching (suggest triage-all-first at low depth, then deep-dive
only the candidates, so the sweep's coverage claim survives a context exhaustion mid-run); (c) the
named file the enumeration lands in and the named file the new regression test lands in; (d) the
sequence through worktree cut → work → push → gate-lock run.

---

**[CRITICAL] Scope / Acceptance — The plan is pinned to the debunked "20" and the worthless control**

The plan's `Scope` (line 206) reads: *"20 test files read source files as text … with a control: the
same pattern over `migrations/` returns 0, so the search is discriminating"*, and its `Acceptance`
(line 231) requires *"The 20 source-text-asserting test files are enumerated"*.

The task description exists in large part to retire both of those claims. It documents that four
people measured this number and the first three were wrong (20 → 23 → 20 → 31), and that the
`migrations/` control was worthless. I verified the reasoning: `migrations/` holds **21 files, every
one of them `.sql`**, so a JavaScript call-expression regex could never have matched there — a zero
that proves nothing about discrimination. The task replaced it with a `scripts/` control that *can*
fire and does; I re-ran it and confirm: 13 files read something, exactly **1** reads `src/` as text
(`scripts/checks/verify-design-contract.mjs`).

The plan is therefore not merely imprecise — it reinstates the specific error the ticket was minted
to correct, and encodes it in an acceptance criterion. An implementer following this plan enumerates
20 files, satisfies the plan's AC, and misses at least 16.

**Recommendation:** Delete the `migrations/`-returns-0 sentence entirely and adopt the task's
`scripts/` control. Do not restate any count as fact: re-run the two `git grep -lE` commands from the
task description and record **the number alongside the sha it was measured at**. See the next issue —
this number is not stable.

---

**[CRITICAL] What happened / Acceptance — The premise is stale; the MRQ-93 fix has already landed**

Both the plan and the task assert that the degraded code "is still shipped" at
`src/ui/portal/PortalPage.tsx:593`, and that #199 (which "fixes it in the right direction") is
unmerged. Neither holds on `github/main`:

- `github/main:src/ui/portal/PortalPage.tsx:647` reads
  `await requestJson<{ person: PortalPerson }>("/api/v1/me/profile", …)` — **the generic is
  restored**.
- `github/main:tests/node/mrq-93-portal-task-subjects.test.mjs:25` already carries the widened
  assertion `requestJson(?:<[^>]+>)?\("\/api\/v1\/me\/profile"` with a comment explaining the
  widening.
- PR #199 merged 2026-08-14T01:53Z; PR #205 merged 2026-08-14T03:28Z.

So two of the four acceptance criteria are **already satisfied for the MRQ-93 case**. An implementer
working this plan opens `PortalPage.tsx`, finds line 593 is a social-handles loop, and burns time
reconciling the ticket against reality — or worse, "restores" something already restored.

This does not invalidate the ticket. It re-weights it: what remains is (i) the 31–36 file sweep,
which is untouched, and (ii) AC-3, the regression test, which is genuinely open and is the subtle
part. The plan should say so.

**Recommendation:** Re-baseline the plan against `github/main` at a named sha. State explicitly that
MRQ-93's production restoration and assertion-widening are already merged, and that the remaining
MRQ-93 work is AC-3 alone. Verify the same for MRQ-178 and MRQ-180 (both cited as live in the task;
#205/MRQ-180 is merged) before assuming any of the three cited instances is still open.

---

**[MAJOR] Acceptance — AC-2 and AC-3 are in direct tension, and the plan does not notice**

AC-2 requires bent assertions be **widened to accept the better form**. AC-3 requires **a regression
test that fails if the generic is stripped again**. Implemented as the plan implies — both as source-text
regexes in the same test — these cancel: the widened regex `requestJson(?:<[^>]+>)?\(` accepts the
generic *and* its absence, so stripping the generic tomorrow leaves the suite green. The merged
comment in `mrq-93-portal-task-subjects.test.mjs` even asserts the intent ("The production call
should remain type-checked") while the assertion below it does not enforce that intent. That is the
ticket's own failure mode — a check that fires perfectly and enforces the wrong thing — reproduced
inside the fix.

The resolution is that AC-3 cannot be a source-text assertion at all. It has to be a **type-level**
guarantee, and the repo already runs one: `scripts/checks/pr-gate.mjs:29–31` runs `tsc --noEmit`
against `tsconfig.json`, `tsconfig.client.json`, and `tsconfig.test.json`. A `.ts` test that consumes
the profile-save response in a way that only compiles when the generic is present turns "the generic
was stripped" into a red gate, without any regex knowing the spelling.

This is the single highest-value thing the plan could have contained, and its absence is the
strongest argument for sending it back rather than letting the implementer discover it at the end.

**Recommendation:** Add a plan section resolving the tension explicitly: AC-2 is satisfied by
source-text widening; AC-3 is satisfied by a type-level check under one of the three `tsc` projects.
Name the file and the mechanism. State the falsification test the implementer must actually run —
strip the generic locally, confirm the gate goes red, restore it — because a regression test nobody
watched fail is exactly the "proved nothing" mode from MRQ-178.

---

**[MAJOR] Scope — The `migrations/`-reading labelled subset is dropped**

The task requires the 3 tests that read `migrations/` as text be **named as a labelled subset**
(`audit-request-id.test.mjs`, `form-field-dates.test.mjs`, `reviewer-boundary.AC-214-246.test.mjs`),
on the reasoning that "a schema shaped to satisfy a string" is a distinct failure worth being able to
say out loud. I confirmed all three exist and are a strict subset of the larger set. The plan has no
equivalent — a consequence of it predating that refinement.

**Recommendation:** Carry the subset requirement into the plan, and state what the extra question is
for those three: not just "has production been bent" but "has a migration been shaped to satisfy an
assertion," which is worse, because a migration is append-only.

---

**[MAJOR] Scope — The degrade / no-op / obstruct taxonomy is missing, so "bent / brittle / fine" is ungrounded**

The task opens with three worked instances of three distinct failure modes (MRQ-93 bent production,
MRQ-178 proved nothing, MRQ-180 blocked a fix) and rests the whole sweep's justification on *two of
the three being invisible*. The plan omits the taxonomy entirely, then asks the implementer to mark
each file "bent / brittle / fine." Those labels only cohere against the taxonomy: a no-op test is
neither bent nor brittle, and under the plan's vocabulary would be marked **fine** — which is the
precise mistake MRQ-178 already demonstrates, since it *is* green and *does* pass with the comparator
inverted.

**Recommendation:** Restore the taxonomy and reconcile it with the marking scheme — either extend the
labels to cover the no-op mode, or define "fine" to explicitly require that the assertion has been
shown capable of failing. The cheap version of that check is stated as a step: for each file kept,
mutate the thing it claims to protect and confirm red.

---

**[MAJOR] Feasibility — No sizing, batching, or stopping rule for a 31–36 file sweep**

Each file requires reading the test, reading the production code it asserts on, and forming a
judgment about whether production was shaped by the assertion. At 36 files that is a large single
pass, and the plan sets no depth budget, no order, and no rule for what happens when a bent case
requires a production change that reaches into another ticket's live surface. The task's demand to
"report the files you checked and **cleared**" makes coverage the deliverable — so a run that dies
two-thirds through with no intermediate artifact produces nothing citable.

**Recommendation:** Plan two passes: a shallow triage over all N producing the full table (every file
marked, with one-line reasoning), committed and pushed *before* any deep work; then deep-dives only on
the candidates. That ordering makes the coverage claim durable independent of how the second half
goes, and it matches the constraint "push when the work is written, before the verification run."

---

**[MINOR] Acceptance — The count is volatile, which makes the AC unverifiable as phrased**

The set is actively growing: **20** (plan), **31** (task), **32** (primary checkout, 16 commits
behind), **36** (`github/main`). Any AC of the form "the N files are enumerated" is false by the time
it is read. This is not a nit — a reviewer checking the AC will measure a different number than the
implementer did and cannot tell drift from omission.

**Recommendation:** Phrase the AC against a sha: "every file matched by `<command>` at `<sha>` is
enumerated and marked," and have the implementer paste the command, the sha, and the resulting file
list. Then the AC is checkable by re-running one command.

---

**[MINOR] Constraints — Restated but not operationalized**

The gate-lock path, push-before-verification, the `CONTRACT` / `AC-<n>` middle-dot title convention,
and "no migration, do not deploy" are copied verbatim with no plan step that uses them. In particular
the naming convention is a live requirement for the AC-3 regression test the plan never names.

**Recommendation:** Name the new test's file and title in the plan, in the required form, so the
convention is satisfied by construction rather than caught at review.

---

**[MINOR] Deliverables — The sweep's primary artifact has no home**

"Report the files you checked and cleared" is the evidence the sweep happened, and the plan never
says where it goes — PR body, a file in the repo, a Lattice comment. For a 36-row table that choice
matters.

**Recommendation:** Pick one and say so. A committed file is preferable to a PR body: it survives the
merge and can be diffed the next time someone re-runs the grep and gets a larger number.

## 4. Positive Observations

- **The fix direction is right and is stated crisply.** "Assert the property, not the spelling" —
  with the explicit refusal to reach for "delete the test" — is the correct principle, and the plan
  is careful to protect the legitimate job these tests do (CSS rules and rendered class names that no
  type system can see). A weaker plan would have proposed deleting the offenders and called it
  simplification.
- **The AC guarding deletions is well-designed.** "No test is deleted without saying what guarantee it
  was carrying and where that guarantee now lives" is exactly the constraint that keeps a brittleness
  sweep from quietly becoming a coverage cut, and it is the kind of criterion that is genuinely
  checkable at review.
- **Requiring cleared files to be reported, not just changed ones,** is the right instinct for this
  class of work — it makes coverage falsifiable instead of asserted, which is the same standard the
  ticket applies to the tests it is auditing.
- **`onboarding-column-widths.test.mjs` is correctly carried forward** as a known member of the set
  with a specific prior flag against it, giving the implementer at least one concrete starting point.

The gap here is not judgment — where the plan expresses a view, the view is sound. It is that the
document is a restatement of an outdated ticket rather than a plan, and the outdated parts are the
exact claims the ticket was updated to retire.

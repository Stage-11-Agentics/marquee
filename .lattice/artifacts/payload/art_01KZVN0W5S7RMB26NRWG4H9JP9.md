# Plan Review: MRQ-82 — Acceptance reversal is not recorded in Decision History

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

The submitted "Plan" is a verbatim copy of the task description — same headings, same prose, same paragraphs, in the same order — with a single-character drift (`MRQ-81` → `MRQ-79` in the Constraints block, indicating it was pasted from an older revision of the ticket rather than authored). It contains no implementation steps, no file list, no test plan, and no resolution of the investigation the ticket explicitly gates the work on. Separately and materially: **MRQ-82 is already implemented and merged to `main`** (commit `71f60882`, PR #31, 2026-08-11), so this review is being run against a plan for work that is done — the delegator should confirm ticket state before planning anything.

### 3. Issues

**[CRITICAL] Whole document — The plan is a copy of the task description, not a plan**

Every section of the plan (`What was seen`, `Why this matters`, `Scope`, `Constraints`, `Verification`, `File ownership`) is byte-identical to the corresponding section of the task description except for `MRQ-81` → `MRQ-79` on the priority-ordering constraint. A restatement of the problem is not a statement of the solution. Nothing in the document answers: which files change, in what order, what the data shape is, how it is tested, or what could go wrong. None of the review checklist's categories — completeness, feasibility, alignment, risk, AC coverage, architecture — can be evaluated because the plan asserts no technical position to evaluate.

**Recommendation:** Return to `in_planning`. The plan must add, at minimum: (a) the outcome of the investigation the ticket demands, (b) an explicit file-level change list, (c) the ordering/tie-break rule for merged history entries, (d) the test list with compliant titles. Restated ticket context can stay, but it is preamble, not plan.

---

**[CRITICAL] Scope — The plan does not answer the question the ticket makes a precondition**

The ticket says, in its own words: *"Confirm first whether the reversal already writes a row that the history query filters out — if the data exists and is merely unselected, this is a read fix, not a write one."* The plan copies that sentence forward and never answers it. This is the single decision that determines whether the ticket is a ten-line SELECT or a write-path change plus schema work, and it is knowable before writing any code.

The answer is determinable from the current tree: `writeAcceptanceReversal` (`src/jobs/cascade/decisions.ts:754`) already writes an `audit_log` row with `action = 'submission.acceptance_reversed'` carrying the actor, timestamp, resulting status, and all three branch choices with their cancellation counts in `after_json`. The data exists and was merely unselected. **This is a read fix.** A plan that leaves this open invites the implementer to add a redundant write.

**Recommendation:** The plan must state the finding and its evidence (`decisions.ts:754` writes the audit row; the record route's `decisions` array selected only from `submission_decisions`), and commit to the read-side approach.

---

**[MAJOR] Constraints — The plan misses the schema constraint that rules out the obvious approach**

The plan repeats "No migration if the existing decision/audit tables can carry it. `submission_decisions` already exists" — which reads as an invitation to insert a reversal row into `submission_decisions`. That approach is blocked and the plan does not say so. `migrations/0001_init.sql:388` declares:

```sql
resulting_status TEXT NOT NULL CHECK (
  resulting_status IN ('accepted', 'waitlisted', 'rejected')
)
```

The default reversal outcome is `withdrawn`. Relaxing a CHECK in SQLite means rebuilding the table — precisely the migration the constraint forbids. An implementer following this plan literally would write the INSERT, hit a constraint violation at runtime, and have to re-plan mid-implementation.

**Recommendation:** State the CHECK constraint and the `withdrawn` conflict explicitly, and name `audit_log` as the source of truth for reversal entries.

---

**[MAJOR] Scope — The plan's stated premise about the UI is wrong, and it hides a required change**

The plan asserts: *"The existing decision-history rendering already handles entries generically (`src/ui/submissions/SubmissionRecordPage.tsx`), so this is likely a write-side gap rather than a new surface."* Both halves are wrong. It is not a write-side gap (see above), and the rendering is not generic enough: a reversal has no `feedback_md` and needs a distinct label, so `SubmissionRecordPage.tsx` requires a `kind` discriminator and a `note` field to render "Acceptance reversed · Withdrawn" with the branch choices instead of "No feedback recorded." The shipped fix had to touch the UI type and the history row markup. A plan that declares the UI out of scope will produce an entry that renders as an empty decision.

**Recommendation:** Add `src/ui/submissions/SubmissionRecordPage.tsx` to the change list, with the `kind: "decision" | "reversal"` and `note` fields specified.

---

**[MAJOR] File ownership — The plan restates the MRQ-76 blocker without resolving it, and the escape clause does not apply**

The plan copies: *"Do not begin this ticket while MRQ-76 is open unless the work is confined to `src/routes/submission-reversal.routes.ts`."* But the fix is a read fix, and the read lives in `src/routes/submission-record.routes.ts` — the file MRQ-76 owns. The work therefore **cannot** be confined to the reversal route, so the escape clause is unavailable and the plan is proposing to start blocked work without saying so.

**Recommendation:** State MRQ-76's current status and either (a) sequence behind its merge, or (b) get explicit coordination on record it. Do not carry the ambiguity into implementation.

---

**[MAJOR] Verification — No test plan, against an explicit test-naming constraint**

The plan carries the constraint *"Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails"* but proposes no tests. The Verification section describes three manual checks (reverse once, reverse twice, unreversed record unchanged) with no mapping to automated coverage. Given `trace:ac` is a hard gate, a plan that names the naming rule but lists no tests will fail the gate on the first push.

**Recommendation:** Enumerate the tests and their titles. The three verification scenarios map cleanly onto a pure unit test of the merge/format helpers: single reversal renders both entries in order; a record with no reversal is unchanged; two reversals both appear newest-first; plus the note-formatting cases (all-cancel, all-retain, zero-count) and a malformed-`after_json` guard.

---

**[MINOR] Risk — Same-timestamp ordering is unaddressed**

Reversing with `outcome: "rejected"` writes both an audit row and a `submission_decisions` row, potentially at the same millisecond. A naive `sort by decided_at DESC` leaves their relative order undefined, so the pair can render consequence-before-cause. The plan says "in order" in Verification but never defines what order means at a tie.

**Recommendation:** Specify the tie-break: the reversal is the cause and sorts above the decision row it produced.

---

**[MINOR] Constraints — Stale ticket reference indicates the plan was not authored against the current description**

The plan says "Do not let it displace MRQ-79 or MRQ-76" where the task description says "MRQ-81 or MRQ-76." Minor in itself, but it is the tell that the document was pasted from a prior revision rather than written — which is the root of every issue above.

**Recommendation:** Re-plan against the current task description.

---

**[PROCESS] The ticket is already merged**

`git log` shows commit `71f60882` — *"MRQ-82: the one action that changes everything left no trace (#31)"*, merged 2026-08-11 — which lands `src/lib/decision-history.ts`, the `audit_log` read in `submission-record.routes.ts:369-377`, the UI `kind`/`note` rendering, and `tests/unit/decision-history-reversal.MRQ-82.test.ts`. The shipped implementation independently reached every conclusion this review flags as missing from the plan.

**Recommendation:** Before spending another planning cycle, confirm MRQ-82's board status against `main`. If the intent is to review the *merged* work rather than a plan, this should be a code review, not a plan review.

### 4. Positive Observations

The strength here belongs to the **task description**, not the plan — and it is worth naming because it is what a good plan would have built on. The ticket does three things unusually well:

- **It anticipates the wrong turn.** "Confirm first whether the reversal already writes a row that the history query filters out" is a precondition that saves the implementer from building a write path for data that already exists. That instinct was correct — the audit row was already there.
- **It names the files to inspect** (`submission-reversal.routes.ts`, `submission-record.routes.ts`, `SubmissionRecordPage.tsx`), so the investigation has a starting point rather than a search.
- **It states its own priority honestly.** "Deliberately LOW priority: audit completeness, not a walkthrough blocker" is the kind of self-aware scoping that keeps a fleet from letting a nice-to-have displace a blocker.

The verification criteria are also well-chosen: reverse once, reverse twice, and confirm the untouched case is untouched — that third one is the check most plans forget, and it is exactly the regression risk when you widen a history query.

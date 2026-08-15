# Code Review: MRQ-172 — reviewer comment in the EVALUATION PANEL

Reviewer: independent review agent (Claude). Branch reviewed: `implementer-MRQ-172`
(20a367f1, worktree `../Marquee-worktrees/implementer-MRQ-172`), diffed against `main`
(17242b06). I ran the new test suite and a full typecheck on the branch myself.

## 1. Verdict

**PASS**

## 2. Summary

The diff puts each scorecard result — reviewer name, rating, recommendation, and the
comment text itself — directly into the EVALUATION PANEL as a new `EvaluationPanelResult`
row, exactly where the two eval-round agents looked and failed to find it. I verified the
critical data assumption independently: the API at `src/routes/submission-record.routes.ts:722-729`
spreads the full SQL row (including `id`, `reviewer_name`, `override_score`,
`override_comment`, `override_person_name`) into `round.evaluations`, so widening the
previously under-typed `Round.evaluations` to `EvaluationPanelEvaluation[]` is sound, and
`comment` is `NOT NULL DEFAULT ''` in the schema (`migrations/0001_init.sql:526`), so the
unconditional `.trim()` is safe. `tsc --noEmit` is clean and all 4 new tests pass (793ms);
the test fails on `main` by construction since `EvaluationPanelResult` doesn't exist there.
Only minor issues found, none blocking.

## 3. Issues

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:336 — Real recommendations render lowercase; the test fixture hides it**
The database constrains `recommendation` to `'approve' | 'maybe' | 'deny'` (lowercase —
`migrations/0001_init.sql:521-523`, enforced again by `src/routes/review.routes.ts:18`),
and no CSS capitalize transform exists anywhere in `src/ui`. The panel renders the raw
value, so real data shows `4.00 · approve`. This matches the existing
`EvaluationEvidenceRow` (line 214 renders raw too), so it is consistent rather than a
regression — but the test fixture passes `recommendation: "Approve"`, a value that can
never occur in production, so the test asserts a display shape the product will never
show and would mask a future casing fix or break.
**Fix:** Use `"approve"` in the test fixture and assert `"4.00 · approve"` (or add a
shared label map for both surfaces in a follow-up if capitalized display is wanted).

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:321 — Character-count threshold can disagree with the visual clamp**
`isLongComment` fires at >120 characters, but the clamp is visual (3 lines via
`-webkit-line-clamp`). A sub-120-character comment containing a long unbroken token (a
URL, say) in the narrow panel column can wrap past 3 lines under `overflow-wrap: anywhere`
and get clipped with no "Read full comment" button — text unreachable, which is the exact
defect class this ticket exists to kill. Edge case, unlikely with fixture-style prose.
**Fix:** Lower the threshold (e.g. 80) or detect actual overflow via a ref
(`scrollHeight > clientHeight`) to drive button visibility.

**[MINOR] src/ui/submissions/record.css:392 — Expanded comment region is not keyboard-scrollable**
`.evaluation-panel-comment-body.expanded` becomes `overflow-y: auto` at the same 51px
height (deliberate and correct under the elements-never-jump rule — the code comment
explains it well), but the scrollable span has no `tabindex="0"`, so a keyboard-only
operator who activates "Read full comment" cannot scroll the revealed text.
**Fix:** Add `tabindex={0}` (and ideally `role="region"` with an `aria-label`) to the
comment body when `expanded` is true.

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:349-353 — Override block omits who overrode**
The test fixture supplies `override_person_name: "Avery Chair"` but the panel's override
block never renders it — just "Organizer override", the score, and the reason. Attribution
exists in the evidence card below ("Overridden by …"), and the ticket only requires the
override be distinguishable, so this meets the contract; it just accepts and silently
drops a field the test suggests it should show.
**Fix:** Either render `override_person_name` in the block's label ("Override ·
Avery Chair") or drop the field from `EvaluationPanelEvaluation`'s Pick to keep the type
honest about what the component uses.

## 4. Positive Observations

- **The load-bearing assumption was checked, and it holds.** The riskiest part of this
  change is invisible in the diff: the old `Round.evaluations` type lacked `id`,
  `reviewer_name`, and every `override_*` field, so the new component only works if the
  API really sends them. It does — the route spreads whole rows — and expressing the new
  type as a `Pick` of the already-accurate `EvaluationEvidence` interface reuses the
  documented contract instead of inventing a parallel one. Clean.
- **The elements-never-jump rule is engineered, not gestured at.** Reserved slots for the
  Override chip, the comment body, and the action button (`min-height` placeholders with
  `visibility: hidden`), plus scroll-within-slot on expansion, mean no state change moves
  the assignment controls. The CSS comment at `record.css:387` states the constraint the
  code can't show. This mirrors the existing override-chip/clear-button slot pattern in
  `EvaluationEvidenceRow` — the codebase's own idiom, followed.
- **Honest edge states.** Abstention renders "Conflict declared / Reviewer recused; no
  recommendation recorded." rather than a fabricated rating; an empty comment renders "—";
  the override sits in its own explicitly labelled block so the organizer can never
  mistake their own words for the reviewer's — ticket item 5, done properly.
- **Test quality is above the bar for this pattern.** Three of four tests assert rendered
  behavior via `renderToString` rather than implementation details; the one source-grep
  test (mounting inside the panel) follows the established `cold-start-screens.AC-280`
  convention and anchors on `title="Evaluation panel"`, which I confirmed exists. The
  suite fails on `main` by construction (the export doesn't exist there) and covers the
  happy path, override provenance, and recusal.
- **Scope discipline.** `EvaluationEvidenceRow` untouched, no second rendering pipeline
  built, no migration, no deploy — exactly what the ticket asked. `aria-controls` /
  `aria-expanded` on the disclosure button is a nice touch.

## Verification performed

- Ran `npx vitest run tests/unit/submission-record-evaluation-panel.MRQ-172.test.ts` in
  the implementer worktree: **4/4 passed**.
- Ran `npx tsc --noEmit` on the branch: **clean**.
- Independently traced the API projection (`submission-record.routes.ts:598-729`) and the
  DB schema (`0001_init.sql:516-530`) to confirm every field the component reads is
  present and non-null where the code assumes it.

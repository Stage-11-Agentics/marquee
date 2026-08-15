# Code Review: MRQ-178 — CNT-07, newest task columns off-screen

Reviewed: branch `MRQ-178` (tip `2b852856`, two commits on `17242b06`), PR #201.
Verification performed in a detached scratch worktree at the branch tip (removed after):
node contract suite `tests/node/onboarding-column-widths.test.mjs` **5/5 pass**, `tsc --noEmit`
**clean**, `orderNewestFirst` exercised directly (including the tie-break) — correct. Full
gate not run per fleet serialization rules; scoped checks only.

### 1. Verdict

**FAIL (implementation-level)** — the approach is sound and well executed against the base
it was built on, but that base is stale in a way that leaves the ticket's central
requirement unmet in the code that will actually ship. The task should return to
`in_progress` for a rebase-and-integrate pass, not to `in_planning`.

### 2. Summary

The chosen design — newest-first column ordering (`orderNewestFirst` by `position`
descending) plus a sticky pinned select/speaker column via shared `wide-grid` primitives —
is options 3 + 2 from the ticket, and the pieces I could verify are correct: `position` is
assigned `MAX(position)+1` at creation and never modified by the update path, so
position-descending genuinely means newest-first; at 1280px the newest column starts at
~396px (38 select + 220 speaker + 138 track) and is fully visible. The key finding: **the
branch was cut from a `main` that predates MRQ-164 (#182) — the very commit this ticket
layers on — so the committed diff never touches the "9 task columns · scroll the grid
sideways" sentence the ticket requires to go away, and GitHub reports PR #201 as
`CONFLICTING` against `github/main`.** An unresolved reconciliation (conflict markers, `UU`
files) is sitting live in the implementer's worktree, which confirms this is known and
in-flight — but as pushed, the PR is unmergeable and the acceptance is not met.

### 3. Issues

**[CRITICAL] src/ui/onboarding/OnboardingPage.tsx (branch base) — Built on a main that predates MRQ-164; PR #201 is unmergeable and the apology sentence survives**
The branch's merge base is local `main` `17242b06`, which does not contain `b0178496`
(MRQ-164, #182) — the commit that added the scroll-note (`matrixRef`/`matrixOverflows`/
`lastTaskColumn`, the "9 task columns · scroll the grid sideways to reach …" line) and that
this ticket explicitly names as its predecessor. Consequences: (a) GitHub reports PR #201
`mergeable: CONFLICTING` — it cannot merge; (b) the ticket's requirement that the sentence
"goes away, or becomes true and actionable" is unaddressed — the committed diff never sees
the sentence because its base never had it; (c) after a mechanical rebase, MRQ-164's note
would still render, and `lastTaskColumn` (the last of the now-reordered `task_templates`)
becomes the **oldest** task — the note would tell the reader to scroll sideways to reach
the seeded presentation upload, which is exactly the inverted message the ticket calls out.
**Fix:** Rebase onto current `github/main` (the reconciliation already under way in the
worktree), and treat the scroll-note as part of the change, not a conflict to be resolved
mechanically: remove it (newest-first makes it unnecessary at the acceptance viewport), or
rewrite it to be truthful about display order. Then extend the regression test to assert
the apologetic sentence is gone or truthful, re-run the suite, and force-push #201.

**[MINOR] tests/node/onboarding-column-widths.test.mjs:356 — Regression test asserts source text, not rendered output**
The CNT-07 contract test greps `OnboardingPage.tsx` and `wide-grid.css` for class strings
and regexes. It does fail on `main` (the `orderNewestFirst(` match and the pinned-class
matches cannot succeed there) and passes on the branch, so the fail-on-main requirement is
met — but the acceptance asks that the test "proves the newest task's column is reachable
in the rendered output," and a source regex proves markup authorship, not geometry. It also
hard-codes exact multi-class attribute strings, so any class reorder breaks it without a
behavior change. This follows the file's established CONTRACT style, hence minor rather
than major. **Fix:** When rebasing, consider one render-level assertion (the page's own
SSR/render path is exercised elsewhere in `tests/`) that the first task column in DOM order
is the highest-position template; keep the CSS-primitive assertions as-is.

**[MINOR] tests/unit/r2/policy.test.ts:137 — CNT-07 ordering test filed under r2 policy**
The `orderNewestFirst` unit test lives in the R2 upload-policy test file. That file is
already a grab-bag (it holds the AC-92 chase-ordering tests), so this follows local
precedent, but a `src/ui/shell/wide-grid.ts` helper tested from `tests/unit/r2/` will be
hard to find. **Fix:** Move it to a `tests/unit/wide-grid.test.ts` (or alongside the other
onboarding tests) during the rebase pass; zero-cost now, confusing later.

**[MINOR] src/styles/wide-grid.css:22 — Opaque pinned background breaks the row hover wash**
`.wide-grid-pinned { background: var(--panel) }` is required so scrolled columns pass
under the pinned ones, but `tbody tr:hover` paints a translucent `color-mix` wash on the
row — the pinned select/speaker cells stay flat `--panel` while the rest of the row
highlights, so the hover state visibly splits at the pinned boundary. Cosmetic, but this
project treats that kind of seam as a defect. **Fix:** On `tr:hover .wide-grid-pinned`, set
the background to the same mix composited over `--panel`
(`color-mix(in srgb, var(--accent-wash) 42%, var(--panel))`).

No security issues: the change is presentation-only — no new inputs, no data writes, no
markup built from strings (the task name already flowed through the same JSX text nodes).

### 4. Positive Observations

- **The right option, and the layered one.** Newest-first ordering directly answers the
  judge ("the dashboard was never observed reflecting the S2 upload") by making the S2
  task the first column the viewport opens on, and the sticky speaker column answers the
  row-identity requirement. The TASK TYPE filter was leaned on, not duplicated, exactly as
  the ticket asked.
- **`orderNewestFirst` is careful and honest.** Pure, stable (explicit index tie-break for
  equal positions), applied at display time so the snapshot's authored order is untouched
  for every other consumer — and the semantic bet checks out in the data layer: `position`
  is `MAX+1` at insert and absent from the UPDATE statement, so it is a true creation-order
  proxy.
- **The `wide-grid` primitives are a genuine extraction, not premature abstraction.** The
  `--wide-grid-leading-width` custom-property contract cleanly decouples the pinning offset
  from the consumer's column width (and `* { box-sizing: border-box }` in tokens.css makes
  the 38px offset exact), with a comment that names the intended second consumer (agenda
  builder). The z-index laddering (pinned header 3, plain header 2, pinned body 1) is
  correct for the two-axis sticky case.
- **Geometry stability was preserved.** `table-layout: fixed` with every column stating a
  width survives the change, `scrollbar-gutter: stable` is a nice touch, and the moved
  `min-width: max-content` keeps the grow-with-columns behavior the previous fix fought
  for — the existing contract tests that encode that history still pass unmodified in
  intent.
- **The verification story on the branch itself is green**: contract suite 5/5, clean
  typecheck, and the new tests genuinely fail on `main`.

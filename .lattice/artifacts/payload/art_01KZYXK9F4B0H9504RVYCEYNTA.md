# Code Review: MRQ-178 — chase grid pushes its newest task columns off the screen

## 1. Verdict

**PASS** — Implementation is correct and meets the acceptance criteria.

(Note: PR #201 for this exact branch head `c4251ed2` was already merged into `github/main` at 2026-08-14T01:13:53Z with a green `fast-gate`. This review is therefore retrospective; nothing found below warrants a revert.)

## 2. Summary

The branch fixes CNT-07 by choosing the ticket's option 3 — newest-first column ordering — plus a refactor of the pinned/scroll CSS into shared `wide-grid` primitives. A new `orderNewestFirst()` helper (sort by `position` descending, stable on ties) reorders `task_templates` at display time only, so the most recently authored task column renders immediately after the pinned select/speaker columns at x≈396px — comfortably on-screen at 1280px — while the API and every other consumer keep authored order. I verified the semantics hold: `position` is assigned `MAX(position)+1` at creation (`task-templates.routes.ts:498`) and the update route never rewrites it, so position-descending genuinely is creation-descending. The sticky/z-index/background layering survives the refactor intact, and the regression tests fail on `main` (the files they assert on don't exist there). Remaining issues are minor.

**Important scoping note for anyone reading the review diff:** the review prompt's diff was generated against the primary checkout's stale local `main` (`17242b06`), which is behind `github/main`. Almost everything in it — board fill/virtualization, tokens.css scrollbar theming, dashboard veil, social badges, portal, MRQ-176 files panel, auto-eval prompts, seed changes — is *other tickets' already-merged work*, not this branch. The branch's own change is exactly 9 files, ~149 insertions (`027cab88..c4251ed2`): the plan file, `src/styles/wide-grid.css`, `src/ui/app.tsx` (one import), `src/ui/onboarding/OnboardingPage.tsx`, `src/ui/onboarding/onboarding.css`, `src/ui/shell/wide-grid.ts`, and three test files. This review covers those 9 files.

## 3. Issues

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:345 — The "scroll the grid sideways" sentence survives**
The ticket said the sentence "goes away, or becomes true and actionable rather than an instruction to compensate for the UI." It remains, still phrased as an instruction to scroll, still with no visible horizontal scrollbar in the Day theme (macOS overlay scrollbars; the always-visible `::-webkit-scrollbar` theming elsewhere in the diff is Night-only and not this branch's work). The defect itself is genuinely fixed — the newest column is on-screen without scrolling, and the note now only fires on real overflow and names the *oldest* column (`lastTaskColumn` is `.at(-1)` of the reordered list, which is coherent) — so what the sentence describes is now archival reach rather than an apology for hiding live work. But it is still text-as-affordance for the columns it names.
**Fix:** Either drop the suffix entirely (the count alone carries the information), or replace it with a real affordance — e.g. always-visible scrollbar styling on `.wide-grid-scroll` in both themes, or an edge-fade/chevron that indicates more columns.

**[MINOR] tests — no rendered-output assertion; contract tests match source text**
The acceptance asked for "a regression test [that] proves the newest task's column is reachable in the rendered output." What shipped is (a) unit tests on the sort helper and (b) node CONTRACT tests that regex-match the TSX/CSS source (`onboarding-column-widths.test.mjs:81-92`). These do fail on `main` (the asserted files/identifiers don't exist there) and they follow this codebase's established CONTRACT-test idiom, but none of them renders the component, so a future change that reorders props or renames a class satisfies the intent while breaking the regex — or vice versa. The existing route-level test (`onboarding-new-task-column.MRQ-164.test.ts`) covers the API side only.
**Fix:** Acceptable as-is given codebase norms; if a follow-up touches this surface, add a render-level check (SSR or preact render-to-string of the matrix header) asserting the first `.onboarding-task-column` header is the highest-position template.

**[MINOR] tests/unit/r2/policy.test.ts:137 — CNT-07 ordering test duplicated, in the wrong home**
The same newest-first assertion exists twice: once here (via `OnboardingTaskTemplate` fixtures) and once in `tests/unit/wide-grid.MRQ-178.test.ts`. The R2 *policy* test file is a strange place for an onboarding-ordering test — it has evidently already accreted onboarding tests (it imports `compareOnboardingRows` etc.), but this change deepens that wart rather than draining it.
**Fix:** Keep the `wide-grid.MRQ-178.test.ts` pair (which also covers the tie-break) and drop the near-duplicate from `policy.test.ts`, or move it to an onboarding-named test file.

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:240-242 — `ready` rebuilt and re-sorted every render**
The spread-plus-sort runs on every render, not just when the snapshot changes, producing a new `task_templates` array identity each time. Harmless today (N≈9, the overflow effect deps use `.length` not identity, cells key by id), but it is exactly the shape that becomes an accidental re-render/effect-churn source if someone later adds `ready` or `ready.task_templates` to a dependency array.
**Fix:** Wrap in `useMemo(() => …, [state])` (or memo on `state.kind === "ready" ? state.snapshot : null`).

## 4. Positive Observations

- **The root cause was actually verified before being fixed.** `position` as a creation-ordered, append-only value is load-bearing for this whole approach, and it holds: assignment is `COALESCE(MAX(position),-1)+1` and the update route deliberately leaves `position` alone. "Newest first" is real, not a heuristic.
- **Display-only reordering is the right layer.** The API keeps `ORDER BY position ASC`, cells are keyed by `task.id` (order-independent), and the one consumer that opts into display order does so by name — `orderNewestFirst` — with the contract documented at the helper. Nothing downstream (portal, exports, authoring) inherits the reversal.
- **The `wide-grid` primitive extraction is a genuine simplification, not churn.** The old onboarding-local sticky rules (five selectors, a hand-threaded `--select-column-width` offset) collapse into four generic classes with a single `--wide-grid-leading-width` seam, and the z-order contract (pinned-header 3 > plain header 2 > pinned body 1) survives exactly. The existing contract tests were updated to point at the new home rather than deleted — the protections moved with the code.
- **Layering and theming details are right:** `.wide-grid-pinned-header` is declared after `.wide-grid-pinned` so the equal-specificity background resolves to `--sunk` for headers; the tbody hover tint rules retained their higher specificity so pinned cells still tint with the row; `scrollbar-gutter: stable` and the retained `min-height` on the scroll note honor the "elements never jump" rule.
- **Geometry confirms the acceptance criterion:** select 38 + speaker 220 + track 138 = 396px of pinned/leading columns, so the newest task column occupies ≈396–482px — visible at 1280px with no interaction, while overflow now costs only the oldest columns.
- The tie-breaker in `orderNewestFirst` is technically redundant (ES2019 sort is stable) but self-documenting and cheap — a reasonable call.

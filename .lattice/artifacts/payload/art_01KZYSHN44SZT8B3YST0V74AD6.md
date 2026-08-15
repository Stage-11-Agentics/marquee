# Plan Review: MRQ-178

### 1. Verdict

**FAIL (plan-level)** — the task should return to `in_planning` for revision.

### 2. Summary

I reviewed the plan submitted for MRQ-178 (CNT-07: the chase grid pushes its newest task columns off-screen at 1280px). The submitted "plan" is a verbatim copy of the task description — title added, everything else byte-for-byte identical, including the "Any of these is acceptable" menu of three options and the boilerplate constraints. It makes no decision, names no files, and contains no test strategy, so there is nothing here that implementation can proceed from and nothing a plan review can meaningfully de-risk.

### 3. Issues

**[CRITICAL] Entire plan — It is the task description, not a plan**
Lines under "### Plan" reproduce the task description verbatim. A plan's job is to convert "any of these is acceptable" into "we are doing this one, in these files, verified this way." None of that conversion happened. Approving this would push every plan-level decision into implementation, which is exactly the failure mode plan review exists to catch.
**Recommendation:** Rewrite the plan to contain (at minimum): the chosen approach, the files to be modified, the regression-test strategy, and how each acceptance clause maps to a change. The sections below spell out what each of those must resolve.

**[CRITICAL] What to build — No approach chosen among the three sanctioned options**
The task offers a column chooser (option 1), visible horizontal scroll with sticky speaker column (option 2), or newest-first ordering (option 3), and notes option 1 "is the strongest answer because it also scales past 9." These have very different footprints: option 1 needs chooser UI plus persisted/defaulted column state; option 2 is mostly CSS (`position: sticky` on the row-header column, a forced-visible scrollbar) plus discoverability work; option 3 is an `ORDER BY` change in the task-template query plus copy changes. The plan commits to none, so scope, files, and tests are all undefined. Note also that options 2 and 3 each satisfy the letter of the acceptance differently — option 3 alone makes the *newest* column visible without scrolling but leaves the *oldest* columns in the same undiscoverable position, arguably re-creating the defect for a different column; the plan should confront that trade-off explicitly rather than leave the implementer to discover it.
**Recommendation:** Pick one primary approach (or a deliberate small combination, e.g., newest-first ordering *plus* a real scroll affordance), state why, and enumerate what it does *not* cover.

**[MAJOR] Missing file identification — the plan names zero files**
The affected surface is well-localized and the plan should say so: the grid is `src/ui/onboarding/OnboardingPage.tsx` (the matrix renders from `ready.task_templates.map(...)` inside `.onboarding-matrix-wrap`), the wrapper's only current affordance is `overflow-x: auto` in `src/ui/onboarding/onboarding.css:35`, and the "9 task columns · scroll the grid sideways to reach …" sentence is template-generated in `OnboardingPage.tsx` (from `lastTaskColumn.name`). Column ordering, if chosen, likely touches `src/routes/onboarding.queries.ts` or wherever `task_templates` is ordered. Tests live under `tests/`.
**Recommendation:** List the concrete files and, for each, the nature of the change. This is a one-paragraph addition that turns the plan from abstract to checkable.

**[MAJOR] Acceptance — no regression-test strategy, and the required test is genuinely hard to design**
The acceptance demands "a regression test proves the newest task's column is reachable in the rendered output," failing on `main` and passing on the branch. This is the trickiest part of the whole ticket and the plan is silent on it. "Visible at 1280px" is a layout property: a DOM/JSDOM assertion cannot measure whether a column sits inside the viewport, because JSDOM does no layout. The plan must choose a mechanism — e.g., a Playwright test at a 1280px viewport asserting the newest task's header cell's `boundingBox` is within the viewport without scrolling (repo has `playwright.config.ts`), or, if the column-chooser/ordering route is taken, a component-level test asserting the newest template renders within the default-visible set / first position. Whichever mechanism, it must be shown to actually fail on `main` — and it must fit the 45s suite / 120s gate budget the project enforces.
**Recommendation:** Specify the test file, the assertion mechanism, and why it fails on `main`. If a Playwright test is used, state where it runs relative to the fast suite so the budget rule is respected.

**[MAJOR] Constraints — no plan for the "elements never jump" and sticky-speaker-column requirements**
The task's own riders — speaker column stays fixed while task columns move; no layout jump when columns toggle or the grid scrolls; reserve widths — interact non-trivially with each option. A sticky first column inside an `overflow-x: auto` table needs `position: sticky; left: 0` on both `th[scope=row]` and the header cell, plus background/z-index handling so rows don't bleed through; a column chooser needs reserved widths so toggling doesn't reflow the visible columns. MRQ-164's follow-up ("one token for the pinned pair's offset", #184) already established a pinning token on this very surface — the plan should build on it, not beside it.
**Recommendation:** Add a short "craft constraints" section stating how each rider is satisfied by the chosen approach, and reference the existing MRQ-164 pinned-offset token rather than introducing a parallel mechanism.

**[MINOR] Base branch — the primary checkout's `main` is stale; the plan must branch from `github/main`**
In the board's home checkout, local `main` (`17242b06`) predates the MRQ-164 merges; the "9 task columns · scroll sideways" sentence and the 9-column state this ticket targets exist only on `github/main` (`9fcab246`). A worktree created off stale local `main` would neither reproduce the defect nor let the regression test fail meaningfully.
**Recommendation:** The plan's first step should be `git fetch github` and `git worktree add ../Marquee-worktrees/MRQ-178 -b MRQ-178 github/main`. (A local branch named `MRQ-178` already exists — verify whose it is before reusing the name.)

### 4. Positive Observations

- The context carried into the plan is accurate and rich: the round-4 → round-5 causal chain (MRQ-164 fixed missing columns; off-screen columns are the residual gap), the judge's verbatim reasoning, and the rubric's pass criteria are all present and correctly quoted. Whoever implements will not lack for *why*.
- The constraints section faithfully preserves the fleet's hard rules (no stash, no deploy under freeze, serialized gate, own worktree), which matters in this multi-agent tree.
- The task framing itself ("a sentence is not an affordance"; newest columns are the most urgent) is a genuinely good product insight to keep in the eventual PR description.

None of that, however, is planning — it is well-preserved input. The revision only needs to add the four decisions flagged above (approach, files, test mechanism, base branch); the raw material for a strong plan is already all here.

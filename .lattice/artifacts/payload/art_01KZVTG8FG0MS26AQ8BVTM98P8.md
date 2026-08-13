# Plan Review: MRQ-135 — Publication confirmation gate clips every field

### 1. Verdict

**PASS** — Implementation can proceed. The diagnosed root cause is independently verified as accurate at the cited build, the fix is genuinely a one-liner, and none of the gaps below justify a round-trip to `in_planning` for a change this small. They should be absorbed as implementation notes.

### 2. Summary

The plan is a verbatim copy of the task description; it adds no decomposition, chosen fix variant, or verification step of its own. Normally that would weigh against it, but this ticket's description already contains a confirmed file:line root cause and three viable fix shapes — and I re-verified every claim directly against commit `75b871d94c6f`: `.agenda-publication-candidate` is `grid-template-columns: 20px minmax(0, 1fr)`, the checkbox renders only when `!review` (AgendaPage.tsx, the `{!review && <input …>}` guard), so in review mode the copy `<div>` falls into the 20px column and its nowrap/ellipsis children clip to 1–2 characters. The diagnosis is correct and the fix is bounded. The key concern is that the plan commits to no fix variant and no verification, and doesn't note that the affected code is **not on `main`**.

### 3. Issues

**[MAJOR] Fix shape — Plan does not choose among the three proposed variants**
The plan offers "placeholder first cell OR `grid-column: 1 / -1` OR single-column grid" and stops. These are not equivalent: the two column-collapsing variants shift the copy left by ~29px between the select step and the review step, while the placeholder-cell variant keeps text aligned across the mode transition. The workspace's binding UI rule is that elements never jump across state changes — the select→review transition is exactly such a change, and the rows are the same rows.
**Recommendation:** Prefer the variant that preserves horizontal alignment across steps (placeholder first cell, or equivalently a CSS-only `.agenda-publication-candidate-copy:only-child { grid-column: 1 / -1; }` if the left-shift is judged acceptable for a step transition). The implementer should make this call explicitly and say why, not leave it to the diff to reveal.

**[MAJOR] Verification — No acceptance criterion or test step anywhere in the plan**
The defect was found by an sbek judge walking the publish path; nothing in the plan closes that loop. A CSS one-liner is precisely the kind of change where green unit tests prove nothing — the fix must be seen. There is also no regression guard: the bug is structural (conditional first grid child + fixed first column), and the same pattern could silently re-clip after a future markup change.
**Recommendation:** Add two verification commitments: (1) drive `/agenda-builder` → select sessions → Review publication in the running app and confirm title, time, room, and speaker render in full (screenshot or e2e assertion); (2) a cheap regression assertion — e.g. a DOM/e2e check that the candidate copy's rendered width in review mode exceeds some sane floor, or that the copy element is not a 20px-column occupant.

**[MINOR] Target branch — The affected code does not exist on `main`**
Local `main` (`22e4a75f`) contains no `agenda-publication-candidate` code at all; the cited build `75b871d94c6f` sits 94 commits ahead on the working line. The plan never states what the fix branches from. An implementer who defaults to branching off `main` will find nothing to fix.
**Recommendation:** State the base explicitly (the current working line containing `75b871d94c6f`), and per repo rules do the work in a linked worktree, never the primary checkout.

**[MINOR] Root cause wording — Ellipsis attribution is one level off**
The plan attributes `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to "that copy" div. At the cited sha those properties live on the copy's `strong` and `span` **children** (`.agenda-publication-candidate-copy strong` / `… span`); the copy div itself is a grid with `min-width: 0`. The mechanism and the fix are unaffected — noted only so the implementer isn't confused when the copy div itself shows no ellipsis rules.
**Recommendation:** No plan change required; keep in mind when reading the CSS.

### 4. Positive Observations

- **The root cause is real, specific, and honest.** Every claim — the grid template, the `{!review && …}` conditional, the ellipsis behavior — checked out exactly against the cited commit. Plans that inherit a description this rigorous need far less scaffolding of their own; the diagnosis work that usually happens (or fails to happen) during implementation is already done and pinned to a sha.
- **Provenance is pinned.** Citing the exact build (`75b871d94c6f`) and the sbek run that surfaced the defect makes the claim re-verifiable — which is precisely how this review verified it in minutes.
- **Scope discipline is exemplary.** "One-line CSS/markup change, no dependency" is accurate, and the plan resists any temptation to redesign the publication panel while it's open. The urgency framing (a confirmation gate that defeats its own purpose on the publish path) correctly ties the fix to the product's "whole loop or nothing" principle.

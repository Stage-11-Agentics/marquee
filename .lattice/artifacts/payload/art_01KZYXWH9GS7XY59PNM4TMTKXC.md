# Plan Review — MRQ-183

## 1. Verdict

**FAIL (plan-level)** — the document submitted as a plan is a verbatim copy of the task
description, not a plan. It contains no implementation approach, names no files, makes no
design decisions, and its one original contribution — a rewritten constraints section —
drops several mandatory constraints and substitutes a gate-serialization mechanism that
violates the fleet rule. The task should return to `in_planning`.

## 2. Summary

I reviewed the MRQ-183 plan against the task description and the current codebase
(`src/ui/agenda/AgendaPage.tsx`, `src/lib/conflicts.ts`, and the merged MRQ-178 work).
Lines 130–203 of the plan reproduce the task description word for word; the only divergence
is the constraints section, which is shorter than the task's and contradicts it on gate
serialization. There is nothing here an implementer can execute against, and nothing a
reviewer can later hold the diff to — the two things a plan exists to provide.

## 3. Issues

**[CRITICAL] Entire plan — It is the task description, not a plan**
Everything from the title through Part 2's acceptance list is copied verbatim from the task.
There is no proposed approach for either part: no statement of what the badge will say and
how it gets the counterpart's name, no design for the room picker, no decomposition into
steps, no test plan. Every question in the review checklist ("does the plan identify which
files will be created or modified?", "is there a clear corresponding step for each
acceptance criterion?") is unanswerable because no planning content exists.
**Recommendation:** Return to `in_planning`. A real plan for this ticket should at minimum
name the surfaces it will touch and the shape of each change. From my read of the code, that
means: `src/ui/agenda/AgendaPage.tsx` — the tile badge at `agenda-conflict-flag`
(lines ~324 and ~452, note it renders in **two** tile variants, both must change),
`conflictMarkers()` (~line 229), which currently collapses each `AgendaConflict` to a bare
`"Conflict" | "Transit"` string and discards the `session_ids` pairing the task needs; the
`ConflictPanel` (~line 671) the counter must open; and `src/lib/conflicts.ts` as the single
source of counterpart data (constraint 4: no second detector).

**[CRITICAL] Plan constraints — Gate serialization contradicts the fleet rule**
The task mandates routing every `pr-gate` and full `npm test` through
`Marquee-worktrees/.gate-lock/gate-lock.sh` (which exists and is the lock the rest of the
fleet holds). The plan replaces this with a private Python `flock` on
`/tmp/marquee-gate.lock` — a *different* lock file. A lock only serializes its
participants: an agent holding `/tmp/marquee-gate.lock` lands its gate run directly on top
of whoever holds the fleet lock, inflating their timing and its own — precisely the failure
mode the task constraint spells out.
**Recommendation:** The plan's constraints must carry the task's gate-lock instruction
verbatim. Delete the `/tmp` flock line.

**[MAJOR] Plan constraints — Mandatory constraints silently dropped**
The plan's constraints section omits, without comment: cutting the branch from
`github/main` (never stale local `main`); the freshness check; the
instrument-verification rule (confirm port + `build_sha` before believing a negative
browser result, with tonight's taken ports); and the test-title rule
(`CONTRACT`/`AC-<n>` prefix enforced by `scripts/checks/trace-ac-core.mjs:44`, which the
task says has already cost three CI cycles tonight). An implementer working from the plan
alone will hit at least the test-title gate blind, and may branch from a stale `main`.
**Recommendation:** Carry the task's constraints through unmodified, or reference them
explicitly. A plan may add constraints; it must not shed them.

**[MAJOR] Part 2 — Ignores that MRQ-178 has already landed with reusable primitives**
The task says "read MRQ-178 before designing this, and prefer the same answer in both
places." MRQ-178 merged as PR #201 (`e9c1de43`) and deliberately extracted shared
primitives for exactly this reuse: `src/ui/shell/wide-grid.ts` and
`src/styles/wide-grid.css`, plus a testing pattern in
`tests/node/onboarding-column-widths.test.mjs`. The plan neither mentions the merged work
nor commits to reusing the primitives — the exact "two ideas of a wide grid" outcome the
task warns against.
**Recommendation:** The plan should state that Part 2 builds on `wide-grid.ts` /
`wide-grid.css`, and note anything the agenda grid needs that onboarding didn't (a sticky
*time* row-header column, room toggling with newest-on-by-default), extending the shared
primitives rather than forking them.

**[MAJOR] Missing — No test plan for the required regression test**
The task requires "a regression test that fails on `main` and passes on your branch." The
plan does not say what will be tested or how. Both parts are UI-behavior changes, which are
the hardest kind to make a failing-on-main test for; deciding the seam now (e.g., a
projection function in `conflicts.ts`/a view-model layer that maps a conflict to its
counterpart label, testable without a browser, following the `onboarding-column-widths`
pattern for the grid) is precisely what plan review is for.
**Recommendation:** Name the tests: at minimum one asserting the badge/view-model surfaces
the counterpart (person + clashing session) for a `speaker`/`co_speaker` conflict, and one
asserting column ordering/visibility puts the newest room in view — both titled
`CONTRACT · MRQ-183 · …` per the trace gate.

**[MINOR] Part 1 — Unaddressed design questions the code makes concrete**
The current badge distinguishes `Conflict` from `Transit` kinds, and the panel filters
through `visibleVenueConflicts()` (venue-disclosure). A plan should say what a *transit*
conflict's badge names (its counterpart is a room-to-room hop, not a person), how a tile
in **multiple** conflicts renders in a fixed-width slot, and whether the toolbar counter
counts raw or disclosure-filtered conflicts so the "door" opens onto a panel showing the
same number.
**Recommendation:** Add a short "design decisions" section resolving these three cases
before implementation starts.

## 4. Positive Observations

The task description embedded in the plan is genuinely excellent — it names the failure
pattern precisely ("the information exists and the surface the eye lands on does not carry
it"), pins Part 2 to MRQ-178 so the product keeps one idea of a wide grid, forbids a second
conflict detector, and carries the elements-never-jump rule into the badge design. Whoever
plans this next has an unusually clear brief: the acceptance criteria are concrete and
testable, and the "what to build" list is already a decomposition skeleton. The failure
here is purely that no one did the planning step on top of it — the raw material for a
strong plan is all present.

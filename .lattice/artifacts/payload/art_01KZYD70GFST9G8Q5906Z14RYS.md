# Plan Review: MRQ-164

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

I verified the plan's investigation against the live codebase and the linked worktree (`../Marquee-worktrees/mrq-164`), not just the prose: for Part 1 and Part 3 the described root causes check out exactly, the described fixes are already implemented, and the described tests exist and pass (`vitest run` — 2 files, 7 tests, green). The plan correctly overturns two of the ticket's three "where to look" hypotheses with real evidence rather than assuming them, which is exactly the discipline the ticket asked for. The one real gap is that Part 2's plan doesn't mention a pre-existing CONTRACT test (`tests/node/onboarding-column-widths.test.mjs`) that already pins the exact CSS classes and JSX structure the planned fix will touch — worth folding in before implementation starts, but not a reason to send the plan back.

## 3. Issues

```
**[MAJOR] Part 2 — Work items 4/6 don't account for the existing onboarding-column-widths CONTRACT test**
`tests/node/onboarding-column-widths.test.mjs` already asserts, by regex against
`onboarding.css` and `OnboardingPage.tsx`, that `.onboarding-speaker-column` states
a fixed width, `.onboarding-matrix-wrap` is `overflow-x: auto`, and
`.onboarding-matrix` is `min-width: max-content` — the anti-squeeze fix from an
earlier ticket. The plan's Part 2 work (pin the speaker column, add an overflow
affordance) touches exactly these rules but never mentions this file. Pinning the
speaker column will need `position: sticky; left: 0` added to
`.onboarding-speaker-column` — plausible without breaking the existing width
assertions, but the plan should say so explicitly rather than have the
implementer discover the coupling by breaking a test mid-PR.
**Recommendation:** Name `tests/node/onboarding-column-widths.test.mjs` in the plan,
confirm the sticky-column change is additive to its assertions, and extend that
same file (rather than starting a disconnected one) for the new "task authored
after setup gets a visible column" and "all-unassigned row says so" coverage
called for in Work item 6.
```

```
**[MINOR] Work item 6 — "Tests for 4 and 5" is underspecified**
Items 2 and 3 name exact test files and scenarios; item 6 does not. The onboarding
UI tests in this repo follow a static-analysis "CONTRACT" pattern
(`tests/node/*.test.mjs` reading source and asserting via regex) rather than DOM
rendering, and `src/lib/sessionize-import.ts` already has integration coverage at
`tests/integration/api/sessionize-import.AC-110-113.test.ts`. Leaving the pattern
unstated risks a shallow test (e.g. only unit-testing `merge()` in isolation
instead of an integration test exercising the actual blank-cell-preserves-value
path end to end).
**Recommendation:** State which file the Part 3 merge/reason tests extend
(`sessionize-import.AC-110-113.test.ts` looks like the natural home) and confirm
Part 2's new tests follow the CONTRACT-file pattern already established.
```

```
**[MINOR] Part 3 — PR-description commitment isn't in the Work list**
The ticket is explicit: "State the choice in the PR; do not leave it implicit."
The plan states the last-write-wins decision clearly in the plan body and the
code comment, but the Work checklist (items 1–7) has no line item for writing it
into the PR description itself, which is the artifact the ticket actually asked
for.
**Recommendation:** Add a Work item (or fold into item 7) confirming the PR
description states the last-write-wins policy explicitly, not just the code
comment.
```

## 4. Positive Observations

- **The investigation is verified, not asserted.** I independently re-derived Part 1's root cause (the `+ Add session` form at `src/ui/submissions/CreateSubmissionPage.tsx` only ever sends `submitter_person_id`/`submitter`, producing a single `submitter`-role participation) and Part 3's root cause (the wholesale `UPDATE ... SET title = ?, company = ?, bio = ?` in `sessionize-import.ts` vs. the blank-preserving filter already in `speakers.routes.ts`) directly from source, and both match the plan exactly, including line-level details.
- **It correctly refuses two of the ticket's own hypotheses.** The ticket's five-layer trace for Part 1 said "don't touch the role list" and the plan's own repro test proves the co-speaker path passes unfixed — the plan does not touch `AGENDA_PARTICIPATION_ROLES`, and instead finds the real defect one layer over. That is precisely the caution the ticket asked for ("if that turns out to be the case, say so and close this part; do not invent a fix").
- **Fixes are narrow and justified against rejected alternatives.** Part 1's submitter-fallback is scoped to fire only when no participant holds an agenda role, with the false-positive case explicitly tested (`tests/unit/agenda-conflicts.AC-76-77.test.ts:101`) and passing. Two plausible-but-wrong fixes (widening `AGENDA_PARTICIPATION_ROLES`, fabricating a `speaker` row at write time) are named and rejected with reasons.
- **Work already done is honestly reported as such.** Parts 1 and 3 have working code and green tests in the worktree right now; Part 2 has none yet. The plan doesn't overstate progress on Part 2, and its acceptance-criteria mapping (pin column → visibility, overflow affordance → discoverability, per-row honesty → distinguishability) lines up one-to-one with the ticket's three-clause Part 2 acceptance line.
- **Validation plan matches the ticket's explicit gate.** All three parts have a stated browser-driven validation step (Work item 7) mirroring the ticket's "Local review is not enough … drive the running system" requirement, rather than treating passing tests as sufficient.

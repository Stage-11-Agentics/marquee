# Plan Review: MRQ-206

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The minor issues below are precision notes for the implementer, not gaps requiring re-planning.

## 2. Summary

Reviewed the four-step plan for MRQ-206 (kind segment leading the submissions toolbar; Sessions explainer band on the program board) against the ticket source (`sequence/sidebar-fold-tickets.md` §T4), the current code, and the binding prototype. The plan is terse but each step maps cleanly onto real seams that I verified exist: the kind dropdown at `src/ui/submissions/SubmissionsPage.tsx:837`, saved-view serialization that already includes `kind` (`SubmissionsPage.tsx:686`), the board's type filter at `src/ui/board/ProgramBoardPage.tsx:140`, and the prototype's `#kind-segment` (fixed `width: 82px` buttons) and `board-kind-note` band with the exact ruled copy. The key concern is a wording ambiguity around where "URL round-tripping" applies — the board's filter state is component-local, not URL-backed, and the implementer must not invent a new URL param for the board.

## 3. Issues

**[MINOR] Step 3 — Board filter is local state, not URL-backed; scope the round-trip tests accordingly**
`ProgramBoardPage.tsx` holds its filters in component `useState` (`FilterState` at line 30), with no query-param serialization. Step 3 bundles "both visible/hidden arms and URL round-tripping" into one sentence, which could be read as tying the band to URL state. If the implementer adds a `kind` URL param to the board to make that test pass, they have changed a surface the ticket explicitly freezes ("no new query shape") and grown the diff beyond the contract. The prototype likewise drives the band from in-page filter state (`state.boardType === "Sessions"`).
**Recommendation:** Treat URL round-tripping as a submissions-list concern only. The board band's visible/hidden regressions should drive the existing local filter (select the Sessions option, assert the band; clear it, assert absence) with no routing changes.

**[MINOR] Step 2 — "Fixed width" must be a true fixed width, not the existing `.segment` min-width**
The app already ships a `.segment` component style (`src/styles/components.css:139`) whose buttons use `min-width: 76px`. The prototype deliberately overrides this for the kind segment: `#kind-segment button { width: 82px }`. With 10px mono uppercase, "ABSTRACTS" renders close to 76px — a min-width could let the longest label stretch its button, so the active-state bolding rule and the elements-never-jump rule (a project-level hard rule) hinge on the explicit fixed width. The plan's "prototype-matched fixed-width" phrasing covers this, but only if the implementer notices the prototype's override rather than reusing bare `.segment`.
**Recommendation:** Reuse the existing `.segment` markup pattern (see `AgendaPage.tsx:1246` for the accessible precedent with roles and labels) but carry the prototype's explicit per-button width override into the submissions stylesheet.

**[MINOR] Plan-wide — The judges' language ruling deserves an explicit regression guard**
The ticket records a ruling that chips stay "Abstract"/"Session" (singular) while the segment reads "All / Abstracts / Sessions" (plural). That asymmetry is exactly the kind of thing a well-meaning implementer "harmonizes" while touching adjacent code — the chip rendering sits lines away from the dropdown being replaced (`SubmissionsPage.tsx:195`, `ProgramBoardPage.tsx:51`). The plan never proposes touching chips, but it also never marks them as a non-goal.
**Recommendation:** Add one cheap assertion to the step-3 regressions that chip labels remain "Abstract"/"Session", so the ruling is enforced rather than remembered.

**[MINOR] Step 1 — Files named by the ticket, not the plan**
The checklist asks whether the plan identifies files to be modified; the plan speaks of "seams" while the ticket names `src/ui/submissions/SubmissionsPage.tsx` and the board view. Since the ticket text travels with the plan this is survivable, but the plan is the artifact a fresh implementer executes.
**Recommendation:** No revision required; the implementer should read step 1's inspection as landing on `SubmissionsPage.tsx`, `ProgramBoardPage.tsx`, `board.css`/`submissions.css`, and `src/styles/components.css`.

## 4. Positive Observations

- **The plan is anchored to a real, verified design contract.** Prototypes/pipeline-v1.1 at v1.15 contains the segment, the band, and the exact explainer copy the ticket quotes — the "reproduce the prototype one-to-one" rule is satisfiable without interpretation, and the plan points straight at it.
- **The hardest requirement is already free, and the plan knows it.** Saved-view serialization (`SubmissionsPage.tsx:686`) and the list query (`list-request.ts` seam, `kind` param at line 302) already carry `kind`; step 2's "preserving the existing serialization" is the correct posture — read/write the same param, change no query shape, and R7's server-side filtering rule is honored by doing nothing.
- **Step ordering is right for this codebase.** Baseline first (step 1) matters in a multi-agent tree where a stale base has previously manufactured phantom failures; and step 4's closing sequence — targeted tests, `check:design`, the full PR gate (which I confirmed includes the design-contract check), plus a running-app smoke pass — matches the project's "green tests ≠ working product" doctrine.
- **Scope discipline.** Four steps, no new abstractions, no board URL params, no new query shape, and the toolbar replacement is a swap rather than a redesign. This is the right size for a single implementation pass and a single captain-review PR.

# Pipeline v1.4 — the converged, context-complete take

**Read `prototypes/PROTOTYPE-CONTRACT.md` first — still fully binding** (badge, vocabulary, mock-data scale and ugliness, elements-never-jump, the 11-step loop, speed). This build converges the client-chosen direction with the best of the other two takes into **one super solid prototype**: `prototypes/pipeline-v1.1/index.html`, self-contained. The directory name is retained for lineage; the file is now the **v1.4 client-review candidate**.

## v1.4 context-coverage closure (client-approved scope, 2026-08-09)

- Demonstrate multiple independent forms and the complete CFP participant/profile/file/conditional flow, including open, closed, at-limit, resumed-draft, and submitted states.
- Make portal acknowledge/form/file tasks real completion surfaces; show organizer-controlled talk editing and one-source decision feedback across email + portal.
- Make reviewer responsibility explicit by track; open full evaluator-visible submissions/files without losing queue position; use **Approve · Maybe · Deny** as the simple path with numeric scoring optional.
- Add personal event-scoped saved views, configurable table columns (Title mandatory), and the role-gated **Drafts needing attention** queue. Opening/editing a draft never submits it.
- Preserve the v1.3 ruling: Program board cards are read-only navigation; consequential actions belong on the record. Agenda drag remains.
- Do **not** add Month view or a generalized CMS. Month was reference-image vocabulary, and generalized CMS support is optional/R8-skipped; the narrow Handbook and embeds remain.

This prototype is not yet signed. Do not mint `DESIGN.md` or begin orchestration until Atin drives and approves v1.4.

## Base and sources — steal code, don't rewrite

- **Base: `prototypes/pipeline/index.html`** — the chosen spine. Start from it (copy, then modify). Keep its IA, home dashboard, reviewer queue, form builder, portal, public views, ⌘K, and the `min-width: 900px` table fix.
- **`prototypes/chase/index.html`** — reference implementation for the chase board you are grafting in.
- **`prototypes/marquee/index.html`** — reference implementation for the swimlane agenda you are grafting in.

All three are working, verified prototypes. Lift their markup/CSS/JS wholesale where it serves; unify naming and styling to the Pipeline base's system.

## Original convergence changes (still binding)

### 1. Onboarding becomes a first-class pipeline stage

Home pipeline becomes: **Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published**. The Onboarding count is *speakers who still owe something* (e.g. "103 owe tasks · 38 at risk"), styled like every other stage, clickable like every other stage. The attention strip keeps its overdue line, now deep-linking into the same place.

### 2. The Chase board grafts in as the Onboarding stage screen

Clicking the Onboarding stage lands on the full chase board from the Chase take: every accepted speaker × task state glyphs, filter chips with live counts (All / Overdue / Incomplete / At risk), task-type and track filters, select-all → **"Send reminder (N)"** updating live, per-row Nudge, the compose drawer with template + merge-field preview and per-row send logging, and the **speaker context drawer** (click a name → tasks, message history, sessions, bio). This should be the single most finished screen in the product — it is the brief's item 6 and our strongest differentiator.

### 3. The Marquee swimlane grafts in as the Agenda's track view

The agenda keeps Pipeline's list/day/week/room views; the **track view becomes Marquee's swimlane canvas** — tracks as lanes, the unscheduled pool docked (158 accepted ready to place), drag-and-drop placement with format-default durations, live conflict flags on tiles, and the conflicts drawer. Fixed-width view toggle (no layout shift), filters and scroll preserved across views.

## Also fix (QA findings from round 1)

- **Title-template repetition**: the procedural generator's phrases repeat visibly ("at uncomfortable scale" twice on one screen). Widen the generator's variety — enough templates/combinators that no phrase repeats within any one visible screen.
- Verify the submissions table renders real titles at both full and narrow widths.

## Aesthetic

Keep Pipeline's clean, typography-led language as the base — data surfaces stay quiet. Add **restrained Marquee identity in brand moments only**: the wordmark, the landing page, and the pipeline strip itself may carry a touch of display-type theater and track-color energy. If a flourish competes with data legibility, the flourish loses.

## Verification gate (before presenting v1.4)

Drive the full 11-step loop headlessly. Confirm: every loop screen reachable and populated; the original three convergence changes function; every v1.4 context-closure control mutates/restores the expected state; desktop and 375px layouts remain operable; no JavaScript errors; no dead controls (toast rule from the contract).

Handoff as a client review candidate, not as a signed design.

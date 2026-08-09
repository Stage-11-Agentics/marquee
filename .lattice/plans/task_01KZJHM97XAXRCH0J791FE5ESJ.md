# MRQ-20: Agenda: data, pool, placement, and day/list/week/room views

BUILDPLAN: M-19a — Wave 1 (§4), walkthrough step 10

Scope (verbatim): Unscheduled pool = accepted-and-unplaced, configurable schedulable statuses, drag pool↔slot, drop sets date/time/room, duration from format, resize, **no save button**, filters + scroll preserved across view switches. **The unscheduled pool is derived from status** (accepted-and-unplaced), so a live M-18 accept flows into it with no code dependency — which is why this ticket depends on M-08's list/queries and **not** on M-16's evaluation plan. That dependency was serializing the whole agenda branch behind evaluation and made M-08 → M-16 → M-19a → M-20 → M-22 the longest chain in Wave 1; removing it is the single cheapest schedule win available (F-17).

Non-goal (EVALUATION §5): **no Month view.** List, Day, Week, Track, and Room are the five signed views; "Month" appeared only in a context reference image.
Amendment 11 fold (SPEC.md): agenda room headers render "Room · Building" and expose the AV/notes tooltip panel where placement decisions happen (AC-252, AC-253) — without cluttering public surfaces.

File surface: `src/routes/agenda.routes.ts`, `agenda.queries.ts`, `src/ui/agenda/*`

ACs: AC-70 – AC-74, AC-80, AC-82 · **AC-252, AC-253** (agenda-side rendering, Amendment 11 fold)
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: none — module-local.
Deps: M-08 (explicitly **not** M-16)
Plan: filled in by delegator's plan phase

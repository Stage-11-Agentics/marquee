# MRQ-10: Event settings: details, formats, tracks, rooms, buildings

BUILDPLAN: M-09 — Wave 1 (§4), walkthrough step 2

Scope (verbatim): Event details (incl. timezone driving every rendered time and ICS `DTSTART`), formats with default durations, tracks with colors + reorder, rooms with capacity. Save confirms in place, no reload.

Amendment 11 fold (SPEC.md, post-BUILDPLAN-v1.4 — flagged to the orchestrator; SPEC allocates +2 h across Event Settings, seed, and agenda): **Buildings card** — an event supports multiple buildings, each with a name and address, managed from Event Settings; every room belongs to a building (AC-252). **Rooms card** gains a building select, an **AV capabilities** tag editor (projector, confidence monitor, mic count, livestream), and free-text **notes** (AC-253). Room displays that schedulers and day-of staff read render "Room · Building". The v1.6 prototype (`prototypes/pipeline-v1.1/index.html`) carries the buildings card, room AV tags/notes, and Room·Building headers — reproduce it one-to-one.

File surface: `src/routes/event-settings.routes.ts`, `src/ui/settings/*`

ACs: AC-5 – AC-13 · **AC-252, AC-253** (Amendment 11 fold — settings-side owner)
Hours: 4 (+~1 for the venue fold)
Workflow: inline-full
Shared files: none — module-local.
Deps: M-08
Plan: filled in by delegator's plan phase

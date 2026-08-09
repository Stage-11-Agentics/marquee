# MRQ-21: Agenda: track swimlane and conflicts

BUILDPLAN: M-19b — Wave 1 (§4)

Scope (verbatim): True swimlane per track (own lane box per track, day bands, slot columns), conflict computation over rooms **and every participation role**, tile flags, conflicts drawer with jump-to, warn-never-block.

AC-81 is structural, not cosmetic: lane container count equals track count, each lane has its own bounding box, every session's box sits inside its own track's lane. **Colour overlay alone fails.**
AC-77 is parameterized over all four participation roles — speaker, co-speaker, moderator, chairperson.
Felt checkpoint C5 runs here on deployed infra: place ten sessions with a trackpad and with a mouse; no perceptible lag, no snap-back, no ghost offset.

File surface: `src/ui/agenda/track-board.tsx`, `src/lib/conflicts.ts`

ACs: AC-75 – AC-79, AC-81
Hours: 5
Workflow: inline-full
Shared files: none — `src/lib/conflicts.ts` is a new specific-name helper (§7).
Deps: M-19a
Plan: filled in by delegator's plan phase

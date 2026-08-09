# MRQ-41: Empty-state pass and craft sweep

BUILDPLAN: M-48 + M-49 — cross-cutting (§5), run alongside, not after · MERGED at mint (3 h + 3 h = 6 h; both are one sweep over every route with no dependencies, and doing them in one pass is how the sweep stays coherent)

**M-48 — Empty-state pass** (3 h)
Scope (verbatim): every route renders an empty-state component naming the next action on a fresh install (AC-161).

**M-49 — Craft sweep** (3 h)
Scope (verbatim): elements never jump (reserved space, fixed-width toggles, `—` over removed rows, tabular numerals), one primary action per screen, textual state markers everywhere colour is used.
This is the house UI rule stated as a ticket: toggling a control must never shift another element. Textual state markers matter to a dozen ACs that say "text, not colour alone" (AC-23, AC-42, AC-49, AC-120, and the agenda's AC-81).

ACs: AC-161 (M-48) · M-49 carries no AC of its own but underwrites every "not colour alone" assertion and felt checkpoint C3
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: touches every module's own styles — **never `src/styles/tokens.css`** (M-05a owns it; token changes go through the orchestrator).
Deps: none listed in the plan's cross-cutting table (runs alongside; in practice it sweeps whatever has landed)
Audit that keys off this ticket: A-2 (PROTOTYPE-badge sweep), after M-49
Plan: filled in by delegator's plan phase

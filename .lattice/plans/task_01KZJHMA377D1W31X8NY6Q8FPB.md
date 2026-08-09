# MRQ-29: Quick search

BUILDPLAN: M-28 — Tier B rank 5 (US-67), Wave 2 (§5)

Scope (verbatim): affordance on every admin route, `/` and ⌘K with no navigation, one labelled result list across submissions/speakers/sessions/forms, fuzzy on name and title, <200 ms.

AC-101 iterates **every** admin route in the route manifest — the affordance must be in M-05a's shell, not bolted onto individual screens.

ACs: AC-101 – AC-104
Hours: 4
Workflow: inline-full
Shared files: the search affordance lives in the shell topbar (M-05a's `src/ui/shell/*`) — additive only; do not restyle the shell.
Deps: M-10
Speed: AC-103 is an AC-sourced budget — keystroke → results painted p95 ≤ 200 ms over ≥10 queries including misspellings.
Plan: filled in by delegator's plan phase

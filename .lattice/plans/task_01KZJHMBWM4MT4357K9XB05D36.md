# MRQ-48: Audit — speed report, AC-sourced versus objective

BUILDPLAN: A-6 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Speed report — `speed-report.json` attached with actuals, AC-sourced vs objective separated.
Starts when (verbatim): After M-22.

The separation is the whole point (client ruling 2026-08-09): **AC-sourced budgets fail the run** (AC-16, AC-36, AC-62, AC-69 completion, AC-85, AC-89, AC-103); the client-signed *objective* budgets are reported with a ⚠ OBJECTIVE MISSED banner and never exit non-zero. An auditor who mixes the two either fails a green build or passes a red one.
Rule that still binds both kinds: if a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion.

ACs: — (backs gate 7; evidence for AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, AC-103)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-22
Plan: filled in by delegator's plan phase

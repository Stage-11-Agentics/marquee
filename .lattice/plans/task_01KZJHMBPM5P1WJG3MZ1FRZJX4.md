# MRQ-46: Audit — Airtable mirror isolation

BUILDPLAN: A-4 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Mirror isolation — Airtable client importable only from `src/jobs/mirror/*`; zero mirror calls during page renders.
Starts when (verbatim): **From CP-2**, tightened after M-25/M-26.

This is guardrail G4 and trap 8 (Airtable Team throttles at 2 req/s). **A-4's isolation rule is what makes AC-225's 60-second budget affordable** — the mirror is asynchronous by construction, never on a read path.

ACs: — (underwrites AC-225)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: none linked — the plan's start condition is the CP-2 checkpoint, not a ticket; the M-25/M-26 tightening is a second pass recorded here rather than a dependency, so the import-boundary lint can land the moment CP-2 is green.
Plan: filled in by delegator's plan phase

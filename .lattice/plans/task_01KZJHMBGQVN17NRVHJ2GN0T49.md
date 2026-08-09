# MRQ-44: Audit — PROTOTYPE badge absent from the product

BUILDPLAN: A-2 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): PROTOTYPE-badge sweep — grep `src/` and the built bundle, visual pass over every product route.
Starts when (verbatim): After M-49.

Pass condition (gate 15): the badge exists **only** under `prototypes/`; no product route renders it. The grep must cover the built bundle, not just source — a badge that survives the build is exactly the failure this audit exists to catch.

ACs: — (backs gate 15)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-48+M-49
Plan: filled in by delegator's plan phase

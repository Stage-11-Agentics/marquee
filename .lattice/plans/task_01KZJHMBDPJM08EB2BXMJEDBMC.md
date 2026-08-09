# MRQ-43: Audit — repo hygiene and full-history scan

BUILDPLAN: A-1 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Repo hygiene — secret scan, `Atin/` and internal paths, third-party denylist, full history.
Starts when (verbatim): At every milestone; **twice at the push** (assembled orphan history, then the pushed remote).

Method: `npm run check:repo` over **the full history of the tree being published**, not the tip — gitleaks + the Marquee ruleset + PROTOTYPE-badge absence in `src/` + README lint + `Atin/`/Stage-11 path scan + the third-party-content denylist (`sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state`, `C11_`, `surface:`, `workspace:`, `/Users/`).
**A-1's second run is a hard gate on the push** (§8 item 13), not a formality. Backs gate 16.

ACs: — (backs gates 15 and 16)
Hours: 2
Workflow: fast-track
Shared files: none — the audit produces an artifact, not a code change. File findings as Lattice comments/artifacts and open follow-up tickets rather than editing the subject code.
Deps: none — its start is a milestone, not a ticket ("at every milestone")
Plan: filled in by delegator's plan phase

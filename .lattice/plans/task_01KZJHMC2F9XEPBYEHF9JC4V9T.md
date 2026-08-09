# MRQ-50: Audit — reviewer anonymity byte-scan

BUILDPLAN: A-8 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Anonymity scan — byte-scan every reviewer-visible response **and export** for seeded identity strings.
Starts when (verbatim): After M-17.

The export is the half that gets forgotten — AC-64 and AC-246 both assert over "every export", which is why M-17 ships `GET /rounds/:id/export?format=csv` for this audit to scan. Strings to scan: name, company, email, bio fragment, headshot URL. Identity is stripped **in the query layer**, so a view-layer fix is a finding.

ACs: **AC-64** (audit evidence)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-17
Plan: filled in by delegator's plan phase

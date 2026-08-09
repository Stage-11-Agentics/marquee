# MRQ-51: Audit — reviewer event and track isolation

BUILDPLAN: A-9 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Reviewer event+track isolation (**AC-214, AC-246**) — one helper on every reviewer route incl. export; out-of-scope ID probe.
Starts when (verbatim): **From CP-2** (M-16/M-17 landed).

AC-214 is a post-competition ID that carries an enforcement obligation anyway (EVALUATION §7): cross-event reviewer access is not inherited; reviewer scope is per event by construction. It is the one permission bug in this domain that leaks unpublished work. The probe: guess an out-of-scope submission ID as a reviewer → 403 with no metadata.

ACs: **AC-214, AC-246** (audit evidence)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-16, M-17
Plan: filled in by delegator's plan phase

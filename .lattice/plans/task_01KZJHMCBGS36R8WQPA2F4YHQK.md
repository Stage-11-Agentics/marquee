# MRQ-53: Audit — reset drill

BUILDPLAN: A-11 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Reset drill (**AC-230**) — mutate, reset by command and by button, twice consecutively, concurrent poller sees no partial state, **mirror change feed short-circuited and one reconcile enqueued**.
Starts when (verbatim): After M-03; **re-run at CP-3**.

Gate 13's shape: mutate the demo (bulk-accept a wave, un-accept a talk, reschedule a session), run `reset:demo` **and** the in-product button, then re-run `check:seed`. A second context polls the public agenda and the dashboard throughout and must observe only coherent states — never zero sessions alongside non-zero speakers. The second judge inherits nothing from the first.

ACs: **AC-230** (audit evidence; the e2e is M-03's)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-03
Plan: filled in by delegator's plan phase

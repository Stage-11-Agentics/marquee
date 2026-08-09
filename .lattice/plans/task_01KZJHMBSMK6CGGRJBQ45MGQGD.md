# MRQ-47: Audit — cookie scope and session issuance

BUILDPLAN: A-5 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Cookie scope and session issuance — no `Domain=`; enumerate every route that mints an `auth_sessions` row and assert its precondition, including the demo route's `demo_mode` gate; **embed routes never read `mq_session`**.
Starts when (verbatim): **From CP-2** (M-03 landed).

Trap 15: `.dev` is HSTS-preloaded and parent-domain cookies leak — the session cookie carries **no `Domain` attribute** (guardrail G6). AC-2's second half is this audit's: with `events.demo_mode=0`, `POST /api/v1/auth/demo` returns 403 and sets **no** cookie — a self-hosted instance ships no one-click owner session.

ACs: — (asserts the AC-2 demo-mode gate; backs gate 5)
Hours: 2
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-03
Plan: filled in by delegator's plan phase

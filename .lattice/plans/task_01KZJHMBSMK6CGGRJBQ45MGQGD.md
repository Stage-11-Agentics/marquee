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

## Audit plan

### Objective

Independently prove the shipped authentication perimeter for A-5. The audit will enumerate every production path that inserts an `auth_sessions` row or sets the session cookie, then exercise each precondition and the denial paths. It will separately verify cookie scope, session lifetime, magic-link single use and expiry, demo-mode gating, embed isolation, and parity between cookie sessions and MRQ-30 bearer tokens.

### Evidence method

1. Read the binding auth/session implementation and its existing tests. Inventory `auth_sessions` writers, cookie construction, credential resolution, magic-link issuance/consumption, demo-mode configuration, bearer-token resolution, and embed routes with `rg` plus direct call-site inspection. Record exact `file:line` locations.
2. Establish a clean baseline with the auth-focused Node tests and the relevant repository gate checks before adding audit coverage. Distinguish harness failures from product findings.
3. Add focused AC-tagged Node coverage for the demo-mode denial contract and any missing machine guard discovered by the inventory. Each negative assertion will check status, response headers/body, and before/after persistence counts; each guard will include a positive control.
4. Run deterministic request-level probes against the shipped route handlers or the existing test harness for:
   - `HttpOnly`, `Secure`, `SameSite`, `Path`, and absence of `Domain` on session cookies;
   - issuance, expiry, and rejection of expired sessions;
   - unauthenticated attempts to mint or extend sessions;
   - magic-link token single-use and time-bounded expiry;
   - `POST /api/v1/auth/demo` with `events.demo_mode = 0`, requiring `403`, `demo_disabled`, no `Set-Cookie`, and no new session row;
   - embed routes, proving they neither read nor honor `mq_session`;
   - bearer-token versus cookie-session authority, including grant intersection with membership, conference restriction, and immediate revocation.
5. For every finding, write a concrete reproduction with `file:line`, request/input, observed result, expected result, and owning seam. If all checks pass, state the exact coverage and observed outputs rather than inferring safety from source inspection.

### Deliverables

- Audit findings and evidence in the ticket completion/review artifact; no production-code fixes unless a trivially safe guard is required and explicitly identified.
- A regression guard under `tests/node` for each recurrence risk found. Do not create `tests/ac-claims/MRQ-47.json` unless traceability proves MRQ-47 owns an `auto` AC; if it owns none, record that explicitly in the completion artifact instead of shipping an empty claims file.
- Self-review artifact naming the final branch commit, with a PASS verdict and `file:line` findings or an explicit clean-audit coverage statement.

### Non-goals

Do not edit SPEC/EVALUATION/BUILDPLAN/DESIGN/USER_STORIES, mint AC IDs, alter the auth implementation being audited, broaden the audit into unrelated route behavior, or merge the PR. The terminal state for this delegator is `pr_open`.

### Verification and handoff

After implementation and self-review, run `npm run pr-gate -- --ticket MRQ-47`, capture its result, push `mrq-47-audit-cookie` to `forgejo`, open the PR against `master`, attach the PR reference, transition the ticket to `pr_open`, and report the state to the Orchestrator at workspace:9 surface:60.

# Plan Review: MRQ-47 — Audit: cookie scope and session issuance (A-5)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. Two scope-discipline notes below should be honored during execution but do not require returning to planning.

### 2. Summary

Reviewed the audit plan for A-5 against BUILDPLAN §5 (audit track), the A-5 row's verbatim scope, and the current state of the repo. The plan is strong: it enumerates the right evidence surfaces, treats the demo-mode denial (AC-2's second half / Trap 15) as a first-class request-level probe rather than a source read, and its ground assumptions all check out against the codebase — M-03 has landed (`src/lib/auth/*`, `src/routes/auth.routes.ts`), `npm run pr-gate -- --ticket MRQ-N` is the real gate interface (`scripts/checks/pr-gate.mjs`), `tests/node` and `tests/ac-claims` exist as described, the `mrq-47-audit-cookie` branch already exists as a worktree branch, and `master` on `forgejo` is the correct PR target. The one key concern is a single evidence bullet (bearer-token authority semantics) that drifts beyond A-5's verbatim scope and contradicts the plan's own non-goals.

### 3. Issues

**[MAJOR] Evidence method, step 4 (last bullet) — Bearer-token authority audit exceeds A-5's verbatim scope**
The bullet "bearer-token versus cookie-session authority, including grant intersection with membership, conference restriction, and immediate revocation" audits the MRQ-30 token feature's authorization semantics. Bearer tokens do not touch `auth_sessions` (verified: `src/lib/auth/credential-resolver.ts` and `src/routes/tokens.routes.ts` contain no `auth_sessions` or `mq_session` references; the sole INSERT site is `src/lib/auth/auth-sessions.ts:28`). A-5's verbatim scope is cookie scope, `auth_sessions` minting preconditions, the demo gate, and embed isolation — grant intersection and revocation semantics belong to the token feature's own AC coverage, not this audit. This bullet also contradicts the plan's own non-goal ("broaden the audit into unrelated route behavior") and threatens the 2-hour box, which the BUILDPLAN explicitly counts against the audit lane's ~15 agent-hours rather than treating as free.
**Recommendation:** Trim the bullet to the boundary A-5 actually owns: bearer-token machine surfaces never read or mint `mq_session` cookie sessions (the same isolation claim made for embed routes). Full grant-intersection/revocation semantics stay with MRQ-30's coverage; if the inventory surfaces a real gap there, file it as a finding for the orchestrator rather than auditing it here.

**[MINOR] Deliverables vs. Non-goals — Internal contradiction on production-code fixes**
Deliverables allow "a trivially safe guard is required and explicitly identified" as a production-code edit, while Non-goals forbid "alter the auth implementation being audited" and the ticket declares "Shared files: none — audit artifact only." An auditor-who-didn't-write-the-code fixing the audited code, even trivially, weakens the independence the audit track exists to provide and creates a shared-file conflict the ticket says it doesn't have.
**Recommendation:** Resolve toward findings-only: every product-code change, however trivial, is reported as a finding with a proposed diff and routed to the orchestrator. New regression tests under `tests/node` are fine (new files, no shared-file conflict) and consistent with how the sibling audit A-3/MRQ-45 shipped (test files only).

**[MINOR] Evidence method, steps 4 — Session lifetime/expiry probes are borderline scope; keep them anchored to issuance**
Issuance-precondition framing covers magic-link single-use and TTL cleanly (the magic-link consumption route mints a session; its precondition is a valid, unexpired, unused token — squarely "assert its precondition"). Rejection-of-expired-sessions probes are session *consumption*, not issuance, and are M-03 feature-test territory. Not wrong to include, but at 2 hours the fat should be trimmed from here first if time pressures.
**Recommendation:** Keep these probes cheap (reuse the existing harness; no new fixtures) and deprioritize them below the four verbatim scope items if the box tightens.

### 4. Positive Observations

- **The demo-mode denial is treated as a full contract, not a status code.** Requiring `403`, `demo_disabled`, **no** `Set-Cookie` header, and a before/after row count on `auth_sessions` is exactly the right shape for Trap 15 — a 403 that still sets a cookie would pass a naive check, and this plan would catch it.
- **The inventory method will actually find the interesting call sites.** `rg` plus direct call-site inspection (not just grepping for the route files) is the right approach here — the repo already contains a raw-SQL `auth_sessions` read outside the auth lib (`src/routes/uploads.routes.ts:228`), precisely the kind of drift this enumeration exists to surface and assert preconditions over.
- **Positive controls for every negative assertion** (step 3) is disciplined audit practice — a denial test that passes because the harness is broken is the classic audit false-negative, and the plan pre-empts it.
- **Honest treatment of the clean-pass case.** "State the exact coverage and observed outputs rather than inferring safety from source inspection" (step 5) and the refusal to ship an empty `tests/ac-claims/MRQ-47.json` without proven `auto`-AC ownership both respect the traceability rules rather than performing them.
- **Handoff is fully specified and verified correct**: real gate command, correct remote (`forgejo`), correct base branch (`master`), terminal state `pr_open`, orchestrator address included. Nothing in the handoff depends on unstated context.

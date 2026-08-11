# MRQ-61: Register auth and admin-ops routes in the API manifest

## Ground truth and decision

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-61-auth-manifest`
- Branch: `mrq-61-auth-manifest`, rebased onto `forgejo/master` at `25b234d2bb0150b427f5dcb704c34bd1f59c883c`
- Ticket: `MRQ-61`; actor: `agent:delegator-mrq-61`
- The two modules are raw Hono sub-apps and therefore cannot be made visible to the generated manifest by renaming alone: the manifest requires a non-empty `apiRoutes` export of `defineApiRoute` entries.
- Decision: bring both modules into the manifest convention. Rename them to `auth.routes.ts` and `admin-ops.routes.ts`, define every existing endpoint as a manifest entry, and remove the direct Hono mounts and duplicate auth middleware from `src/index.ts`. Cookie/session writes, credential resolution, demo-mode fail-closed behavior, and reset local-validation behavior remain in the handlers. No explicit allowlist is needed because the routes will be documented in OpenAPI.

## Implementation

1. Convert the auth sub-app to `apiRoutes` entries for:
   - `POST /api/v1/auth/demo`
   - `POST /api/v1/auth/magic-link`
   - `GET /api/v1/auth/exchange`
   - `POST /api/v1/auth/logout`
   - `GET /api/v1/auth/me`
2. Convert the admin-ops sub-app to `apiRoutes` entries for:
   - `POST /api/v1/admin/reset-demo`
   - `GET /api/v1/admin/reset-demo/{jobId}`
3. Preserve the existing handler semantics, including `AC-2` demo-mode 403/no-cookie behavior and `AC-214` scope/schema behavior. Keep local validation able to invoke reset-demo without a session.
4. Update composition-root imports and queue constant references in `src/index.ts` and `tests/integration/reset-demo.test.ts` for the renamed modules; do not edit the generated manifest or contract documents.
5. Add an `AC-105` test under `tests/` that fetches the served OpenAPI document and asserts all auth/admin method+path operations are present, including the walkthrough's demo-login POST. Add `tests/ac-claims/MRQ-61.json` exercising `AC-105`, `AC-106`, `AC-2`, and `AC-214` without claiming ownership of pre-existing ACs.

## Verification

- Run targeted auth, reset-demo, API manifest/OpenAPI, and reviewer-scope tests.
- Run `npm test` and `npm run check:api`; record that `check:api`'s live served-JSON/rendered-docs parity passes and the demo-login integration path is exercised. The repository currently has no `tests/e2e` spec, so the standalone e2e runner remains its existing MRQ-50 stub until that ticket lands.
- Run `npm run trace:ac -- --ticket MRQ-61` as part of the gate and confirm AC-2 and AC-214 remain green without changing their tests.
- Self-review the exact implementation HEAD and attach a standard-shaped PASS review artifact because headless plan/code review is suspended for this run.
- Run `npm run pr-gate -- --ticket MRQ-61`, commit, push to `forgejo/mrq-61-auth-manifest`, verify remote parity, create the Forgejo PR against `master`, attach its URL, transition to `pr_open`, and notify the Orchestrator at workspace 9 surface 60.

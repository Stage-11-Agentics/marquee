# Plan Review: MRQ-61

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

I reviewed the plan against the current implementation of `_manifest.ts`, `defineApiRoute`/`createApiRouter`, `credential-resolver.ts`, `auth.endpoints.ts`, `admin-ops.endpoints.ts`, `check-api.mjs`, `run-e2e.mjs`, and the relevant tests/AC definitions in `EVALUATION.md`. The core architectural decision (fold both modules into the manifest convention via `defineApiRoute`, following the `uploads.routes.ts` precedent from MRQ-59) is sound and well-justified. However, the plan misses a concrete regression risk in the shared credential-resolution pipeline that can 401 exactly the walkthrough's demo-login step under a realistic reset-demo sequence, and it mislabels the new completeness test's AC coverage in a way that would make `trace:ac` over-report what's actually verified. Both are fixable without changing the overall approach, but need to be addressed before implementation.

### 3. Issues

```
**[CRITICAL] Verification / Risk Identification — credential-resolver 401s a stale-but-present session cookie even on "public" routes, and reset-demo manufactures exactly that condition**
`createCredentialResolver()` (src/lib/auth/credential-resolver.ts) calls `resolveAuth()`
and, if it returns null *but a credential was attempted* (a cookie named `mq_session` is
present, or an `authorization` header is present), throws `ApiError.unauthenticated()` —
before `authorize()` even looks at `policy.auth.kind`. This throw fires in
`routeMiddleware` (src/api/router.ts) unconditionally, for every registered route
regardless of whether its policy is "public". Today `auth.endpoints.ts` and
`admin-ops.endpoints.ts` are raw Hono mounts guarded only by the non-throwing
`authMiddleware` (`if (auth) context.set("auth", auth)`, never rejects), so a stale/invalid
`mq_session` cookie is silently treated as anonymous and every route (demo login, logout,
reset-demo) proceeds normally.

Once these modules are registered through the generated manifest router, that tolerance
disappears. Concretely: `reseedDemo()` (src/lib/reset-demo/reseed-demo.ts) `DELETE`s every
row in `auth_sessions` as part of the reset. A browser that already holds an `mq_session`
cookie from a prior demo login, after a reset-demo run, now presents a cookie whose session
row no longer exists — `resolveAuth` returns null, `hasCredential` returns true, and
`credentialResolver.resolve()` throws 401. That turns `POST /api/v1/auth/demo` (the
walkthrough's literal step 1) into a 401 instead of a fresh demo login, and the same applies
to `/api/v1/auth/logout` and `/api/v1/admin/reset-demo` itself. This is precisely the class
of dead-end the ticket exists to prevent, and it's newly introduced by the fix, not present
today.
**Recommendation:** Before implementing, decide and document how demo/logout/reset-demo
should behave when presented with a stale cookie (e.g., treat these specific routes as
exempt from the "attempted-but-invalid" strictness, or have the client always start these
calls unauthenticated). Add an explicit test: POST `/api/v1/auth/demo` (and `/logout`, and
`/admin/reset-demo` with local-validation) with an `mq_session` cookie pointing at a
non-existent session row, and assert it does NOT 401.
```

```
**[MAJOR] Acceptance Criteria Coverage — the new "AC-105" test actually verifies AC-106, and mislabeling it will misreport trace:ac coverage**
EVALUATION.md defines AC-105 as "route-manifest parity — every non-GET request *captured
during a full-loop session* must exist in the public OpenAPI document; the UI-only write
set must be empty" — i.e., real captured traffic vs. the schema. That capture mechanism is
`tests/e2e` + the Playwright replay, which is explicitly not built yet (`scripts/checks/
run-e2e.mjs` stubs out with `owner: "MRQ-50"` when `tests/e2e` has no specs, and
`check-api.mjs` itself says outright: "notCoveredHere: Full-loop network-recorded traffic
parity ... is MRQ-9."). AC-106, separately, is "Every route appears in the OpenAPI
document" — a static presence check. The plan's step 5 proposes exactly a static presence
check ("fetches the served OpenAPI document and asserts all auth/admin method+path
operations are present") but names it an "AC-105 test" and has `tests/ac-claims/MRQ-61.json`
list AC-105 under `exercises`. `trace:ac` aggregates `exercises` claims from `ac-claims/*`
against a scan of `test(...)` names, so this test would need to literally be titled
`AC-105 · ...` to register — which then makes `npm run trace:ac -- --ticket MRQ-61` (a gate
step in the plan's own Verification section) report AC-105 as covered, when the real gap it
names (UI traffic parity) is still unverified and depends on MRQ-9/MRQ-50.
**Recommendation:** Title the new test `AC-106 · ...` and claim only AC-106 in
`MRQ-61.json`'s `exercises` list (not AC-105). If the plan wants to also gesture at AC-105,
say explicitly in the plan/PR that AC-105 remains unverified pending MRQ-9/MRQ-50's traffic
capture — don't let the ac-claims file imply otherwise.
```

```
**[MAJOR] Completeness — per-route auth policy, rate-limit bucket, and response-schema authoring are undecided for all 7 endpoints**
`defineApiRoute` requires a full `ApiRoutePolicy` (`auth: AuthPolicy`, `rateLimit:
RatePolicy`) and a complete `responses` map (success + every relevant error code, each with
its own Zod schema — see `uploadErrorResponses`/`uploadErrorEnvelopeSchema` in
uploads.routes.ts for the shape of effort this actually takes) per route. The plan's
Implementation section lists only method+path for each of the 7 endpoints and never states:
which `policy.auth.kind` each gets (this matters concretely — `/auth/me` needs
`authenticated`, `/auth/demo` and `/admin/reset-demo` must stay `public` with the handler
self-gating, matching the existing `signTaskUpload`/`handlePublicSign` dual-guardrail
pattern already established in uploads.routes.ts); which `rateLimit.bucket` (`read` /
`write` / `send` / `import`) applies to demo login, magic-link request, reset-demo, etc.;
and what the Zod response/error-envelope schemas are for each handler's existing ad-hoc
`context.json({...}, status)` calls (demo login's 400/403 envelopes, magic-link's always-200
envelope, admin reset-demo's 403/404/202 envelopes, `/me`'s two-shaped response for session
vs. token principals). This is a real chunk of schema-authoring work across 7 endpoints,
not a mechanical rename, and the task's carried-over "~2 hours" estimate doesn't obviously
account for it.
**Recommendation:** Have the plan spell out the auth-policy and rate-limit-bucket decision
per route (a short table would do), and flag the response-schema authoring explicitly as
the bulk of the implementation effort so the estimate/scope is realistic.
```

```
**[MINOR] Feasibility — GET /api/v1/auth/exchange's 302 redirect has no precedent in the manifest and isn't addressed**
Every existing `apiRoutes` entry (uploads, meta, submissions, comms) returns either JSON or
(for `serveMedia`) raw octet-stream content with an explicit `content` schema. `/auth/
exchange` returns `context.redirect(link.redirect_to, 302)` — a bare redirect with a
`Location` header and no body. The plan lists it as one of five auth routes to convert
without noting that its OpenAPI `responses` entry will need a different shape (no `content`,
just `description`, presumably under a 302 key) than anything currently in the codebase.
This is likely fine to express (OpenAPI response `content` is optional), but it's the one
endpoint of the seven that's structurally novel for this router and deserves an explicit
line in the plan rather than being silently folded into "convert to apiRoutes entries."
**Recommendation:** Add a line noting how the redirect response will be declared, and add a
regression test confirming `/api/v1/auth/exchange` still 302-redirects (not just 200s with a
JSON body) once wrapped in the generated router's response pipeline.
```

### 4. Positive Observations

- The core decision — fold both modules into the manifest convention rather than reach for
  the SPEC §4.2 allowlist — is the right call and well-reasoned against SPEC's "every
  operation the product performs is here" (R8) framing; the plan correctly notes the
  allowlist route was available and explains why it wasn't taken.
- Correctly identifies that renaming alone isn't enough — the manifest only picks up modules
  with a non-empty `apiRoutes` export of `defineApiRoute` entries — rather than assuming a
  glob-pattern rename would suffice.
- AC-ownership discipline is exactly right: `tests/ac-claims/MRQ-3.json` already owns AC-2,
  and `MRQ-8.json` already owns AC-105/AC-106, and the plan's own language ("without
  claiming ownership of pre-existing ACs") shows it checked this convention rather than
  guessing.
- Explicitly protects AC-2 (demo-mode fail-closed) and AC-214 (reviewer scope) as
  non-negotiable regressions per the task's guardrail instruction, and the Verification
  section correctly identifies that `tests/integration/reset-demo.test.ts` imports
  `RESET_DEMO_MESSAGE_TYPE` from the module being renamed and needs its import updated —
  this is a real, easy-to-miss dependency that the plan caught.
- Ground-truth section (worktree, branch, rebase SHA, actor) is precise and gives a reviewer
  everything needed to locate the exact base state being built on.

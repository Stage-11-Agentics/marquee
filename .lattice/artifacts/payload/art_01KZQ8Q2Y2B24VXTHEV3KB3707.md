# Code Review: MRQ-60 — API credential resolver

Reviewed at worktree HEAD `de5ab25` (branch `mrq-60-credresolver`, 3 commits on top of merged base `84a84b8`). Diff scope actually touched by this ticket (`git diff 84a84b8 de5ab25 -- src tests`): `src/api/router.ts`, `src/api/runtime.ts`, `src/index.ts`, `src/lib/auth/auth-middleware.ts`, `src/lib/auth/credential-resolver.ts` (new), `src/lib/auth/scope-resolution.ts`, `src/routes/auth.endpoints.ts`, `src/routes/submissions.routes.ts`, plus two test files. The rest of the raw diff in the prompt (seed/pool/evaluations/UI/`.lattice` artifacts) is MRQ-5/MRQ-9 content already merged at the base commit and out of scope for this review.

## 1. Verdict

**PASS**

## 2. Summary

The `CredentialResolver` adapter is wired into the API runtime, `Principal`/`AuthContext` are reconciled onto one canonical shape, and the mandatory re-gate of `GET /api/v1/events/{eventId}/submissions` from `public` to `grants: ["program:read"]` is present in the final diff with its response schema updated (401/403 added) — the exact blocking gap the ticket exists to close. I ran the full test suite (81 vitest + 20 node tests, all passing), `check:api`, `trace:ac`, `tsc --noEmit`, and `pr-gate -- --ticket MRQ-60` (all green), and independently exercised the new integration tests, which correctly assert 401 for anonymous, 403 with no data leak for cross-event credentials, and 200 for correctly-scoped session/bearer credentials, with handler-invocation assertions proving the deny path never reaches the route body. One latent (currently unreachable) correctness gap is worth fixing before it's built on.

## 3. Issues

```
**[MINOR] src/lib/auth/scope-resolution.ts — `authHasRole`'s local `minimumGrantByRole` map — "owner" and "program_lead" collapse to the same grant**
`minimumGrantByRole` maps both `program_lead` and `owner` to `"program:write"`. The grant-vocabulary fallback branch of `authHasRole` (`auth.grants.includes(minimumGrantByRole[required])`) therefore cannot distinguish a program_lead-scoped token from an owner-scoped one: a bearer token holding only `program:write` (granted to program_lead per `LEGACY_ROLE_GRANTS`, not owner-only capabilities like `mirror:write`) would pass `authHasRole(auth, "owner", eventId)`. There is currently exactly one call site (`admin-ops.endpoints.ts:78`, required role `"program_lead"`), so this doesn't manifest today, but it's a silent privilege-escalation landmine for the next caller that gates on `"owner"` via a token credential — easy to miss since the primary (role-name) branch of the same function ranks correctly and only the grant-fallback branch is wrong.
**Fix:** Add a distinct owner-only grant to the mapping (e.g. `owner: "mirror:write"`, since that's the one grant `LEGACY_ROLE_GRANTS` reserves for owner) so the fallback branch preserves the same rank ordering as `ROLE_RANK`.
```

```
**[MINOR] src/api/router.ts — `principalHasGrant` — token event-restriction check is skipped when the route has no `:eventId` param**
For a `kind: "token"` principal, the event-restriction check is gated behind `eventId !== undefined`; if a future grant-scoped route has no `{eventId}` path segment, an event-restricted token's `eventId`/`eventIds` are never consulted and only `grants`/`permissions` are checked. The session-principal branch is the mirror opposite: it *denies* outright when `eventId === undefined` (fail-closed). The asymmetry means tokens fail open on the event-scope dimension exactly where sessions fail closed. No such route exists yet (the only grant-scoped route today, `listEventSubmissions`, has `{eventId}`), so there's no live exploit, but it's inconsistent with the "fail closed when absent" principle the plan calls for elsewhere.
**Fix:** Either deny token-principal grant checks the same way when `eventId === undefined` and the token carries a non-empty restriction, or explicitly document why an event-scoped token is allowed to act with no `:eventId` in the URL (e.g. for genuinely event-agnostic routes) so the next author doesn't have to rediscover the asymmetry.
```

No other issues found. The core security-critical path — credential resolution, event-scoped grant authorization for the previously-public submissions endpoint, and the mandatory MRQ-9 re-gate — is correct and covered by tests that assert both status code and absence of leaked submission data.

## 4. Positive Observations

- The exact hole named in the ticket is closed precisely where it was flagged: `src/routes/submissions.routes.ts` changes only the `policy.auth` from `{ kind: "public" }` (with its own `TODO(MRQ-60)` comment) to `{ kind: "grants", grants: ["program:read"] }`, plus adds 401/403 to the documented responses — a minimal, surgical diff exactly matching scope.
- `credential-resolver.ts` correctly distinguishes "no credential supplied" (→ anonymous, public routes still work) from "credential supplied but invalid/expired/tampered/revoked" (→ 401, never silently downgraded to anonymous) via the `hasCredential` pre-check. This is the subtle behavior the plan called out as required and it's implemented exactly as specified, with a test (`CONTRACT · expired and tampered session cookies are rejected`) proving both an actually-expired session and a fabricated session id are rejected without invoking the handler.
- `AuthContext = Exclude<Principal, { kind: "anonymous" }>` is a clean reconciliation — it eliminates the second union type entirely rather than maintaining two auth vocabularies, and every consumer (`auth.endpoints.ts`, `admin-ops.endpoints.ts`) was updated to the new field names (`sessionId`, `personId`, `tokenId`, `eventId`, `permissions`, `grants`, `eventIds`) with no leftover references to the old `api_token`/`auth.token.*` shape (verified via repo-wide grep).
- Cross-event isolation is real, not just declared: `principalHasGrant`'s session branch resolves role strictly via `roleForEvent(principal.memberships, eventId)` for the specific route's event id, and the integration test `CONTRACT · an event-A reviewer cannot read event-B submissions` proves a reviewer with real membership in event A gets 403 (with `handlerCalls` staying at 0) when reading event B — a genuine negative-authorization test, not just a happy-path check.
- Test assertions consistently check for absence of leaked data (`expectNoSubmissionLeak`) in addition to status codes, matching the plan's explicit instruction to assert "the response body has no submission rows or leaked record data."
- The MRQ-9 handoff was actually completed, not just planned: `tests/integration/api/submissions-list.test.ts` replaces the old "currently public" assertion with `CONTRACT · MRQ-60 guard rejects unauthenticated and cross-event admin reads without submission data`, covering both the unauthenticated and differently-scoped-session cases against the real 1000-row fixture.
- Per the plan's explicit instruction, no `tests/ac-claims/MRQ-60.json` was created, and `trace:ac`/`pr-gate` both run clean with that omission accounted for (the only warning is the expected `missing-current-ticket-manifest` notice, not an error).

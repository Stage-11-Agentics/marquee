# MRQ-60: API credential resolver — wire merged auth into the API runtime

## Plan

### Ground truth and sequencing

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-60-credresolver`, branch `mrq-60-credresolver`.
- Planning base: `forgejo/master @ 00069f6456e960470b5f017f3287c42bcb524f4e`; the worktree is clean and equal to that base after a rebase and fresh `npm ci`.
- `npm ci` completed successfully before trusting tests. The initial base has no `src/routes/submissions.routes.ts` or MRQ-9 test: those are currently untracked in the sibling MRQ-9 worktree. Do not copy or edit that work-in-progress. After MRQ-9 merges, fetch/rebase onto its merge and complete the mandatory route re-gate before treating MRQ-60 as done.
- Headless plan/code reviews are suspended for this run. Planning is self-reviewed inline; the implementation review will be a standard-shape PASS artifact naming the exact final HEAD.

### Auth model and runtime wiring

1. Make the API runtime `Principal` the canonical non-anonymous identity shape because the router, rate limiter, `ApiVariables`, and `CredentialResolver` already consume it. Preserve MRQ-3's security-bearing data in that shape: session id/person/org plus memberships, and token id/org/event restriction plus validated grants/event ids. Migrate `AuthContext` to a type alias/compatibility export over the canonical principal rather than maintaining a second union with different discriminants and nested token rows.
2. Add a focused credential-resolver adapter under `src/lib/auth/` that delegates session and bearer lookup to the MRQ-3 D1 path, maps both valid credentials into the canonical principal, returns anonymous only when no credential was supplied, and throws the API 401 envelope for malformed, expired, revoked, missing, or tampered credentials. Preserve immediate D1 revocation and never log credential material.
3. Make API authorization event-aware. Session admin authority derives from `roleForEvent` for the route's `eventId`; reviewer membership for event A must not authorize event B. Bearer authority must retain token event restrictions and grants. Keep public routes public and make auth-required routes fail closed when the resolver is absent or returns anonymous.
4. Wire the adapter into `src/index.ts` when constructing the API router. Reconcile the API environment/bindings and handler context types so handlers can read the resolved principal without falling back to an unauthenticated/`any` context. Preserve the generated route/OpenAPI registry convention and `*.routes.ts` naming.

### Tests and the MRQ-9 handoff

5. Add an AC-tagged integration test under `tests/` against the real API pipeline/D1 fixtures. Prove session-cookie and bearer resolution, bearer-without-cookie, expired/tampered/revoked rejection, anonymous 401, and cross-event reviewer isolation. For protected submission-shaped reads, assert both status and that the response body has no submission rows or leaked record data; assert a different-event credential gets 403 and the handler is not invoked. This ticket owns no new stable AC ID, so do not create `tests/ac-claims/MRQ-60.json`; state that explicitly in the PR body.
6. When MRQ-9 merges, refresh/rebase and run `npm ci` before trusting red tests. Change `GET /api/v1/events/{eventId}/submissions` from public to authenticated admin authorization, add its 401/403 responses to the schema, and convert MRQ-9's current-public test to assert unauthenticated 401/403 with no submission data plus 403/no data for a credential scoped to another event. Keep the change in MRQ-60's final diff; this re-gate is mandatory and the ticket is not complete without it.

### Verification and delivery

7. Run the focused auth tests, `npm test`, `npm run check:api`, `npm run check:repo`, `npm run trace:ac`, and `npm run pr-gate -- --ticket MRQ-60`. Record observed status/body/side-effect evidence separately from static/type checks. If MRQ-9 has not merged by resolver readiness, open a resolver-only PR at `pr_open` with the re-gate explicitly outstanding; do not claim completion or release safety.
8. Enter review, self-review the exact HEAD, attach a standard-shape PASS review artifact, enter validation, and record why any live validation is N/A or exercise a real local Worker/API flow. Push to `forgejo/mrq-60-credresolver`, verify remote/local HEAD equality, open the PR against `master`, attach the PR reference, bump `pr_open`, and notify workspace:9 surface:60.

## Plan Review Cycle 1 Resolutions (AUTHORITATIVE)

- No headless plan-review was run because the orchestrator's boot instruction suspends headless reviews. The MRQ-9 base mismatch and mandatory post-merge re-gate are explicit in the sequencing and completion gates above.

# MRQ-78: API tokens screen is unreachable for every seeded user — org-scope membership never created

Ticket: MRQ-78  
Actor: `agent:delegator-mrq-78`  
Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-78-api-tokens-org-scope`  
Branch: `mrq-78-api-tokens-org-scope`  
Base: `github/main @ ba22fb3`

## Decision

Take path (a), the recommended seed correction. The demo organizer is the product's organization owner, so add one deterministic org-scoped `owner` membership for that seeded principal and leave `requireTokenAdmin` unchanged. This restores the intended qualified principal without widening event-scoped authority. No migration, route-policy relaxation, token-scope widening, or UI copy change is needed.

The new seed row is additive only. Existing event-scoped owner/program-lead/reviewer rows, submission statuses, counts, and all other seeded volumes remain byte-for-byte unchanged. The legacy auth/API fixture receives the matching org-scoped owner row; the production reset already derives from the shared seed through `shippedDemoFixtureRows`.

## Implementation

1. In `scripts/seed/evaluations.ts`, add exactly one org-scoped owner membership for `STAFF_PERSON_ID` with a deterministic ID. Preserve the existing membership helper and every existing row; do not alter submission generation or status distribution.
2. In `src/lib/reset-demo/demo-fixture.ts`, add the matching org-scoped owner row to `demoFixtureRows`, keeping the fixture's existing event-scoped owner and speaker rows intact. `shippedDemoFixtureRows` will inherit the production seed row automatically.
3. Add a Worker integration test covering all three `/api/v1/org/tokens` routes with the demo organizer, event-scoped reviewer, event-scoped speaker, and anonymous caller. Assert organizer list/issue/revoke success; reviewer and speaker 403; anonymous 401; refusal bodies disclose no token data and refused writes leave token-row counts unchanged. Use a conference-restricted issued token and verify bearer access/revocation as part of the route proof.
4. Add a Node seed guard asserting the generated seeded rows contain at least one principal satisfying the exact org-scoped role predicate used by `requireTokenAdmin`, plus the organizer identity check. Update only the reset test's expected membership count for the intentional single-row addition and assert reset still restores the qualifying organizer row.

## Explicit non-scope

Do not edit migrations, `package.json`, `src/ui/settings/ApiTokensPage.tsx`, `src/routes/submissions.queries.ts`, `src/routes/landing.route.tsx`, `src/api/board.ts`, `src/routes/dashboard.routes.ts`, `src/ui/evaluation/*`, `src/ui/submissions/*`, or any submission/status/volume seed logic. Do not take path (b); there is no event-scoped lead widening and therefore no cross-event narrowing branch to add.

## Verification and evidence

- After every phase boundary, refresh `github/main` and record the exact base SHA. Run `npm ci` after any rebase before trusting tests.
- Focused integration/node tests first; then `npm test`, type checks, `npx vite build`, `node cli/generate-api-registry.mjs`/`npm run check:api`, `npm run check:seed`, and `npm run pr-gate -- --ticket MRQ-78`. Keep generated artifacts out of the commit unless the repository's existing gate requires them.
- Transition to `in_validation` only after a PASS review artifact names the exact branch HEAD. Start `npx wrangler dev --port 8803` in this worktree only, with local seeded D1. Browser approval is scoped to the c11 embedded browser, `http://127.0.0.1:8803` only, organizer demo login, `/settings/api`, issuing one real conference-scoped token, calling a real API endpoint with its bearer secret, revoking it, confirming the bearer call stops, then running `npm run reset:demo` against this worktree's local D1 and confirming the screen remains usable. No external domains or credentials are in scope.
- Attach focused-test, reset, Worker/API, and c11 browser evidence with `--role validation`; send the final summary to workspace 9 surface 245 as requested, and the required one-line lifecycle report to the orchestrator surface from COMMON.md. Stop at `pr_open` after attaching the GitHub PR.

## Delivery sequence

1. Move MRQ-78 to `planned` after this plan is reviewed, commit and push this plan as the first commit from the exact worktree, then move to `in_progress`.
2. Implement the additive seed/fixture change and tests in small meaningful commits, pushing and verifying each against `github/<branch>`.
3. Self-review the exact HEAD adversarially for accidental seed-volume changes, authorization widening, disclosure on refusals, reset divergence, and bearer/revocation behavior; attach a PASS review artifact after entering `review`.
4. Enter `in_validation`, run the real Worker/browser/reset evidence, attach validation, run the local gate, push, create the GitHub PR against `main`, attach its URL, and move to `pr_open`.

## Baseline observed before implementation

- `npm ci`: passed, 114 packages audited, 0 vulnerabilities.
- Worker baseline: 21 files / 126 tests passed in 8.34s.
- Full `npm test`: existing run timed out at 39.091s against the 30s budget after the Worker suite; re-run after the change and distinguish pre-existing budget failure from product/test failures.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Ruling:** path (a) is retained. The route guard remains unchanged, so the event-scoped lead privilege-escalation branch from path (b) is deliberately neither implemented nor tested.
- **Seed safety:** the implementation must preserve every existing deterministic membership row and add only the separate org-scoped owner row; any diff touching submission rows or status counts is a plan violation and must be reverted before review.
- **Predicate guard:** the Node test mirrors the guard's org match, `event_id === null`, and `roleRank(role) >= roleRank("program_lead")` condition against generated seed rows; the Worker matrix then proves the same predicate through all three route handlers.
- **Reset safety:** production reset consumes `shippedDemoFixtureRows`, so no second production seed is authored. The legacy fixture and reset membership baseline are updated only for the intentional owner row, with an explicit qualifying-row assertion.
- **Budget note:** the pre-change full-suite timeout is recorded as baseline evidence. A post-change timeout or new test failure remains a release blocker; do not hide it by changing `package.json` or the hard scope boundary.

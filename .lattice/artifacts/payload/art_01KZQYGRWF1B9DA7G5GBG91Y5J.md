Reviewed exact HEAD b03185fbb6d3aa7cfbd69dc80000ac3b9cb4a284 against forgejo/master 3be1909c41dbc395e7fef6c7845870b312c6fb81.

Verdict: PASS for the implemented M-29 slice.

Security and authorization:
- Production bearer rows use the canonical credential resolver, load issuer memberships constrained by person_id and org_id, and load the organization event boundary. tokenHasGrant requires token grant AND effective membership grant AND event allowance. A reviewer membership carrying program:write is refused; an owner positive control succeeds.
- Token management is session-only and requires an org-wide program_lead or owner membership. Create returns the raw mq_ secret only in the creation response; the database stores only SHA-256 token_hash, and list/revoke summaries omit both secret and hash.
- Resolver selects only revoked_at IS NULL, so revocation is immediate. The AC-242 test verifies the next bearer write is rejected and the event remains unchanged.
- event_ids are checked against the current organization at issue time; resolver plus tokenEventAllowed prevents access to a different conference and the AC-242 body asserts no other-conference data leaks.
- The legacy fixture adapter is explicit for pre-MRQ-30 minimal test tables that lack created_by; deployed migration 0001 rows cannot take that branch.

Surface and regression checks:
- New src/routes/tokens.routes.ts uses the glob-discovered *.routes.ts convention; no generated manifest was hand-edited.
- Same-path GET/POST middleware is method-scoped and has a dedicated test preventing rate-policy bleed.
- Existing comms, evaluation, and forms token fallbacks now all use tokenHasGrant; no second authorization path remains in those route checks.
- UI has real /settings/api token list/create/revoke flows, one-time secret copy, named grants, event restriction, and docs/sidebar links.
- No webhook implementation, provider fetch, or outbox send_policy change is included; exactly two always_live sites remain untouched. AC-241 is deliberately not claimed because CP-2/Tier A is not green.

Evidence already recorded on this exact commit:
- npm run pr-gate -- --ticket MRQ-30: PASS; worker/client/test types, production build, design contract, 28 Vitest files with 163 tests, 43 Node tests, merged AC trace live 212 uncovered 0 errors 0; elapsed 12885 ms under 45000 ms.
- npm run check:api: PASS; served OpenAPI JSON and rendered docs parity, 113 operations, CLI skipped because no cli directory.
- npm run trace:ac -- --scope=merged --ticket=MRQ-30: PASS; live 212 uncovered 0 errors 0.
- Targeted AC-242 Worker test: 4/4 passed.
- git diff --check: PASS.
No findings remain for the M-29 slice. Review does not approve or validate the held M-54 slice.
Validation is against exact HEAD b03185fbb6d3aa7cfbd69dc80000ac3b9cb4a284, remote forgejo/mrq-30-api, base forgejo/master 3be1909c41dbc395e7fef6c7845870b312c6fb81.

Required gate:
npm run pr-gate -- --ticket MRQ-30
PASS
- worker types: PASS
- client types: PASS
- test types: PASS
- production build: PASS
- design contract: PASS
- hermetic fast suite: 28 test files passed, 163 tests passed
- Node tests: 43 passed
- merged AC trace: PASS, live 212, uncovered 0, errors 0
- npm test elapsed 10.13s, budget 30s
Final gate result:
{"command":"pr-gate","ticket":"MRQ-30","status":"pass","elapsedMs":12885,"budgetMs":45000}

Additional measured checks:
- npm run check:api: PASS; OpenAPI JSON and rendered docs parity, 113 operations, CLI skipped because no cli directory.
- npm run trace:ac -- --scope=merged --ticket=MRQ-30: PASS; live 212, uncovered 0, errors 0.
- npm run check:design: PASS.
- npx tsc --noEmit: PASS.
- npx vite build: PASS.
- targeted tests/integration/api/tokens.AC-242.test.ts: 4/4 passed.
- targeted legacy dashboard and submissions-list bearer fixtures: 9/9 passed.
- git diff --check: PASS.
- git fetch forgejo confirmed HEAD equals forgejo/mrq-30-api.

Scope boundary:
- M-29 AC-105 through AC-108 and AC-242 are validated.
- AC-241 and M-54 are not claimed, implemented, or validated because CP-2/Tier A is not green. Planned second pass contract is HMAC-SHA256 over the ASCII bytes delivery_id.timestamp.raw_request_body, with the receiver recomputing over the exact raw body; this is not shipped by this PR.
- No direct api.resend.com fetch or outbox always_live change was introduced.
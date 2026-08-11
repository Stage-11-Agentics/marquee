# MRQ-15 validation

Verdict: PASS
Validated commit: a519f44f84cb47c0c44f5400a7ad9854a9690409

Automated evidence:
- npm run pr-gate -- --ticket MRQ-15: PASS; elapsedMs 15045.
- npx tsc --noEmit: PASS.
- node --test tests/node/public-form.AC-35-155-157.test.mjs: PASS.
- Targeted public-form integration suite: 7 tests PASS.
- npm test: 30 files and 168 tests PASS; hermetic true.
- npm run check:design: PASS, findings [].
- npm run check:api: PASS, OpenAPI 3.1 with 84 operations.
- npm run trace:ac -- --ticket MRQ-15: PASS; live 212, testFiles 41, claims 19, uncovered 0, errors 0.

Observed local runtime evidence:
- Applied D1 migrations and seeded local Miniflare data, then exercised the real Wrangler route.
- Integration POST with a conditionally hidden answer asserted no hidden submission_answers row/value and no required-field issue.
- Missing, failed, and replayed Turnstile paths asserted rejection plus no write; public presign paths asserted rejection plus no attachment write.
- Browser at a real 374px viewport observed SSR builder order, conditional field reveal through the shared applicability path, remedy copy after empty submit, retained entered values, counters, and no horizontal overflow.
- Open, closed, at-limit, resumed, submitted, and re-opened state behavior is covered by integration tests.

Boundary:
- This is local Wrangler/Miniflare proof. Real Cloudflare Turnstile verification and production inbox delivery are not claimed and are named as MRQ-57 checklist items in the PR.

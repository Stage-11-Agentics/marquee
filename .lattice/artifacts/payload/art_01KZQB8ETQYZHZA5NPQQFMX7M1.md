# MRQ-61 validation — final exact HEAD

Validated exact implementation HEAD `0ebedfaed172ee96741f3a40afcc16542b975bd7`.

## Running-system evidence

- Local Wrangler Worker ran over HTTPS at `localhost:8791` using an isolated persisted D1.
- After local migrations and deterministic demo seeding, `GET /api/openapi.json` returned `200`, 22 operations, and all 7 auth/admin paths.
- The real `POST /api/v1/auth/demo` with `{"role":"organizer"}` returned `200` with the seeded organizer response and `Set-Cookie`.
- After local `UPDATE events SET demo_mode = 0`, the same POST returned `403` with `demo_disabled` and no `Set-Cookie`, proving AC-2's guardrail.
- The final rebase was source-equivalent: `git diff --quiet 6aceefe11992bedbca3a458b733c2d1b5244c911 HEAD -- src tests` passed.

## Automated evidence

- `npm run pr-gate -- --ticket MRQ-61`: PASS.
- `npm run check:api`: PASS, OpenAPI 3.1, 22 operations, no findings.
- Targeted auth/reset/scope/manifest tests: PASS, 4 files / 16 tests.
- `npm test`: PASS, 18 files / 96 tests.
- `npm run trace:ac -- --ticket MRQ-61`: PASS, uncovered 0, errors 0.
- `npm run e2e`: existing MRQ-50 stub (`tests/e2e` has not landed); no deployed Playwright loop is claimed.

No external domains, credentials, browser automation, or production state were used.

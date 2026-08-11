# MRQ-61 validation — local Worker proof

Validated exact implementation HEAD `6aceefe11992bedbca3a458b733c2d1b5244c911`.

## Running-system evidence

- Started `npx wrangler dev --local --port 8791 --persist-to <isolated-temp-dir>`.
- Applied local migrations and seeded the deterministic demo fixture into that same isolated D1.
- `GET https://localhost:8791/api/openapi.json` returned `200`; the served document contained 22 operations and all 7 auth/admin paths, including `POST /api/v1/auth/demo`.
- `POST https://localhost:8791/api/v1/auth/demo` with `{"role":"organizer"}` returned `200`, the seeded organizer response, and a `Set-Cookie` header.
- After local `UPDATE events SET demo_mode = 0`, the same demo-login POST returned `403` with `demo_disabled` and no `Set-Cookie` header, proving AC-2's guardrail in the running Worker.

## Automated evidence

- Targeted auth/reset/scope/manifest tests: PASS, 4 files / 16 tests.
- `npm test`: PASS, 18 files / 96 tests.
- `npx tsc --noEmit`: PASS.
- `npm run check:api`: PASS, OpenAPI 3.1, 22 operations, no findings.
- `npm run trace:ac -- --ticket MRQ-61`: PASS, uncovered 0, errors 0.
- `npm run e2e`: existing MRQ-50 stub (`tests/e2e` has not landed); no deployed Playwright loop is claimed.

No external domains, credentials, browser automation, or production state were used.

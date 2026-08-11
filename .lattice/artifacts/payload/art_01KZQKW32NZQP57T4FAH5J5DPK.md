Validation: MRQ-16 running-system evidence
Result: PASS
Environment: local-only wrangler dev with a fresh D1 database at /tmp/mrq16-portal.qAFMTr; no remote or production state touched.

Observed flow:
- GET /api/v1/me/portal without a cookie returned HTTP 401 with the unauthenticated error and no speaker profile, task, or submission payload.
- POST /api/v1/auth/demo with role speaker returned HTTP 200 and created a session for the seeded speaker.
- GET /api/v1/me/portal with that session returned HTTP 200 and included the speaker's own event, profile, accepted submission with Wave 1, and three task payloads (form, acknowledge, file).
- The worker log recorded 401 for the anonymous portal request and 200 for both the demo login and authenticated portal request.

Browser evidence: N/A. The c11-browser automation connector is not exposed in this Codex session; the API surface was exercised against a running local Worker, while the production client bundle and route manifest were covered by pr-gate/check:api.

Checks: npm run pr-gate -- --ticket MRQ-16 PASS; 34 test files / 188 tests passed; trace:ac PASS with 0 uncovered and 0 errors.
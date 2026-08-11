# MRQ-34 validation (final exact HEAD)

Validated commit: 53230e7a0cd24edc19f6b8ee1d5512d79d2f9602
Base: forgejo/master @ 500c5c7d72e8f37933b5db6ed1b5b915b549e1b6
Result: PASS

Running-system evidence:

- Started the built Worker with npx wrangler dev --local --port 8788 --inspector-port 9238.
- curl -sk https://localhost:8788/health returned {"service":"marquee","status":"ok"}.
- curl -sk https://localhost:8788/api/openapi.json returned HTTP 200, OpenAPI 3.1.0, and 93 registered operations including views and draft PATCH routes.
- Worker stopped cleanly after the probes.

Behavior and gates:

- AC-249 integration test observes the hidden-only draft as total 0 and the same draft after revealing the condition as total 1 with the applicable missing label. Reviewer and speaker requests assert 403 and no draft id/title; form-admin and program-staff requests succeed; PATCH preserves Draft status.
- Saved-view integration tests cover create/list/update/delete, personal and event scoping, immutable built-ins, and Title normalization across the complete registry.
- npm run pr-gate -- --ticket MRQ-34 PASS, elapsedMs 24226; 34 Vitest files / 176 tests and 37 Node tests passed, merged AC trace reported 0 uncovered and 0 errors.
- npm run e2e is an honest MRQ-50 stub because this repository has no tests/e2e specs and no deployed MARQUEE_E2E_URL; no browser result is claimed.

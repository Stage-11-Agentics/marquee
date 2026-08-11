Validation mode: running-system plus deterministic gates
HEAD: c2a90e83f874e7344e03a61a8f903d4d6746b0e4
Base: 1937ea4b897dd1e199b1b4b9bab0b7629d35359f
Verdict: PASS

Observed running system: local Wrangler Worker served the rebased production build; GET /health returned 200 with {"service":"marquee","status":"ok"}; GET /api/openapi.json returned 200 with OpenAPI 3.1.0 and 97 operations. Server shut down cleanly after the probe.

Behavioral proof: AC-249 integration test covers the required pair: a draft missing only a hidden conditional field has queue total 0, while revealing that field produces queue total 1 and the missing-field label. The same test asserts unauthorized reviewer/speaker responses are 403 and do not contain draft content; draft GET/PATCH preserves Draft status. AC-247 and AC-248 API tests cover event/person-scoped personal views, immutable built-ins, exact registry, and mandatory Title. AC-134 UI test covers visible condition summary without opening a field.

Gates at this exact HEAD: npm run pr-gate -- --ticket MRQ-34 => {"command":"pr-gate","ticket":"MRQ-34","status":"pass","elapsedMs":27431,"budgetMs":30000}; merged trace reports 212 live, 50 testFiles, 24 claims, 0 uncovered, 0 errors; check:api and check:design pass. e2e is the declared MRQ-50 stub with no specs, not a browser claim.
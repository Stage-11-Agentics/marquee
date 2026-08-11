Validation mode: running-system plus deterministic gates
HEAD: 69cb987f1812bda6d04f5451342236b1462bdcbf
Base: 19f8f1d236d6f31607a85e309ecbf3f4137ae3e3
Verdict: PASS

Observed running system: local Wrangler Worker served the final production build; GET /health returned 200 with {"service":"marquee","status":"ok"}; GET /api/openapi.json returned 200 with OpenAPI 3.1.0 and 105 operations. Server shut down cleanly after the probe.

Behavioral proof: AC-249 integration test covers the pair: a draft missing only a hidden conditional field has queue total 0, while revealing that field produces queue total 1 and the missing-field label. The same test asserts unauthorized reviewer/speaker responses are 403 and do not contain draft content; draft GET/PATCH preserves Draft status. AC-247 and AC-248 API tests cover event/person-scoped personal views, immutable built-ins, exact registry, and mandatory Title. AC-134 UI test covers visible condition summary without opening a field.

Gates at this exact HEAD: npm run pr-gate -- --ticket MRQ-34 => {"command":"pr-gate","ticket":"MRQ-34","status":"pass","elapsedMs":21778,"budgetMs":30000}; npm run check:api => pass with OpenAPI 3.1 and 105 operations; merged trace reports 212 live, 55 testFiles, 26 claims, 0 uncovered, 0 errors; check:design pass. e2e is the declared MRQ-50 stub with no specs, not a browser claim.
Review mode: self-review
HEAD: c2a90e83f874e7344e03a61a8f903d4d6746b0e4
Base: 1937ea4b897dd1e199b1b4b9bab0b7629d35359f
Verdict: PASS

Findings: none.

Scope checked: shared isFieldApplicable consumer for AC-249 with hidden/revealed behavioral pair; no second condition evaluator or required-set derivation; authenticated draft read/edit and status-plus-body non-leak assertions; saved-view filter vocabulary reuse and immutable built-ins; fixed column registry with mandatory Title; builder condition summary affordance; stable table layout and draft non-submit behavior.

Checks reviewed: npm run pr-gate -- --ticket MRQ-34 PASS at this exact HEAD; npm run check:api PASS; npm run trace:ac -- --scope merged --ticket MRQ-34 PASS with zero uncovered; npm run check:design PASS; live Worker health/OpenAPI probes PASS; e2e remains the declared MRQ-50 stub.
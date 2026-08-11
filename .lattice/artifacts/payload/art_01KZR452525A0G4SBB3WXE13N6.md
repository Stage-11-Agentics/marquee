MRQ-50 validation evidence

Reviewed commit: 23fdd29 (branch HEAD; remote head matches).
Verdict: PASS.

Observed runtime proof: npm exec vitest -- run tests/integration/api/reviewer-anonymity.AC-64.test.ts --reporter=verbose passed 1 file and 2 tests. The first test derived all eight Reviewer-tagged apiManifest signatures, drove both scorecard and comparison rounds, both CSV exports, detail/file/context/queue/comparison/evaluation operations, and scanned every body and response header for exact seeded identity bytes. The second scanned unauthenticated, forbidden, unknown-round/name-in-path, malformed, invalid-query, wrong-mode, and out-of-scope responses. No identity hit occurred.

The AST guard also passed at this head. Browser validation is N/A because this ticket changes no UI; the reviewer API was exercised directly through the Worker integration runtime.
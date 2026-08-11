# MRQ-17 running-system validation (exact head)

Validated commit: 8980501b5864c407a6b2942920deddf972ede922
Base: forgejo/master 7fb875fbd2e0629706f8bb4683e8e45e2a7feaff

Verdict: PASS

Validation mode: headless Cloudflare Workers integration runtime with an
isolated D1 fixture. Browser/computer-use validation was not run because no
browser approval was granted; this artifact is API/runtime evidence.

Observed proof:

- `npx vitest run tests/integration/api/evaluation.test.ts --reporter=verbose`
  passed 9/9 against the running Workers test runtime. The observed flow
  created a plan, rejected a non-100% scorecard, configured two ordered rounds,
  created a committee, exercised both assignment modes, read progress, and
  confirmed the first-load queue was populated.
- The same runtime confirmed carried-track intersection filtering and generic
  403 responses with no leaked title or submission metadata for guessed
  out-of-scope submission detail, file, export, and evaluation-write paths.
- `npm run check:api` passed on this head: OpenAPI 3.1, 40 operations, no
  findings. The route registry includes queue, detail, file, export, and
  evaluation-write endpoints.
- The mandatory `npm run pr-gate -- --ticket MRQ-17` passed on this head in
  17.922s, including the production worker/client build and 108 hermetic
  tests.

Validation boundary: seed-generator evidence for MRQ-5's 40 organizer-
unreviewed assignments and track scopes passed in the same PR gate; the
focused runtime fixture independently proves the queue behavior and
authorization boundary.

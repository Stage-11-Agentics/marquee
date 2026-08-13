# MRQ-161 plan

1. Edit only the JSDoc immediately above the OpenAPI concurrency contract test in `tests/integration/api/meta.test.ts`. Describe the present guard: `info.description`'s concurrency claim is held to the routes in `apiManifest`.
2. Inspect the surrounding comments for the same false historical narrative. Do not change assertions, test behavior, or any unrelated ticket-numbered filenames.
3. Run the pre-edit and post-edit test suites and compare failure lists. Run `npm run pr-gate`, report the known fixture-session failures if they remain, and verify the final diff is comment-only. No new tests are expected; the existing contract test remains unchanged, so pre-fix-test failure evidence is not applicable.

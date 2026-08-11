# MRQ-59: Port uploads routes onto the generated route manifest

## Plan

1. Inspect the MRQ-14 upload handlers, manifest registration contract, OpenAPI
   schema conventions, and existing guardrail tests; establish a passing
   baseline for the targeted unit/integration checks.
2. Rename the upload route module to `src/routes/uploads.routes.ts` and adapt
   its four upload POST handlers plus media serving route to
   `defineApiRoute` entries exported as `apiRoutes`, preserving AC-231 and
   AC-232 behavior and using explicit OpenAPI schemas for every served path.
   Remove the direct mount from `src/index.ts` so the generated manifest is the
   sole registration path.
3. Add focused parity assertions for upload operations in the served OpenAPI
   document/manifest and retain the existing guardrail coverage unchanged;
   run the targeted suite, `check:api`, and the required PR gate.
4. Self-review the exact diff, record validation evidence, commit, push, create
   a Forgejo PR against `master`, attach its URL, and transition MRQ-59 to
   `pr_open`.

## Scope and non-goals

- Scope is route discovery, registration, and public schema parity for the
  existing MRQ-14 upload endpoints.
- Do not weaken or rewrite AC-231/AC-232 guardrail tests, edit contract docs,
  or add an implicit schema exclusion. No upload path is expected to use the
  SPEC §4.2 allowlist.
- Fast-track inline mode: headless plan/code reviews are suspended; perform a
  documented self-review and attach validation evidence.

## Verification

- Existing upload route guardrail tests remain unchanged and pass.
- Served `/api/openapi.json` contains all upload operations and the media
  operation, with manifest/schema parity passing `npm run check:api`.
- Required final command: `npm run pr-gate -- --ticket MRQ-59`.

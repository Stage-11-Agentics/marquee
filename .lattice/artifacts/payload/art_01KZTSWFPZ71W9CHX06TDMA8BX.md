# MRQ-110 validation

Validated commit: `28094db50515ba47a28068cf5f65624de38fcd1a` on
`mrq-110-pools-recusal`, with parent `github/mrq-108-review-depth`
`fd7e46a2a7b32cc6a1d4f270dfccfb3d0c54dbcb` as an ancestor.

Automated validation:

- `npm run pr-gate -- --ticket MRQ-110`: PASS, 134/134 tests, hermetic suite
  19,807 ms, total 23,327 ms, under the 120,000 ms gate budget.
- `npm run check:api`: PASS, 136 operations, document SHA
  `9f894ebda7eea64e901daef438f5e309daa62059c7c0fd33c3f556a5cf580aa7`.
- `npm run trace:ac -- --scope=merged --ticket=MRQ-110`: PASS, zero warnings,
  errors, or uncovered claims.
- `node scripts/schema-verify.mjs`: PASS — 48 tables, 121 named indexes, 92
  foreign keys, 3 triggers.
- `npm run check:seed`: PASS in 27,353 ms, under its 30,000 ms budget; the
  deterministic local Wrangler seed and reviewer queue checks passed.
- Targeted API/UI tests: 27/27 passed. Worker and client TypeScript checks
  passed.

Live local validation:

- Started `npx vite dev --host 127.0.0.1` in the ticket worktree, then stopped
  it with exit 130 after validation; no dev server remains running.
- `GET http://127.0.0.1:5173/health` returned 200 with build
  `28094db50515`.
- `GET /api/openapi.json` returned 200 and the served document contained 136
  operations.
- `GET /evaluation` returned 200.
- `GET /api/v1/events/evt_aie-ny-2026/plans` without credentials returned the
  expected 401 unauthenticated response.
- The c11 browser socket timed out twice while opening the local page, so UI
  browser interaction was not run and no browser surface was left open. This
  is an infrastructure limitation, not a product result.

The branch was fetched after push and matched `github/mrq-110-pools-recusal`
exactly at this head; the worktree was clean.

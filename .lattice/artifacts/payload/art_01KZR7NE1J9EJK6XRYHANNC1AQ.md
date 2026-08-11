# MRQ-53 validation evidence

Validated commit: `1e238804c961ea4d5e856a434d9bbf87dcae0304`

Boundary: local Wrangler/miniflare Worker seeded by `scripts/seed/index.ts`; no deployed or production claim.

Runtime evidence:

- Full seeded baseline counted every migration-defined table: 1,000 submissions, 25 agenda items, 324 speaker tasks, 60 evaluations, 159 memberships, 1,101 people, and all other table counts recorded in the review artifact.
- Dirty drive exercised accept/reject decisions, speaker task completion, agenda placement/publication, reminder/outbox, saved view, import, API-token row coverage, round promotion, valid attachment upload, auth sessions, and foreign non-demo organization/event.
- `npm run reset:demo` completed twice (1.078s, 1.056s) but both runs produced the same wrong minimal vector: all reset-owned tables zero except `memberships=2`, `people=2`, `events=1`, `organizations=1`; login succeeded only into `evt_demo`. The old organizer cookie returned 401.
- Browser probe found one rendered Reset demo button, zero `reset-demo` requests, and the unavailable-module modal.
- The completed attachment's R2 key remained present after both resets while its D1 attachment row was gone. `outbox=0` and `mirror_outbox=0` after reset. No standalone webhook table exists in the current schema.
- Poller observations were old state (`agenda.sessions=4`, dashboard task preview 4) until the reset completed, followed by `agenda.sessions=0` and old dashboard HTTP 401. No partial D1 count vector was observed; the complete new state was the wrong fixture.

Verification commands:

```text
npm test
=> PASS; 33 files, 186 tests; pr-gate reported elapsedMs 18833 and budgetMs 30000.

npm run trace:ac -- --ticket MRQ-53
=> {"command":"trace:ac","status":"pass","scope":"merged","ticket":"MRQ-53","counts":{"live":212,"testFiles":77,"claims":41,"uncovered":0,"errors":0}}

npm run pr-gate -- --ticket MRQ-53
=> {"command":"pr-gate","ticket":"MRQ-53","status":"pass","elapsedMs":24679,"budgetMs":45000}
```

The audit diff contains no product fix; only the plan, the table-coverage invariant guard, and the explicit no-auto-AC claim manifest.

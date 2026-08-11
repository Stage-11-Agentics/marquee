# MRQ-20 inline self-review (final rebased head)

Reviewed commit: 340fd5273306e66d4d7567d516b5d651e31f5cea
Base: forgejo/master @ 750ee7260ad02f021a23a59874ce3fc64de74737
Verdict: PASS
Review mode: inline self-review; headless code review is suspended by the ticket directive.

Findings: none.

Scope checked:

- `src/routes/agenda.routes.ts` and `src/routes/agenda.queries.ts` are manifest-discovered `*.routes.ts`/query modules using `defineApiRoute`, with event-scoped auth, status-derived pool reads, immediate placement/removal, format duration bounds, and strong ETag CAS for item edits.
- Agenda projection carries source title, speakers, format, all submission tracks, `Room · Building` labels, AV capabilities, and private room notes. MRQ-62 remains the owner of venue/building data and geography; no seed or venue-authoring files changed.
- `src/ui/agenda/*` mounts the five signed views only (List, Day, Week, Track, Room), preserves filters and per-view scroll, supports agenda-only pool/slot drag, immediate persistence with no Save control, resize, room metadata panel, and visible non-blocking conflicts.
- Existing shell, Venues/Settings routes, binding navigation labels, migrations, seed files, and guardrail tests remain intact. AC-252/253 are exercised here for agenda-side rendering while MRQ-62 remains their claim owner in the merged AC manifest.
- No Month view, public AV/notes projection, contract-document edits, secrets, or unrelated data-seeding changes were introduced.

Checks on this exact source tree:

- `git diff --check forgejo/master...HEAD` passed.
- `npm test` passed: 24 Vitest files / 129 tests and 28 node contract tests; 12.657s, under the 30s budget.
- Worker, client, and test TypeScript checks passed.
- Production Worker/client build passed.
- `npm run check:design` passed.
- `npm run check:api` passed: OpenAPI 3.1, 47 operations, no findings; CLI parity remains the existing M-38 skip because `cli/` is absent.
- `npm run trace:ac -- --scope=merged --ticket=MRQ-20` passed: 0 uncovered, 0 errors.

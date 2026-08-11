# MRQ-20 inline self-review (final rebased head)

Reviewed commit: 2718520758136c3d64f0d209ce6de8f5e6012ad0
Base: forgejo/master @ f83de445392700f8721bcdbccb3b30c345856e00
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
- `npm run pr-gate -- --ticket MRQ-20` passed in 17.180s: worker/client/test types, production Worker/client build, design contract, hermetic suite, and merged AC trace.
- The gate's hermetic suite passed: 25 Vitest files / 132 tests and 29 node contract tests, under the 30s budget.
- The gate's merged AC trace passed: 212 live criteria, 0 uncovered, 0 errors.
- The earlier `npm run check:api` passed: OpenAPI 3.1, 47 operations, no findings; CLI parity remains the existing M-38 skip because `cli/` is absent.

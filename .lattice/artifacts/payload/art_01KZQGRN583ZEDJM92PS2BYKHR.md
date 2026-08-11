# MRQ-20 inline self-review (final rebased head)

Reviewed commit: 735c308b34ed67c0884be048c923d4d8c1c7abcc
Base: forgejo/master @ a05a015da45d3c9379b99ef1e48d5b291e127c32
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
- `npm run check:api` passed: OpenAPI 3.1, 59 operations, document SHA-256 `f903fa3acf9e2d87ac95c47b26878216b518263ea4753d17ab0e67b1843f0fc4`, no findings; CLI parity remains the existing M-38 skip because `cli/` is absent.
- `npm run pr-gate -- --ticket MRQ-20` passed in 19.959s: worker/client/test types, production Worker/client build, design contract, hermetic suite, and merged AC trace.
- The gate's hermetic suite passed: 28 Vitest files / 156 tests and 32 node contract tests, under the 30s budget.
- The gate's merged AC trace passed: 212 live criteria, 0 uncovered, 0 errors.

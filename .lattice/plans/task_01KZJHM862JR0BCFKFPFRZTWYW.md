# MRQ-9: First loop screen: submissions list

BUILDPLAN: M-08 — Wave 0 (§3), the last ticket before CP-1

Scope (verbatim): Server-side filtered/sorted/paginated list at 50/page over the seed, type/status/track filters including Draft, selection state, exact record navigation, empty state, and the stable column registry that M-55 configures. Proves the whole stack end to end on real data.

Amendment 5 fold (AC-240): slot chips (day · time · room) and the "Not yet public" marker land in the submissions list here.
Vocabulary note (SPEC): **`waitlisted` displays as "Maybe"** on chips and filters.

File surface: `src/routes/submissions.routes.ts`, `submissions.queries.ts`, `src/ui/submissions/*`

ACs: AC-23, part AC-66, foundation **AC-240, AC-247–249**
Hours: 4
Workflow: inline-full
Shared files: none — module-local. The **column registry** it defines is consumed by M-55; keep it a named module (`src/lib/`-style specific name), never a `utils.ts`.
Deps: M-04a, M-05a+M-06, M-07
CP-1 (human-visible checkpoint) closes when this lands: deployed URL, populated, both demo logins land on a real screen, `npm test` green in <30 s, `check:repo` clean; traps 2, 4, 15 closed; felt checkpoint C1 runs.
Plan: filled in by delegator's plan phase

## Plan

### Contract and boundaries

- Implement M-08 only: the event-scoped submissions read endpoint, its D1 query module, the Preact list screen, selection state, exact record links, and a named fixed column registry.
- Reuse MRQ-8's sole list contract unchanged: `page`, `per_page`, `q`, `sort`, endpoint-owned flat filters in; `{data, page, per_page, total, total_pages}` out. Keep `per_page=50` in the UI and use `executeListPage`; do not register a route outside the generated `*.routes.ts` manifest.
- Cover AC-23 directly and the list-side foundation of AC-66 and AC-240. Define the full AC-248 registry now, but leave saved-view CRUD, configurable-column persistence, and the role-gated derived Draft queue to M-55. Leave bulk mutations to M-18 and record content/actions to M-32.
- Preserve wire vocabulary (`/api/v1/events/...`, `kind=abstract|session`, stored snake-case statuses) while all organizer-facing copy says "conference" and `waitlisted` renders as "Maybe".

### Data and API

1. Add `submissions.queries.ts` with one parameterized filter builder shared by count and page statements. Scope every read to `event_id`; support `q`, `kind`, `status`, and any-carried-track filtering; whitelist stable sorts; append the existing ULID tie-break; and query speaker, format, all track chips, score, timestamps/origin, and an optional agenda slot without N+1 reads.
2. Treat `scheduled` and `published` as derived list filters from agenda placement plus `is_published`; keep every stored lifecycle status available, including `draft` and `waitlisted`. A scheduled row exposes day/time/room and `is_published` so the list can show the AC-240 slot chip and "Not yet public" marker. Missing score/slot values serialize as null and render as the non-jumping em dash.
3. Add `src/routes/submissions.routes.ts` using `defineApiRoute`, zod schemas, the shared list schema/response schema, standard error envelopes, and the glob-discovered `apiRoutes` export. Keep the route at `GET /api/v1/events/{eventId}/submissions` so `check:api` registry/OpenAPI parity covers it.
4. Add `src/lib/submission-columns.ts` as the stable named registry consumed later by M-55. Register exactly: Type, ID, Title, Speakers, Status, Tracks, Score, Submitted, Last updated, Origin, Missing fields; mark Title mandatory and expose a conservative prototype-matching default order.

### UI and interaction

5. Add `src/ui/submissions/*` with a fetch hook/state machine and the Flight Deck list. Route `/submissions` in `AppShell` to this screen; derive its API query from the browser URL and keep filter/sort/page changes in history so sidebar stage links and reloads reproduce the exact slice.
6. Reproduce the binding prototype: "Abstracts & sessions" header, Export plus one primary "+ Add session" action, search, status/type/track filters, sort, 50-row table, explicit text type/status chips, truncating titles with full title affordance, monospaced tabular counts, multi-track chips, pagination, row checkboxes, and exact `/submissions/:id` links.
7. Implement page selection and "Select all N matching" as explicit selector state. Changing query/filter/sort/page clears selection. The bar states whether selected IDs or the entire matching set is selected, without pretending M-18's mutations exist.
8. Give loading, error/retry, no-records, and no-matches states honest copy and a reserved table body footprint so controls and pagination do not jump. Use em dashes for absent values and fixed-width numeric/status regions. Keep responsive behavior usable without redesigning the signed desktop-first prototype.

### Tests, review, and proof

9. Add an AC-tagged test under `tests/` named with `AC-23` that exercises the running route against D1 fixtures containing both Abstract and Session rows and asserts textual type markers in the rendered list. Add focused tests for the common envelope at 50/page, deterministic sort, composed status/kind/track/search filters, empty/out-of-range pages, `waitlisted` -> "Maybe", selection-all-matching semantics, slot/publication metadata, and the fixed column registry.
10. Add `tests/ac-claims/MRQ-9.json` with the exact owned AC claim so `trace:ac` remains authoritative and does not claim downstream AC-66/240/247-249 completion prematurely.
11. Measure the list read/render path against a deterministic 1,000-row ugly-data fixture (long diacritic names and truncating titles) and record observed timings as evidence against the signed speed objective; no AC-sourced budget is invented.
12. Run `npm test`, `npm run check:api`, `npm run check:repo`, `npm run trace:ac`, and the ticket gate. Enter `review`, self-review the exact HEAD (headless reviewers are suspended), attach a standard-shape PASS review naming that commit, then enter `in_validation`.
13. Seed an isolated local D1, run the app through `wrangler dev` on an ephemeral port, drive the real list in c11's embedded browser (filters, pagination, selection, empty/reset, exact record URL) and curl the list endpoint. Attach command output, browser observations, and measured response timing as `--role validation` evidence.
14. Commit only MRQ-9 paths after the worktree guard, push `mrq-9-submissions` to `forgejo`, verify local/remote HEAD equality, open a Forgejo PR against `master` citing MRQ-9, M-08, AC-23 and the named foundations, attach its URL, transition to `pr_open`, and notify workspace:9 surface:60.

### Baseline

- Initial `npm test` could not start because the fresh worktree lacked `node_modules`; after lockfile-pinned `npm ci`, the unchanged baseline passed: 8 Vitest files / 37 tests and 12 node contract tests, 8.599 s total, under the 30 s inner-loop ceiling.
- Planning base: `forgejo/master @ 5b9199f82be79316cbfafce54e00e38d078475f1`.

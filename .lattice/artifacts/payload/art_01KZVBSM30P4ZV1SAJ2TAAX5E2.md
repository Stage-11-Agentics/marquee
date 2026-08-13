# Code Review: MRQ-131 — People (org-level speaker record, Lists, sourcing pipeline)

Reviewed at `mrq-131-people` @ `e3e73bd` (3 commits off `github/main` @ `cd907d3`),
35 files, +6,725/−47. Read every new source file in the worktree rather than the
truncated diff (2,155 lines were omitted from the prompt's copy).

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and mostly well executed — one list query with two entrances,
one append-only annotations table, server-side everything, and a genuinely
agent-native surface. But **Live lists, the headline of build block 4, do not
work through the screen that opens them**, and two other capabilities the UI and
SKILL.md state plainly are not implemented. These are small, local fixes; the
architecture does not need revisiting.

## 2. Summary

I reviewed the migration, the query builder, all four route modules, the roster
refactor, the five People screens, the CLI/skill surface, and both test files,
then ran the suite and the PR gate. The engineering quality is high: bindings are
never interpolated, the org boundary is enforced in one place and tested from
another organization's row, the roster really is the same query rather than a
second one, and the "nothing is saved in the browser" discipline the ticket
demanded is honoured throughout.

The key finding: `list_id` is resolved **only** through `person_list_members`,
which a Live list never has rows in. Verified against the running Worker — a Live
list reports `member_count: 1` on the Lists page, and opening it (`/people?list=…`
→ `GET /api/v1/org/people?list_id=…`) returns **zero rows**; emailing it returns
**404 "that selection resolves to nobody"**. Separately, a card's score and
rationale can be written by API/CLI but there is no UI that can set them and no
surface that displays the rationale, while the Sourcing pipeline page's own copy
says cards carry both.

### Verification performed

- `npm test` → **739 passed, 1 failed, 41.9 s** (budget 45 s). The single failure
  is `tests/integration/auth-demo.test.ts` "demo session cookie …" expecting
  `Secure`, and it is **environmental, not this branch**: the worktree has an
  untracked, gitignored `.dev.vars` containing `INSECURE_LOCAL_COOKIES=1`
  (`src/lib/cookies.ts:34`). Moving that file aside makes the file pass 21/21; the
  same test passes on the base commit. Nothing in the diff touches auth or cookies.
- `npm run pr-gate -- --ticket MRQ-131` → worker/client/test types, production
  build, shell truth, **design contract, API contract, route map** all pass; the
  gate stops only at the fast suite for the reason above.
- A throwaway Worker-backed probe (written, run, deleted) confirmed findings 1
  and 2 against real HTTP responses.

## 3. Issues

**[MAJOR] src/routes/people.queries.ts:192 — a Live list resolves to nobody, so opening one from Lists shows an empty People page**

`filterClauses` implements `listId` as
`person.id IN (SELECT person_id FROM person_list_members WHERE list_id = ?)`
regardless of the list's kind. `createList` only writes member rows when
`kind === "fixed"` (`person-lists.routes.ts:188`), so a Live list has none. The
Lists page reports the correct count (it calls `liveCount`, which re-runs the
saved filter) and then navigates to `/people?list=<id>`, which routes to the
member-table filter — so the organizer reads "Keynote shortlist · live · 1 people",
clicks **Open**, and lands on "Nobody matches these filters". `GET /api/v1/org/lists/{listId}`
resolves live membership correctly, which is exactly why the integration test
(`people.MRQ-131.test.ts:244`) does not catch this: it reopens the live list
through the endpoint that works, never through the one the UI uses.

Measured against the running Worker: `member_count: 1`, `?list_id=` → `[]`,
`GET /lists/{id}` → `["Priya Raman"]`.

**Fix:** resolve the list before filtering — read `kind`/`config_json` for the id,
and for `kind='live'` apply `configFilters(config)` instead of the members clause.
A shared `resolveListFilters(db, orgId, listId)` in `person-lists.routes.ts`,
called by the `listPeople` handler (and by `audienceFor`, below), keeps one
definition of "who is in this list". Add a test that asserts `?list_id=<live>`
returns the same people as `GET /lists/{id}`.

**[MAJOR] src/routes/org-comms.routes.ts:66 — emailing a Live list 404s, though the UI, the CLI help and SKILL.md all say every List is an email audience**

`audienceFor` joins `person_list_members` for `list_id`, so a Live list resolves
to an empty audience and `sendOrgMail` throws `not_found` ("that selection
resolves to nobody in this organization"). Verified: `POST /api/v1/org/comms/send
{list_id:<live>}` → **404**. Meanwhile `SKILL.md:281` states "Both are reusable
as an email audience", `ListsPage.tsx:73` prints "A list is reusable as an email
audience and as a pipeline source" in the table foot, and `PeopleModals.tsx:319`
repeats it in the save dialog. `marquee people email --filter list_id=…` hits the
same wall. Same root cause as the finding above.

**Fix:** route `list_id` through the shared resolver; for a live list, run
`buildPeopleQuery({orgId, ...configFilters(config)})` and take its rows as the
audience. Cover it in the integration file next to the existing bulk-send test.

**[MAJOR] src/ui/people/SourcingPipelinePage.tsx:61 — the page states cards carry a score and a rationale; no UI can set either, and the rationale is never rendered**

The API models score and rationale carefully — `currentCard` deliberately carries
the last stated value forward (`person-annotations.ts:151`), and both are returned
on the card and in the history. But `setStage` is only ever called as
`setStage(personId, { stage })` (`PersonDrawer.tsx:201`, `SourcingPipelinePage.tsx:46`);
the plan's `EnrollModal` — the prototype's "Enroll in pipeline" dialog with Score
and Rationale fields (`prototypes/crm/index.html:1048`) — was not built, and
`rationale` appears nowhere in `src/ui/people/` except as a type and a request
field. The prototype's card drawer has a dedicated `<h3>Rationale`; the drawer
that ships shows stage name and score only. So every card reads "No score", and
the page's own copy promises something the screen cannot do — the kind of claim
PHILOSOPHY forbids, and a one-to-one prototype miss on build block 8.

**Fix:** add the enroll/move dialog from the prototype (stage · score · rationale)
behind the "Move to" control, and render `record.card.rationale` in the drawer's
Sourcing section. If it is being deferred instead, cut the promise from the page
copy and say so in the PR body.

**[MINOR] src/ui/people/people-api.ts:144 — the list filter chip shows a raw ULID**

`activeCriteria` pushes `{ label: "list", value: filters.listId }`, so the status
row reads `list: 01KZT…` — an id where the organizer expects the list's name
(PHILOSOPHY §6, the organizer's language).

**Fix:** carry the list name in the URL or look it up on mount and render that;
fall back to "list" with no value rather than the id.

**[MINOR] src/ui/people/PersonDrawer.tsx:204 — the "Not in the pipeline" option silently does nothing and then lies about the state**

The stage `<select>` includes `<option value="">Not in the pipeline</option>`.
Choosing it for an enrolled person hits `if (stage) …` and no-ops — no state
changes, so nothing re-renders, and the control keeps displaying "Not in the
pipeline" for a person the server still has in `contacted`. A control that
answers a click by quietly showing the wrong thing is worse than one that is
disabled.

**Fix:** render the placeholder option only when `record.card` is null (or
`disabled`), so the option is unreachable once enrolled.

**[MINOR] src/routes/org-imports.routes.ts:79 — the import runs two sequential D1 round trips per row inside one request**

The loop awaits a `SELECT` and then an `UPDATE`/`INSERT` for every row before
starting the next. The payload cap is 2 MB — roughly 20 k rows — which would be
~40 k serialized D1 calls in a single invocation, well past what a Worker
request will survive. Fine at eval and demo scale; a cliff at real speaker-export
scale, and R7 treats slow as a defect.

**Fix:** one `SELECT id, email FROM people WHERE org_id = ? AND email IN (SELECT
value FROM json_each(?))` up front to build the existing-email map, then
`db.batch()` the writes and the receipts together.

**[MINOR] src/routes/person-lists.routes.ts:238 — opening a Live list returns every match with no page window**

`openList` builds the query without `page`, so no `LIMIT` is emitted; a live list
whose config is `{}` (the schema permits it — `q` defaults to `""`) matches the
whole organization and serializes ~1,100 rows into one response. Related:
`listLists` fires one extra count query per live list (`Promise.all` over the
rows), which is bounded but grows with the list count.

**Fix:** page the member resolve like every other list, or cap it and say what
was capped.

**[MINOR] src/routes/org-imports.routes.ts:81 — `lower(email)` defeats the index and diverges from the other write path**

Emails are stored already normalized (`normalizeEmail` on both create paths), so
`WHERE org_id = ? AND lower(email) = ?` does a scan where `email = ?` — what
`createPerson` uses at `people.routes.ts:255` — would use the index.

**Fix:** compare `email = ?` and keep normalization at the write boundary.

**[MINOR] src/routes/people.routes.ts:324 — the activity summary parses `value_json` inline, twice, bypassing the tolerant reader**

Every other consumer goes through `value()` in `person-annotations.ts:64`, which
degrades a bad payload to `{}` rather than throwing. Here a tag row is
`JSON.parse`d twice per entry in a `.map`. The `json_valid` CHECK makes a throw
unlikely, but the inconsistency is the kind that outlives the constraint that
protects it.

**Fix:** parse once through `value(row)` and read `op`/`tag`/`stage` off it.

**[MINOR] src/routes/people.queries.ts:227 — the roster now pays four correlated subqueries per row, unpaged**

`listSpeakers` takes its rows from `buildPeopleQuery` with no `page`, so
`CONFERENCE_COUNT`, `LAST_CONTACT`, `CURRENT_TAGS` (a doubly-nested correlated
subquery) and `CURRENT_STAGE` are evaluated for every roster row on a hot screen
that previously ran a flat projection. It is cheap today because `person_events`
is empty, and it grows with annotation volume rather than with roster size.
Sharing the builder is right; paying for columns the roster does not display is
not.

**Fix:** make the folded columns opt-in (e.g. `annotations: false`) so the roster
selects only what it renders.

**[MINOR] src/routes/people.routes.ts:474 — a tag containing `/` cannot be removed**

`DELETE …/tags/{tag}` puts the tag in the path; the client encodes it, but a
percent-encoded slash is not reliably routable. The tag input accepts any
characters up to 60.

**Fix:** either restrict the tag charset on write, or take the tag in the body /
query rather than the path.

### Notes, not defects

- The demo seed ships **no** `person_events` and no lists (`reset-demo.test.ts:72`
  documents this deliberately), so after a reset the Sourcing pipeline is empty,
  the tag facet is empty, and the KPI "In pipeline" reads 0. Correct as data
  hygiene; worth deciding whether the demo surface should show these areas alive.
- Column sorting exists in the API (`PEOPLE_SORTS`) but no table header exposes
  it — the ticket's "sort" is served for agents, not for the organizer. Fine if
  intended.
- `tests/unit/people.MRQ-131.test.ts` asserts a lot by regex over source text —
  route-table spellings, sidebar ordering, a CSS `min-width` literal. They guard
  real rulings, but they check spelling rather than behaviour and will break on
  innocent edits (`expect(css).toMatch(/\.people-save-control \{ min-width: \d+px; \}/)`
  fails if the declaration is reformatted). The behavioural halves of that file —
  the folds, the CSV plan, the query shape — are excellent and are where the
  value is.
- The plan's dependency ruling (block 9 out, MRQ-129 not started) is respected,
  and no stub event picker was smuggled in. Good discipline.

## 4. Positive Observations

- **One list query, honestly one.** `SPEAKER_ROSTER_PERSON_SOURCE` moving to
  `lib/roster-source.ts` and `listSpeakers` genuinely reading through
  `buildPeopleQuery` — with the roster's membership columns passed as a
  projection extension rather than a fork — is the ticket's hardest ask and it
  landed. The existing roster tests pass unchanged, which is the regression
  guard the plan promised.
- **The append-only log pays for itself exactly as designed.** Notes, tags,
  stage, stage history and the activity feed all fall out of one table; the
  same-millisecond tie-break by id is handled identically in SQL
  (`ORDER BY created_at DESC, id DESC`) and in TypeScript (`foldTags`), and is
  tested from both directions. `currentCard`'s carry-forward of score and
  rationale is a genuinely thoughtful reading of what a stage move means.
- **The org boundary is one function, and it is tested from the outside.**
  `requireOrgAccess` centralises the rule; `audienceFor` and the fixed-list
  member write both filter ids through `org_id` so a foreign id resolves to
  nobody rather than to a stranger's inbox — and the integration test proves the
  outsider is unreadable, unaddressable, and unsmuggleable into a list.
- **Server-side means server-side.** Search, filters, facets, sort and paging are
  all SQL, the count and the page share one WHERE builder so totals cannot
  disagree with rows, the facet panel is built from the org rather than the
  current page, and the sort registry rejects an unknown key instead of
  interpolating it (tested with a `DROP TABLE` payload).
- **The run-1 "Draft saved locally" defect is answered squarely.** Every write
  re-reads from the server, and the integration tests assert persistence through
  a fresh request rather than through the response body.
- **`orgAttributionEventId`** turns the NOT NULL `event_id` shortcut into one
  documented call site with the migration path written down — the right way to
  take a shortcut.
- The agent surface is complete and consistent: routes declared through
  `defineApiRoute` (API-contract check green), CLI verbs that skip event
  resolution because org commands have no event, and a SKILL.md chapter that
  explains *why* People takes no event id.

# Plan Review: MRQ-205

### 1. Verdict

**PASS** — with one major issue that must be resolved as the first implementation
step (a documented data-model decision, detailed below), plus minor clarifications.
The plan is otherwise complete, aligned with the ticket, and carries a strong
verification section. If the implementer cannot resolve the major issue within the
constraints below, the task should bounce back to planning rather than improvise.

### 2. Summary

Reviewed the MRQ-205 plan against the ticket (sequence/sidebar-fold-tickets.md §T3)
and the actual codebase. The plan covers every ticket requirement — rename, target
conference, card hygiene, drawer linkage, and the three v1.15 org-concept additions —
and its verification plan is unusually concrete. The key concern is that the plan's
schema language ("add a nullable `target_event_id` foreign key to outreach cards with
a migration, repository/API round-trip") assumes a stored cards table that does not
exist: the sourcing card is a **fold over the append-only `person_events` annotations
log** (migration `0012_people_annotations.sql`), and the plan never reckons with that
architecture.

### 3. Issues

**[MAJOR] Approach — "outreach cards" is not a table; the storage decision is unmade**
There is no outreach/cards table to add a column to. The card is the newest
`kind='stage'` row per person in the append-only `person_events` log, with the stage
payload in `value_json` (`{"stage":"identified","score":85,...}`); current state is
deliberately "a fold over the log, never a stored column" (0012's header comment).
The plan's phrasing — FK column, migration, "repository/API round-trip" — reads as a
stored-table mental model. The worst wrong turn from here is minting a parallel
`outreach_cards` table, which would break the log's core invariant (state can never
disagree with the log) and repeat the class of error this project's rules exist to
prevent. Two implementations do fit the ticket's language:
(a) a migration adding a nullable `target_event_id` column (FK to `events`) on
`person_events`, populated by stage writes — "nullable for legacy rows" then falls
out for free; or (b) a `target_event_id` field inside the stage `value_json`, no
migration, no FK integrity. The ticket's scope list names a migration, which points
at (a).
**Recommendation:** Before writing any code, record the decision in the task plan or
a comment: where `target_event_id` lives, that no new cards table will be created,
and that the fold (`foldStageHistory`, the board query in `people.routes.ts`) is
where the target surfaces. Note also the deliberate client/server stage-list
duplication (`src/ui/people/pipeline-stages.ts` vs `lib/person-annotations.ts`,
drift-tested by `tests/node/people-annotations.test.mjs`) — the stage payload change
touches both sides of that seam and its drift test.

**[MAJOR] Approach — next-touch and do-not-contact storage unaddressed, and the CHECK constraint bites**
The plan says "add the ruled CRM affordances" without saying where they live, and
this is a real schema decision, not a detail: `person_events.kind` has
`CHECK (kind IN ('note','tag','stage'))`, so introducing a new annotation kind (e.g.
`flag` for do-not-contact) requires a table-rebuild migration in SQLite/D1, not just
new writes. Alternatives: do-not-contact as a `people` column (defensible — it is a
property of the human, org-scoped, not per-event workflow status, so it does not
violate the "never workflow status on `people`" rule); next-touch as a field on stage
rows' `value_json` or alongside `target_event_id`. Each choice has different
migration and fold implications, and compose exclusion needs to read it server-side.
**Recommendation:** Name the storage for both affordances in the same first-step
decision record as the issue above, including whether the `kind` CHECK must be
rebuilt and how the compose path (`ComposeModal` / comms routes) reads the exclusion
server-side so the "names excluded people" notice is trustworthy.

**[MINOR] Approach — no file inventory**
The plan describes areas but never names files. The ticket does
(`SourcingPipelinePage.tsx`, `PeoplePage.tsx`, `PersonDrawer.tsx`,
`pipeline-stages.ts`, migration), and the real surface is wider: `people.routes.ts`
(board query, stage verb, list), `lib/person-annotations.ts`, `PeopleModals.tsx`
(compose, import — Export CSV lands beside the Import button at
`PeoplePage.tsx:225`), and seed data.
**Recommendation:** Add a short file list to the plan so the review diff can be
checked against intended scope.

**[MINOR] Approach — design contract not referenced**
The ticket names `prototypes/crm/index.html` as the binding design contract, and
this project's rule is that the build reproduces the prototype one-to-one. The plan
never mentions the prototype or DESIGN.md tokens, yet several deliverables are
visual judgments (overdue tint, card layout, `→ <conference>` rendering, drawer
status line).
**Recommendation:** Add an explicit step to open the prototype and match the ruled
rendering against it, tokens from the Flight Deck skin included.

**[MINOR] Approach — "all sorting server-side" vs. the board fold**
The blanket "keep all filters, sorting, pagination, and search server-side" is right
for the list query (R7), but the outreach board is produced by a single fold over
the org's stage rows; next-touch overdue ordering within a board column may
legitimately happen in that fold or in the client rendering of an
already-fetched column.
**Recommendation:** Scope the server-side rule to the list query, and state where
overdue sort actually executes so the verification plan tests the right layer.

**[MINOR] Verification — define the year-grep's scope so it doesn't rot**
"Rejecting any four-digit year in static outreach copy" needs a precise definition
of "static outreach copy" (which files/strings, excluding test fixtures, comments,
and legitimate data like seeded conference names that contain years) or it will
either false-positive and get weakened, or silently scope-creep.
**Recommendation:** Pin the assertion to the outreach surface's copy strings
(page title, breadcrumb, definition, KPI copy, button) and document the exclusion
rule in the test.

**[MINOR] Handoff — MRQ-203 sequencing left implicit**
The nav rename lands with MRQ-203; if the branch is cut before it merges, the nav
will still read "Sourcing pipeline" while this ticket's page reads Outreach. That
interim inconsistency is expected and correct, but the plan only says "preserve
MRQ-203's nav work."
**Recommendation:** State explicitly that this ticket does not touch
`route-table.ts`/`Sidebar.tsx` even if the nav label looks inconsistent mid-flight,
and that a rebase onto MRQ-203's merge is the only interaction expected.

### 4. Positive Observations

- The verification plan is the strongest section: the von-Habsburg overflow fixture
  with a bounding-rectangle assertion, the grep-able year check, the two-event seed
  coverage, and the do-not-contact exclusion notice each map one-to-one onto the
  ticket's acceptance sketch.
- The plan has internalized this project's operational rules precisely: reading
  status fields rather than wall clock, `INSECURE_LOCAL_COOKIES=1` for local smoke,
  cutting from `github/main`, no merging, merge-captain boundaries, and evidence
  attached before the PR opens.
- "Do not put workflow state on `people`" is called out unprompted — the one error
  this project's rules say cannot be undone.
- The seed pointing one org-level funnel at two events directly encodes the ticket's
  "one funnel can aim at two conferences" ruling rather than leaving it to chance.
- Scope discipline is good: the rename is correctly limited to page title,
  breadcrumb, and copy, leaving the nav to MRQ-203, and nothing in the plan invents
  features beyond the ruled set.

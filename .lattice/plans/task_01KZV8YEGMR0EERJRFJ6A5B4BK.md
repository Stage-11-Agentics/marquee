# MRQ-131 — People (org-level speaker record, Lists, sourcing pipeline)

Branch `mrq-131-people` off `github/main` @ `cd907d3`.
Binding design: `prototypes/crm/index.html` (copied into the worktree; the scope
overlay and reset button are scaffolding and do not ship).

## Dependency ruling, decided up front

**MRQ-129 (multi-event) is `backlog` — not started, no worktree, no branch.**
Build block 9 (**Add to conference**) is therefore **out of this PR**. No stub
event picker will be built; the ticket's `depends_on` stays visible on the board
and the PR body says so explicitly. Blocks 1–8 ship.

**MRQ-130 (agent briefs) is unmerged** (`mrq-130-agent-briefs` exists locally,
nothing on `github/main`). Block 5 inlines an agent-brief block **in the shape of
the prototype's "Import people" modal** — copy box + "Copy for your agent" +
`POST /api/v1/org/imports` hint — so the two can be reconciled later. Called out
in the PR body.

## Schema delta — one migration, `0011_people_annotations.sql`

Three tables. `people` is untouched; **no nullable-`event_id` migration** (out of
scope by ruling — org-level writes that must carry an `event_id` attribute to the
org's single existing event and say so in a comment).

```sql
person_events (id, org_id, person_id, kind CHECK(note|tag|stage),
               value_json, actor_person_id, created_at)
person_lists  (id, org_id, name, kind CHECK(live|fixed), config_json,
               created_by, created_at, updated_at)   -- UNIQUE(org_id, name)
person_list_members (list_id, person_id, created_at)  -- PK(list_id, person_id)
```

`person_events` is **append-only and serves four things at once** — exactly as
the ticket requires, and the reason there is no `person_notes` / `person_tags`:

| kind | `value_json` | reads as |
|---|---|---|
| `note` | `{"body": "…"}` | internal notes |
| `tag` | `{"tag":"AI","op":"add"\|"remove"}` | current tags = **latest row per (person, tag)**; `op='add'` wins |
| `stage` | `{"stage":"identified","score":85,"rationale":"…"}` | current stage = **latest `stage` row**; every earlier row *is* the stage history |

Indexes: `idx_person_events_person_kind (person_id, kind, created_at DESC)`,
`idx_person_events_org_kind (org_id, kind, created_at DESC)`.

Everything above is a server write. Nothing in this ticket keeps state in the
client — the run-1 "Draft saved locally" defect is the failure this is built
against, and the validation pass proves persistence by reloading.

## One list query, two entries

`src/routes/people.queries.ts` owns **`buildPeopleQuery({ orgId?, eventId?, filters, sort, page })`**
— the single SQL builder. `eventId` is optional; when present it restricts to
`SPEAKER_ROSTER_PERSON_SOURCE`, **imported from `speakers.queries.ts`** so the
definition of "who speaks at this conference" exists once.

- org People (`GET /api/v1/org/people`, no `event_id`) → the whole org.
- the same endpoint **with** `?event_id=` → that conference's roster population.
- `listSpeakers()` is refactored to take its person rows from the same builder
  and keep its own decorations (status rollup, tracks, task counts). Its existing
  tests are the regression guard. If that refactor destabilizes the merged roster
  I stop, keep the shared person-source constant, and say so in the PR rather
  than shipping a broken roster.

Search / filter / sort / pagination are **server-side**, leaning on
`idx_people_org_name` (R7 — ~1,100 seeded rows today, a client-side filter is a
defect). The list response also carries `facets` (company / title / tag with
counts) so the filter panel is server-driven and can never disagree with the rows.

## Routes — all through `defineApiRoute`, all under `/api/v1/org/*`

| Method | Path | Serves |
|---|---|---|
| GET | `/api/v1/org/people` | list + facets (q, company, title, tag, stage, list_id, event_id, page, per_page, sort) |
| POST | `/api/v1/org/people` | add person |
| GET | `/api/v1/org/people/{personId}` | the whole drawer in one read: identity, tags, notes, connections (participations across every conference), activity (person_events + audit_log + outbox) |
| PATCH | `/api/v1/org/people/{personId}` | identity edit |
| POST | `/api/v1/org/people/{personId}/notes` | append `note` |
| POST | `/api/v1/org/people/{personId}/tags` | append `tag` add |
| DELETE | `/api/v1/org/people/{personId}/tags/{tag}` | append `tag` remove |
| POST | `/api/v1/org/people/{personId}/stage` | append `stage` (enroll **and** move — one verb) |
| GET | `/api/v1/org/summary` | KPI strip: counts + top companies (`GROUP BY company`) |
| GET/POST | `/api/v1/org/lists` | Lists |
| GET/DELETE | `/api/v1/org/lists/{listId}` | open (members resolved: live = re-run config, fixed = members table) |
| GET | `/api/v1/org/pipeline` | board — six stages folded from `stage` rows |
| POST | `/api/v1/org/comms/preview` | thin: `renderAdHocMail` |
| POST | `/api/v1/org/comms/send` | thin: resolves org people → **the existing `enqueueBulkReminder` + `enqueueMailMessage` + `outbox`** path. Not a second mail path; the event-scoped `recipientsFor` cannot address a person with no membership in the event, which is precisely why the org entry point resolves its own audience and then hands off. |
| POST | `/api/v1/org/imports` | CSV, auto-mapped by header, returns `created/updated/skipped/unmapped[]`. Matches on email (`normalizeEmail`), reuses `parseCsv`. **No column-mapping wizard.** |

`check:api` parity applies to every one; `docs/ROUTES.md` regenerated via
`check:routes --write`. No new dependencies; `package.json` untouched.

## UI — `src/ui/people/`

Reproduces the prototype one-to-one, minus scaffolding.

- `PeoplePage.tsx` — KPI strip (4 counts + top-companies widget), toolbar
  (search · Filter · **contextual save control**), filter panel (company / job
  title / tag with counts), the **one reserved status row** carrying either
  active-criteria chips or the selection bar (elements never jump), table,
  server-paginated footer.
- The save control is fixed-width and swaps text only: nothing selected →
  "Save filter as list" (defaults **Live**); rows ticked → "Save selected as
  list" (defaults **Fixed**).
- `PersonDrawer.tsx` — one scrolling drawer, not a tab chain: Profile · Tags ·
  Internal notes · Connections · Activity.
- `ListsPage.tsx`, `PipelinePage.tsx` (six columns; cards move by a **"Move to"
  menu, never drag** — the existing program-board ruling), `PipelineCardDrawer`
  with notes + timestamped stage history.
- Modals: `ImportPeopleModal`, `ComposeModal`, `SaveListModal`, `EnrollModal`.
- `people.css` — tokens only, no literal colors (`check:design`).

**Nav:** a new `organization` route group rendered in `Sidebar` **above** the
conference caption — the switcher is the scope boundary and that placement is the
point. Entries: **People · Lists · Sourcing pipeline**. `/people` is canonical;
`/crm`, `/directory`, `/contacts` are aliases that resolve to the same page (an
agent guessing a URL must not spend turns on a 404).

**Language (binding):** "People", "List", "Live", "Fixed". Never *CRM*,
*Directory*, *Contacts*, or *Segment* in a user-facing string.

## Agent surface

- CLI verbs in `cli/registry.mjs` + dispatch in `cli/marquee.mjs`:
  `marquee people list|show|note|tag|import`, `marquee lists list|save`,
  `marquee pipeline move`, `marquee people email`.
- `SKILL.md` regenerates from the registry through `cli/generate-skill.mjs`.

## Test plan (suite budget 45 s)

- **`tests/node`** (pure, cheap): the query builder's SQL/bindings shape;
  tag folding (add → remove → add); current-stage + history derivation from an
  append-only log; CSV header auto-map incl. `unmapped[]`; the contextual
  save-control label/kind rule; list-config normalization.
- **`tests/integration/api`** — **one** Worker-backed file (~19 s each, so it is
  consolidated deliberately): list + server-side filter + pagination; note and
  tag persistence read back through a fresh request; list save/open for both
  kinds; stage move then history; org send landing in `outbox`; CSV import
  create/update/skip.
- The existing roster tests guard the `listSpeakers` refactor.

## Order of work

1. migration + `people.queries.ts` builder (+ roster refactor)
2. people routes (list, get, patch, create) + summary
3. annotations (notes, tags) — server-persisted
4. Lists
5. Import (drop-zone + agent brief)
6. Bulk email
7. KPI strip
8. Sourcing pipeline
9. *(skipped — depends on MRQ-129)*
10. CLI + SKILL.md, `check:routes --write`, `pr-gate`, browser validation

Partial delivery is expected on a ticket this size; the PR body states exactly
which blocks shipped, which did not, and why.

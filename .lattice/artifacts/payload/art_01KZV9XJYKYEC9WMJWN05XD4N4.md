# Plan Review: MRQ-131 — People (org-level speaker record, Lists, sourcing pipeline)

## 1. Verdict

**FAIL (plan-level)**

The remedy is a short amendment, not a redesign. Four of the issues below are
answerable in a paragraph each; two of them (Issues 1 and 2) are the kind that
ship green and fail in production, which is why this is a FAIL rather than a
PASS-with-notes.

## 2. Summary

Reviewed the plan against `github/main @ cd907d3` — the API authorization
pipeline, the outbox/comms stack, `speakers.queries.ts`, the client route table
and sidebar, the migration set, the test harness, and the binding prototype
`prototypes/crm/index.html`. The plan is unusually well-grounded: every symbol it
names (`SPEAKER_ROSTER_PERSON_SOURCE`, `canAddressPersonOnly`, `renderAdHocMail`,
`enqueueBulkReminder`, `parseCsv`, `normalizeEmail`, `idx_people_org_name`) exists
and does what the plan says it does, the append-only `person_events` design is
faithful to the ticket, and the MRQ-129/MRQ-130 dependency rulings are made up
front rather than discovered mid-build.

The key concern is that the plan declares fifteen routes under `/api/v1/org/*`
without stating an auth policy, and the request pipeline denies grant-based
authorization outright when there is no `{eventId}` path parameter — so the
default reading of the plan produces an API that 403s every call, including every
CLI call. Close behind: the org bulk-email path inherits an idempotency key that
makes the *second* campaign to the same person a silent no-op.

## 3. Issues

**[CRITICAL] Routes — `/api/v1/org/*` has no stated auth policy, and the default one cannot pass**

`src/api/router.ts:185` — `principalHasGrant` returns `false` unconditionally
when `eventId === undefined`, and `eventId` comes from `context.req.param("eventId")`.
For a token principal the branch above it is the same: `tokenHasGrant` requires an
event id. None of the plan's fifteen `/api/v1/org/*` routes carry an `{eventId}`
parameter, so any route declared with the usual `policy: { auth: { kind: "grants", … } }`
will 403 for **every** caller — session and bearer alike. Worse, `router.ts` carries an
explicit "closed after M-07 (R5)" contract in its header comment, so "just fix the
middleware" is not available as an in-ticket answer.

This is not hypothetical for the agent surface: the CLI authenticates only with
`--token` / `MARQUEE_TOKEN` (`cli/registry.mjs` GLOBAL_OPTIONS), i.e. a bearer
principal. If the org routes reject tokens, the AGENT-NATIVE requirement
(`marquee people|lists|pipeline` verbs) is dead on arrival and the failure shows
up at the very end of the plan's order of work, at step 10.

The precedent exists and the plan should name it: `/api/v1/org/tokens`
(`src/routes/tokens.routes.ts:120,143,195`) uses `policy: { auth: { kind: "authenticated" } }`
and resolves the org in-handler from `getAuth(context).orgId` —
`src/lib/auth/auth-middleware.ts:49-51,74-77` populates `orgId` for both `token`
and `session` principals. Note that that module's own `requireTokenAdmin` throws
for any non-session principal; copying it verbatim reintroduces the CLI lockout.

**Recommendation:** State in the plan that every `/api/v1/org/*` route uses
`{ kind: "authenticated" }` plus an in-handler org guard reading `getAuth(context).orgId`,
that **token principals are accepted** (org from `api_tokens.org_id`), and what the
minimum role is for writes. Add one integration assertion that a scoped bearer
token can read `GET /api/v1/org/people` — that single test is what keeps step 10
from discovering this.

---

**[CRITICAL] Block 6 (bulk email) — the outbox idempotency key makes the second campaign a silent no-op**

`src/jobs/mail/outbox.ts:36-38` derives `idempotency_key = sha256(templateKey, entityId, personId)`,
`outbox.idempotency_key` is UNIQUE (`migrations/0001_init.sql:303`), and on
conflict `insertOutbox` returns `{ inserted: false }` — no row, no queue handoff,
no error. The existing ad-hoc send passes `entityId: recipient.submission_id ?? recipient.person_id`
with `templateKey: body.template_key ?? "custom"` (`src/routes/comms.routes.ts:712-713`).

Every org-level recipient is by definition person-only (that is precisely why the
plan says the event-scoped `recipientsFor` cannot address them). So the key
collapses to `sha256("custom", person_id, person_id)` — a **constant per person
across all time**. The first org campaign to a person sends; every subsequent one
silently enqueues nothing. The operator sees a success response and an empty
outbox. The plan describes this route as "thin: resolves org people → the existing
`enqueueBulkReminder` + `enqueueMailMessage` + `outbox` path" and never touches
the key.

**Recommendation:** Mint a per-send entity id — a `person_events` row or a
campaign/send row id created before the fan-out — and pass it as `entityId` so
idempotency still protects a retry of *one* send without deduplicating *distinct*
sends. Add the assertion explicitly to the integration file: two different org
sends to the same person produce two `outbox` rows.

---

**[MAJOR] "One list query, two entries" — the roster's status filter and counts are derived in JS, not SQL**

`listSpeakers` (`src/routes/speakers.queries.ts:336-393`) loads the **entire**
roster (no LIMIT/OFFSET anywhere), computes `status` in JavaScript via
`rollupSpeakerStatus` from participations + membership, filters in memory with
`speakerMatchesFilters`, and derives `counts` (all/pending/invited/confirmed/declined)
and the `tracks` facet over the full row set. `getSpeaker` shares `personQuery`.

The plan's `buildPeopleQuery({ …, page })` is server-side paginated. These two
shapes are not reconcilable by a parameter: you cannot page in SQL and still
return whole-population counts from the page, and you cannot filter in SQL on a
`status` that does not exist until the JS rollup runs. The plan's escape hatch —
"if that refactor destabilizes the merged roster I stop, keep the shared person-source
constant, and say so in the PR" — lands on exactly the outcome the ticket names a
defect ("a second implementation is a defect"), and it lands there at step 1,
before any of the visible work is done.

**Recommendation:** Decide the reconciliation in the plan rather than at the
keyboard. The workable shape: the builder pages **person ids** in SQL from the
shared source, decorations (participations/tracks/tasks) load for that page only,
and `counts` come from a separate COUNT-only query over the same source. Then say
explicitly whether roster `status` filtering moves into SQL — it can, as a CASE
over the same participations join, which is the only way `?status=confirmed&page=2`
is correct — or whether the roster keeps a documented post-filter with its
consequences named.

---

**[MAJOR] Schema delta — migration number will collide, and the schema registry/asserts are not addressed**

Two separate problems the plan does not mention:

1. `github/main` already carries **three** `0009_*` and **three** `0010_*`
   migrations (`0009_criterion_kinds`, `0009_file_comments`,
   `0009_person_custom_fields`, `0010_bound_form_options`,
   `0010_evaluation_round_committees`, `0010_saved_embeds`) — parallel tickets
   collide on number as a matter of course here, and `wrangler d1 migrations apply`
   resolves siblings lexicographically. `0011_people_annotations.sql` is likely to
   acquire a sibling before this PR merges.
2. `scripts/schema-verify.mjs:175-176` asserts **exactly 48 product tables**, and
   `assert.deepEqual(sorted(mirrorColumns.keys()), sorted(expectedTables), "SQL and CoreTableRows table registries diverge")` binds the SQL to
   `CoreTableRows` in `src/db/schema.ts:788`. Three new tables break both. Because
   `schema-verify` is wired to no npm script and is **not** in `pr-gate`, this
   fails after the gate is green rather than at it — the worse failure mode.

**Recommendation:** Add a schema step to the order of work: update `CoreTableRows`,
bump the 48→51 asserts, run `node scripts/schema-verify.mjs` before the PR. State
the collision policy (keep the number, rely on the descriptive suffix for
deterministic ordering) so a rebase does not silently reorder DDL.

---

**[MAJOR] Nav — `/speakers` is the public SSR directory; the organizer roster is `/roster`**

The ticket says "the conference roster at `/speakers`". In this repo it is not:
`src/ui/shell/route-table.ts` mounts `{ id: "speakers", path: "/roster", label: "Speakers" }`
with a comment explaining exactly why — `/speakers` is claimed by the public
directory and matched by `isPublicPage` in `src/ui/app.tsx:27`, which resolves
before the SPA. The plan repeats the ticket's framing without correcting it, which
is how a delegator ends up wiring an org list into a public page.

Related, on the aliases: `check:routes` generates `docs/ROUTES.md` from
`route-table.ts` + `isPublicPage` + `src/routes/*.route.tsx` precisely to catch
"paths that answer 200 with the SPA shell while being nothing at all" — its header
comment names `/site`, `/settings/webhooks`, `/comms` as prior instances. `/crm`,
`/directory`, `/contacts` must be real rows in `route-table.ts` (utility group,
`sidebar: false`), not just client-router special cases.

**Recommendation:** Name `/roster` explicitly in the plan; declare the three
aliases as route-table rows and say so.

---

**[MAJOR] Annotations — "latest row wins" has no deterministic tiebreak**

The plan folds current tags as "latest row per (person, tag)" and current stage as
"latest `stage` row", both keyed on `created_at`. `created_at` here is epoch
**milliseconds** (`EpochMilliseconds` in `src/db/schema.ts`). A bulk tag apply, a
test using a frozen clock, or two writes inside one request all produce ties — and
a tie means a `remove` can lose to the `add` it followed, so a removed tag comes
back on reload. That is the same class of defect as the run-1 "Draft saved locally"
cautionary tale the plan is written against: state that does not survive a reload.

**Recommendation:** Specify the ordering as `(created_at DESC, id DESC)` with
monotonic ids, in the plan and in the index (`idx_person_events_person_kind`
should carry `id` as its trailing key). Add the same-millisecond add/remove case
to the `tests/node` folding test — it is a pure-logic test and costs nothing.

---

**[MINOR] Block 8 — the six stage ids live in the binding prototype and the plan does not pin them**

`prototypes/crm/index.html:554-561` defines `STAGES` as `researching, identified,
contacted, interested, confirmed, declined`, each with `kind: open|won|lost`. The
ticket's phrasing — "six named stages including terminal won/lost" — reads as if
`won` and `lost` are stage ids, which would produce eight stages or two wrongly
named ones. The prototype is binding and the plan claims one-to-one reproduction,
so the ids should be in the plan.

**Recommendation:** Quote the six ids and state that won/lost is `kind`, not id.
Name where the vocabulary lives (a TS const plus a CHECK, or the const alone).

---

**[MINOR] UI — save-control copy diverges from the binding prototype**

Prototype: "Save this filter as a list" / "Save selected as a list"
(`prototypes/crm/index.html`). Plan: "Save filter as list" / "Save selected as
list". Minor on its own, but the plan's own claim is one-to-one reproduction, and
the two strings differ in length — a fixed-width control (correctly required by
the plan, per the elements-never-jump rule) must be sized to the longer of the
*actual* strings.

**Recommendation:** Quote the prototype strings verbatim and size the min-width to
the longer one.

---

**[MINOR] Test plan — the consolidation rationale is inverted for this scheduler**

The plan justifies "**one** Worker-backed file" with "~19 s each". That figure does
not survive contact: `tests/integration/api` already holds **48** Worker-backed
files and the whole suite fits a 45 s wall-clock budget. `vitest.config.ts` runs
both projects as one Vitest run over one shared worker pool, so the budget is
wall-clock across parallel isolates and **the longest single file is the critical
path**. A deliberately monolithic new file covering seven scenarios is therefore
the worst available shape, not the safest.

**Recommendation:** 2–3 balanced integration files (list/filter/pagination ·
annotations+lists · import+send). Same total work, shorter critical path.

---

**[MINOR] No `tests/ac-claims/MRQ-131.json` in the order of work**

`pr-gate` runs `trace:ac --scope=merged --ticket=MRQ-131`
(`scripts/checks/pr-gate.mjs:21`). A missing manifest produces the
`missing-current-ticket-manifest` warning rather than a failure, so this will not
block the gate — but the claims file is how this ticket's SPK-01/02/03/11/13/14/15
coverage becomes visible to the merged AC trace, which is most of the ticket's
stated justification.

**Recommendation:** Add "write `tests/ac-claims/MRQ-131.json`" to step 10.

---

**[MINOR] File inventory is incomplete outside the new modules**

The plan names `src/ui/people/`, `src/routes/people.queries.ts`, and the migration,
but the change necessarily touches: `src/ui/shell/route-table.ts` (the `RouteGroup`
union is a closed type — `"home" | "pipeline" | "modules" | "utility"` — and gains
`"organization"`), `src/ui/shell/Sidebar.tsx`, `src/db/schema.ts`,
`scripts/schema-verify.mjs`, `cli/registry.mjs`, `cli/marquee.mjs`, `cli/client.mjs`,
`docs/ROUTES.md`, `SKILL.md`.

**Recommendation:** List them, so a delegator staging blocks 1–8 knows which
shared files every stage re-touches (they are the merge-conflict surface with
sibling tickets).

---

**[MINOR] Block 5's inlined agent brief creates a known duplicate with MRQ-130**

Accepted and documented by the plan, which is the right call given MRQ-130 is
unmerged. The plan does not say which file the later reconciliation edits.

**Recommendation:** Name the component/file that MRQ-130's merge will replace, in
one line, so the reconciliation is a lookup rather than an excavation.

## 4. Positive Observations

- **The dependency rulings are made up front.** MRQ-129 is `backlog`, so block 9
  is out of the PR with no stub picker built; MRQ-130 is unmerged, so block 5
  inlines a prototype-shaped brief and says so. Both are stated as decisions with
  reasons, in the plan, before any code — which is exactly where they cost the
  least.
- **Every symbol the plan reaches for is real and does what the plan says.**
  `SPEAKER_ROSTER_PERSON_SOURCE`, `ONBOARDING_PERSON_SOURCE`, `canAddressPersonOnly`,
  `renderAdHocMail`, `enqueueBulkReminder`, `enqueueMailMessage`, `parseCsv`,
  `normalizeEmail`, `idx_people_org_name` all check out. Grounding a plan this
  large in verified seams rather than remembered ones is the reason the issues
  above are amendments rather than a rewrite.
- **The `person_events` table earns its design in the plan, not just in the ticket.**
  The three-row `kind`/`value_json`/"reads as" table makes the append-only claim
  concrete and shows *why* there is no `person_notes`/`person_tags` — history falls
  out of the log instead of needing a second table.
- **Server persistence is framed against the specific prior defect** ("Draft saved
  locally") with a validation method attached — prove it by reloading — rather
  than as a general aspiration.
- **The plan is more accurate than the ticket on the sidebar.** It says "above the
  conference caption"; the ticket says "switcher". `Sidebar.tsx` carries a comment
  explaining that the element is deliberately a caption and not a control. Reading
  the code rather than the brief is the habit worth reinforcing.
- **Boundaries are honored without argument**: no new dependencies, no
  nullable-`event_id` migration, no dedupe/merge, no column-mapping wizard, no
  second mail path, "Move to" menu instead of drag. The language contract
  (People/List/Live/Fixed, never CRM/Directory/Contacts/Segment) is restated as
  binding.
- **The partial-delivery contract is explicit** — the PR body states which blocks
  shipped and which did not. On a ticket this size that is the difference between
  a reviewable PR and an archaeology exercise.

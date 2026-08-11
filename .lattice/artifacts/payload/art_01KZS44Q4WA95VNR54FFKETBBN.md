# Plan Review: MRQ-76 — Pipeline stage derivation

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-76 implementation plan against the ticket, the four implicated
surfaces (`landing.route.tsx`, `dashboard.routes.ts`, `api/board.ts`,
`submissions.queries.ts`, `submission-record.routes.ts`), the seed generators, and
the local gate scripts. The plan's spine is right — it rules on semantics before
touching counts, it correctly identifies that stages must be *precedence-ordered and
mutually exclusive* rather than independently literal, and it names the one invariant
worth having (tile count == linked-list total).

It fails the gate on two things it decides unilaterally and three it does not decide
at all. The unilateral decisions: it self-waives the ticket's explicit smoke criterion
("NO pipeline stage links to an empty list") by ruling `Submitted 0 = 0` acceptable,
and it extends stage-gating to `can_schedule`, which under its own derivation strips
the scheduling affordance from most accepted sessions. The undecided items: narrowing
`accepted` silently breaks the dashboard's Unscheduled metric and creates a *new*
disagreement with `/agenda-builder` (a fifth surface the plan never mentions and does
not own); the new `waved` definition makes the sent-wave dashboard rows link to empty
lists; and the eighth board column has four unlisted dependencies including a
hard-coded 7-column CSS grid and a `declined` value with no destination filter.

## 3. Issues

---

**[CRITICAL] "Semantic ruling" + "Plan-Review Cycle 1 Resolutions" — the plan waives a non-negotiable acceptance criterion, leaving the first pipeline stage a dead link on every surface**

The plan rules `submitted` literal and records that the seed has no such rows, then
resolves this by declaring the smoke evidence will "record `0 = 0` explicitly." I
confirmed the premise: `scripts/seed/pool.ts:218` `poolStatus()` returns only
`in_review | rejected | waitlisted | draft`, and `scripts/seed/accepted-core.ts:184`
writes `accepted`. No code path in the seed ever writes `status = 'submitted'`.

So after this ticket lands, **Submitted reads 0 on the landing hero, 0 on the
dashboard tile, 0 as a board column, and its sidebar entry opens an empty list.**
That is directly contrary to the ticket's verification item 5, which is marked
non-negotiable: *"confirm … that NO pipeline stage links to an empty list."* It is
also worse for the artifact this ticket exists to protect: `src/ui/shell/route-table.ts:16`
puts `Submitted` at position 1 of the pipeline sidebar, and
`scripts/checks/verify-design-contract.mjs:28` **pins that label** — so `check:design`
guarantees a judge sees a permanently-empty first stage on a 1,000-submission demo.
Trading "960 vs 0" for "0 everywhere" is internally consistent and still a
walkthrough blocker.

A delegator cannot waive a criterion the ticket marks non-negotiable. The Cycle-1
resolution reads as the planner noticing the conflict and ruling around it rather
than surfacing it.

**Recommendation:** Resolve it, don't waive it. Cheapest correct option: seed a real
Submitted cohort. `scripts/seed/pool.ts` is claimed by neither MRQ-77 nor MRQ-78, so
it is available; reassign a slice of the 280 `in_review` rows (or the 40 drafts) to
`status = 'submitted'` in `poolStatus()`, keep the `POOL_SIZE` sum assertion at
`pool.ts:347` green, and re-run `check:seed`. That makes every stage non-empty and
makes the literal ruling honest. If the plan believes a seed edit is out of scope,
that is an escalation to the orchestrator before implementation — not a resolution
the plan can grant itself. Either way, name the decision and its owner in the plan.

---

**[CRITICAL] Implementation step 4 — gating `can_schedule` on the narrowed derived stage removes scheduling from most accepted sessions**

The ticket asks for one thing here: *"Gate decision affordances on the derived stage."*
The plan extends this to `can_schedule`: *"a record that is no longer an unplaced
Accepted stage must not expose scheduling as if it were still there."*

Under the plan's own derivation that is a functional regression. `accepted` is defined
as "accepted, not scheduled/published, **not in the derived Onboarding or
pending-Waved sets**." Today `submission-record.routes.ts:407` reads
`row.kind === 'session' && row.status === 'accepted' && slot === null`, and the
dashboard's Unscheduled metric measures exactly that population at **36**. Most of
those 36 are precisely the records that *do* have open speaker tasks (stage
`onboarding`) or sit in the pending Wave 2 (stage `waved` — `scripts/seed/event.ts:225`
seeds Wave 2 and Wave 3 with `sent_at: null` and `accepted-core.ts:189` assigns
28 accepted submissions to Wave 2). Gating on `stage === 'accepted'` hides the
"Working agenda" card (`src/ui/submissions/SubmissionRecordPage.tsx:142`) from all of
them.

An accepted speaker who still owes a headshot is the *normal* case for scheduling a
talk. This removes the scheduling path from the walkthrough for the majority of
schedulable sessions.

**Recommendation:** Split the two gates. `can_decide` → derived stage (this is what
the ticket asked for; use the `row.stage` projection already present at
`submission-record.routes.ts:365`). `can_schedule` → keep it on the accepted
*family*: `kind === 'session' && slot === null && <record is in the accepted family,
i.e. raw status 'accepted' and not agenda-placed>`. State this split explicitly in the
plan so the implementer does not "simplify" it back together.

---

**[MAJOR] Implementation step 2 — narrowing `accepted` breaks the Unscheduled metric and creates a new cross-surface disagreement with `/agenda-builder`**

The plan says: *"Ensure wave rows and the Unscheduled metric use the same predicate as
their linked list, so the dashboard-wide count/link invariant holds."* Applied to
Unscheduled, that satisfies the invariant by making the number wrong.

`dashboard.routes.ts:230-236` labels it "Unscheduled / accepted sessions" and counts
`s.status = 'accepted' AND ai.id IS NULL` = 36. `/agenda-builder` computes its own
Unscheduled pool from `shouldBeInUnscheduledPool` (`src/api/agenda.ts:152-158`) with
`DEFAULT_SCHEDULABLE_STATUSES = ['accepted']` (`src/api/agenda.ts:7`), reading the raw
column — also 36, which the UX sweep confirms agrees today ("Unscheduled: 36 and
Conflicts: 7 match `/dashboard` exactly"). `src/routes/agenda.queries.ts` is **not in
MRQ-76's OWNS list**, so it cannot be changed.

If the dashboard's Unscheduled adopts the narrowed `accepted`, it drops to a small
number while `/agenda-builder` still shows 36. The ticket whose entire purpose is
"four surfaces must not answer four different questions under one label" would ship a
fifth surface disagreeing with the fourth — and organizers would lose sight of
unscheduled onboarding sessions, which is the operationally dangerous direction.

**Recommendation:** Decide this explicitly in the plan. The clean resolution is to keep
the *submissions filter* `?status=accepted` as the accepted family (accepted, not
agenda-placed) so `?status=accepted&placement=unplaced` still returns 36 and still
agrees with `/agenda-builder`, and make mutual exclusivity a property of the
*dashboard tile / board column* projection rather than of the filter vocabulary. If
the plan instead insists the filter be exclusive, it must say in writing how
`/agenda-builder` stays in agreement without editing a file it does not own.

---

**[MAJOR] Semantic ruling ("waved") — the new definition makes sent-wave dashboard rows link to empty lists**

`waved` becomes "accepted, wave `sent_at IS NULL`, not agenda-placed." The dashboard
wave rows (`dashboard.routes.ts:205-213`) all use `href: /submissions?status=waved&wave=<id>`
with `accepted_count` from `submission.status = 'accepted'`. Wave 1 is seeded as
**sent** (`scripts/seed/event.ts:224`, `WAVE_ONE_SENT`) with 32 accepted submissions.
After the change, Wave 1's row shows a count against a link that returns **zero rows** —
the exact defect class this ticket exists to eliminate, reintroduced two rows below the
pipeline. Making `accepted_count` match the `waved` predicate instead just turns every
sent wave into a `0`, which is not honest either.

The plan mentions wave rows in one clause but rules nothing about sent waves.

**Recommendation:** Add an explicit rule: sent waves link to their decided population
(`?status=accepted&wave=<id>`, or the notification view), pending waves link to
`?status=waved&wave=<id>`; `accepted_count` matches whichever list the row's own href
opens. Include sent-wave and pending-wave rows in the regression net (see the
Verification issue below).

---

**[MAJOR] Implementation step 3 — the eighth board column has four unstated dependencies, one of which reintroduces a count with no destination**

The plan says it will "update the minimal board presentation contract only as necessary
to render the eighth terminal column." Four concrete blockers it does not name:

1. `src/ui/board/board.css:12` hard-codes `grid-template-columns: repeat(7, minmax(210px, 1fr)); min-width: 1490px`. An eighth column renders off-grid until this changes (allowed — the file is unowned — but it must be listed).
2. `src/routes/board.routes.ts:25` documents the endpoint as "across the **seven** program stages." That string is served in the OpenAPI document.
3. `declined` is not in `SUBMISSION_STATUS_FILTERS` (`submissions.queries.ts:27-41`). If the Declined column's count is clickable — as every other board column count implies — it opens nothing. A count with no valid destination is precisely the defect the ticket names.
4. Changing the `BoardStage` enum and the route description changes the served OpenAPI document. The plan calls `board.routes.ts` a "registry-preserving pass-through," which risks the implementer skipping `npx vite build && node cli/generate-api-registry.mjs`; `check:api` asserts exact parity and will fail the gate.

**Recommendation:** Enumerate all four in the plan. For (3), either add `declined` to
`SUBMISSION_STATUS_FILTERS` with a matching predicate (`status IN
('rejected','waitlisted','withdrawn')`) so the column is navigable, or state
deliberately that the terminal column is non-navigable and render it without an
affordance. For (4), state that the registry is regenerated regardless of no route
being added.

---

**[MINOR] Implementation steps 1 and 3 — the `cancelled_at` schema-probe asymmetry is not threaded**

`submissions.queries.ts` gates the open-task clause behind
`hasSpeakerTaskCancellationColumn()` (line 76) and threads `includeCancelledAt`
through `filterParts` and `dashboardStageSql`. `BOARD_STAGE_SQL` (`api/board.ts:148-151`)
hard-codes `cancelled_at IS NULL` with no probe. Building `BOARD_STAGE_SQL` from the
shared predicates — which step 3 requires — means `listBoard()` must now run the probe
and thread the flag, as must `submission-record.routes.ts`'s stage projection.
Otherwise minimal-schema fixtures that exercise the board will start throwing
`no such column`, or the board and the filters will disagree on cancelled tasks.

**Recommendation:** Name the threading explicitly in steps 1, 3, and 4, and make one
existing minimal-schema fixture exercise the board so the regression is caught by the
fast suite rather than by `wrangler dev`.

---

**[MINOR] Implementation step 2 — "inside the existing one-read statement" is under-specified, and the naive form double-counts**

`loadLandingData` (`landing.route.tsx:60-106`) is a `WITH demo AS (…) SELECT
(scalar subquery), (scalar subquery), …` with **no agenda join at all**. The shared
predicates reference an `ai` alias (`submissions.queries.ts:93-94`). Embedding them
requires either correlated `EXISTS` rewrites or a join inside each scalar subquery, and
if the implementer reaches for `COUNT(*)` over a `submissions ⟕ agenda_items` join, a
submission with more than one session agenda item double-counts — which is exactly why
the dashboard and list both use `COUNT(DISTINCT s.id)` (`dashboard.routes.ts:81`,
`submissions.queries.ts:572`).

**Recommendation:** State in the plan that landing's stage counts use
`COUNT(DISTINCT …)` over the same join shape as the dashboard, and add the landing
count to the cross-surface integration assertion so a double-count fails the suite
rather than the smoke walk.

---

**[MINOR] Verification step 5 / plan step 5 — the invariant is applied only to pipeline tiles, but the failures live in the non-pipeline counts**

The regression net covers "each dashboard pipeline item." Issues 3 and 4 above both
live in `DashboardCount` objects that are *not* pipeline items — `unplaced`,
`overdue`, `decided-not-notified`, and every wave row — all of which carry an `href`
and a count.

**Recommendation:** Widen the assertion to *every* `DashboardCount` with an `href` in
the snapshot (pipeline, metrics, attention, waves): fetch the href's list, assert
`total === count`. That is one loop, it is mechanical, and it catches issues 3 and 4
automatically instead of relying on the reviewer having spotted them.

---

**[MINOR] Factual note for the implementer — the "true status distribution" in the findings is derived status, not the raw column**

UX-SWEEP-FINDINGS §4b lists `published 23` and `scheduled 1` as statuses. Those values
never appear in the `submissions.status` column: `toItem()`
(`submissions.queries.ts:292-297`) derives them from the agenda join at read time, and
`scripts/seed/agenda.ts:87` sets `is_published` on the 24 agenda items over
`accepted-core`'s rows. The raw column holds `accepted 60` (= 36 + 23 + 1). The ticket
body (line 55) has this right; the findings table is the misleading one. The plan's
rules happen to be safe either way, but an implementer who trusts §4b may write
predicates for raw statuses that do not exist.

**Recommendation:** One line in the plan stating the raw-status inventory
(`draft, submitted, in_review, accepted, waitlisted, rejected, withdrawn`) so the
derivation's exhaustiveness can be reasoned about against the real column domain.

---

## 4. Positive Observations

- **It rules before it patches.** The ticket's central warning is that surface-by-surface
  fixes are how this was introduced. The plan opens with a semantic ruling section and
  derives implementation from it. That is the correct shape.
- **It gets the hard part right.** The insight that literal-per-status predicates are
  *not* sufficient — that stages need precedence ordering with agenda and task states
  derived first and `accepted` defined as the remainder — is the non-obvious correct
  answer, and it is what makes "a record sits in exactly one stage" actually true rather
  than aspirational.
- **The invariant is well chosen.** "Displayed count == the `total` returned by its own
  href" is mechanical, cheap, and unfalsifiable by relabeling. It is exactly the missing
  regression net the ticket asked for. My objection is only that it stops short of the
  non-pipeline counts.
- **Boundaries are explicit and correct.** Owned files, forbidden files, no-migration,
  no-`package.json`, the parallel-ticket collision surfaces, and the retired Forgejo
  remote are all named. The `check:design`-pinned sidebar labels are correctly left
  alone.
- **The Cycle-1 resolutions show real engagement** rather than boilerplate — each names
  a specific failure mode and a specific mitigation. The `0 = 0` one is the wrong call,
  but it is a *considered* wrong call, and the reasoning is legible enough to argue
  with, which is worth more than silence.
- **Verification sequence includes the real-artifact smoke walk** on a dedicated port
  with observed values captured, and explicitly refuses to claim success from green
  unit tests alone.

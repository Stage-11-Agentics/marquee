# Plan Review: MRQ-34 (M-55 + M-36)

## 1. Verdict

**FAIL (plan-level)**

The plan is directionally right and contradicts nothing in the contract, but it is written at a level of
abstraction that hides four decisions the implementer will otherwise make silently — and one of them
(`missing_fields` is currently a hardcoded `[]`, and the seed writes **zero** `submission_answers` rows)
determines whether AC-248's `Missing fields` column and AC-249's applicable-missing computation can show
anything true at all. This is a tightening pass, not a redesign: the fixes below are all statements the
plan should make, not work it should re-scope.

## 2. Summary

Reviewed the MRQ-34 plan (saved views, configurable columns, Draft queue, builder condition summary)
against `SPEC.md` §§208/210/384/473–475, `BUILDPLAN.md` M-08/M-12/M-55/M-36, `EVALUATION.md`
AC-134/247–249, and the merged code on `master` (3fd129f). The plan correctly identifies the load-bearing
constraint — everything applicable-missing flows through `isFieldApplicable()`, never the full required
set — and correctly refuses to build a second evaluator. Its key weakness is that it never names a file,
an endpoint, or a persistence mechanism, and it assumes two things the repository contradicts: that
`missing_fields` has a data source (it does not), and that the builder-list condition summary does not
yet exist (it does, at `src/ui/forms/FormsPage.tsx:336`).

## 3. Issues

**[CRITICAL] Step 3 / Step 5 — `missing_fields` has no data source, and the seed has no answers**
`src/routes/submissions.queries.ts:213` returns `missing_fields: []` as a literal stub, so AC-248's
`Missing fields` column and AC-249's applicable-missing list both need a computation that does not exist
yet. Worse: `scripts/seed/` writes **no `submission_answers` rows at all** (confirmed — the seeded tables
are people/submissions/submission_tracks/participations/decisions/tasks/forms/form_fields/…, and
`SEED-DATA.md` states no answer obligation). Two consequences the plan does not address. First, with no
answers, `vendor_content` is never `"Yes"`, so the conditional `vendor_product` field
(`scripts/seed/event.ts:279`) is *always* hidden — the "revealed missing is attention" half of the
decisive pair the plan promises to prove cannot be produced from seed data. Second, if missing-fields is
computed naively for every row, every *submitted* and *accepted* record in the walkthrough will render as
missing all eleven required fields — a visibly dishonest table on the graded surface.
**Recommendation:** State in the plan (a) the semantics for non-draft records — a submitted record passed
submit-time validation, so the column reads `—`/`Complete` rather than re-deriving; (b) how answers reach
the computation for drafts — either add `submission_answers` seeding for a handful of drafts (including
one with `vendor_content = "Yes"` so the revealed case exists) or build the hidden/revealed pair as a
hermetic test fixture and say plainly that the seeded demo shows only the hidden case; (c) if seeding is
chosen, note that MRQ-23 is in flight on the seed/speed suites and coordinate rather than rewrite.

**[MAJOR] Step 3 — no computation strategy for missing-fields against the speed budgets**
Computing applicable-missing for 50 rows means loading each submission's form fields plus its answers.
`scripts/checks/speed-budgets.mjs` holds `submissions-filter-sort` at 200 ms p95 and
`submissions-first-interactive` at 1 s p95, and R7 makes speed a graded feature. The plan says nothing
about how this is done — a per-row query is 50 round-trips per page on D1.
**Recommendation:** Commit in the plan to one batched shape: fetch the page's answers in a single
`WHERE submission_id IN (…)` query, fetch each form's fields once, then evaluate `isFieldApplicable()` in
memory per row. Also state whether the column is computed only when requested (it is off by default —
`DEFAULT_SUBMISSION_COLUMNS` in `src/lib/submission-columns.ts` excludes `missing`), so the cost is not
paid on the default view.

**[MAJOR] Step 6 — AC-134 is already implemented; the plan proposes to "add" it**
`src/ui/forms/FormsPage.tsx:336` already renders `· When ${conditionSummary(field.condition)}` inside the
builder field-list row, with `conditionSummary` at `:94`. AC-134 ("conditions visible in the builder list
without opening a field") is substantially satisfied by M-12's merged work. Planning to "add the
affordance" invites a rewrite of a shared file that §7 says to add to, never rewrite — and misstates what
this ticket's 1 h buys.
**Recommendation:** Restate step 6 as: verify the existing summary, claim AC-134 with a test that asserts
the summary is present in the list row markup without a field being selected, and make exactly one
substantive improvement — `conditionSummary` prints the raw `fieldKey` (`vendor_content equals Yes`)
where PHILOSOPHY's "the organizer's language" wants the trigger field's **label** ("Does the session
substantially discuss a product or service?" → shortened). Anything beyond that is out of M-36's scope.

**[MAJOR] Step 4 — the built-in-view representation and the endpoint contract are unstated**
`SPEC.md:208` is explicit: "Built-in views are code-defined and immutable, **not rows**", and
`SPEC.md:384` fixes the surface: `GET/POST /views`, `PATCH/DELETE /views/:id`, always event- and
person-scoped, built-ins returned with `built_in: true` and rejecting mutation. The plan says only
"immutable built-ins" and "generated `*.routes.ts` modules". An implementer left to choose could add an
`is_builtin` column and a migration — note the `saved_views` table and
`uq_saved_views_event_person_name` already exist (`migrations/0001_init.sql:399`, `:838`), so **no
migration is required** and adding one would break `scripts/schema-verify.mjs`'s mirror contract with
`src/db/schema.ts`.
**Recommendation:** Write into the plan: no migration; built-ins are a code-defined array merged into the
`GET /views` response with `built_in: true`; PATCH/DELETE on a built-in id returns 4xx; the four endpoints
land in a new `src/routes/views.routes.ts` picked up by the glob manifest (`src/routes/_manifest.ts` — it
is generated by `import.meta.glob`, never hand-edited). Also note that M-63 (AC-268/269, "Decided · not
notified") adds a second built-in later: make the registry a list, not an `if (id === "drafts")`.

**[MAJOR] Step 3 — AC-248's "persists after reload" has no stated mechanism**
AC-248 requires the column choice to change the table immediately, **persist after reload**, and
round-trip through a saved view. Saved-view CRUD covers the round-trip; nothing in the plan covers
persistence of a bare column choice when the user has not saved a view. The submissions surface is a
client-rendered Preact SPA (`src/ui/app.tsx:20`, `SubmissionsPage.tsx` state hooks), so this is a real
choice: URL query param, `localStorage`, or an implicit per-user default view row.
**Recommendation:** Pick one and say so. URL param (`columns=type,title,…`) is the cheapest and composes
with the existing `page/per_page/q/sort/filters` vocabulary the plan already commits to preserving, but it
must survive a reload of a bare `/submissions` — so either it is written into the URL on change, or a
`localStorage` fallback is stated explicitly.

**[MINOR] Step 3 — "Title … immovable" is stricter than the AC**
The plan says Title is "always present and immovable"; AC-248 and `SPEC.md:473` say the chooser
"shows/hides/**reorders** the fixed registry while Title stays mandatory", and the task scope says only
"Title is mandatory" (`src/lib/submission-columns.ts` encodes exactly this as `required: true`). Pinning
Title's position is an extra constraint that a verifier reading the AC could reasonably call a defect.
**Recommendation:** Title cannot be hidden; its position follows the user's chosen order like any other
column. If the implementer wants Title pinned first for craft reasons, say so as a deliberate design
choice rather than as the AC's requirement.

**[MINOR] Step 5 — the authorization disjunction is described abstractly**
"Credential-resolved form-admin/program-staff principal" does not map cleanly onto the codebase's
declarative policy layer: routes declare `policy.auth.kind: "grants"` with a grant from the fixed
`API_GRANTS` enum (`src/api/grants.ts`), and rank comparison happens in
`src/lib/auth/scope-resolution.ts` — but form-admin is a **row** in `form_admins`, not a role or a grant,
so it cannot be expressed declaratively. `src/routes/forms.routes.ts:178-186` is the existing pattern for
this exact disjunction.
**Recommendation:** State it concretely: declare the route at the `program:read` policy layer and enforce
`owner|program_lead|ops` **OR** an explicit `form_admins` row inside the handler, following
`forms.routes.ts:178-186`; reviewer and speaker fall through to 403 with no draft content in the body.

**[MINOR] Step 7 / Verification targets — `e2e:` ACs cannot be verified by Playwright yet**
All four ACs are marked `e2e:` in `EVALUATION.md` (AC-249 is `test + e2e:`), but `tests/e2e/` does not
exist and `scripts/checks/run-e2e.mjs` deliberately stubs out to MRQ-50 until it does. The gate that
actually runs is `npm run pr-gate -- --ticket MRQ-34` → `trace:ac --scope=merged`, which reads AC tags out
of `tests/**` and `tests/ac-claims/MRQ-34.json`.
**Recommendation:** Say which suites carry each AC — integration tests under `tests/integration/api/` for
the views and drafts endpoints, a `tests/node/` DOM-contract test for the column chooser and the builder
summary (following `submission-board.AC-243.test.mjs` / `venue-ui-contract.test.mjs`) — and note that the
e2e specs remain MRQ-50's.

**[MINOR] Whole plan — no file inventory**
The checklist asks which files are created or modified; the plan names only `src/lib/form-conditions.ts`.
With five other worktrees live (mrq-15, mrq-16, mrq-23, mrq-25, mrq-63) and a §7 add-never-rewrite rule
on shared files, an explicit inventory is cheap insurance.
**Recommendation:** List them: new `src/routes/views.routes.ts` (+ `views.queries.ts`), new
`src/ui/submissions/` column-chooser and saved-view-chip components, modified
`src/routes/submissions.queries.ts` (`missing_fields`), `src/routes/submissions.routes.ts` (schema for any
new query params), `src/ui/submissions/SubmissionsPage.tsx` (render the chosen column list rather than
`DEFAULT_SUBMISSION_COLUMNS`), `src/ui/forms/FormsPage.tsx` (summary label polish only),
`tests/ac-claims/MRQ-34.json`. Note explicitly that `src/lib/submission-columns.ts` is complete as merged
and needs no change — all eleven ids exist with `title` already `required: true`, and `SubmissionsPage.tsx`
already has a `Cell` renderer for all eleven.

## 4. Positive Observations

- **The one non-negotiable is correctly identified and repeated.** The plan states, in both the scope
  restatement and step 2, that applicable-missing flows through `isFieldApplicable()` and that a second
  evaluator must not be created. That is the exact failure mode `SPEC.md:175` and BUILDPLAN's B-7 move
  were written to prevent, and the plan holds the line.
- **Good instinct on reuse.** Step 2's commitment to preserve the existing `page/per_page/q/sort/filters`
  vocabulary rather than invent a view-specific query shape is right, and it is what makes saved views a
  thin persistence layer over the merged list contract instead of a parallel one.
- **Authorization is treated as a proof obligation, not a checkbox.** Step 5's "prove unauthorized access
  with both status **and** absence of draft content in the response body" is the correct, stricter test —
  a 403 that still serialized the payload would pass a naive assertion.
- **The read-only invariant is called out explicitly.** "Opening/editing a draft must remain read-only and
  never submit it" appears in both the scope and the verification targets; that invariant is the whole
  reason AC-249 exists and it would have been easy to leave implicit.
- **Verification targets are written per-AC and are falsifiable.** Each of the four targets names an
  observable behavior rather than a component, which is what makes the later AC trace honest.

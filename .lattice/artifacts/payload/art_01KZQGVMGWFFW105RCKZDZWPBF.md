# Plan Review: MRQ-33 (M-32 + M-53)

## 1. Verdict

**FAIL (plan-level)**

Two items must be settled in the plan before code: the board's *exclusive* stage
derivation (the central mechanic of AC-238, where the plan's stated order
contradicts `STATEMAP.md` §2 and leaves three statuses homeless), and the
`tests/ac-claims/MRQ-33.json` `owns`/`exercises` split (AC-240 is already owned
by MRQ-11; claiming it again is a deterministic `duplicate-owner` failure in
`trace:ac`, which `pr-gate` runs). Everything else below is fixable in flight.

## 2. Summary

Reviewed the MRQ-33 plan against `SPEC.md` (Amendments 5–7, 10), `EVALUATION.md`
§2.3, `USER_STORIES.md` (AC-118–120, AC-238, AC-240, AC-243, AC-251),
`STATEMAP.md`, the binding prototype `prototypes/pipeline-v1.1/index.html`, and
the live code in the ticket's worktree (`src/routes/*`, `src/lib/reviewer-scope.ts`,
`scripts/checks/*`). The plan is unusually disciplined on the things that are
normally missed here — AC-243 is treated as authoritative, AC-239 is quarantined,
the single decision writer and the single reviewer-scope helper are explicitly
protected, and the verification section names the real gate (`pr-gate --ticket`).
The gap is at the level of *which rule* the board applies: the plan asserts a
seven-bucket first-match ordering that no upstream artifact contains, and the
one artifact that does define derivation (`STATEMAP.md` §2) produces five
buckets with different membership.

## 3. Issues

**[CRITICAL] Implementation plan §2 — the board's stage derivation contradicts `STATEMAP.md` §2, and three statuses have no column**

The plan says: "derive exactly one stage per non-draft submission in the order
Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published."
That ordering is asserted, not sourced, and it conflicts with the two places
that actually define stage membership:

- `STATEMAP.md` §2 ("Pipeline stage — derived, never stored") is a decision tree
  with five outcomes: published slot → Published; any slot → Scheduled;
  `accepted` → **Onboarding**; `in_review` → In review; else Submitted. Under
  it, an accepted record with no slot is *Onboarding*. Under the plan's order,
  the same record lands in *Accepted* (Accepted precedes Onboarding). "Waved" is
  explicitly "the acceptance batch a record belongs to, **not a status**" — the
  plan's ordering makes it a column with membership rules it never states.
- `submissionStatusPredicate()` in `src/routes/submissions.queries.ts:74` (the
  dashboard's counting authority) is deliberately **non-exclusive**: `waved` is
  `wave_id IS NOT NULL AND status='accepted'`, `onboarding` is an open-task
  predicate, `accepted` is `status='accepted'`. One accepted, waved record with
  open tasks satisfies three of them. A board that assigns it to exactly one
  column will disagree with the dashboard's stage counts for the same seed, on
  two screens one click apart.

Worse, neither rule places `rejected`, `withdrawn`, or `waitlisted` non-draft
submissions. `STATEMAP.md`'s tree falls them through to **Submitted**; the plan's
order does the same. AC-238 requires every non-draft submission to appear
exactly once, so silently rendering rejected records as Submitted cards is the
default outcome of this plan — a visible defect in the ticket's headline AC. The
binding prototype hedges this (`index.html:1796`) by rendering an "actual
status" chip on any card whose status differs from its board stage; the plan
never mentions that control, so the one-to-one reproduction requirement is
missed at the same time.

**Recommendation:** State the derivation as a single named, exported predicate
(e.g. `src/lib/pipeline-stage.ts`, consumed by both the board query and any
future dashboard reconciliation), cite `STATEMAP.md` §2 as its source, and
resolve in the plan — explicitly, with the rule written out — (a) Accepted vs
Onboarding vs Waved membership, (b) where `rejected` / `withdrawn` /
`waitlisted` go (a column, or excluded from the board with the filtered count
saying so), and (c) whether the prototype's differing-status chip ships. If (a)
or (b) requires a contract reading the plan can't make alone, name it as an
orchestrator question rather than picking silently.

**[MAJOR] Implementation plan §5 — `MRQ-33.json` must split `owns` vs `exercises`; AC-240 is already owned**

The plan says the claim file will claim "only this ticket's ACs" without the
ownership distinction. `scripts/checks/trace-ac-core.mjs:77` raises
`duplicate-owner` when two claim files `owns` the same ID, and `pr-gate` runs
`trace:ac --scope=merged`, so this fails the gate outright. Current state on
this branch: `tests/ac-claims/MRQ-11.json` **owns AC-240**; MRQ-9 exercises it;
MRQ-19 exercises AC-243 (owner free). AC-240 is deliberately spread across
M-08/M-10/M-15/M-20/M-32 (`BUILDPLAN.md:324`), so this ticket cannot own it.

**Recommendation:** Pin the file contents in the plan:
`owns: [AC-118, AC-119, AC-120, AC-238, AC-243, AC-251]`,
`exercises: [AC-240]`. Also note the enforced test-title grammar — every
`test()`/`it()` title must match `^(AC-\d+(, |\+)…|CONTRACT) · ` or `trace:ac`
raises `invalid-title-prefix` (`trace-ac-core.mjs:38`).

**[MAJOR] Implementation plan §3 — AC-251 removal semantics and the plan-status gate are unspecified**

Three concrete holes in the assignment CRUD branch:

1. **Remove-with-evidence.** `DELETE` of a `round_assignments` row whose reviewer
   has already written an `evaluations` row is undefined here. The existing
   evaluation write flips the assignment to `status='complete'`
   (`evaluation.routes.ts:857`), and `authorizeReviewerScope` treats
   `('assigned','complete')` as authorization — so deleting a completed
   assignment silently revokes a reviewer's access to a record they already
   scored, while the score remains attached. That needs a stated rule (reject
   with 409 / soft-remove / allow and keep the evaluation) before it is coded.
2. **Plan status.** The existing distribute route refuses when
   `plan.status !== 'open'` (`evaluation.routes.ts:645`). The plan doesn't say
   whether single assign/remove inherits that gate. Silently not inheriting it
   creates two different rules on one path.
3. **Schema shape.** `assignmentsInput` requires `committee_id` and `mode`
   (`evaluation.routes.ts:57`). "A direct create branch" on the same POST means
   relaxing those, which weakens validation for the distribution path unless the
   body is a discriminated union. Note the existing insert writes
   `committee_id` as literal `NULL`, so a direct assignment cannot lean on
   committee membership for later authorization — the reviewer must be matched by
   `reviewer_person_id`, and `reviewer_track_scopes` is keyed
   `(event_id, person_id, track_id)`, not by committee.

**Recommendation:** Add a short contract paragraph: discriminated body
(`mode: 'direct'` vs the existing modes), the plan-status rule, the
delete-with-evaluation rule, and the exact "coverage count" definition
(assigned vs complete per round) the panel renders.

**[MINOR] Whole plan — no file inventory**

The plan lists artifacts to *read* but never names a file it will create or
modify. For a 9 h merged ticket spanning three API modules and three UI pages,
that removes the cheapest collision check available — and the ticket asserts
"Shared files: none — module-local", which at least two steps appear to
violate (see the next two issues).

**Recommendation:** Add a create/modify list, and flag any file outside
`src/routes/<new>.routes.ts`, `src/ui/board/*`, `src/ui/submissions/record*`.

**[MINOR] Implementation plan §4/§5 — AC-120's "in lists" surface belongs to M-08's file**

AC-120 ("admin-created records are visually distinguishable from public
submissions **in lists**") is owned by this ticket, but the list surface already
exists and belongs to M-08: `SubmissionsPage.tsx:103` renders
`{item.id} · {item.origin}` (raw lowercase enum) and `submission-columns.ts`
carries an optional `origin` column. The plan's step 4 doesn't touch the list,
and step 5 only says the test covers an "admin origin marker".

**Recommendation:** State the finding — either the existing M-08 rendering is
deemed to satisfy AC-120 (then the test asserts against it and no list file is
touched), or it needs a proper chip (then `src/ui/submissions/*` is a
shared-file touch and should be declared). Don't leave it to be discovered
mid-implementation.

**[MINOR] Verification — `check:api` and the speed budget id are both missing**

`EVALUATION.md:590` conditions AC-251 on "`/rounds/:id/assignments` CRUD appears
in `check:api` registry parity", and `pr-gate.mjs` does **not** run `check:api`
(its checks are: three `tsc` projects, `vite build`, `check:design`, `npm test`,
`trace:ac`). So the plan's verification list never exercises the thing AC-251
names. Separately, the ticket requires the board to be measured against "the
full-seed objective budget", but `scripts/checks/speed-budgets.mjs` has no
program-board entry — and `tests/unit/speed-budgets.test.ts:10` hard-asserts
"seven acceptance and seven objective" budgets, so adding one breaks a CONTRACT
test in a shared file.

**Recommendation:** Add `npm run check:api` to the pre-commit list, and name
which budget id the board reports under — reuse `admin-route-transition` /
`submissions-first-interactive`, or declare the `speed-budgets.mjs` +
contract-test edit as an intentional shared-file change.

**[MINOR] Implementation plan §4 — `/submissions/new` collides with `/submissions/:id` once a query string is present**

`matchRoute` (`route-table.ts`) tries an exact `path === pathname+search` match
first, then falls back to pattern order — and `submission-detail`
(`/submissions/:id`) is listed *before* `submission-new`. `/submissions/new`
resolves correctly; `/submissions/new?kind=session` (or any query the create
page might carry) resolves to the record page with `id === "new"`.

**Recommendation:** Either guarantee the create route is never navigated with a
query string, or reorder the table / guard the record page against the literal
`new` id, and cover it in `tests/unit/route-table.test.ts`.

**[MINOR] Implementation plan §1 — "the smallest record-owned mutation routes … where the existing agenda model supports it" is an unbounded hedge**

AC-240 requires a *publish affordance* on scheduled-but-unpublished records, and
AC-243 requires the record to own review/wave/accept/onboarding/placement/publish
with the existing confirmation-cascade preview. "Where the existing agenda model
supports it" reserves the right to ship none of it. The agenda/publish surface
(M-19a/M-20) is not in this ticket.

**Recommendation:** Enumerate the record actions this ticket ships and which
existing writer each one calls (`writeSubmissionDecision`, the bulk transition
path, `agenda_items.is_published`), and name explicitly anything deferred to the
agenda ticket so the gap is a decision rather than a discovery.

**[MINOR] Implementation plan §5 — virtualization vs. the "exactly once" assertion**

AC-238's row in `EVALUATION.md:577` reads "board contains every non-draft
submission exactly once in its derived lifecycle stage" while the ticket mandates
windowed rendering. The plan correctly refuses to inflate the DOM but never says
what the assertion runs against.

**Recommendation:** State it — assert exactly-once over the board API payload
(and per-column counts in the DOM), with the DOM assertion limited to the
rendered window.

## 4. Positive Observations

- **The struck-AC discipline is exactly right.** AC-239 is named as forbidden in
  code, tests, claims *and* review text, and AC-243 is stated as authoritative
  rather than reconciled against the older drag language. This is the failure
  mode the ticket was minted to prevent, and the plan front-loads it.
- **Single-writer instincts are correct and specific.** Naming
  `writeSubmissionDecision`/`insertDecisions` and the centralized reviewer-scope
  helper as things not to duplicate matches the codebase's actual design
  (`reviewer-scope.ts` is deliberately the one authorization path, AC-246), and
  the non-goals section makes it enforceable.
- **The AC-251 negative assertion is well specified.** "Assert response status
  *and* unchanged assignment-row count" is the right shape for a rejection test —
  status alone would pass against a route that rejects after inserting.
- **Verification names the real gate** (`pr-gate -- --ticket MRQ-33`) and refuses
  the tempting shortcut of replacing virtualization with a large DOM to make a
  test easier. Both are signs of a plan written against this repo rather than a
  generic one.

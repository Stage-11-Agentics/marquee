# Plan Review: MRQ-97 — accepted fact filter and categorized status control

## 1. Verdict

**PASS** — with four issues the implementer must fold in during the pass (two major, two minor).
The approach is sound, the non-negotiable is met, and the MRQ-76 invariant is respected. The gaps
are missed consumers and one explicitly-chosen-but-wrong freeze, all additive to the existing plan
rather than requiring a different architecture.

## 2. Summary

Reviewed the plan against the live tree (`src/routes/submissions.queries.ts`,
`dashboard.routes.ts`, `landing.route.tsx`, `src/api/board.ts`, `src/api/submissions.ts`,
`src/ui/shell/route-table.ts`, `src/ui/submissions/SubmissionsPage.tsx`, `src/lib/saved-views.ts`,
`src/jobs/mail/audience.ts`, and `tests/unit/submission-stage-predicate.MRQ-76.test.ts`).
The chosen shape — an additive `accepted_any` filter carrying the stored fact (`s.status =
'accepted'`), the transient bucket relabelled, and the dropdown grouped into optgroups — is the
right call for the remaining time: it leaves the shared stage projection untouched, so every
MRQ-76 consumer keeps counting the same set. The plan also caught two non-obvious hazards on its
own (the stored-semantics path binding the raw filter value, and the response-item enum being the
same `z.enum(SUBMISSION_STATUS_FILTERS)` as the filter enum), which is genuinely good auditing.

The key concern is that the plan's consumer audit is incomplete and its one freeze decision is
wrong: the dashboard keeps a tile literally labelled **"Accepted"** counting the transient stage,
which is the operator's *second* complaint ("it looks like we have no accepted statuses") left
untouched on the most-visited screen in the product.

## 3. Issues

```
**[MAJOR] Approach step 3 (dashboard) — the dashboard keeps a tile labelled "Accepted" that counts the transient stage**
`PIPELINE_META.accepted` (`src/routes/dashboard.routes.ts:64`) renders `label: "Accepted"`,
`note: "Decision confirmed"`, counted by `submissionStatusPredicate("accepted", …)`
(`dashboard.routes.ts:81`) and linked to `submissionsHref({ status: "accepted" })`
(`dashboard.routes.ts:187`). The plan relabels the *sidebar* and the *dropdown* entry to
"Ready to place" but deliberately leaves the dashboard tile alone ("Keep dashboard pipeline
accepted counts and their `status=accepted` href paired"). Two consequences: (a) the operator
still sees "Accepted — 3 — Decision confirmed" on the dashboard while 150 talks are accepted,
which is the exact second observation the ticket quotes; (b) clicking that tile lands on the
submissions list where the very same filter is now labelled "Ready to place" — the tile and its
destination disagree on the word, even though they agree on the row set. Pairing the count to the
href is necessary but not sufficient; MRQ-76's guarantee is about the *set*, and nothing stops the
label from being corrected.
**Recommendation:** Rename `PIPELINE_META.accepted.label` to the same words the dropdown and
sidebar use ("Ready to place"), keeping the predicate and href exactly as they are. If the plan
instead wants the tile to mean the fact, it must move count *and* href together — but the
stage-labelled version is the smaller, safer change and keeps the seed check
(`scripts/checks/seed.ts:173-176`, which asserts the list `status=accepted` total equals the
dashboard `accepted` stage count) green. Either way, state the decision in the PR.
```

```
**[MAJOR] Approach step 3 — the "Unscheduled" tile is frozen on a predicate that undercounts it**
`unplaced` (`dashboard.routes.ts:230-236`) is labelled "Unscheduled", noted "accepted sessions",
counted with `submissionStatusPredicate("accepted", …)`, href
`submissionsHref({ status: "accepted", placement: "unplaced" })`. Because the stage predicate
already excludes waved and onboarding records, this tile silently omits every accepted session
that has a pending wave or an open speaker task — i.e. most of them, right after an acceptance
run. It is the same defect the ticket is about, wearing a number instead of a dropdown, and the
plan explicitly decides to keep it that way ("keep the unplaced tile on the same stage
predicate").
**Recommendation:** Point both the count and the href at `accepted_any` together
(`submissionStatusPredicate("accepted_any")` + `submissionsHref({ status: "accepted_any",
placement: "unplaced" })`). Count and destination stay paired, so MRQ-76 holds, and the number
becomes the honest "accepted sessions not yet on the agenda". Note that `placement=unplaced`
is currently redundant (the stage predicate carries `ai.id IS NULL`); under `accepted_any` it
becomes load-bearing, so it must stay in the href. If the implementer disagrees, the PR must say
why the tile is allowed to keep undercounting.
```

```
**[MINOR] Approach step 3 — `landing.route.tsx` is an unlisted consumer of the vocabulary**
The plan promises to "audit and update every app entry point" and then enumerates dashboard,
sidebar, board, agenda and onboarding empty states. It misses
`src/routes/landing.route.tsx:60-85`, which calls `submissionStatusPredicate` directly for
`accepted_count` and renders it to the public landing page — the surface a hackathon judge sees
first. It is stage-labelled "Accepted" there too.
**Recommendation:** Add `landing.route.tsx` to the consumer list and make a deliberate call:
either keep the stage count and requalify the copy, or move the landing figure to the fact. Also
worth a line: `src/ui/comms/CommsScreen.tsx:364` hardcodes its own status `<select>` whose
"Accepted" already means the stored fact (comms resolves through
`selectSubmissionIds(..., { statusSemantics: "stored" })`, `src/jobs/mail/audience.ts:140`). After
this change the product will call the same concept "Accepted" in comms and "Accepted (any stage)"
in submissions. Leaving comms alone is defensible; leaving it unmentioned is not.
```

```
**[MINOR] Approach steps 3 and 6 — a known-failing test and a prototype divergence are unbudgeted**
Two concrete consequences of the sidebar relabel are unstated: `tests/unit/route-table.test.ts:7`
asserts the exact nav label list including `"Accepted"` and will fail; and the binding prototype
(`prototypes/pipeline-v1.1/index.html:1508`, `pipelineNavItem("Accepted","4","Accepted")`, plus
its dashboard stage `{name:"Accepted",hint:"Decision confirmed"}` at line 1785) names that item
"Accepted", while `DESIGN.md` binds the build to reproduce the prototype one-to-one. The plan also
never names the files it will create or the test file it will add.
**Recommendation:** Update `tests/unit/route-table.test.ts` as part of the change, and call the
prototype divergence out explicitly in the PR as a deliberate correction of the prototype rather
than a drift from it (the prototype's own filter list has the same category confusion this ticket
is fixing). Name the new test file up front, following the repo convention
(`tests/integration/api/accepted-fact-filter.MRQ-97.test.ts` or similar), and keep it lean — the
suite budget is 45s and the plan's five-stage lifecycle assertion is the most expensive thing here.
```

```
**[MINOR] Approach step 2 — `accepted_any` becomes a persisted, hard-to-rename token**
`SavedViewFilters` is `Omit<SubmissionFilter, "eventId" | "q">` (`src/lib/saved-views.ts:8`), so
the new value will be written into user saved-view rows and shared URLs. If a later ticket does
the full status/stage split the ticket's first option describes, `accepted_any` is the token that
has to be migrated or kept forever as an alias.
**Recommendation:** No change to the approach — just add a one-line comment next to the enum
entry recording that `accepted_any` is the stored fact and is persisted in saved views, so the
next person knows it is not free to rename. (No built-in saved view uses `status: accepted` today
— `BUILT_IN_SAVED_VIEWS` covers all-submissions, drafts-needing-attention, and
decided-not-notified — so the plan's "existing saved views with `status=accepted` intact" claim is
about user-created views only. Worth correcting so nobody hunts for a built-in that isn't there.)
```

## 4. Positive Observations

- **The judgment call is the right one and is argued, not asserted.** Choosing the additive fact
  filter over a full status/stage split preserves `submissionStatusPredicate` as the single shared
  projection that MRQ-76 established, which is what keeps dashboard, board, landing, and list from
  drifting. On a deadline day, the smaller change with the intact invariant is correct.
- **Two real footguns were found by reading the code, not by guessing.** `filterParts`'s stored
  branch pushes the raw filter value into `s.status = ?` (`submissions.queries.ts:219-221`), so an
  unmapped `accepted_any` would have returned zero rows for comms audiences and filter-selector
  bulk actions — silently. And `submissionStatusSchema` is genuinely reused as the response item's
  `status` enum (`submissions.routes.ts:13,48`), so widening the filter list would have advertised
  a status the API never returns. Both are called out with the right fix.
- **The regression test is specified at the level the defect actually lives.** Driving the real
  accept action against a seeded event whose task template has `auto_assign`, then asserting the
  fact filter holds across wave-pending → onboarding → scheduled → published, is exactly the shape
  that would have caught this and that a predicate unit test would not. Asserting the *stage*
  moves while the *fact* holds is the sharpest possible statement of the invariant.
- **Scope discipline is explicit and correct.** The MRQ-98 boundary (search, skeleton, saved-view
  strip, toolbar layout) is restated in the plan's own words, the worktree is named, and the
  new-class-not-new-layout approach to the select styling is the right way to touch a shared
  toolbar without colliding.
- **The rebase-and-regate step before opening the PR** anticipates the concurrent MRQ-98 edits to
  the same page rather than discovering the conflict at merge time.

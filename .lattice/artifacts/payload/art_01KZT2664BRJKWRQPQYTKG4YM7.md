# Plan Review: MRQ-97 — accepted fact filter and categorized status control

### 1. Verdict

**FAIL (plan-level)**

Two gaps are load-bearing: the plan's consumer map misses the app's own "Accepted"
entry points (sidebar nav, agenda and onboarding empty states, dashboard tile), so
the ticket's non-negotiable outcome would still fail on the most prominent path; and
adding a value to `SUBMISSION_STATUS_FILTERS` silently breaks the *stored*-semantics
arm that comms audience selection uses. Both are cheap to fold into the plan — this
is a revision, not a redesign.

### 2. Summary

Reviewed the MRQ-97 plan against `src/routes/submissions.queries.ts`, the shared
`submissionFilterSchema` consumers, and the UI surfaces that link to
`?status=accepted`. The judgment call (option B — add an explicit fact filter rather
than split status from stage) is well reasoned and correctly protects MRQ-76's shared
projection. The key concern is that the plan treats "consumers" as *predicate*
consumers only; the ones that actually carry the operator's complaint are *href*
consumers, and the plan never names them.

### 3. Issues

**[CRITICAL] Approach §1–2 / Contract — The app's own "Accepted" entry points still point at the transient stage**

The ticket's non-negotiable is *"after an organizer accepts a submission, filtering
for accepted talks finds it."* The plan satisfies that only for an organizer who
opens the status dropdown and picks the new "Accepted (any stage)" entry. Every
built-in path to accepted talks still resolves to the transient stage:

- `src/ui/shell/route-table.ts:19` — sidebar item **"Accepted"** → `/submissions?status=accepted`. This is the primary route, not the dropdown.
- `src/ui/agenda/AgendaPage.tsx:638` — empty-state button *"Open accepted submissions"* → `?status=accepted`.
- `src/ui/onboarding/OnboardingPage.tsx:255` — *"Open accepted speakers"* → `?status=accepted`.
- `src/routes/dashboard.routes.ts:193` (pipeline tile `accepted`, labelled *"Accepted / Decision confirmed"*) and `:239` (unplaced-accepted tile).

Accept a talk on the live site, click sidebar "Accepted" — under this plan it is
still empty. The operator's report is reproduced verbatim.

Note that the sidebar is a *numbered pipeline* (1 Submitted → 7 Published), so
repointing item 4 blindly is wrong too — it would put a scheduled talk under step 4.
This is a decision the plan must make and state, not skip.

**Recommendation:** Add a step that enumerates these five call sites and states, for
each, whether it keeps the stage or moves to the fact — with a reason. A defensible
resolution: relabel sidebar item 4 to name the stage it actually is (it sits inside a
numbered pipeline, so the stage reading is legitimate once labelled), and repoint the
agenda/onboarding empty-state buttons — which mean "talks I accepted" in the
organizer's words — to the fact filter. Whatever is chosen, say it in the PR.

**[MAJOR] Approach §2 — `href` and its count must move in lockstep or MRQ-76 breaks**

If any dashboard href is repointed (`dashboard.routes.ts:193`, `:239`), the matching
count SQL (`:80` via `DASHBOARD_STAGE_IDS`, `:165`) must change with it. A tile that
counts the stage and links to the fact is exactly the divergence MRQ-76 was written to
prevent, and `dashboard.routes.ts:80` derives its columns from `DASHBOARD_STAGE_IDS`,
so a new filter value is *not* automatically a new tile.

**Recommendation:** State the rule explicitly in the plan ("no href change without its
count") and add a test asserting tile count equals the destination list total for the
accepted tile specifically.

**[MAJOR] Approach §2 — `accepted_any` silently matches nothing under stored semantics**

`SUBMISSION_STATUS_FILTERS` feeds `submissionFilterSchema`, which is shared by the
list, saved views (`views.routes.ts:21`), bulk selection
(`submissions-bulk.routes.ts:24`), evaluation promotion (`evaluation.routes.ts:77`),
and comms audience (`comms.routes.ts:119`). Comms resolves through
`selectSubmissionIds(..., { statusSemantics: "stored" })`
(`src/jobs/mail/audience.ts:140`), and that arm does `clauses.push("s.status = ?")`
with the raw filter value (`submissions.queries.ts:219-221`). A request carrying
`status=accepted_any` there binds a literal no row holds → **empty audience, no
error**. The derived arm has the same shape: `submissionStatusPredicate` falls through
to `` `${submission}.status = '${status}'` `` (`:136`), so a missing branch is a silent
empty result, not a type error.

**Recommendation:** Plan two explicit branches — in `submissionStatusPredicate`, and a
normalization in the stored arm mapping `accepted_any → 'accepted'` (under stored
semantics the two are the same fact). Add a unit test that every member of
`SUBMISSION_STATUS_FILTERS` produces a predicate under both semantics, so the next
addition can't reintroduce this.

**[MAJOR] Approach §4 — "API boundary" coverage may not exercise the cascade that caused the bug**

The defect exists because *accepting* triggers a pending wave or `auto_assign` speaker
tasks. A test that inserts a row with `status='accepted'` and then queries the filter
passes even against today's broken code path in some configurations. The ticket asks
for accept-then-filter **end to end**.

**Recommendation:** Specify that the test drives the real accept action (the decision /
bulk-accept route) against a seeded event whose templates carry `auto_assign`
(`scripts/seed/event.ts:339-360`), then asserts the fact filter returns the record —
and asserts it again after wave send, task completion, scheduling, and publishing.
Assert the *derived* stage moves while the fact filter holds; that is the invariant
worth locking.

**[MAJOR] Approach §2 — the list-item response enum widens with a value the API never returns**

`submissions.routes.ts:13` does `z.enum(SUBMISSION_STATUS_FILTERS)` and reuses it as
the *item* `status` field (`submissionListItemSchema`). Adding `accepted_any` publishes
a status value in the OpenAPI contract that `toItem` (`submissions.queries.ts:341-346`)
can never produce, and it drifts from `SubmissionListStatus` in `src/api/submissions.ts:1`.

**Recommendation:** Split the two enums — a filter enum and an item-status enum — in
the same change. Small, and it removes the trap for the next filter that isn't a status.

**[MINOR] Judgment call — "labeled as a pipeline-stage option" is under-specified**

Two adjacent entries reading "Accepted (any stage)" and "Accepted" is the same
ambiguity in a smaller font, and the dashboard tile still says *"Accepted / Decision
confirmed"* for the transient stage.

**Recommendation:** Commit to concrete labels in the plan (e.g. the fact reads
"Accepted" and the stage reads something that names the stage — "Accepted · awaiting
onboarding" or similar under a *Pipeline stage* heading), and order the fact entry
above the stage. Per `PHILOSOPHY.md`, the organizer's word "Accepted" should belong to
the fact, and the stage should carry the qualifier.

**[MINOR] Contract and scope — no rebase strategy against MRQ-98**

The status `<select>` lives inside the toolbar MRQ-98 is restyling, and both tickets
touch `SubmissionsPage.tsx` and `submissions.css`. The ownership boundary is stated;
the merge mechanics are not.

**Recommendation:** Add a step to rebase on `main` before opening the PR and re-run
the local browser check afterward, and prefer a new CSS class over editing shared
toolbar rules.

**[MINOR] Approach §4 — saved views holding the old value**

Saved views persist `filters.status` in `config_json`. Any existing view saved with
`status=accepted` keeps stage semantics after this change (correct, but silent), and
the `count` shown on the saved-view strip is computed from that config.

**Recommendation:** One line in the plan confirming existing saved views are
intentionally untouched, and say so in the PR under "no status silently dropped."

### 4. Positive Observations

- **The judgment call is the right one and is argued, not asserted.** Preserving
  `submissionStatusPredicate` as the single shared projection is exactly what protects
  MRQ-76's guarantee; inventing a parallel derivation to satisfy this ticket would have
  been the tempting mistake.
- **Additive vocabulary.** Adding the fact rather than redefining `accepted` means no
  existing surface silently changes meaning — the plan can be reviewed by reading what
  it adds.
- **Correct read of the failure mode.** The plan names the exact stage sequence
  (fresh → wave-pending → onboarding → scheduled → published) the filter must survive,
  which is the ticket's real acceptance test.
- **Scope discipline.** The MRQ-98 boundary is restated in the plan's own words and the
  worktree is named up front; deployment is explicitly deferred, matching `DEPLOY.md`.
- **Checkpoints are declared,** so the status trail will be legible to the orchestrator
  without prompting.

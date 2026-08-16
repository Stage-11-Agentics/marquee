# MRQ-229 durable build plan

## Status and boundary

This is the plan-only head for MRQ-229, owned by `agent:delegator-mrq-229` in
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-229-routing-rules`.
The implementation is held until the Adoption Orchestrator returns a fresh,
non-author plan-review PASS. No subagents or reviewer are launched from this
ticket; the orchestrator owns the single reviewer slot.

This turn must not edit implementation or contract artifacts, run browser or
live-system writes, deploy, merge, publish, or run the full `pr-gate`. A future
full gate requires a slot from `merge-captain` before it is started. Stable
US/AC identifiers are not minted here; ordered consolidation owns that fold.

## Binding inputs

- Lattice task: MRQ-229, `task_01M03NS9T3Z9P11W5HAPGW7M2M`.
- Binding prototype: `prototypes/pipeline-v1.1/index.html` at commit
  `390d52dc` (v1.17). The implementation reproduces the signed surface
  one-to-one. Any necessary divergence gets an explicit SPEC marker during the
  later consolidation fold; it is never an implementation-only judgment.
- The signed design decision requires: an ordered rule list with readable prose
  summaries; tangible first-match-wins ordering and reorder arrows; fixed-width
  On/Off controls; an inline editor; 1–5 conditions; the six shared operators;
  set-track, add-tag, set-level, and route-to-review actions; live would-have-
  matched/landing feedback; soft-disable with a reason and Fix rule; and an
  explicit skip-not-evaluate state when a condition names a question the
  current form does not ask.
- Scope: answer-aware routing, event-scoped tags and levels, track plus
  `submission_tracks` consistency, apply-once arrival behavior, soft-disable and
  Fix-rule behavior, and the signed builder panel.
- Deliberate non-goals: Sessionize import remains unrouted; org/person tags
  (`person_events` tag data) remain distinct and untouched; later manual edits
  are never re-routed; `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`,
  `USER_STORIES.md`, and `DESIGN.md` are not edited in this stage.

## Existing seams to preserve

- `src/routes/public-form-routing.ts` is the server routing seam. It currently
  resolves legacy domain references and ordered enabled rules, so widening it
  must preserve existing review-pool routing and legacy JSON compatibility.
- `src/lib/form-conditions.ts` is the shared, dependency-free condition seam.
  Extend/export its canonical evaluator for routing rather than creating a
  second operator vocabulary or a second evaluator.
- `src/routes/public-form.routes.ts` already projects form answers before
  routing. Public submission is the only new routing hook; Sessionize import and
  caller-asserted admin creation remain outside it.
- `src/routes/forms.routes.ts`, `src/routes/forms.queries.ts`, and
  `src/ui/forms/FormsPage.tsx` own form-builder API/data/UI. Step 4 is currently
  a hardcoded placeholder and is the signed panel's seat. Keep the existing
  live-preview column, fixed geometry, and Flight Deck states.
- `src/routes/event-settings.routes.ts` and `src/ui/settings/EventSettings.tsx`
  are the existing event-scoped formats/tracks taxonomy seam. Add the new
  event-level taxonomy beside it, not to the organization/person tag system.
- `src/routes/submission-record.routes.ts` and
  `src/ui/submissions/SubmissionRecordPage.tsx` own the organizer record view;
  `src/lib/reviewer-scope.ts` reads `submission_tracks`, so the routed track
  must be visible through that join as well as through
  `submissions.primary_track_id`.
- Existing reset/demo, event-copy, event-delete, DB schema types, OpenAPI route
  registration, and seed fixtures must remain coherent with any new tables and
  columns.

## Implementation plan after plan-review PASS

### 1. Reconcile base and schema before coding

1. Fetch `github/main`, confirm the branch base, and reread the current routing,
   form-condition, taxonomy, submission, and reviewer-scope seams at the exact
   implementation head.
2. Only at implementation start, inspect `migrations/` and record the next
   free migration number. Create one sequential migration for the event-scoped
   routing taxonomy and submission projections, without guessing from an older
   run-state note. Repeat the next-free check after every rebase and before
   pushing the final implementation head.
3. Add event-owned tags and levels using the repository's tracks-shaped
   ownership/position conventions; add the submission tag join and the
   submission level projection with event-safe foreign-key/index constraints.
   Preserve the existing one-primary-track invariant. Choose and test the
   deletion behavior so a rule that is invalidated by a later field, track, tag,
   or level deletion remains inspectable as a dangling rule rather than being
   silently rewritten. Keep applied submission history and event teardown,
   copy, reset, and seed behavior internally consistent.
4. Extend typed DB rows and fixtures only as part of implementation. Do not
   mint stable story or acceptance IDs in source or tests.

### 2. Build one answer-aware routing evaluator

1. Extend `src/lib/form-conditions.ts` so routing consumes the same canonical
   six operators used by form conditions (`equals`, `not_equals`, `contains`,
   `not_contains`, `answered`, `not_answered`, with the prototype's labels and
   existing aliases mapped deliberately). `contains` must work for scalar and
   multi-select values. Preserve old routing condition encodings while
   normalizing them into the shared representation.
2. Make the routing evaluator receive the arriving form's known field keys and
   projected answers. A clause whose field exists in the event but is not asked
   by this form returns a distinct `skipped` result for the rule, never a false
   answer. This is essential for `not_equals`/`not_answered`: an absent field
   cannot accidentally match and shadow all later rules.
3. Evaluate 1–5 clauses per rule with AND semantics, in stored position/id
   order, considering only enabled and non-dangling rules. Return the matched
   rule plus a typed action set; preserve the existing review-pool target
   resolution and rejection of closed or out-of-scope targets.
4. Normalize actions to the four signed concepts: set track, add one or more
   event tags, set event level, and route to review. Validate every referenced
   track/tag/level/plan/committee/round against the event before accepting a
   fresh rule. A missing reference discovered after a later delete is a
   readable dangling/soft-disabled state with the exact reason, not a silently
   false rule.

### 3. Add routing-rule API and taxonomy APIs

1. Add event-scoped CRUD/list/reorder/toggle endpoints for routing rules using
   the existing `defineApiRoute`, Zod, OpenAPI, event authorization, rate-limit,
   and position-normalization patterns. Responses must include the readable
   summary inputs, order, enabled state, action targets, and dangling reasons
   needed by the builder; fresh writes reject dangling references.
2. Add event-scoped tag and level list/create/update/delete/reorder APIs beside
   the existing settings routes, with the same ownership and authorization
   boundaries. Return stable option data to the builder, submission record, and
   any event settings surface that paints the taxonomy.
3. Make toggle refuse a dangling rule with the signed Fix-rule instruction.
   Fixing a reference through the inline editor must clear the warning and
   re-enable the rule only after a valid save. A rule that is valid globally but
   names a field absent from one particular form remains enabled and reports
   skip-not-evaluate for that form.
4. Ensure event isolation: a valid ID from another conference is rejected on
   create/update/action resolution, and readers cannot infer another event's
   taxonomy or rules. Keep route manifests/OpenAPI output and API tests in
   lockstep.

### 4. Apply the matched result exactly once at public arrival

1. Pass projected answers and the arriving form schema from
   `public-form.routes.ts` into the shared routing evaluator. Preserve the
   existing public-submit response/error behavior and legacy review routing.
2. Apply the matched action in the same atomic submission write path as the
   submission and answer rows. A set-track action must write
   `submissions.primary_track_id` and the corresponding `submission_tracks`
   membership together, with one unambiguous primary row visible to
   `reviewer-scope`. Define the treatment of any submitter-supplied secondary
   tracks explicitly at implementation time and cover it; no route may leave
   the scalar and join disagreeing.
3. Persist add-tag and set-level results through their event-scoped submission
   projections, and preserve `applied_rule_id`. Routing must work for a
   track/tag/level-only action even when there is no review-pool target; the
   current committee-only staging guard cannot drop those actions.
4. Extend the routed audit payload and record/timeline composition with the
   applied rule and resulting track/tag/level set. Keep manual edits independent:
   a later record edit must not re-run the rule, change `applied_rule_id`, or
   fight an organizer's track/tag/level choice. Admin API creation keeps its
   caller-asserted applied-rule semantics, and Sessionize import never invokes
   this evaluator or overwrites its asserted track provenance.
5. Use the existing stage/rollback or transaction boundary so a failed target,
   taxonomy write, join write, or audit write cannot leave a partially routed
   submission. Add a positive reviewer-queue assertion against
   `submission_tracks`, not only `primary_track_id`.

### 5. Reproduce prototype v1.17 in the builder

1. Replace the Step 4 placeholder in `FormsPage.tsx` with the signed ordered
   rule panel. Rules apply to every form on the conference, so state that
   scope honestly while showing when a rule's condition is not carried by the
   current form.
2. Match the prototype's interaction contract: summaries are readable without
   opening a rule; order is visible and changed only by up/down controls; the
   first-match-wins/order-is-meaning copy is present; On/Off has fixed geometry;
   editing is inline, never a modal; conditions are capped at 1–5; and the six
   operator labels/value controls match the shared evaluator.
3. Render the four action controls and event-owned options. Render dangling
   rules on the warning background with the reason and “disabled for you, not
   deleted”; refuse their toggle; make Fix rule open the inline editor with the
   dangling condition outlined; and clear the warning only after repair.
4. Build the live preview from the same pure evaluator representation as the
   server. Show the prototype's honest states: skipped rule when the form does
   not ask a referenced question, “of the last 100 arrivals, N would have
   matched” and “K rules above run first” for a usable rule, and the exact
   landing/no-match sentence. Do not invent a second client-only matching
   behavior.
5. Extend the existing event settings and submission record surfaces only where
   the prototype paints event tags/level/routed track. Keep organization/person
   tags visibly separate. Keep fixed widths, reserved error space, hairlines,
   contrast, and no-decorative-motion rules from `DESIGN.md`; no silent visual
   divergence is acceptable.

### 6. Verification set

Before requesting review, run targeted checks and record their exact results:

- Unit tests for all six operators, scalar/multi-select `contains`, aliases,
  malformed conditions, 1–5 limits, dangling references, and the distinction
  between skipped fields and blank answers. Include a shadow regression where
  `not_equals` or `not_answered` on a field absent from the form cannot match.
- Routing integration tests for first-match order, answer-based matches, all
  four action types, event authorization, closed/out-of-scope review targets,
  and atomic `primary_track_id` plus `submission_tracks` state.
- Public-submit tests for track/tag/level-only routing, audit/record provenance,
  one-time application followed by manual edits, and the unchanged unrouted
  Sessionize import path. Include the reviewer-scope positive control.
- Soft-disable/Fix-rule tests for a deleted question and deleted taxonomy
  reference: warning/reason on read, toggle refusal, fresh invalid write
  rejection, outlined repair, and re-enabled valid rule. Test a valid rule on a
  different form that skips rather than evaluates a missing question.
- API/OpenAPI and authorization tests for taxonomy/rule CRUD, reorder, toggle,
  and event isolation; update reset/demo/copy/delete fixtures and tests.
- UI/static and Playwright coverage for builder load/save, inline edit, add and
  remove condition, order changes, toggle refusal, Fix rule, preview parity,
  and the record's routed track/tag/level/rule presentation. Browser validation
  remains held in this plan-only stage and requires the approved validation
  scope at implementation time.
- After any rebase, re-check the next free migration number, rerun relevant
  targeted tests, then request a gate slot from `merge-captain` before any full
  `npm run pr-gate`. Do not merge, deploy, or publish from this ticket.

## Handoff produced after implementation

The implementation handoff must contain a pushed branch/PR-ready head, the
exact migration-number checks before and after rebase, targeted test evidence,
and explicit notes for the Adoption Orchestrator about any prototype/spec
marker. The branch remains held for the orchestrator's non-author review and
subsequent lifecycle decisions; this plan-only head stops before all of that.

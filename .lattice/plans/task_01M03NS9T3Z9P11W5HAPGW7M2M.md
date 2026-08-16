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
   ownership/position conventions; add `submission_tags`, `submissions.level_id`,
   normalized-name keys, and the nullable tombstone columns described in the
   amendment below. Preserve one primary track and applied history. The
   amendment's soft-delete, collision, copy, reset, seed, and teardown policies
   are binding implementation requirements, not choices to rediscover later.
4. Extend typed DB rows and fixtures only as part of implementation. Do not
   mint stable story or acceptance IDs in source or tests.

### 2. Build one answer-aware routing evaluator

1. Extend `src/lib/form-conditions.ts` so routing consumes the same canonical
   six operators used by form conditions (`equals`, `not_equals`, `contains`,
   `not_contains`, `answered`, `not_answered`, with the prototype's labels and
   existing aliases mapped deliberately). The exact blank/missing/scalar/
   multiselect truth table and the removal of the old local routing evaluator
   are binding below; there is one evaluator, not two.
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
2. Apply the matched action in the single atomic public-arrival batch defined
   below. A set-track action replaces the submitter's track membership with one
   routed primary row, writing `submissions.primary_track_id` and
   `submission_tracks` together; no route may leave the scalar and join
   disagreeing. The chosen secondary-track precedence and deduplication policy
   are binding below.
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
5. Replace the committee-only staging path with the concrete preflight plus
   one-D1-batch boundary below. It covers action-only routes as well as review
   routes, preserves idempotent retries, and includes the routed audit row.
   Add a positive reviewer-queue assertion against `submission_tracks`, not only
   `primary_track_id`.

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
   server and load the bounded historical aggregate from the explicit
   `GET .../routing-preview` contract below. Show the prototype's honest states:
   skipped rule when the form does not ask a referenced question, “of the last
   100 arrivals, N would have matched” and “K rules above run first” for a
   usable rule, and the exact landing/no-match sentence. Do not invent a second
   client-only matching behavior or expose raw answer rows to the browser.
5. Extend the existing event settings and submission record surfaces only where
   the prototype paints event tags/level/routed track. Keep organization/person
   tags visibly separate. Keep fixed widths, reserved error space, hairlines,
   contrast, and no-decorative-motion rules from `DESIGN.md`; no silent visual
   divergence is acceptable.

### 6. Verification set

Before requesting review, run targeted checks and record their exact results:

- Unit tests for all six operators, scalar/multi-select `contains`, aliases,
  malformed conditions, 1–5 limits, dangling references, and the distinction
  between skipped fields and blank answers. Enumerate every truth-table row,
  including blank/empty negative-operator controls and present `0`/`false`
  controls. Include a shadow regression where `not_equals` or `not_answered`
  on a field absent from the form cannot match.
- Routing integration tests for first-match order, answer-based matches, all
  four action types, event authorization, closed/out-of-scope review targets,
  and atomic `primary_track_id` plus `submission_tracks` state.
- Public-submit tests for track/tag/level-only routing, audit/record provenance,
  one-time application followed by manual edits, and the unchanged unrouted
  Sessionize import path. Include the reviewer-scope positive control and the
  admin-create non-routing positive control described below.
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

## Amendment 2026-08-16 — blocker artifact disposition

This section is part of the binding plan and supersedes every earlier phrase
that deferred one of these decisions to implementation. It resolves every
finding in review artifact `art_01M058VHPMXB77FWZFTTYF5PA8`. It remains plan-only:
no migration number is minted, no contract document is edited, and no stable
US/AC identifier is introduced here.

### A. One evaluator and the six-operator truth table

The evaluator input has two separate facts:

- `eventFieldKeys`: the active question keys carried by at least one form in the
  event, plus the reserved derived keys for Format, Track, Vendor content, and
  Level.
- `formFieldKeys`: the active question keys on this arriving/current form, plus
  the derived keys that are always available to the routing projection.

An answer map contains only non-empty projected answers. For a key in
`formFieldKeys` but absent from that map, the answer is blank/missing. A key
absent from `formFieldKeys` but present in `eventFieldKeys` is not an answer
value: it skips the whole rule. A key absent from `eventFieldKeys` is a dangling
reference and makes the rule effectively disabled. The rules below use a
non-empty scalar expected value for value-taking operators; `answered` and
`not_answered` do not accept a value. `null`, an array expected value, and an
empty expected string are invalid on a fresh save.

| Actual/input state | `equals` | `not_equals` | `contains` | `not_contains` | `answered` | `not_answered` |
|---|---|---|---|---|---|---|
| Field absent from event schema | dangling; no operator result | dangling; no operator result | dangling; no operator result | dangling; no operator result | dangling; no operator result | dangling; no operator result |
| Field absent from this form but present on another event form | skip the whole AND-rule; no operator result | skip the whole AND-rule; no operator result | skip the whole AND-rule; no operator result | skip the whole AND-rule; no operator result | skip the whole AND-rule; no operator result | skip the whole AND-rule; no operator result |
| Answer key missing, `null`, or blank/whitespace string | false | false | false | false | false | true |
| Empty multiselect `[]` | false | false | false | false | false | true |
| Present scalar, including `0` or `false` | true only when scalar-equal to expected | true only when present and not scalar-equal | true only when a string contains expected text | true only when present and a string does not contain expected text | true | false |
| Non-empty string scalar | true only when scalar-equal to expected | true only when present and unequal | true when substring is present | true when substring is absent | true | false |
| Non-empty multiselect | true when any selected member is scalar-equal to expected | true when present and no selected member is equal | true when any selected member is scalar-equal | true when present and no selected member is equal | true | false |

`equals`/`not_equals` compare strings case-sensitively after the existing scalar
string/number compatibility normalization; taxonomy names are normalized before
they become values. `contains`/`not_contains` use Unicode case-folded substring
matching only for a string scalar and membership matching for a multiselect.
Negative operators are presence-guarded, matching the signed prototype: blank,
missing, and empty multiselect values do not become a surprising negative match.
Non-null file/object values are answered but are not value-matched by these
operators. All clauses are ANDed. A skipped clause skips the entire rule, even if
another clause would be false; a dangling/invalid rule is excluded before order
evaluation.

`clauseMatches` becomes an exported pure function in
`src/lib/form-conditions.ts`, alongside a pure routing-condition-set result
that returns `matched`, `skipped`, `dangling`, or `invalid`. Form applicability,
the server routing path, the builder's live preview, and the historical preview
counter all call this module. `src/routes/public-form-routing.ts` removes its
local `RoutingCondition`, `scalarEqual`, and `conditionMatches` implementation;
it only normalizes legacy `{field, op, value}`/review-pool JSON and supplies the
shared evaluator's input. A source-level test must fail if a second local
condition matcher returns.

### B. Track precedence, secondary tracks, tags, levels, and retries

At public arrival, submitter track values are resolved to event-owned IDs,
deduplicated by first occurrence, and retain answer order. Without a matched
`set-track` action, that list is persisted as-is: its first ID is primary, every
other unique ID is secondary, and an empty list has no primary. A matched
`set-track` action is authoritative and replaces the entire list with exactly
`[routed_track_id]`; submitter-selected secondary tracks are not unioned into a
routed queue. This makes “set track” mean one reviewer-visible destination and
prevents a submitter's secondary selection from widening reviewer scope. If the
routed ID already appears in the submitted list, the result is still one row,
not a duplicate. Manual editing may add secondary tracks later and is never
re-routed.

The batch writes `primary_track_id` from the first resulting ID and exactly one
`is_primary = 1` join row. `submission_tracks` is the reviewer-scope source of
truth; the scalar is a compatible projection, never an alternative scope.
`submission_tags` is a set: duplicate IDs in one action are reduced by first
occurrence, existing membership is retained, and the unique
`(submission_id, tag_id)` constraint plus an upsert makes a repeated action a
no-op. `set-level` replaces the single `level_id`; setting the current level is
a no-op. Audit arrays are emitted in taxonomy position/id order so retries do
not create order churn.

The taxonomy/action contract is idempotent at the stable submission boundary.
A draft/resume submission has one `public_submit` arrival claim keyed by its
submission ID in a new unique `submission_arrivals` table. The first successful
batch claims it; a retry with the same resume capability re-reads the completed
submission and returns its existing result without another routing or audit
application. A failed batch commits no claim, so the retry can try again. A
no-token request intentionally creates a new submission; Marquee must not
silently deduplicate two unauthenticated people who happen to submit identical
answers. Taxonomy POST collisions return 409; stable-ID PUT/PATCH writes are
idempotent. Tag-set upserts, same-level updates, and `round_assignments`
`INSERT OR IGNORE` are all retry-safe.

### C. Taxonomy names and collision policy

Tracks, tags, and levels use one `normalizeTaxonomyName` helper: Unicode NFKC,
trim leading/trailing whitespace, collapse internal whitespace to one space,
then derive an ASCII/Unicode case-folded `name_key` for comparison. The stored
display name is the trimmed/collapsed form. Each event-owned taxonomy table has
a partial unique index on `(event_id, name_key)` for rows with
`deleted_at IS NULL`; track/tag/level names may coincide across the different
taxonomy types because their IDs and action meanings are distinct. Create and
rename normalize before validation and return 409 on an active same-type
collision, including case/whitespace-only collisions. A database uniqueness
constraint remains the race-safe backstop.

The new tag/level APIs and the existing track settings APIs expose the normalized
display name and `deleted_at` state, reject cross-event IDs, and never resolve a
rule by a non-unique display name. Rule JSON stores IDs for taxonomy/domain
references and field keys for answer references. Legacy name-based rules are
normalized once on a valid write; an ambiguous legacy name is a validation
error, not a guessed ID.

### D. Delete, soft-disable, and applied-history policy

Individual question and taxonomy deletion is a tombstone, not a physical delete:

- `form_fields.deleted_at` makes a question disappear from active form/API
  projections while retaining `submission_answers` and its historical label.
  The event field universe is computed across active forms. Deleting a question
  from one form therefore leaves an event rule valid if another form still
  carries the same key; this form reports skip-not-evaluate. When no active form
  carries the key, the rule reports a dangling reference. Re-adding that key
  restores validity without changing the rule ID. Historical record queries may
  still paint the tombstoned field as deleted.
- Track, tag, and level DELETE APIs set `deleted_at` and hide the row from new
  option lists. They do not break `submission_tracks`, `submission_tags`, or
  `submissions.level_id`; records and reviewer scope retain the applied row and
  show its deleted label. A rule that names a tombstoned taxonomy ID is
  effectively dangling and cannot be toggled on until fixed.
- Routing-rule DELETE is also a soft archive: set `deleted_at` and `enabled = 0`
  while retaining its ID, name, JSON, and position for provenance. Active lists
  exclude archived rules; record loads continue to join the archived row, so
  `applied_rule_id` is never nulled merely because an organizer archives a
  rule. Event deletion is the only physical delete of these tombstones, after
  dependent submissions/audit rows are removed in the stated order.

Dangling status is computed on read and returned with each reference and reason;
the read path does not silently mutate `enabled`. Toggle returns a validation
error with the signed “Fix rule” instruction while any dangling reference is
present. Fixing a reference through the inline editor clears the warning; a
previously enabled, non-archived rule becomes effective again, while a rule the
organizer had deliberately left off remains off. Applied routing audit rows
also snapshot `rule_id`, `rule_name`, action IDs/names, and the resulting
projection, so the record/timeline remains intelligible even after a rule is
archived.

### E. Organizer manual routing edit seam

The organizer edit is a separate, non-routing API in
`src/routes/submission-record.routes.ts`:

`PUT /api/v1/events/{eventId}/submissions/{submissionId}/routing`

uses the existing event-scoped `program:write` authorization/can-write guard,
never accepts a public resume token, and requires the full projection payload:

```json
{
  "track_ids": ["..."],
  "primary_track_id": "...",
  "tag_ids": ["..."],
  "level_id": "..."
}
```

The server deduplicates IDs, requires the primary to be in `track_ids` (or
requires both to be empty/null), rejects deleted/cross-event options, and
replaces the joins/level in one D1 batch. It never calls the routing evaluator
and never changes `applied_rule_id`. The batch writes one
`submission.routing_updated` audit row with actor person, request ID, and
before/after `{track_ids, primary_track_id, tag_ids, level_id, applied_rule_id}`
so an organizer change is visibly distinct from a system `submission.routed`
row.

`src/ui/submissions/SubmissionRecordPage.tsx` adds an editable Routing card
beside the existing read-only Tracks card. Its track multi-select, primary
choice, tag multi-select, level select, save/cancel states, and copy state
“Applied once at arrival; manual changes do not re-run rules” use the PUT seam.
The same card shows the archived/deleted labels needed for history. No public
submitter UI gains this capability. Tests cover program-write authorization,
cross-event refusal, atomic replacement, audit before/after, and unchanged
`applied_rule_id` under repeated edits.

### F. Concrete public-submit atomicity and compensation boundary

`handlePublicSubmission` is refactored into a read-only
`preparePublicArrival` phase and one `commitPublicArrival` D1 batch. Preflight
loads the form, active fields, projected answers, normalized taxonomy IDs, the
ordered rule result, the complete review-pool membership/scope checks, existing
draft state, and all required participant/attachment/outbox IDs. No mutation
occurs before preflight succeeds.

The single batch contains, in dependency order: any new/changed public person
row; the submission insert or guarded draft-to-submitted update; the unique
`submission_arrivals` claim; replacement of projected answers; replacement of
`submission_tracks`; replacement/upsert of `submission_tags`; the `level_id`
projection; participant/participation rows; attachment metadata ownership
updates; routed `round_assignments`; idempotent outbox rows; and both
`submission.received` and (when a rule matched) `submission.routed` audit rows.
The submission row, `applied_rule_id`, all four action projections, join rows,
assignment rows, and routed audit row therefore commit or roll back together.
The old committee-only `stageRoutingSubmission` branch and its incomplete
track-only rollback are not the transaction boundary; action-only routes enter
the same batch.

Mail queue fan-out after the D1 commit and any R2/object-store effect are
deliberately outside this boundary. Outbox rows have stable idempotency keys and
queue retry can only deliver an existing row; it cannot re-run routing. An
external enqueue failure is reported as a retryable delivery concern, never
used to undo or repeat the committed submission projection. Sessionize import
continues to use its own provenance-scoped track reconciliation and never calls
`preparePublicArrival`; admin create likewise remains outside it.

### G. Copy, reset, delete, and seed contract

Add an opt-in `routing` copy set, defaulting to false so event-specific routing
does not silently travel to a new conference. The set contains event tags,
levels, and eligible routing rules. Selecting it requires the copied forms and
tracks; a rule using a format ID also requires formats. The copy plan returns a
422 with its dependency reason when a selected rule would lose a required
parent, rather than creating a half-valid clone.

Copy order and remaps are explicit: formats/tracks/forms/fields and the routing
taxonomy parents are read first; fresh tag/level IDs are recorded in the map;
then routing rules receive fresh IDs, remap `event_id`, `track_id`,
`add_tag_ids`, `level_id`, and any format/track/plan/round IDs in canonical
condition/action JSON. Field keys remain unchanged because copied fields retain
their keys. Legacy name references resolve through the normalized destination
`name_key` map or the rule is reported as skipped. Commit the entire clone in
the existing one-batch copy contract. Commit no submissions, submission joins,
arrival claims, or applied-history rows.

Because committees are deliberately not copied and copied plans are draft, a
rule with a route-to-review target is reported in the copy receipt and skipped;
an action-only track/tag/level rule is copied. This is safer than copying a
review rule that points at last year's committee or a closed plan. If the
organizer does not select `routing`, forms may still copy but the receipt says
that taxonomy/rules did not travel.

For event delete, extend the existing children-before-parents batch in this
order: `submission_answers`, `submission_tracks`, `submission_tags`, arrival
claims, assignments/participations, submissions, form fields/forms, routing
rules, tags, levels, tracks, formats, then the remaining existing event-owned
tables. Applied-rule FKs are therefore valid until submissions are gone; no
organization/person `person_events` tags are touched. Tombstones are physically
removed only in this event cascade.

For `reset:demo`, add `submission_tags` and arrival claims immediately beside
the submission child tables in `WIPE_ORDER` and `DELETE_PLANS`, then add routing
tags/levels after `routing_rules` and before tracks/formats. The total delete
plan stays explicit and event/org scoped. Add `tags`/`levels` rows to
`scripts/seed/event.ts`, add a `scripts/seed/routing.ts` module after the
evaluation-plan seed and before submission content, and make submission seed
rows insert their level and submission-tag joins only after the submission row.
`DEMO_SEED_MODULES`, reset, and CLI seed use the same dependency order. Fixed
IDs are exported from the event/routing seed modules for rule/action remaps;
they are fixture IDs, not stable US/AC IDs.

### H. Authorized bounded last-100 preview contract

The builder fetches historical counts from:

`GET /api/v1/events/{eventId}/forms/{formId}/routing-preview`

using the same authenticated event/form-read authorization and ownership helper
as the form detail endpoint. It is never public, accepts no caller-controlled
limit, and reads at most 100 rows ordered by `submitted_at DESC, id DESC` where
`form_id` matches, `origin = 'public'`, `status <> 'draft'`, and
`submitted_at IS NOT NULL`. Admin and Sessionize/import arrivals are excluded;
the query is event-scoped and receives a supporting `(form_id, origin,
submitted_at, id)` index if the implementation check shows it is needed.

The response contains aggregates only, not speaker or answer values:

```json
{
  "data": {
    "form_id": "...",
    "sample_size": 100,
    "last_arrival_at": 123,
    "max_sample_size": 100,
    "rules": [{
      "rule_id": "...",
      "state": "matchable",
      "would_have_matched": 37,
      "rules_above": 1,
      "landing": {"track_id": "...", "tag_ids": ["..."], "level_id": "...", "plan_id": null, "committee_id": null, "round_id": null},
      "reason": null
    }]
  }
}
```

`state` is `matchable`, `skipped`, `dangling`, or `invalid`; skipped/dangling/
invalid rules return `would_have_matched: null` and a reason, never a misleading
zero. The count is the rule's own condition match count over the bounded sample,
while `rules_above` makes first-match ordering tangible as in v1.17. A zero-row
sample reports `sample_size: 0` and an honest no-arrivals state.

The server reconstructs the same evaluator input shape from stored projected
answers, active form keys, and derived format/track/vendor/level values, then
calls the shared evaluator for each rule. The live builder preview calls that
same pure function with the current `projectApplicableAnswers` result; the
historical endpoint does not invent a SQL matcher. Targeted parity tests feed
identical fixture maps through the shared function and compare every aggregate
and state. Rule edits invalidate/reload this bounded response; keystrokes remain
local and zero-latency.

### I. Admin-create non-routing positive control

Add an integration test through
`POST /api/v1/events/{eventId}/submissions` with `origin = admin` semantics,
the same form/answers that would match a seeded public answer rule, and a
caller-supplied `applied_rule_id` plus explicit admin track data. Assert that
the record preserves only the caller's `applied_rule_id` and explicit admin
projection, does not acquire the rule's tag/level/route target, creates no
`submission.routed` audit row, and creates no reviewer assignment merely because
the answers resemble a public arrival. A second admin create with no asserted
rule proves the field/answer data alone never invokes routing. This positive
control sits beside the Sessionize-unrouted test and protects the admin/public,
import/public, and tenant boundaries while the shared routing seam changes.

## Reset 2026-08-16 by agent:delegator-mrq-229

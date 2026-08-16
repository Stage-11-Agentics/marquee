# MRQ-245: Conference-level submission capacity: set the default once, forms inherit

## Outcome

Add one conference-level submission-capacity default while preserving every existing
form's explicit behavior. The event setting is stored through the existing
`event_settings` seam and falls back to the current default of 3 when unset. New
forms inherit it; an existing or explicitly overridden form keeps its own value.
The public form, refusal paths, and builder all read one effective value.

## Guard rails and boundaries

- Draft rows deliberately do not count. Preserve the d520c320 reversal and the
  existing `tests/integration/draft-limit.test.ts` behavior; do not reopen that
  ruling or create a second draft-counting path.
- The event default supplies the value for each inheriting form. It is not an
  event-wide pool or cross-form ceiling, and no such ceiling is added here.
- Do not reserve a migration number in the plan. `0029` is currently MRQ-242
  and `0030` is currently MRQ-241. At implementation/rebase time, choose the
  next free migration number for the additive
  `forms.submitter_limit_inherit INTEGER NOT NULL DEFAULT 0` column, record it
  in the migration harness and handoff, and allow gaps; never back-fill a
  missing prefix merely to make the sequence pretty.
- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, or
  `sequence/USER_STORIES.md`; do not mint US/AC IDs or a claims manifest. The
  draft criteria below remain unnumbered until serialized consolidation.
- Keep the capacity editor adjacent to the existing form settings/validation
  seam so MRQ-246 can add its combined-character-budget panel later without
  changing this resolver or the `projectApplicableAnswers` evaluator. Do not
  implement MRQ-246.
- Browser/computer-use, live writes, deployment, review-agent work, the full
  gate, and merge are held by the brief. Stop at the orchestrator handoff.

## Contract decisions (Plan-review Cycle 1; authoritative)

- `submitter_limit_inherit` is the state control on the admin wire. When it is
  present on PATCH, `true` means inherit and `false` means explicit; the latter
  requires `per_submitter_limit` in the same request. When the flag is absent,
  PATCH with a `per_submitter_limit` is an explicit override, while a PATCH with
  neither capacity field preserves the current state. The builder sends both
  fields on every whole-object save, so renames and close-date edits send
  `submitter_limit_inherit: true` for an inheriting form and cannot pin it to
  the current effective value. Clearing an override is
  `submitter_limit_inherit: true`. This makes the already-supported CLI
  `--set per_submitter_limit=...` an observable override rather than a silent
  dormant-column write; the builder/API use the flag deliberately.
- On create, `per_submitter_limit` loses its Zod `.default(3)` and becomes
  optional. A create with neither capacity field inherits; a new explicit
  override sends `submitter_limit_inherit: false` and a number. For compatibility
  with older create clients, a supplied number without the flag is treated as
  explicit only on create; new builder/API callers send the flag deliberately.
  The INSERT always stores a valid dormant value: an omitted number lets the
  SQL default 3 apply (or binds 3 equivalently), while an inherited supplied
  number remains dormant. The OpenAPI default disappearing is intentional and
  is covered by route behavior rather than by a schema-text assertion.
- `forms.per_submitter_limit` remains the dormant raw stored value while
  `submitter_limit_inherit = 1`; no writer maintains it and no admin reader
  treats it as authoritative. Admin form rows expose both that raw field and
  `effective_submitter_limit`. The public `form.per_submitter_limit` continues
  to mean the number the public form enforces, so it becomes the effective
  number there. Existing explicit rows retain their current raw and effective
  values.
- Both form-copy paths carry capacity state. A duplicated form preserves the
  source's inherit flag and dormant/explicit number. An event-to-event copy
  arrives inheriting when the source inherits and then resolves against the
  destination event's default; an overridden source carries its explicit
  number. Both cases receive behavior coverage near the existing copy tests.
- The event default and the form override API both accept an integer from 0
  through 100, where 0 means unlimited. Missing or malformed/out-of-range
  `event_settings.submission_default_limit` values fall back to 3 without
  throwing on a public request; an effective 0 never enters an at-limit path.
  The public query folds the setting into its existing event join to avoid a
  serial D1 round-trip, then passes a synchronous event context and raw form to
  `effectiveSubmitterLimit(event, form)`. Admin form routes read the same
  default once at their request boundary and pass it into
  `normalizeForm(row, eventDefault)`; listing N forms never reads settings N
  times.
- Capacity refusal data is shared and truthful: a single helper carries the
  effective limit and actual non-draft, non-withdrawn count, while a path-aware
  next-step field distinguishes new submission/save-draft paths from resumed-
  draft submission. The common sentence names both numbers and keeps the
  ticket's noun, "abstracts"; a resumed draft does not tell someone to use the
  resume link they are already using, and instead says the saved draft remains
  available and the organizer must make room. The CLI form registry exposes
  inherit state alongside raw and effective values; readers display or compare
  `effective_submitter_limit`, not the dormant raw field.
- The ticket's requested builder e2e is explicitly substituted by a
  happy-dom/Preact runtime component test because browser/computer-use is held
  by the brief. The browser e2e remains a named operator/intake follow-up
  candidate; this worker cannot mint its ticket or ID and makes no e2e claim.
- Forms created through the forms API inherit by default. The seeded demo CFP
  is authored with `submitter_limit_inherit = 1` and no event setting row, so
  its effective limit remains the fallback 3 while the feature is visible in
  the evaluator path. The Sessionize importer is an explicit-source
  compatibility path: imported forms keep their source number and remain
  explicit rather than silently adopting the event default.

## Plan-review Cycle 3 resolutions (authoritative)

- The five current capacity-related 409 paths share one refusal data model with
  `{ effectiveLimit, actualCount }`, but next-step copy is path-aware. The four
  new-submission/save-draft paths may direct the submitter to a saved resume
  link; the resumed-draft submit path says the draft remains saved and the
  organizer must make room. The shared formatter is exercised in every 409
  response body, and the GET `at_limit` state uses the new-submission wording.
  A lowered cap with a submitter above the cap reports the true actual count,
  not the effective limit repeated as a fake count.
- At this plan head the five authority sites are explicitly inventoried:
  `src/routes/public-form.shared.ts` `loadPublicForm` at-limit state (around
  line 525), `toPublicFormState` capacity projection (around line 639), and
  `src/routes/public-form.routes.ts` draft-cap check (around line 783), new
  submission check (around line 1075), and resumed-draft `existingCount` check
  (around line 1094). The five 409 throw paths are separately covered at
  `public-form.routes.ts` around lines 766, 784, 1028, 1076, and 1095; line
  numbers are rechecked at implementation, but these symbols and branches are
  the contract. All enforcement remains at those sites and delegates to the
  one resolver.
- The form API and event-settings API both accept 0 through 100, with 0
  explicitly documented and tested as unlimited. The builder presents the
  same meaning for an explicit 0 override and an inherited 0 event default;
  no scope is hidden behind a legacy-only database state.
- Whole-object PATCH behavior is explicit and tested: the builder always sends
  `submitter_limit_inherit` with its echoed raw field, so unrelated edits keep
  inheritance; a generic client that echoes dormant `per_submitter_limit`
  without the flag takes the documented explicit-override path, never a silent
  no-op. The API test covers both the builder-shaped preserve case and the
  flag-omitted explicit case, and asserts readers use the effective field.
- The demo seed chore includes `scripts/seed/event.ts`'s CFP row with
  `submitter_limit_inherit: 1`; no `submission_default_limit` seed is added,
  preserving effective 3. `src/lib/reset-demo/reseed-demo.ts` reuses that seed
  path and therefore preserves the same inherited behavior.
- Migration numbering is deliberately deferred: at implementation/rebase use
  the first free numeric prefix, record explicit harness order, permit gaps,
  and never back-fill an absent prefix. The current 0029/0030 observations are
  read-only context, not a reservation.
- The authenticated builder e2e remains an operator/intake follow-up
  candidate, named in the handoff and PR evidence when one exists. This worker
  does not mint an ID or claim browser coverage.

## Draft acceptance scope

- The effective-value matrix is observable: an inheriting form uses the event
  default, an explicit override wins, clearing the override returns to inherit,
  and the event-default fallback is stable when no setting exists.
- Saving an inheriting form's name, close date, or the builder's whole settings
  payload leaves it inheriting; changing the event default changes its effective
  value without a form-capacity write.
- A PATCH containing only `per_submitter_limit` visibly creates an explicit
  override; a new form with no capacity field stores a valid dormant 3 while
  reporting inheritance. Admin listing N forms performs one event-setting read.
- A whole-object builder PATCH includes the inherit flag and preserves an
  inheriting form across unrelated edits; a flag-omitted PATCH that includes
  the raw capacity field is an explicit, observable override. Readers display
  the effective field rather than comparing the dormant raw value.
- Migration of a pre-existing form leaves its inherit flag off and preserves its
  previous enforcement value; API-created forms and the seeded CFP start with
  inherit on, while Sessionize-imported forms retain explicit source behavior.
- Changing the event default changes enforcement and displayed effective values
  for inheriting forms immediately, with no per-form writes and no effect on an
  explicit override.
- Every current public capacity enforcement site uses the one
  `effectiveSubmitterLimit(event, form)` authority without moving those sites.
  Drafts remain excluded, while submitted/non-withdrawn abstracts still consume
  capacity.
- At-limit state and refusal responses name the effective limit and the true
  actual count. All five current capacity-related 409 paths use the shared
  limit/count data, while the resumed-draft submit path has a non-circular
  organizer-action next step; every response body and the GET state are
  asserted.
- A lowered default can leave a submitter above the new cap; refusal copy says
  the true count they have. Explicit and inherited 0 values are both tested as
  unlimited and never produce a refusal.
- Event settings can read and write the default through the live settings
  endpoint, and the builder always shows the effective number with explicit
  inherit, override, and clear behavior.

## Implementation phases

1. Establish the exact worktree/head/base, inspect the ticket and cited draft
   reversal, and run a separate install/baseline. Read the current migration
   refs for 0029/0030, but defer choosing the next free prefix until
   implementation/rebase; then write, commit, push, and verify this plan before
   source edits.
2. At implementation/rebase choose the first free migration prefix (gaps are
   allowed and are not back-filled), then add
   `migrations/<next-free>_submission_capacity.sql`, its schema-delta receipt, the
   migration test harness import, the `FormRow` type, the
   `CoreDefaultColumns.forms` entry, and the copy-manifest declaration. The
   migration is additive and defaults existing forms to explicit behavior;
   copied forms carry the flag with the form. Add the seeded CFP inherit flag to
   `scripts/seed/event.ts`; do not add an event setting row, preserving 3.
3. Add a focused submission-capacity helper containing the setting key, default
   parser/writer, the shared `{ effectiveLimit, actualCount, nextStep }` refusal
   model, and the sole `effectiveSubmitterLimit(event, form)` resolver. Extend
   the event-settings GET/PATCH response and UI with a bounded 0–100
   "Submission capacity" control, using the same upsert idiom as social
   settings; document 0 as unlimited.
4. Extend form API rows and schemas with the inherit flag and effective value.
   Align form create/PATCH bounds to 0–100, make creation default to inheritance,
   preserve explicit legacy rows, and make PATCH support override and clear
   explicitly. Render the builder control with a visible effective number, an
   inherit/override state, an override input, an explicit unlimited state, and a
   clear-to-inherit action. Keep the control in a small runtime-testable
   component next to the existing form settings editor. Test builder-shaped
   whole-object preservation and flag-omitted explicit override semantics.
5. Load the event setting once at the public-form boundary and carry the
   effective value through the public form record/state. Replace every current
   raw enforcement read in the five inventoried authority sites with the shared
   resolver result, leaving enforcement locations unchanged. Centralize truthful
   limit-plus-actual-count data, then choose a path-aware next step for all five
   409 paths, including a non-circular resumed-draft response.
6. Add behavior-level integration coverage for the resolver/inheritance matrix,
   migration preservation, immediate default changes, explicit overrides, 0 =
   unlimited on both APIs, draft exclusion, the seeded CFP, all five authority
   sites, all five 409 bodies, lowered-cap actual-count honesty, and the
   path-aware resumed-draft next step. Add a happy-dom/Preact runtime component
   test for builder display, override, unlimited, whole-object preserve, and
   clear behavior. Extend neighboring existing traced tests without minting a
   new criterion or using source-text/CSS matching as proof; leave browser e2e as
   the named operator/intake follow-up candidate.
7. At each meaningful checkpoint, commit and push with remote-parity proof. At
   the final clean pushed head, re-check `github/main`, rebase if required,
   rerun `npm ci` after any rebase, choose and verify the next-free migration
   allocation again with gaps allowed, run the
   focused tests and static checks, and report the implementation plus evidence
   to Adoption Orchestrator. Do not request a reviewer or full gate before that
   final pushed head, and stop for orchestrator sequencing.

## Verification and handoff evidence

- Baseline/install evidence is separate from changed-code evidence. Focused
  checks must report behavior, not merely the presence of a resolver or string.
- Record exact branch HEAD, `github/main` base, migration allocation checks,
  focused test commands and status, and the clean pushed-head parity result.
- Distinguish static/schema evidence from runtime integration/component evidence;
  do not claim browser, deployment, merge, or full-gate results.
- The handoff residuals must name the unrun authenticated builder e2e explicitly
  as an operator/intake follow-up candidate; this worker cannot mint its ticket
  or ID. The component test is not browser evidence.
- Report the durable plan receipt and completion/blockers to the Adoption
  Orchestrator at workspace `workspace:10`, surface `surface:513`, mailbox
  `adoption-orchestrator`. Raise a c11 flag only for an operator-action
  decision.

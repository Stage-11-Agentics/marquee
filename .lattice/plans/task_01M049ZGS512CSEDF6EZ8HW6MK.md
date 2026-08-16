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
- Reserve migration `0031` for the additive
  `forms.submitter_limit_inherit INTEGER NOT NULL DEFAULT 0` column when it is
  free. `0029` is MRQ-242 and `0030` is MRQ-241. Verify this allocation before
  implementation and again after the required rebase; if `0031` is taken,
  choose the next free number (or a distinct same-numbered file with explicit
  harness order), record that order, and report the chosen migration name.
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
- The event default is a bounded integer from 0 through 100, where 0 means
  unlimited for every inheriting form. Missing or
  malformed/out-of-range `event_settings.submission_default_limit` values fall
  back to 3 without throwing on a public request. An explicit form value of 0
  remains the existing unlimited state; inherited forms use the parsed event
  default. The public query folds the setting into its existing event join to
  avoid a serial D1 round-trip, then passes a synchronous event context and raw
  form to `effectiveSubmitterLimit(event, form)`. Admin form routes read the
  same default once at their request boundary and pass it into
  `normalizeForm(row, eventDefault)`; listing N forms never reads settings N
  times.
- The refusal copy keeps the ticket's exact noun, "abstracts", for both form
  kinds in this ticket; kind-aware nouns are deferred. The CLI form registry
  exposes the inherit state alongside the raw and effective values so the
  agent-native surface does not diverge from the builder.
- The ticket's requested builder e2e is explicitly substituted by a
  happy-dom/Preact runtime component test because browser/computer-use is held
  by the brief. The e2e remains an orchestrator-owned follow-up, not an implied
  claim in this handoff.
- Forms created through the forms API inherit by default. The Sessionize
  importer is an explicit-source compatibility path: imported forms keep their
  source number and remain explicit rather than silently adopting the event
  default.

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
- Migration of a pre-existing form leaves its inherit flag off and preserves its
  previous enforcement value; new forms start with inherit on.
- Changing the event default changes enforcement and displayed effective values
  for inheriting forms immediately, with no per-form writes and no effect on an
  explicit override.
- Every current public capacity enforcement site uses the one
  `effectiveSubmitterLimit(event, form)` authority without moving those sites.
  Drafts remain excluded, while submitted/non-withdrawn abstracts still consume
  capacity.
- At-limit state and refusal responses name the effective number and tell the
  submitter to use the saved resume link to continue a draft. The centralized
  sentence is used by all five current capacity-related 409 paths and asserted
  in both the GET state and every one of those response bodies.
- Event settings can read and write the default through the live settings
  endpoint, and the builder always shows the effective number with explicit
  inherit, override, and clear behavior.

## Implementation phases

1. Establish the exact worktree/head/base, inspect the ticket and cited draft
   reversal, and run a separate install/baseline. Confirm migration `0029` and
   `0030` ownership from the available refs, then write, commit, push, and verify
   this plan before source edits.
2. Add `migrations/0031_submission_capacity.sql`, its schema-delta receipt, the
   migration test harness import, the `FormRow` type, the
   `CoreDefaultColumns.forms` entry, and the copy-manifest declaration. The
   migration is additive and defaults existing forms to explicit behavior;
   copied forms carry the flag with the form.
3. Add a focused submission-capacity helper containing the setting key, default
   parser/writer, and the sole `effectiveSubmitterLimit(event, form)` resolver.
   Extend the event-settings GET/PATCH response and UI with a bounded
   "Submission capacity" control, using the same upsert idiom as social settings.
4. Extend form API rows and schemas with the inherit flag and effective value.
   Make creation default to inheritance, preserve explicit legacy rows, and make
   PATCH support override and clear explicitly. Render the builder control with
   a visible effective number, an inherit/override state, an override input, and
   a clear-to-inherit action. Keep the control in a small runtime-testable
   component next to the existing form settings editor.
5. Load the event setting once at the public-form boundary and carry the
   effective value through the public form record/state. Replace every current
   raw enforcement read in the state, draft, and submit paths with the shared
   resolver result, leaving enforcement locations unchanged. Centralize the
   at-limit sentence and route it through all five current capacity-related 409
   paths so its number and saved-resume next step cannot drift.
6. Add behavior-level integration coverage for the resolver/inheritance matrix,
   migration preservation, immediate default changes, explicit overrides, draft
   exclusion, all public enforcement paths, and truthful refusal copy. Add a
   happy-dom/Preact runtime component test for builder display, override, and
   clear behavior. Extend neighboring existing traced tests without minting a
   new criterion or using source-text/CSS matching as proof.
7. At each meaningful checkpoint, commit and push with remote-parity proof. At
   the final clean pushed head, re-check `github/main`, rebase if required,
   rerun `npm ci` after any rebase, verify migration allocation again, run the
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
- The handoff residuals must name the unrun authenticated builder e2e explicitly;
  the component test is not browser evidence.
- Report the durable plan receipt and completion/blockers to the Adoption
  Orchestrator at workspace `workspace:10`, surface `surface:513`, mailbox
  `adoption-orchestrator`. Raise a c11 flag only for an operator-action
  decision.

# MRQ-236 — Question library in the form builder: reuse across forms

## Plan-only handoff

- Ticket: MRQ-236
- Lattice task: task_01M03Q7P84R9R7MSP9W1P9RFP7
- Actor: agent:delegator-mrq-236
- Worktree: /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-236-question-library
- Planned base: github/main at 52bb485f105e0392fe475332b87cbb48dbcee832
- Binding prototype: prototypes/pipeline-v1.1/index.html at 390d52dc, v1.17
- Authoritative board plan: /Users/atin/Projects/Stage11/deployments/Marquee/.lattice/plans/task_01M03Q7P84R9R7MSP9W1P9RFP7.md
- Branch review copy: .lattice/plans/task_01M03Q7P84R9R7MSP9W1P9RFP7.md
- Current stage: plan-only. This plan is the only intended branch change. No feature code, stable US/AC mint, contract fold, browser run, live write, deploy, publication, PR, merge, or full gate belongs in this stage.
- The parent board plan and branch copy must remain byte-identical. The branch will be committed and pushed before the task moves to planned. The transition must use --no-auto-review so Lattice does not launch a plan reviewer. The next action is an orchestrator-owned fresh plan review.

This plan is grounded in CLAUDE.md, sequence/run-state.md, DESIGN.md, PHILOSOPHY.md, the complete MRQ-236 ticket and DESIGN GATE SATISFIED event, the v1.17 prototype, and the current form, schema, reset, event-delete, and copy-manifest seams.

## Binding product decision

The v1.17 operator-approved shape supersedes the earlier strict segmented-control draft:

- In the fields step, From library · N is a peer button beside + New question. It is not a strict segmented control and the controls must not cause the add row to jump.
- From library opens a searched picker. Every result shows the question name, type, number of forms using it, and its condition note when one exists.
- A question already placed on the destination form is visibly disabled as On this form. The API enforces the same invariant; the disabled state is not only a client convenience.
- Adding is a materialized copy into form_fields. The copy carries a nullable library_field_id provenance pointer and a source-version snapshot. Editing the library later never mutates a form copy.
- A copied condition whose trigger is absent in the destination is surfaced at insert. The stored destination condition is made unconditional for this copy, and the response/toast names the missing trigger and says the question shows unconditionally until re-pointed. There must be no silently dangling condition that fails closed in the public form.
- Question library management is a Question library tile at the end of the forms list, not a sidebar row.
- Participant-machinery keys are excluded from library results and cannot be saved into the library. The picker footer states why.
- The library is event-scoped. Org-wide definitions, reference placement, per-placement configuration, automatic propagation, and other widening are explicitly out of scope.
- The public render, validation, submit, answers, and condition-evaluation path remains unchanged. A live form is not mutated by library operations and a library edit never propagates to an existing placement.

The prototype's labels and geometry are binding evidence, not a request to copy its in-memory label-based identity. Production identity is by stable field/library IDs and field keys.

## Scope and non-goals

In scope:

- An event-scoped field_library definition table and nullable provenance/version columns on form_fields.
- Server-side library search and usage counts, event/org authorization, participant-key exclusion, and library-definition management from the forms surface.
- A draft-form copy operation that snapshots the complete question definition into a new form_fields row.
- Honest missing-condition-trigger handling at copy time.
- Both builder modes: the existing New question path and the From library path. New question retains an optional save-to-library affordance.
- Question library tile placement at the end of the forms catalog.
- Cross-event copy-manifest support so copied forms carry copied event-scoped definitions and remapped provenance rather than references into the source event.
- Reset-demo wipe/seed coverage, event deletion coverage, schema metadata, and structural/API/UI tests.
- Runtime validation planning for the local builder and public-form invariants. The runtime flow is recorded below but is held pending explicit operator browser scope approval.

Out of scope:

- Any change to the public form projection, public validation, submit, answer storage, condition evaluator, participant collection, or email behavior.
- Any migration to reference placement, shared org libraries, cross-event references, automatic propagation, or per-placement overrides.
- A second speaker/participant schema or a speakers table.
- A redesign of the forms navigation or a sidebar item.
- Minting stable US/AC identifiers or folding SPEC/contract artifacts. Existing traces such as US-07/US-08 and AC-17–21 may be cited for continuity only; consolidation owns new IDs.
- Browser/computer-use execution, live writes, deployment, publication, PR creation, merge, or full pr-gate in this plan stage.

### Existing live-form contract boundary

The current field CRUD routes have a pre-existing test contract that permits a direct field PATCH on an open form (the AC-24 fixture in tests/integration/api/forms.AC-17-33.test.ts), while form kind changes are guarded after open. MRQ-236 must not silently broaden into a rewrite of that existing contract during implementation.

For this ticket, the enforceable immutability boundary is:

- The new library-copy endpoint accepts draft destinations only and returns a clear conflict for an open or closed form.
- Library management edits definitions only; they never update any form_fields row, regardless of form status.
- Existing public and answer paths remain untouched.
- The implementation plan must not claim that the repository has acquired global schema immutability unless consolidation first resolves the AC-24 contradiction. If the operator later requires all field CRUD to be draft-only, that is a separately named contract/test decision, not an implicit MRQ-236 side effect.

## Implementation plan

### 1. Recheck the base and migration number at implementation time

Do not reserve a migration number in this plan. At implementation start:

1. Fetch github and verify the branch is still based on the intended current github/main lineage.
2. Inspect migrations/ and choose the next free migration number at that exact point. The current observed tail is not a reservation.
3. After any rebase, repeat the free-number check and inspect the resulting migration ordering again.
4. Run npm ci after a rebase before tests, per the boot contract.

The migration must be additive and preserve existing rows. It must not rewrite answers or introduce a public projection dependency.

### 2. Schema and typed database seam

Add one migration, using the then-current next free number, with:

- field_library:
  - id, event_id, key, label, help_text, type, required, config, condition, version, created_at, updated_at;
  - event_id references events and is the sole ownership boundary;
  - type uses the same supported form-field type set as form_fields;
  - config is valid JSON and condition is valid JSON or null;
  - version starts at 1 and increments on a library-definition edit;
  - unique event_id plus key constraint;
  - event/label search index and event/key lookup index.
- form_fields:
  - nullable library_field_id referencing field_library(id);
  - nullable library_field_version, recording the source version at materialization;
  - index for provenance and usage-count queries;
  - restrict library deletion while placements still point at it, or return the equivalent explicit API conflict. Do not leave silent dangling provenance.
- Keep existing form_fields uniqueness and position constraints. A copy is a new field row with a new field ID and the destination form's unique key.
- Delete ordering must account for form_fields referencing field_library: form_fields before field_library, and both before forms/events.

Update src/db/schema.ts for the new row type, table name/map, insert type, and any table-name completeness assertions. Add library_field_id and library_field_version to the internal FormFieldRow/FormFieldView shape required by builder APIs. Do not expose either field through publicField in src/routes/public-form.shared.ts.

Use one canonical participant-machinery predicate for library admission and search. It must cover the current structural keys, including speaker_name, speaker_email, speaker_role, speaker_company, co_speaker_* and moderator/other participant structural keys present in the existing form seed. Reuse an existing registry if the implementation finds one; otherwise put the predicate in a shared form-domain module rather than duplicating route and seed lists. Unit-test the exact current keys and a normal custom-question control.

### 3. Server-side library and materialization API

Build the API on the existing event/form authorization seam, preserving event and organization boundaries:

- GET /api/v1/events/:eventId/field-library?search=...:
  - server-side search, stable ordering, event scope, and bounded result size;
  - returns name/key, type, used-on-N-forms as a distinct-form count, condition note, version, and whether the destination form already contains it when a destination is supplied;
  - never returns participant-machinery definitions.
- POST /api/v1/events/:eventId/field-library:
  - creates a reusable definition from the New question save option or library management tile;
  - validates the supported type/config/condition shape and rejects participant keys;
  - normalizes config using the same field-config rules as form creation.
- PATCH /api/v1/events/:eventId/field-library/:libraryFieldId:
  - updates the definition in place, increments version, and never touches form_fields copies;
  - returns usage and stale-copy counts so the UI can say that forms use an older version.
- DELETE /api/v1/events/:eventId/field-library/:libraryFieldId:
  - only succeeds when no materialized form_fields row references the definition;
  - otherwise returns a clear conflict explaining that existing form copies are self-contained. No delete may create dangling provenance.
- POST /api/v1/events/:eventId/forms/:formId/fields/from-library:
  - accepts the library field ID and the desired insertion position;
  - uses the existing form access/authentication path and a single transaction/batch for the destination-field insert and position shift;
  - requires a draft destination for this new operation;
  - rejects a source from another event, a participant key, a duplicate library_field_id on the destination, or a destination key collision with 409 and a user-readable reason;
  - snapshots key, label, help_text, type, required, config/options, and condition data into the new form_fields row; sets library_field_id and library_field_version; never creates a reference-only placement.

Keep listFormFields and fieldResponse as the canonical builder read/response seams. Add provenance/version to builder responses where the UI needs it, but keep the public projection unchanged. The usage query must count distinct destination forms, not field rows.

#### Condition-copy rule

Use the repository's existing condition JSON shape and trigger-key extraction. At materialization:

1. Read the source condition without changing the library definition.
2. Compare every trigger key used by that condition with the destination form's current field keys.
3. If all triggers exist, copy the condition unchanged.
4. If any trigger is absent, store condition as null for the destination copy and return a structured warning containing the missing key(s), a stable warning code, and the exact message that the question shows unconditionally until re-pointed.
5. Render the warning in the builder toast/insert result. The picker condition note still reflects the source definition.
6. Do not modify the public condition evaluator; null is the deliberate honest destination snapshot.

Copy config/options exactly as the normalized source snapshot. Bound option sources must continue to resolve through the destination event's existing formats/tracks context; do not add a new options or answers path.

#### New question save option

Keep New question as the current direct form-field creation mode. Add an optional save-to-library control:

- Without the option, behavior remains the existing direct field creation path and provenance is null.
- With the option, create the event-scoped library snapshot and attach the just-created destination field to that snapshot at version 1, or use the same materialization helper so both paths have one copy manifest and one normalization rule.
- Participant-machinery fields may still follow the existing direct builder behavior if the product already supports them, but the save option must be unavailable/rejected with the same explanatory exclusion used by the picker.
- The save option must not turn a field into a live reference or cause future library edits to fan out.

### 4. Forms UI and Flight Deck fidelity

Update src/ui/forms/FormsPage.tsx and forms.css to reproduce v1.17:

- Keep the existing New question controls stable and add From library · N as its peer. Do not implement the superseded strict segmented-control draft.
- Open the searched picker from From library. Each row shows the question name, type, used-on-N-forms, and a condition note. The destination-form state disables the row as On this form; keyboard focus and disabled semantics must be real, not only visual.
- Show the insert warning toast for a missing condition trigger with the approved unconditional-until-repointed wording.
- Include the picker footer: participant machinery such as speaker email, co-speakers, and moderator fields is structural and never appears here because a second participant placement cannot survive the submit path.
- Add the Question library tile after the last form card in the forms list. It must not add a sidebar navigation item.
- Provide the management view reachable from that tile for creating and editing event-scoped reusable questions, with version/stale-copy counts. Library edits must visibly communicate that existing forms retain their copies.
- Use stable IDs for selection and disablement; labels are display text only.
- Preserve the existing small-screen layout and no-jump geometry. Use the binding tokens, hairline rules, typography, honest states, and no decorative shadows/motion from DESIGN.md and prototypes/skins/skin-c.html. Add responsive picker/tile styles without changing public form styles.
- Keep ordinary New question creation and From library copying independently usable in the same builder session. The UI must not pretend that a library copy is a linked placement.

### 5. Cross-event copy manifest

Extend src/lib/events/copy-manifest.ts and the associated copy planner/runner:

- Treat field_library as part of the existing forms copy selection, with definitions copied before forms/form_fields.
- Remap event_id to the destination event and keep library IDs distinct.
- In form_fields, remap library_field_id through the copied field_library ID map and carry library_field_version. Never leave a destination field pointing at the source event.
- Preserve the existing form-field definition columns, config, and condition snapshot. Conditions remain data snapshots; do not re-evaluate or repoint them during cross-event copy.
- Add the new table/columns to declared-column drift checks and copy-manifest integration coverage.
- Preserve current copy prerequisites and source form selection behavior. No new org-wide/reference-placement selection is introduced.

### 6. Reset, seed, event deletion, and data hygiene

Update every table-name and child-before-parent seam:

- Add field_library to src/lib/reset-demo/reseed-demo.ts WIPE_ORDER after form_fields and before forms/events as required by the foreign-key direction.
- Add an event-scoped DELETE_PLANS entry and include it in reset table coverage. The reset must remove library definitions and their form placements deterministically.
- Update src/lib/events/delete-event.ts so event deletion deletes form_fields before field_library before forms/events.
- Update deterministic demo seed modules to include a small event-scoped set of reusable non-participant questions, at least one condition-bearing definition and definitions used on more than one form, so the picker can prove counts and warning behavior without changing public semantics. Seed provenance/version only for non-participant fields.
- Keep seed IDs deterministic and event-scoped. Do not seed participant machinery into field_library.
- Update reset/delete fixture counts and any migration/table completeness assertions.
- No data cleanup by destructive shell command and no changes to unrelated live/demo data in this plan stage.

### 7. Test plan

Add focused coverage before implementation is considered complete.

Schema and pure-domain tests:

- migration creates field_library, constraints, indexes, JSON checks, version defaults, form_fields provenance columns, and the intended foreign-key/delete order;
- participant predicate excludes all current participant machinery and admits a normal custom question;
- condition trigger extraction returns all missing keys and materializes a null condition plus a structured warning;
- copy-manifest declared columns include field_library and both provenance/version columns.

API integration tests:

- event-scoped list/search and usage counts across several forms;
- organization/event authorization rejects cross-event and cross-org reads, creates, edits, and copies;
- participant-key create/save/list exclusion;
- library update increments version, leaves every existing form copy byte-for-byte unchanged, and reports stale-copy counts;
- materialized copy creates a new field ID with full config/options/condition snapshot, provenance, version, and destination position;
- same-form placement is disabled in the response and rejected server-side, including a key collision;
- missing condition trigger returns the warning, stores an unconditional destination condition, and never silently leaves a dangling condition;
- copy into open/closed destinations is rejected by the library-copy route; no public route behavior changes;
- safe library deletion and referenced-definition conflict;
- both New question and From library save/copy paths, including the participant save exclusion.

Cross-event/reset/delete tests:

- copy-manifest copies library definitions before forms/form_fields and remaps every provenance ID to the destination event;
- reset wipe order and delete plans include field_library;
- event deletion leaves no library or placement rows;
- deterministic seed counts and participant exclusion remain correct.

UI/static/runtime tests:

- update the existing forms-layout assertion intentionally for the approved peer-button shape, preserving no-jump/mobile rules;
- assert the Question library tile is at the end of the catalog and absent from sidebar navigation;
- assert picker row metadata, On this form disabled state, condition note, participant footer, and warning copy;
- retain existing condition summary and public projection tests;
- add builder coverage for both modes, with focus/recovery checks for the picker and disabled rows.

A known baseline test that patches an open form field must remain unchanged unless consolidation explicitly resolves the live-form contract boundary above. Do not make a green suite by deleting or weakening that baseline.

### 8. Held runtime validation plan

No browser or computer-use validation is authorized or run in this plan stage. Before running it, obtain explicit operator scope approval and record that approval in the Lattice plan/comment. The intended local-only flow is:

1. Start the real local Worker in this worktree with the repository's documented local auth/test-fixture setup.
2. Visit the local forms builder as an event organizer, open a draft form, and verify the forms catalog ends with the Question library tile.
3. Use New question, save one ordinary question to the library, and confirm the current form remains self-contained.
4. Use From library · N, search, inspect name/type/used-on count/condition note, add a question, and verify the new field is a materialized copy with the correct config/options and provenance.
5. Repeat with a library condition whose trigger is absent in the destination; verify the insert warning and that the copy is unconditional until re-pointed.
6. Verify the placed row is disabled as On this form, participant machinery is absent, the footer explains the exclusion, and keyboard focus is recoverable after the picker closes.
7. Exercise both builder modes on a second draft form. Edit the library definition and verify existing form copies do not change and the stale-copy count is honest.
8. Verify an open/closed form cannot receive a new library copy; do not modify the existing open-field baseline contract.
9. Check the public preview/submit/answers/conditions path for a fixture form to prove no public behavior changed.
10. Use isolated local fixture/reset and copy flows to prove event scope and remapped provenance. Do not use production, live credentials, deployment, publication, or external writes.

The local browser surface, domains, interactions, fixture accounts, and data limits must be approved explicitly before this flow is executed. Until then, all browser evidence is intentionally absent.

## Verification and handoff gates

Before implementation:

- The orchestrator performs a fresh plan review from the pushed branch, with no auto-fired reviewer from the planned transition.
- The implementation agent rechecks github/main and the next free migration number, then repeats the check after any rebase.
- No stable US/AC IDs or contract amendments are authored here.

During implementation:

- Work remains in this linked worktree and uses a PR for feature code.
- Full pr-gate is held until an implementation stage requests a slot from the merge-captain mailbox. A slow/pass-over-budget result is not a reason to misreport a gate; only the repository's stated verdict is evidence.
- Browser/computer-use, live writes, deploy, publication, PR, and merge remain outside this plan stage and require their respective approvals/ownership.

Plan-stage completion:

1. Replace the scaffold in the authoritative parent plan and create the identical branch copy.
2. Confirm the two files are byte-identical.
3. Commit only the branch plan copy with a plan-only commit; do not stage sibling .lattice changes.
4. Push branch mrq-236-question-library to github.
5. Verify local HEAD equals github/mrq-236-question-library, the branch is clean, and the only diff from 52bb485f105e0392fe475332b87cbb48dbcee832 is the plan copy.
6. Transition MRQ-236 to planned with lattice status MRQ-236 planned --actor agent:delegator-mrq-236 --no-auto-review.
7. Report the pushed commit, parity/clean-tree evidence, and the held boundaries to Adoption Orchestrator at surface:513, then stop for its fresh plan-review decision.

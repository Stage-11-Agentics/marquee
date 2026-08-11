# MRQ-21: Agenda: track swimlane and conflicts

BUILDPLAN: M-19b — Wave 1 (§4)

Scope (verbatim): True swimlane per track (own lane box per track, day bands, slot columns), conflict computation over rooms **and every participation role**, tile flags, conflicts drawer with jump-to, warn-never-block.

AC-81 is structural, not cosmetic: lane container count equals track count, each lane has its own bounding box, every session's box sits inside its own track's lane. **Colour overlay alone fails.**
AC-77 is parameterized over all four participation roles — speaker, co-speaker, moderator, chairperson.
Felt checkpoint C5 runs here on deployed infra: place ten sessions with a trackpad and with a mouse; no perceptible lag, no snap-back, no ghost offset.

File surface: `src/ui/agenda/track-board.tsx`, `src/lib/conflicts.ts`

ACs: AC-75 – AC-79, AC-81
Hours: 5
Workflow: inline-full
Shared files: none — `src/lib/conflicts.ts` is a new specific-name helper (§7).
Deps: M-19a

## Plan

### 1. Keep one agenda conflict path, but make its participant input role-aware

- Add a small `src/lib/conflicts.ts` helper that defines the four schedulable participation roles (`speaker`, `co_speaker`, `moderator`, `chairperson`) and returns shared participants by person ID after filtering to those roles.
- Preserve `getConflicts` in `src/routes/agenda.queries.ts` as the sole aggregator for room overlap, person double-booking, and delegated Transit conflicts. It will call the helper for the person set and push those findings into the existing `conflicts` array; dashboard, drawer, tile, and agenda payload consumers remain unchanged.
- Carry the participation role in the agenda speaker projection so the SQL-backed agenda path proves the same role-aware behavior as the pure conflict helper. Keep the existing public speaker shape backward-compatible for non-agenda readers.
- Apply the schedulable-role filter once through the shared conflict-participant helper for both double-booking and Transit `person_ids`; do not alter the Transit geometry or exact MRQ-63 message, and explicitly rerun its contract test.
- Dedupe agenda participant display objects by person ID while projecting the SQL rows, so a person holding two roles on one submission renders once and produces at most one person conflict per session pair.
- Do not add placement-time rejection or a second conflict endpoint/path. A conflicting POST/PATCH remains a normal successful mutation and the next agenda read reports the warning.

### 2. Extract and strengthen the structural track board

- Move the track-view component into `src/ui/agenda/track-board.tsx`, with stable markup for every track in the snapshot: one `section[data-track-lane]` per track, a track header, one day band per visible day, and fixed time-slot columns in each day band.
- Keep all track lanes mounted when a track filter is active; only session contents change. Give lanes and slots reserved minimum dimensions and use tabular time/count styles so adding a lane, filtering, or adding a conflict does not reflow neighboring controls.
- Preserve the existing drag/drop callback contract and fallback-room placement behavior. Render session tiles as descendants of the lane selected by `session.track_id`, with conflict flags and track coloring; retain room links and resize actions.
- Add the v1.9-style time axis/day-band treatment and accessible/data attributes that make the structural contract inspectable without relying on color classes.
- Add a one-click jump action to each conflict drawer row. It will select the track view/day, close the drawer, and scroll the target session into the reserved board area without changing the shared conflict computation.

### 3. Evidence and validation

- Add `tests/unit/agenda-conflicts.AC-76-77.test.ts` covering room overlap and a parameterized loop over all four roles, plus non-overlap behavior, duplicate-role participant behavior, and the warning payload shape.
- Add `tests/unit/agenda-track-board.AC-78-81.test.ts` rendering the track board markup and asserting lane count equals track count, each lane has the expected day/slot structure, and every session element is nested under its own track lane. Also assert a flagged tile and conflict drawer jump controls are present.
- Extend the agenda integration coverage with an `AC-75 + AC-79 · ...` test that creates an overlapping placement, asserts `201`, then reads the same shared `conflicts` payload. Do not modify the MRQ-63 transit contract test; run it explicitly as a regression checkpoint.
- Add `tests/ac-claims/MRQ-21.json` in the existing `ticket` / `owns` / `exercises` / `handoff` / `notes` shape; do not list test paths in the manifest. Put the C5 felt note in `notes`, and use the literal `AC-NN · ...` title prefix (including combined IDs) in every new test.
- Validate targeted unit/integration tests, the full local PR gate, and a running agenda API/UI smoke path in `in_validation`. Report C5 as an operator/deployed-infra checkpoint, not as agent-signed physical proof.

### Non-goals

- No edits to `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`.
- No changes to transit math or the exact MRQ-63 Transit message/byte-scan test.
- No stored conflict rows, placement blocking, new route module, or unrelated agenda views.

### Verification order

1. Rebase/fetch against `forgejo/master` and keep the branch root guard active.
2. Implement the role projection/helper and structural board together with AC-tagged tests.
3. Run targeted Vitest suites, TypeScript/build checks as exposed by the project scripts, and self-review the diff for one conflict path and DOM containment.
4. Transition through review and validation, run `npm run pr-gate -- --ticket MRQ-21`, attach evidence, create the Forgejo PR against `master`, push, and stop at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

The single plan review returned **PASS** with four minor findings. All are resolved as follows:

- **Role filter placement:** `src/lib/conflicts.ts` will expose the one filtered/deduped schedulable-participant projection. `getConflicts` will use it for person overlap, and `transitInputs` will use the same projection for Transit `person_ids`. Transit geometry and its exact message remain untouched; `tests/integration/api/agenda-transit.AC-258-259.test.ts` is an explicit regression command.
- **Duplicate roles:** the agenda SQL projection will preserve role while parsing, then dedupe each session's display participants by person ID. The unit conflict fixture will include one person with two roles on a submission and assert one person conflict for the pair.
- **AC-75 evidence:** the integration placement test carries `AC-75 + AC-79`; it asserts the hard persistence half and warning-only `201` behavior. C5 remains a felt/operator checkpoint, recorded in the claims notes and not self-signed.
- **Claims format:** `tests/ac-claims/MRQ-21.json` follows existing manifest fields and the AC title scanner's `AC-NN ·` convention; coverage comes from the test titles, not manifest paths.

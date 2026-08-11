# Plan Review: MRQ-21 (M-19b — Agenda: track swimlane and conflicts)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The four issues below are minor sharpening points, not blockers.

## 2. Summary

Reviewed the MRQ-21 plan against BUILDPLAN §4 (M-19b), the EVALUATION rows for AC-75–79/AC-81, and the live code it touches (`src/routes/agenda.queries.ts`, `AgendaPage.tsx`, `migrations/0001_init.sql`, the trace-ac/pr-gate harness). The plan is grounded in codebase reality: the `TrackBoard` it proposes to extract exists inline in `AgendaPage.tsx:421`, `getConflicts` is genuinely the sole aggregator, the `participations` schema already carries all four schedulable roles plus `submitter`/`sponsor_contact`, MRQ-20 leaves AC-75–79/81 unowned so no duplicate-owner error, and `preact-render-to-string` is available for the proposed markup tests. The key residual concern is precision about *where* the role filter is applied, because the same speaker projection feeds double-booking, transit inputs, and display.

## 3. Issues

**[MINOR] §1 — Role filter placement is ambiguous for the transit person set**
`transitInputs()` in `agenda.queries.ts:219` builds `person_ids` from the same `session.speakers` array the double-booking check reads. The plan filters roles "for the person set" via the new helper but also promises "no changes to transit math" and no edits to the MRQ-63 contract test — without saying which layer the filter lives at for transit. If the projection itself is filtered, transit inputs change silently; if only the helper filters, submitter/sponsor participations keep feeding transit. Either can be correct, but only one is intended.
**Recommendation:** State explicitly that the schedulable-role filter is applied once to the person set feeding *both* double-booking and transit inputs, and make the MRQ-63 transit test passing an explicit checkpoint in the verification order (it's currently implied by "run targeted suites").

**[MINOR] §1 — Duplicate person rows once role is carried in the projection**
`participations` is a `(person, submission, role)` triple: one person can hold two roles on one submission (the schema and AC-153 depend on this). `SPEAKERS_JSON` (`agenda.queries.ts:369`) has no dedupe, so carrying `role` per row means a two-role person appears twice in `session.speakers` — risking duplicated names on tiles and duplicate person-conflict entries from the pairwise scan.
**Recommendation:** Dedupe by person id where display shape is produced, and add one unit case: one person holding two roles across an overlapping pair → exactly one person conflict, one display entry.

**[MINOR] §3 — AC-75's tag should sit on a test that demonstrates its behavior**
AC-75 (`felt`, verdict at C5) is drag-placement persistence with no save control. The plan tags AC-75 onto the conflicts unit file and the board-markup file; trace-ac will count that as coverage, but markup rendering doesn't demonstrate persistence. The planned AC-79 integration test (create placement → 201 → re-read) is the honest automated half of AC-75's evidence.
**Recommendation:** Put the AC-75 tag on the persistence-asserting integration test (alongside AC-79), and keep the C5 operator note in the claims manifest as planned.

**[MINOR] §3 — ac-claims manifest format**
The plan says the MRQ-21.json claim will carry "the new test paths." The live format (`tests/ac-claims/MRQ-63.json`) is `owns` / `exercises` / `handoff` / `notes` — test linkage is discovered by the AC-prefixed test-title scan, not by paths in the manifest. Also mind the title convention: `trace-ac-core.mjs` rejects titles not matching `AC-NN · …`.
**Recommendation:** Follow the existing manifest shape; put the C5 felt note in `notes`; use the `AC-NN · ` title prefix in all new tests.

## 4. Positive Observations

- **Grounded in the actual code, not the ticket prose.** The plan correctly identifies that a track view already exists inline in `AgendaPage.tsx` (M-19a's v1.9) and frames the work as extraction-plus-strengthening rather than greenfield — which is exactly what the diff will look like.
- **Single-conflict-path discipline held.** Preserving `getConflicts` as the sole aggregator, feeding it a role-aware helper, and explicitly refusing a second endpoint or stored conflict rows matches both MRQ-63's architecture and SPEC §"conflicts are computed, never stored." The non-goals section fencing off the MRQ-63 byte-scan test and transit math shows real awareness of the adjacent contract.
- **AC-81 read correctly as structural.** One `section[data-track-lane]` per track, all lanes mounted under filters, data attributes making containment inspectable without color classes — this is precisely the "colour overlay alone fails" trap the task description warns about, addressed head-on.
- **Evidence classes handled per live convention.** The e2e runner is a stub owned by MRQ-50 (`run-e2e.mjs` says so explicitly), so covering the `e2e:`-class ACs with unit/integration tests now is the established pattern (MRQ-20 did the same for AC-70–82). C5 is correctly reported as an operator checkpoint on deployed infra, not agent-signed proof — matching EVALUATION's "the frame instrument's p95 is evidence, not the verdict."
- **Gate mechanics are exact.** `npm run pr-gate -- --ticket MRQ-21`, merged-scope trace, ac-claims manifest, AC-tagged filenames matching the existing naming style, and the "no reflow" lane rule (reserved dimensions, tabular numerals) aligning with the operator's elements-never-jump ruling — the plan was written by someone who read the harness.
- **Scope is honest for 5 hours**: one new pure helper, one component extraction, three test files, one drawer affordance. No speculative abstraction.

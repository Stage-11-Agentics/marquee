# MRQ-35: Category routing

BUILDPLAN: M-37 — Tier B rank 18 (US-12), Wave 2 (§5)

Scope (verbatim): track/format/vendor → plan/pool, stamped rule, any-carried-track match.

AC-234 constraint (Tier A, multi-track): routing rules match if **any** carried track qualifies — never only the primary.
AC-136: routing applies at submission time and the applied rule is **named on the submission record**.

ACs: AC-135 – AC-137, **AC-234**
Hours: 4
Workflow: inline-full
Shared files: none — module-local.
Deps: M-16, M-14
## Objective and acceptance shape

Implement category routing at public-submission time without creating a second authorization path. The first enabled rule matching the submitted format, carried tracks, or vendor flag stamps `submissions.applied_rule_id`, routes the submission to its configured evaluation target, and makes the applied rule name available on the admin submission record.

The automatic reviewer-pool path must preserve all merged isolation seams: event ownership, committee event ownership, reviewer membership, and carried-track intersection through `reviewerCanBeAssignedToSubmission`. A pool route that would expose a submission to any committee reviewer outside the carried-track scope fails closed before an assignment row is committed. The test must assert the error status and unchanged `round_assignments` count, plus a correctly scoped positive control that writes an assignment.

## Artifacts to read before edits

- `SPEC.md` §3.10 and §5.4–5.5; `EVALUATION.md` AC-135–137 and AC-234 rows; `sequence/USER_STORIES.md` US-12 and Amendment 2.
- `migrations/0001_init.sql` routing, submission, evaluation-round, committee, scope, and assignment tables; `src/db/schema.ts` row contracts.
- `src/routes/public-form.routes.ts` and `src/routes/public-form.shared.ts` as the existing public write/project/persist seam.
- `src/lib/form-conditions.ts` for the established condition semantics; do not create a competing field-answer evaluator.
- `src/lib/reviewer-scope.ts` and `src/routes/evaluation.routes.ts` for the centralized pre-write assignment guard and committee-pool assignment representation.
- `src/routes/submission-record.routes.ts` and `src/ui/submissions/SubmissionRecordPage.tsx` for named routing-record output.
- Existing Worker fixtures and claim manifests under `tests/integration/api/`, `tests/ac-claims/`, and `scripts/checks/trace-ac*.mjs`.

## Implementation plan

1. Add module-local routing decode/match/target helpers at the public-form boundary. Parse the persisted `{field, op, value}` / `{plan_id|committee_id}` JSON defensively, evaluate rules in `position, id` order, and fail closed for malformed rules. Match format by event-owned id/name, vendor by the normalized vendor affiliation/flag, and tracks by **any** carried track (id or event-owned name), never only `primary_track_id`. Keep all lookups event-scoped.
2. Apply the selected rule in `handlePublicSubmission` after answer projection/domain-reference validation and before mail or other downstream side effects. Stamp `applied_rule_id` on both new and resumed submissions. A plan target records the plan route; a committee target resolves the event-owned active round and materializes the committee pool assignment. Support an explicit round/plan target when present so a rule cannot silently cross plans or events.
3. For committee routing, stage only the candidate submission/track state needed by the existing `reviewerCanBeAssignedToSubmission` helper, validate every committee member before inserting any `round_assignments` row, and roll back the staged submission-side changes on refusal (including resumed drafts). On success, write the pool assignment and finish answers/participants/attachments/outbox through the existing public-form writers. Never enqueue confirmation/admin mail for a refused route. Preserve idempotent behavior for a resumed submission and existing assignment rows.
4. Extend the record query/response to join the event-owned routing rule name and return `{ rule_id, name }`; render that named provenance in the existing submission-record surface with stable geometry. Do not alter generated route naming, public API paths, unrelated form conditions, reviewer authorization, or contract documents.

## Tests and evidence

- Add `tests/integration/api/category-routing.AC-135-137-234.test.ts` with a real Worker/D1 fixture covering format, vendor, and track rules; zero-track rejection; first-track primary preservation; any-carried-track matching where only a secondary track qualifies; first-position rule selection; plan stamping; vendor routing away from the mainstage target; and the named record response.
- Include a committee-pool isolation test with one out-of-scope committee reviewer: assert the submit response is the expected 422, the `round_assignments` count is unchanged, and no assignment/submission leakage is observable; then add a positive scoped reviewer control and assert the count increases with the expected committee/round/submission row.
- Add `tests/ac-claims/MRQ-35.json` with `owns: ["AC-135", "AC-136", "AC-137"]`, `exercises: ["AC-234"]`, and no invented ACs. Keep every AC-tagged test title prefixed with the complete AC set it covers.
- Run focused Worker tests, `npm test`, `npm run trace:ac -- --scope=all --ticket MRQ-35`, `npm run check:api`, and the mandatory `npm run pr-gate -- --ticket MRQ-35`. Record separate implementation review and running-system validation artifacts against the exact branch HEAD.

## Non-goals and safety constraints

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; do not mint AC IDs.
- Do not add a second reviewer-scope predicate, bypass `reviewerCanBeAssignedToSubmission`, or write a committee assignment before all reviewer checks pass.
- Do not introduce a new migration or broaden automatic routing to admin/import writes in this ticket unless existing code requires a narrowly scoped shared behavior; public submission-time routing is the contract seam.
- Do not add secrets, internal paths, c11 identifiers, or Stage 11 implementation details to committed public-repo files.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

1. **AC-234 claim collision [ACCEPTED AND AMENDED].** MRQ-5 already owns AC-234, so MRQ-35 exercises it while owning only AC-135, AC-136, and AC-137. MRQ-35's test names may still carry AC-234 coverage; the manifest no longer creates a duplicate owner and `trace:ac` remains runnable.
2. **Public refusal semantic [RETAINED BY BINDING BOOT PROMPT].** The reviewer's suggestion to accept the public submission and skip routing conflicts with the ticket's explicit operator guardrail: a routing rule that would place a submission outside a reviewer's track scope is refused and must write no `round_assignments` row. MRQ-35 therefore returns a public-safe 422 before confirmation/admin mail. The message names a routing failure in conference language and does not expose reviewer IDs, committee IDs, or internal scope details. The test proves both the status and unchanged assignment/submission counts, plus a positive control.
3. **Rollback mechanism [ACCEPTED AND MADE EXPLICIT].** For a new submission, stage a draft shell plus candidate `submission_tracks` rows only; for a resumed draft, snapshot its submission scalar columns and existing `submission_tracks` rows, then replace only the candidate tracks. Run the existing `reviewerCanBeAssignedToSubmission` helper for every committee member. On refusal, delete staged `submission_tracks`, delete the new shell (or restore the saved scalar/track rows for a resumed draft), and remove only a newly-created person with no remaining foreign-key references. Do not touch `submission_answers`, `participations`, `attachments`, `outbox`, or assignment rows until all reviewer checks pass. This is cleanup of the exact staged tables, not a second scope predicate.
4. **Pool representation and round resolution [ACCEPTED].** A successful committee route writes one `round_assignments` row with `committee_id` set and `reviewer_person_id` null; read-time reviewer authorization remains responsible for each member's own event/track intersection. A target `plan_id` must belong to the conference and be open; its lowest-position round is selected. A committee-only target selects the lowest-position round from the most recently updated open conference plan. An explicit `round_id`, when present in `then_json`, must belong to the conference and an open plan. Missing/closed/no-round targets fail with the same public-safe 422 before side effects. The positive fixture proves the scoped committee member can reach the queued submission, not merely that a row exists.

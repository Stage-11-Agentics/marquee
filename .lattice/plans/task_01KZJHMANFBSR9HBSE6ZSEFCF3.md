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
- Add `tests/ac-claims/MRQ-35.json` with `owns: ["AC-135", "AC-136", "AC-137", "AC-234"]` and no invented ACs. Keep every AC-tagged test title prefixed with the complete AC set it covers.
- Run focused Worker tests, `npm test`, `npm run trace:ac -- --scope=all --ticket MRQ-35`, `npm run check:api`, and the mandatory `npm run pr-gate -- --ticket MRQ-35`. Record separate implementation review and running-system validation artifacts against the exact branch HEAD.

## Non-goals and safety constraints

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; do not mint AC IDs.
- Do not add a second reviewer-scope predicate, bypass `reviewerCanBeAssignedToSubmission`, or write a committee assignment before all reviewer checks pass.
- Do not introduce a new migration or broaden automatic routing to admin/import writes in this ticket unless existing code requires a narrowly scoped shared behavior; public submission-time routing is the contract seam.
- Do not add secrets, internal paths, c11 identifiers, or Stage 11 implementation details to committed public-repo files.

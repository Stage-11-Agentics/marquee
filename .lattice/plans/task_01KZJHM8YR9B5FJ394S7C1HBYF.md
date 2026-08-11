# MRQ-17: Evaluation plan, committees, and reviewer track scopes

BUILDPLAN: M-16 — Wave 1 (§4), walkthrough step 7

Scope (verbatim): Plan, optional weighted scorecard, two rounds, committees, both assignment modes, per-reviewer progress, and explicit one-or-more reviewer track responsibilities editable by managers. One centralized intersection helper is exported for M-17 and audits.

Binding: the centralized helper `src/lib/reviewer-scope.ts` is **the** authorization path. Every reviewer route — queue, record, file, export, evaluation-write — invokes it; A-9 scans for a route that does not.
Non-goal (EVALUATION §5): multi-round beyond two. Two ordered rounds and funnel promotion ship; the schema is round-aware from the first migration, so a third round is data, not a migration.

File surface: `src/routes/evaluation.routes.ts`, `src/lib/reviewer-scope.ts`, `src/ui/evaluation/*`

ACs: AC-53 – AC-58, AC-98, **AC-246**
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `src/lib/reviewer-scope.ts` — created here, **added to, never rewritten** by M-17 and the audits.
Deps: M-08
Audit that keys off this ticket: A-9 (reviewer event+track isolation), from CP-2
## Implementation plan

### Ground truth and boundaries

- Build on `forgejo/master` at the rebased starting point `25b234d2bb0150b427f5dcb704c34bd1f59c883c` and the merged MRQ-5 seed. Do not alter contract documents or mint ACs.
- Keep the wire vocabulary under `/api/v1/events/...`; user-facing copy uses “conference”. Route modules must be named `*.routes.ts` so the generated manifest and OpenAPI stay in parity.
- Treat the existing M-02 schema, MRQ-3 credential resolver, MRQ-8 grant pipeline, and MRQ-5 seed as binding foundations. Do not weaken event-scoped reviewer memberships, the round-aware tables, seeded 40 organizer-unreviewed assignments, or seeded reviewer track scopes.
- The schema is round-aware but this ticket exposes exactly two ordered rounds. No third-round UI or migration is in scope.
- The binding visual contract is the Flight Deck evaluation screen in `DESIGN.md` and `prototypes/pipeline-v1.1/index.html`: two-round funnel, optional scorecard, program committee/progress, summary, and promotion controls with stable geometry, tabular figures, and honest states.

### Data and authorization core

1. Add `src/lib/reviewer-scope.ts` as the sole intersection authorization helper. Given the authenticated principal/event, round, submission, and operation, it will verify event-scoped reviewer authority, explicit reviewer track scopes, and the submission’s carried tracks; it will fail closed and return `ApiError.forbidden()` without a submission/identity lookup being exposed to callers. It will support queue candidate checks, detail/file/export reads, evaluation writes, and manager scope edits without duplicating route-local predicates.
2. Add `src/routes/evaluation.routes.ts` to the manifest. Implement typed admin plan/round/criterion/committee/scope/assignment endpoints and the reviewer queue, submission detail, file metadata, export, and evaluation-write endpoints required by the contract. Every reviewer endpoint will call the helper directly; manager scope writes will validate event and committee membership, require one-or-more scopes, and preserve completed evaluations when scopes change.
3. Enforce domain invariants at the route/service boundary: weighted criteria total exactly 100%, plan creation is order-independent, a plan must be open before reviewer assignment, two rounds are ordered and distinct, assignment modes are `everyone` or N-per-submission, assignments are deterministic/idempotent, completed assignments are not replaced by scope recalculation, and reviewer writes cannot change lifecycle status. Use the shared API error envelope and no metadata-bearing 404/403 responses for concealed reviewer records.
4. Return evaluation plan detail shaped for the UI: rounds with progress/remaining counts and criteria; named committees with reviewer progress and track responsibilities; summary counts/distribution; and promotion preview data. Keep list/filter semantics server-side and avoid seed-specific hard-coding.

### UI

1. Add `src/ui/evaluation/EvaluationPage.tsx` and `src/ui/evaluation/evaluation.css`, wired through `AppShell` for `/evaluation`, preserving the existing route-table label and shell. Reproduce the prototype’s plan card, two-round funnel, scorecard line/edit affordance, committee rows, summary metrics/sparkline, and round-promotion preview.
2. Make plan creation/editing, scorecard criteria editing, committee management, assignment distribution, promotion preview, and reviewer track-scope editing real controls backed by the API. Copy must say “conference”; counts, IDs, progress, and timestamps use monospaced/tabular styling.
3. Include loading, empty/no-plan, validation-error, save-error, and success states without layout jumps. Scope edits must visibly state that queue membership is recalculated while completed reviews remain.

### Tests and AC traceability

- Add `tests/integration/api/evaluation.test.ts` with static AC-tagged names covering AC-53 through AC-58, AC-98, and AC-246. Exercise the real Worker/API and migrated D1 fixture, including plan creation permutations, weighted-score validation, open-plan assignment, both distribution modes, two ordered rounds, committee membership/progress, multi-track intersection, manager scope edits, all reviewer surfaces, and a guessed out-of-scope ID asserting `403` and no identifier/title/identity metadata.
- Add focused unit coverage for the centralized helper if useful, but keep the route-scan assertion in the AC-246 integration test: every queue/detail/file/export/evaluation-write route must import/invoke the same helper and no reviewer route may bypass it.
- Add `tests/ac-claims/MRQ-17.json` mapping only AC-53, AC-54, AC-55, AC-56, AC-57, AC-58, AC-98, and AC-246 to the new test file. Do not claim downstream reviewer-queue ACs owned by MRQ-18.
- Verify MRQ-5’s seeded first-load queue remains populated and add no duplicate seed assignments or scope rows.

### Verification and handoff

1. Run focused evaluation tests, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope=merged`, and `npm run check:design` as applicable; diagnose and fix failures rather than weakening assertions.
2. Perform inline self-review against the exact branch HEAD, especially all route-module filenames, centralized-helper call sites, event/track intersections, no-metadata forbidden responses, two-round ordering, and prototype copy/layout. Attach a standard-shaped `PASS` review artifact naming that exact HEAD because headless plan/code review is suspended.
3. Bump `in_validation`, run the closest available live/API validation against the seeded first-load path, and attach evidence (or an explicit N/A only if the environment cannot host it). Run `npm run pr-gate -- --ticket MRQ-17`; a red gate blocks PR creation.
4. Commit meaningful units with the worktree-root guard, push to `forgejo mrq-16-evalplan`, verify remote HEAD equality, create the Forgejo PR against `master`, attach its URL, bump `pr_open`, and send the Orchestrator at workspace:9/surface:60 the final state and gate result. Stop at `pr_open`; the Orchestrator merges.

### Known risks / decisions

- Existing `committee_members` has no explicit event column; committee ownership is checked through its event and member/person relationships rather than inventing a schema change. If implementation reveals a contract/schema contradiction, keep the correct behavior and flag it in the completion comment.
- The current API route policy can enforce grants before handler execution, but AC-246’s track intersection is resource authorization and must remain in the shared helper, not be treated as satisfied by a broad `review:write` grant.
- The current binding prototype uses example counts; runtime UI will use API-derived values while retaining its visual structure and copy, with no fabricated “success” state when the API is empty or failing.

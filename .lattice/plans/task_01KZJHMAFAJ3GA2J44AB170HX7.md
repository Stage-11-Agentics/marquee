# MRQ-33: Admin create, the submission record, and the program board

BUILDPLAN: M-32 (rank 13, US-22) + M-53 (rank 10, US-75) — Wave 2 (§5) · MERGED at mint (5 h + 4 h = 9 h; M-53 depends on M-32 plus their shared M-08, and AC-243 makes the board a thin read-only surface **onto** the record — "the record owns every stage-appropriate action")

**M-32 — Admin create + record** (5 h, ACs AC-118 – AC-120, AC-240, AC-243, dep M-08)
Scope (verbatim): abstract/session, bypass, origin, participants/answers/scores/routing/history, scheduled slot visibility, stage actions on record.
Amendment 10 fold (SPEC.md, post-BUILDPLAN-v1.4 — flagged to the orchestrator; SPEC allocates +1 h): the record's **evaluation panel** lists its current reviewers per round with coverage counts; an admin can assign or remove a specific reviewer there (writing `round_assignments`), the affected reviewer's queue updates, and track-scope rules are still enforced. API/CLI equivalent is `/rounds/:id/assignments` CRUD. **AC-251.** *(SPEC tags the UI "beyond v1.5 prototype — acknowledged divergence, build per spec.")*

**M-53 — Read-only Program board** (4 h, ACs AC-238, AC-243, deps M-08/M-32)
Scope (verbatim): every non-draft submission once across seven stages, full filters/count/reset, card click/Enter/Space to record, no drag/actions on cards, record owns confirmations/cascades; virtualized at seed scale.
AC-243 is a client ruling (Amendment 7), replacing struck AC-239: **no card drags, no lifecycle action on cards.** Consequential actions belong on the detail screen, deliberately. Agenda drag/drop is unchanged. `trace:ac` fails if AC-239 is treated as live or reused.

ACs (union): AC-118 – AC-120, **AC-238, AC-240, AC-243** · **AC-251** (Amendment 10 fold)
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local.
Deps: M-08
Speed: the board must stay inside the full-seed *objective* budget (measured and reported, not a gate); virtualization is the stated mechanism.
## Plan metadata

- Repository root: `/Users/atin/Projects/Stage11/deployments/Marquee`
- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-33-record-board`
- Ticket UUID: `task_01KZJHMAFAJ3GA2J44AB170HX7`
- Ticket: `MRQ-33`
- Actor: `agent:delegator-mrq-33`
- Buildplan: `M-32 + M-53`
- Working base: `forgejo/master @ a3b55b332bc93d11b301dcdd3d4074cec2473352` (branch rebased from the supplied `40bfda6` cut point before implementation; `npm ci` completed after the rebase)
- Workflow: inline self-review; headless plan/code reviews are suspended for this run

## Binding scope

Implement AC-118, AC-119, AC-120, AC-238, AC-240, AC-243, and AC-251. The product surface is a conference-scoped admin submission record plus a read-only `/board` projection. AC-243 is authoritative: cards have no drag behavior and no lifecycle controls; click, Enter, and Space only navigate to the record. Agenda drag/drop is outside this ticket and must remain unchanged. AC-239 is struck and must not appear in code, tests, claims, or review text.

The record owns the stage-appropriate actions and existing decision/cascade writer. The evaluation panel must show per-round reviewers and coverage, support single-reviewer assignment/removal through `round_assignments`, update the reviewer queue, and reject a reviewer outside the submission's carried-track scope before any assignment row is written.

## Artifacts to read before edits

- `CLAUDE.md`, `sequence/run-state.md`
- `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, `sequence/USER_STORIES.md`
- `prototypes/pipeline-v1.1/DIRECTION.md` and the binding prototype board/record signals
- `migrations/0001_init.sql`, `src/db/schema.ts`
- `src/routes/submissions.queries.ts`, `src/routes/submissions.routes.ts`, `src/routes/submission-decisions.routes.ts`, `src/jobs/cascade/decisions.ts`
- `src/routes/evaluation.routes.ts`, `src/lib/reviewer-scope.ts`, `src/api/list.ts`, `src/routes/_manifest.ts`
- `src/ui/shell/AppShell.tsx`, `src/ui/shell/route-table.ts`, `src/ui/submissions/*`, `src/ui/dashboard/*`
- Existing AC claim files under `tests/ac-claims/` and integration fixtures under `tests/integration/api/`

## Implementation plan

1. Add the record API as a manifest-discovered `*.routes.ts` module. `POST /api/v1/events/{eventId}/submissions` creates an admin-origin abstract/session with kind-specific bypass semantics, validates event-owned format/tracks/wave/people/forms, persists participants, answers, tracks, and routing provenance, and writes an audit history entry. `GET /api/v1/events/{eventId}/submissions/{submissionId}` returns the complete admin record: lifecycle/origin/bypass, participants, answers, track/format/wave/routing data, scores/evaluations by round, scheduled slot (`day`, `time`, `room`, `building`, timezone and publication state), decision/history records, and stage-action metadata. Add the smallest record-owned mutation routes needed by the UI (including publish/placement affordance where the existing agenda model supports it) while routing consequential decisions through `writeSubmissionDecision`/the shared `insertDecisions` path.
2. Add a board read API as a manifest-discovered `*.routes.ts` module. Reuse the canonical list query shape (`page`, `per_page`, `q`, `sort`, and typed filters) and return stable board columns/counts plus cards. Exclude drafts, derive exactly one stage per non-draft submission in the order Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published, preserve scheduled/public slot metadata, search title/ID/company/speaker, and filter by type, any carried track, format, and wave. Keep the query bounded and expose enough total/count data for a virtualized seed-scale client.
3. Extend evaluation assignment handling for AC-251 without weakening MRQ-3 scope enforcement. Add read/list and delete assignment routes plus a direct create branch on `/rounds/{roundId}/assignments`; validate round/submission event ownership, reviewer event membership, and at least one shared `submission_tracks`/`reviewer_track_scopes` track before inserting. Reject out-of-scope assignment with the normal error envelope and prove both status and zero new `round_assignments` rows. Preserve existing distribution mode behavior and ensure queue reads use the centralized reviewer authorization helper.
4. Build the admin UI pages for `/submissions/new`, `/submissions/:id`, and `/board`, matching the Flight Deck tokens and prototype layout. The board uses fixed-width filter controls/count slots, composed filters with a reset, tabular counts, explicit `—` placeholders, stable card geometry, keyboard activation, and windowed/virtualized column rendering at seed scale. Cards contain no `draggable`, drag handlers, accept/reject/publish buttons, or other lifecycle controls. The record renders the full data panels, scheduled `day · time · room`/`Not yet public` state, history, record-owned stage actions and confirmation affordances, plus the per-round evaluation coverage/assign/remove reviewer controls.
5. Add an AC-tagged integration/static test under `tests/` covering the admin create/record contract, bypass-to-agenda behavior without an evaluation row, admin origin marker, board one-card-per-non-draft/derived-stage/filter/reset contract, scheduled legibility, keyboard/read-only board behavior, assignment CRUD/queue update, and the out-of-scope assignment invariant (assert response status and unchanged assignment-row count). Add `tests/ac-claims/MRQ-33.json` claiming only this ticket's ACs, with no AC-239 reference.

## Non-goals and safety constraints

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`.
- Do not remove or alter agenda drag/drop.
- Do not add card lifecycle actions or revive AC-239.
- Do not create a second decision writer or a second reviewer-scope policy.
- Keep routes under `src/routes/*.routes.ts` so generated manifest and `check:api` see them.
- Keep public-repo files free of secrets, internal paths, c11 identifiers, and real credentials.

## Verification and handoff

- Baseline observed: `npm test` passed after `npm ci` (only expected missing-secret warnings).
- Before commit: run `npm test`, type/build checks used by the repo, `npm run trace:ac`, and targeted AC tests; inspect the diff for forbidden drag/AC-239 regressions.
- At the validation phase, run the local PR gate and a running-system probe of the board, record, create, decision, scheduled visibility, and assignment flows. Measure/report the board seed-scale render rather than replacing virtualization with a large DOM.
- Before PR: `npm run pr-gate -- --ticket MRQ-33`; paste its result into the completion comment. Push the branch after the first commit and every meaningful commit, verify the remote head, open the Forgejo PR against `master`, attach its URL, add a standard-shape self-review naming exact `HEAD`, attach validation evidence, and stop at `pr_open`.

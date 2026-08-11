# MRQ-76: Pipeline stage derivation — implementation plan

## Goal

Make the landing preview, dashboard pipeline, program board, and filtered
submission lists answer the same stage question. The invariant is mechanical:
for every dashboard pipeline item, the count equals the `total` returned by its
own `href`; the board assigns every non-draft record to exactly one displayed
column; record actions use that same derived stage.

## Scope and binding boundaries

- Actor: `agent:delegator-mrq-76`.
- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-76-pipeline-stage-derivation`.
- Branch: `mrq-76-pipeline-stage-derivation`, rebased from `github/main @ ba22fb3`.
- Remote/base: `github` / `main`. Forgejo is retired and is not part of this work.
- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`,
  `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; do not add a migration or
  change `package.json`.
- Do not touch `src/ui/shell/route-table.ts`,
  `src/ui/dashboard/DashboardPage.tsx`, `src/ui/embeds/*`, or
  `src/routes/embed.route.tsx`. Their labels and ownership remain unchanged.
- Preserve landing's one statement-level D1 read, the public-path speed budget,
  existing route names/OpenAPI registry, and the seven dashboard/sidebar stages.

## Semantic ruling

Stages are literal, derived stages rather than cumulative milestones. A row is
counted by a stage only when the same predicate can select it from the list
behind that stage.

- `submitted` is the literal `submissions.status = 'submitted'` stage. The
  shipped 1,000-row seed currently contains no such rows; smoke evidence must
  record `0 = 0` explicitly rather than turn another status into Submitted.
- `in_review` is literal `status = 'in_review'`.
- `waved` is an accepted submission assigned to a wave whose `waves.sent_at IS
  NULL`, with no agenda placement. This is the pre-notification staging area;
  it must not be an alias for Accepted.
- `accepted` is an accepted, not-yet-scheduled/published submission that is not
  in the derived Onboarding or pending-Waved sets.
- `onboarding` is an accepted, not-yet-scheduled/published submission with at
  least one open, non-cancelled speaker task and no pending wave. A pending-wave
  row is Waved even if it also has open work, keeping the forward stages
  mutually exclusive. Its count is submissions, matching the submissions-list
  destination; speaker/person totals stay named as such on the chase surface.
- `scheduled` and `published` are agenda-derived and mutually exclusive.
- Rejected, waitlisted, and withdrawn rows are terminal `declined` records for
  the board. They must not be counted or labelled Waved. This is the one
  deliberate board-only extension beyond the seven forward pipeline stages,
  required because the existing seven-stage board had no honest terminal bucket;
  the PR will call out this SPEC-visible ruling.

## Implementation

1. **Centralize the SQL vocabulary.** Extend
   `src/routes/submissions.queries.ts` so `submissionStatusPredicate` expresses
   the derived stage rules above, including agenda exclusion for Accepted and
   Onboarding and the pending-wave `sent_at` check. Keep alias support for
   dashboard, landing, board, and record queries, and preserve the existing
   unreviewed/task/notification filters. Add focused unit coverage that uses a
   fixture distribution containing every raw status, agenda state, task state,
   sent/pending wave, and a positive control proving Waved and Accepted are
   different sets.

2. **Make landing and dashboard consume the vocabulary.** In
   `src/routes/landing.route.tsx`, replace the hand-written cumulative/people/
   agenda counts with the shared stage predicates inside the existing one-read
   statement. Keep review-pressure and overdue-speaker metrics separate and
   honestly named. In `src/routes/dashboard.routes.ts`, keep the seven pipeline
   IDs and hrefs, derive each count from the shared predicates, and update only
   the server-side notes/secondary metrics needed to make nouns and destinations
   honest. Ensure wave rows and the Unscheduled metric use the same predicate as
   their linked list, so the dashboard-wide count/link invariant holds.

3. **Reconcile board derivation and terminal visibility.** In `src/api/board.ts`,
   build `BOARD_STAGE_SQL` from the shared stage predicates in the same
   precedence order as the list/status projection, add an explicit
   `declined` BoardStage/label/entry action, and ensure column counts sum to the
   non-draft card total under every filter. Update the minimal board presentation
   contract only as necessary to render the eighth terminal column and keep its
   copy/layout truthful; do not change the sidebar or dashboard component.
   `src/routes/board.routes.ts` remains a registry-preserving pass-through.

4. **Gate record actions on derived stage.** In
   `src/routes/submission-record.routes.ts`, retain the shared board stage
   projection and replace raw-status checks for `can_decide` and `can_schedule`
   with the stage that the reader sees. A scheduled or published accepted record
   must not expose decision buttons; a record that is no longer an unplaced
   Accepted stage must not expose scheduling as if it were still there.

5. **Build the cross-surface regression net.** Extend the existing dashboard and
   board integration fixtures/tests and add a dedicated MRQ-76 integration test
   over one seeded event. For each dashboard pipeline item, request its linked
   submissions list and compare `total`; compare landing stage counts and board
   column counts for the corresponding stages; assert the board's declined
   positive control is not Waved; assert Waved and Accepted IDs differ; assert
   the scheduled record's detail actions are resolved. Keep tests worker-free
   where the predicate can be tested directly and Worker-backed where D1 joins,
   landing SSR, or API routing is the subject.

## Verification sequence

1. Commit and push this plan as the first commit, then move Lattice through
   `planned` and `in_progress`; run `npm ci` before trusting any test result.
2. Run focused unit/integration tests while iterating, then the relevant full
   suite. Re-run `check:design`, `check:speed`, `check:seed`, and route/API
   parity as required by the local gate.
3. Self-review the implementation adversarially, attach a post-`review` PASS
   artifact naming the exact HEAD, and transition to `in_validation`.
4. Start only this worktree's Worker with `npx wrangler dev --port 8801`.
   Using the c11 embedded browser, walk `/` → `/dashboard` → `/board` → every
   `/submissions?status=` pipeline filter and the scheduled record. Capture the
   observed counts, list totals, board columns, Waved/Accepted ID difference,
   and action visibility. Treat the seed's literal `Submitted 0 = 0` as an
   explicit observed zero, not as a success claim for a non-existent row.
5. Run `npm run pr-gate -- --ticket MRQ-76` immediately before publication and
   paste its exact result into the completion comment. Push to `github`, create
   the GitHub PR with `gh pr create --repo Stage-11-Agentics/marquee --base main`,
   attach the PR URL, bump to `pr_open`, and stop there.

## Non-goals and follow-ups

- No migration, schema/status rewrite, seed-count rewrite, dashboard component
  edit, sidebar label edit, embed edit, deployment, merge, or publication claim.
- The terminal board column is intentionally documented as a semantic ruling;
  if the contract owners want it folded into a future eight-stage SPEC revision,
  that is a separate contract-doc follow-up, not an excuse to put rejected or
  waitlisted records back under Waved.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Concern: the seed has no literal Submitted rows, so a positive-only smoke
  assertion would force a dishonest derivation.** Resolved by preserving the
  literal predicate and making the invariant `displayed count == linked-list
  total`; the live evidence names the legitimate `0 = 0` state.
- **Concern: adding a terminal board bucket could silently drop cards or make
  the board total disagree.** Resolved by including `declined` in the board
  stage registry, asserting column-count sum equals non-draft total, and making
  the presentation render the returned column.
- **Concern: accepting the existing raw Accepted predicate would leave
  scheduled/published/onboarding records in multiple stages.** Resolved by
  deriving agenda and task stages first and defining Accepted as the remaining
  unplaced accepted set; record actions use the same stage projection.
- **Concern: landing fixes could add D1 round trips.** Resolved by embedding the
  shared predicates in the existing landing statement and retaining the existing
  schema-compatibility probe without introducing any stage-specific reads.

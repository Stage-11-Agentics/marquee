# MRQ-134: Evaluation is an open seat — agent evaluator identity, badge, skill, and seeded evidence

## Working contract

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-134-agent-evaluator`
- Branch: `mrq-134-agent-evaluator`; remote: `github`; base observed after refresh: `github/main @ 72648d6368917b105edd8fdbe699648d5c2dfcd2`
- Binding design: `sequence/agent-evaluator-design.md`; contract docs are read-only.
- MRQ-109 is present on this base (`7c064bd1`), so the chair results table is in scope for the neutral `Agent` badge.
- Migration number is not assumed: re-check merged `github/main` immediately before creating the migration and take the next free number, currently 0013.
- Validation approval/scope: the requested local app only, using c11's embedded browser plus the local CLI; create one agent seat, copy its one-time secret, assign/write one evaluation, inspect the chair record beside a human review, and reset the demo. No external domains or real credentials.

## Build sequence

1. **Schema and identity.** Add the next-free `NNNN_agent_evaluator_seats.sql` migration for `people.kind`, `api_tokens.acts_as_person_id`, the partial index, and matching schema types. Extend token principals/auth resolution with `actingPersonId`; a bound token resolves only its seat, and resolution re-checks that the person is still an agent. Update `reviewerPersonIdForEvent`'s comment and implementation so session identity or a valid bound agent seat flows through the existing event, membership, track, and assignment checks unchanged.

2. **Credential and seat authority.** Reuse the existing API-token issuance/secret-panel seam. Add the transactional agent-seat creation endpoint on the evaluation committee surface: agent person, reviewer membership only, committee member, track scopes, and a bound `review:write` token in one transaction. Reject human bindings and extra grants at issue; enforce org/event scope, reviewer-only membership, issuer/seat separation, revocation behavior, and no evaluation deletion. Do not add a reviewer-specific branch to the evaluation write handler.

3. **UI and aggregate semantics.** Add `Add agent evaluator` beside the existing committee controls, with name and track responsibilities. Render the returned secret through the existing shown-once panel component. Carry `kind` through reviewer/assignment/evaluation/result payloads. Render a fixed-width neutral `Agent` Chip at every current reviewer-name surface: submission evidence, evaluation-panel assignment rows/select, and the landed chair results table. Exclude agent scores from human aggregates while rendering a labelled agent line; preserve assignment coverage counting and existing human override/upsert behavior. Do not add model invocation, scheduling, or a second secret UI.

4. **CLI and skill.** Add `review queue`, `review show`, and `review submit` with the existing command registry, authentication, error, and `--json` conventions. Regenerate `SKILL.md` through `cli/generate-skill.mjs`; place the Review section between Triage and Chase and include authentication, empty-queue meaning, verbatim reasoning, re-submit ownership, organizer-only decisions, and a queue → record → rationale submission worked loop. Keep user-facing vocabulary `Agent`, never `AI`.

5. **Seed and claim/evidence coupling.** Extend reset-demo's canonical fixture to create `Triage agent`, assign it to `Taming 40-Minute CI`, write a substantive rationale mentioning that abstract's CI duration, monorepo, and build caching, and retain a human evaluation on the same record. Add the public “Evaluation is open” claim only in the same change, with static protection that the claim cannot exist without seeded agent evidence. Preserve one-seat-per-agent idempotent re-submit semantics.

## Verification matrix

- **AC-288:** integration/API test for one transactional seat and end-to-end bound-token evaluation with score, criteria scores, comment, seat attribution, and chair read; UI test asserts the existing shown-once panel identity.
- **AC-289:** distinct tests for human binding rejection, live kind flip fail-closed, unbound-token 403/empty queue, missing track scope, missing assignment, and shared `authorizeReviewerScope` call-site enumeration.
- **AC-290:** issuer-route denial, grant restriction, reviewer-only membership, revoke → 401, and byte-identical surviving evaluation attribution.
- **AC-291:** agent and human rows coexist; each re-submit updates only its own row; static scan proves no model runner/cron/queue/UI invocation path.
- **AC-292:** aggregate excludes agent scores, agent line is labelled, and completed agent assignment contributes to coverage.
- **AC-293:** reset-demo e2e record shows substantive agent and human evidence side by side, badges with stable row geometry, and static claim/evidence coupling.
- Run focused tests while implementing, then `npm run pr-gate -- --ticket MRQ-134` from this worktree. If a rebase lands another migration/surface, rebase, run `npm ci`, and re-gate exact HEAD.
- Run the real smoke against `npx vite dev`: create the seat in the UI, take the one-time token, use the actual CLI `review submit` on an assigned submission, inspect the chair record beside a human, then reset-demo and confirm seeded evidence without setup.

## Plan review cycle 1 — self-review resolutions (authoritative)

- Keep the evaluation write route generic; identity and authorization must be supplied through `Principal`/`reviewer-scope.ts`.
- Treat `kind='agent'` as a live authorization predicate at both issue and resolution; never trust a token's stored binding alone.
- Use the existing reviewer assignment/coverage and API-token secret-panel seams; no parallel subsystem or secret UI.
- Because MRQ-109 is on the refreshed base, include its results payload/query/UI in the badge and aggregate work; do not create another results table.
- Keep the public claim and seeded evidence in one commit lineage and test both directions of the static coupling.

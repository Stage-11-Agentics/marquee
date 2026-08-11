# MRQ-69 plan: make the seed exercise the product

## Authority and starting point

- Ticket: MRQ-69; actor: `agent:delegator-mrq-69`.
- Repository root: `/Users/atin/Projects/Stage11/deployments/Marquee`.
- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-69-audit-remediation`.
- Branch: `mrq-69-audit-remediation`, aligned to `forgejo/master` at `3556b4fe145b390802c63a84aae8c18d4afb34bf` before this plan.
- Binding inputs read: `sequence/code-quality-audit.md`, `.lattice/orchestration/boot/COMMON.md`, the MRQ-69 task description, and the repository contract artifacts referenced by COMMON. Contract documents will not be edited.
- The audit's unifying failure is binding for this implementation: the product code is mostly present, but the shipped seed does not exercise the reviewer detail, session actions, or conditional answer path.

## In-scope implementation

### 1. Make seeded reviewer detail real

Inspect the existing pool, accepted-core, form, event, and attachment schema/helpers before editing. Extend the deterministic seed using the existing IDs and insert helpers so every seeded submission has a useful set of 4-6 non-identity `frm_cfp` answers. Include the conditional `vendor_product` answer only when the seeded `vendor_content` answer makes it applicable. Insert valid `submission_file`/attachment rows for a broad deterministic subset, including rows reachable near the first reviewer queue cards. Preserve existing identity-redaction and seed invariants.

Seed at least 25 accepted `kind='session'` submissions with `bypass_evaluation=1`. Keep enough accepted Sessions unscheduled for `can_schedule`, and create at least one scheduled but unpublished Session for `can_publish`; preserve the existing status, agenda, venue-clash, ugliness, and organizer-queue data rather than replacing those fixtures.

### 2. Enforce applicable answers on admin create

In `src/routes/submission-record.routes.ts`, load the form fields once in the create path, pass supplied answers through the shared `projectApplicableAnswers` evaluator, persist only the projected answers, and return the established 422 shape when the projector reports issues. Keep ownership validation and transaction behavior intact. Do not introduce a second condition evaluator or alter the public-form/draft-queue consumers owned by other tickets.

Add guardrail coverage that uses the database as the oracle: a hidden-by-condition answer produces no `submission_answers` row, while a positive applicable answer is retained; a supplied value violating the field configuration returns 422 and leaves no invalid answer/submission side effect. Assert status and absence/counts, with a positive control, and use AC IDs in test titles.

### 3. Collapse reviewer queue work without weakening authorization

Refactor the reviewer queue path around one per-round lookup and one authorization pass. Carry the already-authorized candidate set into payload construction, remove the duplicate `authorizeReviewerScope` call, and replace per-submission row reads with a bounded `IN` query (or the repository's equivalent batch query). Preserve assignment/committee semantics, ordering, pagination/list contracts, redaction, and zero-leak behavior. Inspect the export path for the same duplicated work and share the safe context/query seam where that avoids divergence.

Add or update a speed/shape probe that proves the queue performs single-digit D1 statements without relying on line numbers. Keep reviewer scope guardrails asserting both status and absence of leaked IDs/rows, with positive controls.

### 4. Close the PR-gate contract gap

Add the existing `check:api` command to `scripts/checks/pr-gate.mjs` in the established check list. Do not broaden this ticket into the structural route-manifest detector or the suite-aware AC tracer; those are routed to MRQ-42.

### 5. Record, do not absorb, routed handoffs

Record the audit handoffs on their target Lattice tickets: H1 (`check:seed`) to MRQ-23; H2/H3 to MRQ-42; H4 to MRQ-50; H5-H7 to MRQ-51; H8 to MRQ-15 and MRQ-34. MRQ-23 is complete in the current task graph, and the ticket explicitly places the database assertion half in `scripts/checks/seed.ts`; update that helper while leaving `scripts/checks/check-seed.mjs` untouched so its venue assertions survive. Do not absorb the other tickets' owned source changes.

## Verification sequence

1. After this plan is committed and pushed, move Lattice through `planned` and `in_progress`; fetch `forgejo` and record the exact base at each phase boundary.
2. Establish a clean-install baseline as needed (`npm ci` after any rebase), then run focused unit/integration tests for seed data, submission applicability, reviewer detail, and reviewer queue behavior.
3. Build/run the supported seed harness against a disposable database and assert database counts for seeded answers, attachments, and Sessions. Exercise a reviewer detail for an actual seeded submission and assert populated field values plus an attachment; do not use a hand-built fixture for this proof.
4. Exercise admin-create positive, hidden-condition, and invalid-config cases against the database, then exercise reviewer queue authorization and statement-count probes.
5. Run the complete required local gate: `npm run pr-gate -- --ticket MRQ-69`. Record its result and the default-suite duration; do not open a PR on a red gate.
6. Self-review the final diff, then transition through `review` and `in_validation`, attach review and validation evidence, and confirm the review artifact names the exact branch HEAD and has a PASS verdict.
7. Create the Forgejo PR against `master`, attach its URL, transition to `pr_open`, and send the terminal status to workspace `workspace:9`, surface `surface:60`.

## Non-goals and safety constraints

- Do not edit SPEC.md, EVALUATION.md, BUILDPLAN.md, DESIGN.md, PHILOSOPHY.md, USER_STORIES.md, or mint AC IDs.
- Do not implement the MRQ-42/MRQ-50/MRQ-51/MRQ-15/MRQ-34 handoffs. The explicit MRQ-23 `scripts/checks/seed.ts` database-proof addition is in scope; `scripts/checks/check-seed.mjs` remains out of scope.
- Keep all seed data deterministic, demo-safe, and free of secrets, real addresses, internal hostnames, or ticket IDs in shipped files/UI.
- Use shared condition, auth, list, attachment, and route-manifest seams. Any required contract contradiction will be flagged to the Orchestrator with the chosen behavior and reason.
- Before every commit, assert the Git root is this worktree. Push the first plan commit and every meaningful follow-up to `forgejo` immediately.

## Plan self-review

Verdict: PASS.

- The plan covers the five ticket-owned implementation areas and keeps the explicitly routed `check:seed` work out of this ticket.
- The proof is database-backed and uses a seeded reviewer submission, which directly tests the failure mode described by the audit.
- Applicability, reviewer authorization, and batch-query changes are constrained to existing shared seams; no contract artifact or AC namespace is changed.
- The final gate, exact-head review artifact, validation evidence, PR creation, `pr_open` transition, and Orchestrator c11 notification are explicit terminal requirements.

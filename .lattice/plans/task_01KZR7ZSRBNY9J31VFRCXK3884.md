# MRQ-72: Reset demo is broken end to end — implementation plan

## Goal

Close the walkthrough dead end identified by MRQ-53: the in-product **Reset demo** action must call the real reset operation, and the operation must restore the shipped full demo seed without deleting another tenant's data or leaving demo uploads behind. The proof starts from a deliberately dirty database and checks exact row counts for every table after two consecutive resets.

## Scope and binding constraints

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; do not add a migration.
- Preserve the existing FK-safe `WIPE_ORDER` and the MRQ-53 coverage guard. If MRQ-66's migration 0005 lands before this branch is rebased, retain both table sets and place its webhook children before their parents.
- `src/lib/reset-demo/reseed-demo.ts` remains the only production reseed path. The shared seed builder exists to prevent the CLI seed and reset from drifting; it is not a second reset path.
- The AC manifest declares `owns: []` and `exercises: ["AC-230"]`; AC-230 remains owned by MRQ-3.
- Reset writes no mail rows and does not add an `always_live` site. Existing AST/comms guardrails remain unchanged and must pass.

## Implementation

1. **Make the shipped seed available to the Worker and reset.**
   - Refactor the seed source loader to use the committed public JSON as a bundler-safe module instead of `node:fs` at runtime.
   - Add one shared, deterministic seed-module manifest/builder used by `npm run seed` and `src/lib/reset-demo/demo-fixture.ts`; retain the CLI's discovery/parity checks so a new seeder cannot silently be omitted.
   - Convert the builder's rows into bound insert statements for reset. Use the shipped event/org and stable demo owner/speaker personas, including the 1,000 submissions, accepted core, evaluations, agenda, task workload, and all other non-empty seeded tables.

2. **Replace the global wipe with an owned, coherent reset.**
   - Keep `WIPE_ORDER` as the complete schema table inventory and execute FK-safe, table-specific deletes: direct `event_id`/`org_id` predicates and child-table subqueries through the demo event, org, submissions, forms, rounds, committees, imports, and people.
   - Preserve unrelated tenant rows as a positive invariant. For control-plane tables without an ownership key, do not make a guessed global delete; filter mirror outbox payloads where ownership is explicit and document/preserve global mirror state.
   - Delete every object under `uploads/<demo-event-id>/` through the injected R2 binding before deleting attachment rows. A failed object cleanup fails the queue job rather than silently creating more orphans.
   - Keep reset writes in the existing queue job, enqueue exactly one mirror reconcile message, and retain the demo-safe outbox invariant.

3. **Wire the sidebar affordance to the queued endpoint.**
   - Replace `unavailable(...)` with a destructive confirmation that names the data loss, POSTs `/api/v1/admin/reset-demo`, polls the returned job, and reports authentication/server/timeout failures honestly.
   - Expose a stable pending/success/error state and disable duplicate clicks. Reserve a fixed sidebar button slot so `Reset demo` → `Resetting…`/result never shifts neighboring elements; refresh the shell after a successful reset so stale in-memory screens are not presented as restored.

4. **Build adversarial proof.**
   - Extend `tests/integration/reset-demo.test.ts` to seed the full baseline, then dirty it with accepted and rejected decisions, completed speaker work, newly placed/published agenda, queued reminder outbox rows, a saved view, an import and import row, an uploaded demo object/attachment, and session state.
   - Add an unrelated org/event/person/submission and R2 object as a positive control. Assert dirty demo rows disappear while the unrelated row/object and its counts remain.
   - Capture expected counts from the deterministic shipped seed and assert a named count for every `WIPE_ORDER` table after reset, plus `demo_mode`, organizer and speaker demo login. Run the complete endpoint/queue reset a second time and require the same counts and login result.
   - Add/adjust node-level UI/seed assertions as needed, without weakening `reset-wipe-order.test.mjs` or the `comms.AC-250` `always_live` inventory.

## Verification sequence

1. `npm test` while iterating; keep the hermetic suite within its 30s budget.
2. Run focused reset, seed, UI, R2, and comms tests plus `npm run check:seed` where the local runtime is needed.
3. Self-review the final diff, attach a post-`review` PASS artifact naming the exact HEAD, and transition through `in_validation` with recorded running-system evidence (button/endpoint flow or an explicit justified N/A if the local environment cannot host the browser).
4. Run `npm run pr-gate -- --ticket MRQ-72`, paste its result into the completion comment, push `mrq-72-reset-fix`, open the Forgejo PR against `master`, attach its URL, and finish at `pr_open`.

## Non-goals

- No new schema, migration, mirror implementation, deployment, public-site redesign, or unrelated cleanup.
- No claim that this ticket owns AC-230; it only exercises the existing criterion with stronger reset evidence.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Concern: the full seed currently lives under `scripts/` and its source loader uses Node APIs.** Resolved by moving only the shared loading/build seam to Worker-safe imports and having both the CLI and reset call the same module manifest; no duplicated fixture data or second reset route.
- **Concern: scoping every table could accidentally turn a global mirror table into a cross-tenant wipe.** Resolved by making ownership predicates explicit per table, filtering only mirror outbox payloads with an explicit demo identity, and preserving ownershipless mirror state rather than guessing.
- **Concern: R2 cleanup could leave D1 and object storage out of sync on failure.** Resolved by listing/deleting the exact demo prefix before the D1 reset and failing the queue job on a delete error; the test keeps an unrelated prefix as a positive control.
- **Concern: the existing reset test's `200`-style checks could remain green over the dead path.** Resolved by an end-to-end dirty-state test with per-table expected counts, two reset runs, and post-reset demo login, plus a real sidebar call/pending/result contract.

# MRQ-251: Seed storylines: every deliberately awkward record says why it exists

WHY. The seed is deterministic and strong at scale (zero randomness, frozen clock, ON CONFLICT convergence, byte-identical SQL asserted by test) — but the INTENT of its awkward records is illegible. The staged day-one conflicts, the edge-case people, the reachability fixtures, and the one speaker whose rename silently breaks the demo login (SHIPPED_DEMO_SPEAKER_PERSON_ID at src/lib/reset-demo/demo-fixture.ts:16 derives from the seeded name — rename him in scripts/seed/ and sign-in dies with no red test) live scattered across code and tests. The failure mode is the next agent "fixing" a record that is broken on purpose. This also reads well to anyone assessing the repo as an open-source project.

SCOPE. Adopt the discipline, not new machinery — explicitly NOT a hand-editable JSON loader (Load/Reset already ships: sidebar button, AC-230, one db.batch transaction, ~2.7s measured; check:seed already guards the staged conflicts in the normal suite: ≥1 live Transit conflict, ≥2 person conflicts, no double-booked rooms).
1) SEED-STORYLINES.md beside SEED-DATA.md: every deliberately awkward record named with its why and file:line — the two staged day-one conflict placements (scripts/seed/agenda.ts:29-34, addConflictParticipation :74-97), the four ugliness.ts edge people (:13-18), the reachability fixtures (pool.ts:218-228 — the lone submitted and withdrawn rows), the demo-login speaker with a DO-NOT-RENAME warning — plus the guard that locks each one, a "staging a new storyline" recipe (which literals to touch, which check catches a mistake), and the house rule verbatim: anything deliberately broken gets a storyline entry, otherwise the next agent fixes it.
2) // STORYLINE: comments at each listed site in the seed code, keyed to the doc — the protection travels with the code into every diff review.
3) The rename hazard becomes a red test: a node test asserting the demo-login fixture resolves against the built seed, failing with a message that names the fixture relationship.
4) Fix SEED-DATA.md's drift while here: it says "twenty-four" agenda items; the build emits 26 + 1 break.

IF a non-engineer collaborator ever materializes, that is the moment a small hand-editable second conference (human keys → derived ids → delete-then-insert, beside the main seed, never replacing it) earns its cost — a future ticket cut against a real person, not now.

DATA MODEL. None. Docs, comments, one test.

AC DRAFTS. The doc exists and names every staged anomaly with file:line + guard + rule + recipe. Each site carries its STORYLINE comment. Renaming the shipped demo speaker fails the suite loudly. SEED-DATA.md count corrected.

VALIDATION. The new node test; check:seed stays green.

CUT LINE. Smallest: the doc + the rename-guard test. Complete: the comment sweep + recipe.

## Implementation plan

### Scope and constraints

- Add `SEED-STORYLINES.md` beside `SEED-DATA.md`; do not add a loader, schema, migration, or new seed machinery.
- Keep the existing deterministic generator and reset path unchanged except for keyed `STORYLINE` comments and the behavioral regression test.
- Do not mint or reserve stable AC IDs. The ticket has no allocation need; use MRQ-251 in the test filename and review evidence.
- Do not edit contract documents (`SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `USER_STORIES.md`, or `DESIGN.md`).

### Work steps

1. Inventory the emitted seed and existing guards. The storyline register will cover the day-one placement literals and conflict-participation helper in `scripts/seed/agenda.ts`, the four edge people in `scripts/seed/ugliness.ts`, the submitted/withdrawn reachability branches in `scripts/seed/pool.ts`, and the shipped demo-login speaker relationship in `src/lib/reset-demo/demo-fixture.ts`.
2. Write `SEED-STORYLINES.md` with, for every intentional anomaly, its reason, final `file:line` anchor, owning guard, and a concrete recipe for changing the literals and running the relevant guard. Include the exact house rule: “anything deliberately broken gets a storyline entry, otherwise the next agent fixes it.” Explain that the two day-one pairs intentionally create the Transit/person and same-time person conflicts while room occupancy remains legal.
3. Add keyed `// STORYLINE:` comments at each actual seed/fixture site, pointing back to the register. Keep the comments local to the literals/branches so the intent travels with future diffs.
4. Add `tests/node/seed-demo-login.MRQ-251.test.mjs`. Build rows through `buildSeedRows()` and assert that `SHIPPED_DEMO_SPEAKER_PERSON_ID` resolves to a generated `people` row and to a `speaker` membership for `SHIPPED_DEMO_EVENT_ID`. Assertion messages must name the demo-login fixture relationship. Prove the guard behavior with a targeted temporary mutation of the fixture ID: the new test must fail against the mutated generated seed, then pass after restoring the ID; retain only the test and evidence, never the mutation.
5. Correct `SEED-DATA.md` to say the generator emits 26 scheduled sessions plus one break, preserving the separate fact that 24 non-sponsor sessions are represented by the existing seed guard.

### Guard and validation map

| Storyline | Owning guard | Validation recipe |
| --- | --- | --- |
| Day-one Transit/person and same-time person conflicts | `npm run check:seed`; generated-row conflict assertions in `tests/node/venue-transit.test.mjs` and `tests/node/seed-pool.AC-3.test.mjs` | Change only a placement or conflict key, rebuild rows, run those node tests and `check:seed`; restore the literal and confirm no room overlap is introduced. |
| Four long/diacritic edge people and their panel/triple participation | `tests/node/seed-pool.AC-3.test.mjs` | Change an `EDGE_PEOPLE` name or participation key, rebuild rows, run the targeted node test; restore the value and confirm the expected names/cardinality return. |
| Submitted and withdrawn pool reachability rows | `tests/node/seed-pipeline-coverage.MRQ-100.test.mjs` | Change the two `poolStatus()` indices, rebuild rows, run the targeted test and `check:seed`; restore both branches and confirm both filters remain populated. |
| Shipped demo-login speaker | `tests/node/seed-demo-login.MRQ-251.test.mjs` plus the real demo-login/reset relationship | Change the fixture ID only, run the new node test and observe its relationship-specific failure; restore it and rerun. |

### Baseline and completion evidence

- Baseline at the cut: targeted seed node tests passed 23/23. The first `check:seed` attempt was blocked by a missing `node_modules/.bin/vite`; run `npm ci` before relying on it.
- Run the new node test, the targeted seed guard set, `npm run check:seed`, and the full `npm run pr-gate -- --ticket MRQ-251` under the serialized merge-captain slot.
- Record the targeted mutation failure, restored pass, seed verdict, gate result, reviewed HEAD, and PR URL in Lattice artifacts/comments. Stop at `pr_open`; the Adoption Orchestrator owns merge/deploy.

## Plan self-review

- No production behavior or data model changes are proposed.
- Every deliberate anomaly named by the ticket has a source anchor, a guard, and a recovery recipe.
- The rename test consumes generated rows rather than matching source text, and the mutation proof demonstrates it catches the actual failure mode.
- The count correction distinguishes the 26 scheduled sessions + 1 break from the existing 24 non-sponsor-session assertion.

# MRQ-23: Seed and speed check suites

BUILDPLAN: M-22 — Wave 1 (§4), the last Wave 1 ticket

Scope (verbatim): Seed shape/scale assertions over the public API including the deliberate ugliness **and the assertion that the organizer demo persona's review queue returns ≥20 unreviewed candidates** (B-3 — the check that keeps walkthrough step 8 from going dead); speed harness measuring every §1.3 budget on deployed infra against the real seed, emitting `speed-report.json`.

Binding split (EVALUATION §1.3 + client ruling 2026-08-09): **AC-sourced budgets fail the run** (AC-16, AC-36, AC-62, AC-69 completion, AC-85, AC-89, AC-103). The **seven client-signed *objective* budgets warn loudly with a ⚠ OBJECTIVE MISSED banner in `speed-report.json` and never exit non-zero.** If a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion.
`check:seed` budget ≤30 s; `check:speed` ≤4 min.

File surface: `scripts/checks/seed.ts`, `scripts/checks/speed.ts`

ACs: AC-3 evidence, guardrail G7
Hours: 4
Workflow: inline-full
Shared files: the two script files are new and module-specific; **the `package.json` entries already exist** (M-06 registered all thirteen commands as stubs) — fill the stubs, do not add scripts.
Deps: M-20+M-21
Audit that keys off this ticket: A-6 (speed report), after M-22
CP-2 (human-visible checkpoint) follows: the eleven-step loop completes on the deployed preview, desktop and mobile, zero dead ends; `trace:ac` shows every Tier A `auto` AC covered; felt checkpoints C2 and C3 run.
Plan: initial rough form (MRQ-23 delegator, 2026-08-11)

## Objective

Extend the real `check:seed` path and implement the real `check:speed` path against the public API and real demo seed. Preserve MRQ-62's four venue assertions verbatim in behavior, add the B-3 organizer review-queue assertion (at least 20 unreviewed candidates), cover SPEC section 6 shape/scale and deliberate-ugliness invariants, and emit an honest `speed-report.json`.

## Implementation outline

1. Read the binding SPEC §1.3/§6, EVALUATION §1.3, BUILDPLAN M-22, existing check runners, seed/reset helpers, public API/auth conventions, and adjacent AC-tagged tests. Establish the exact seed and local `wrangler dev`/Miniflare lifecycle before editing.
2. Keep `scripts/checks/check-seed.mjs` as the venue-gate implementation introduced by MRQ-62; extend that path rather than replacing or weakening it. Add module-specific TypeScript entrypoints only where the existing command contract requires them, and leave the pre-registered `package.json` scripts unchanged.
3. Add seed assertions over public API responses for B-3, required counts/shapes, long diacritic names, title truncation inputs, one speaker on three submissions, a four-person panel, overdue tasks, and at least two visible double-bookings. Make failures identify the violated invariant and keep the default check hermetic and parallel.
4. Build the speed harness around the same real seed and local runtime. Measure every SPEC §1.3 budget, classify AC-sourced budgets as hard failures and the seven objective budgets as loud `⚠ OBJECTIVE MISSED` warnings that never make the command non-zero, and record source/environment/observed duration/classification in `speed-report.json`. Never label local values as deployed; list deployment-only measurements as MRQ-57 follow-ups.
5. Add an AC-tagged test naming AC-3 and `tests/ac-claims/MRQ-23.json` with coverage metadata accepted by `trace:ac`.
6. Self-review the exact branch HEAD, run targeted tests and both check commands within their budgets, run `npm run pr-gate -- --ticket MRQ-23`, push every meaningful commit, open the Forgejo PR against `master`, attach the PR/review/validation evidence, and stop at `pr_open`.

## Verification outline

- Baseline and post-change targeted tests, `trace:ac`, and the MRQ-23 AC claim file.
- `check:seed` ≤30 s and `check:speed` ≤4 min against local `wrangler dev`/Miniflare plus the real seed; inspect `speed-report.json` for environment and classification honesty.
- Inline self-review artifact naming the exact HEAD with a PASS verdict, then `npm run pr-gate -- --ticket MRQ-23` pasted into the completion comment.

Open details to resolve during reconnaissance: the existing check command wrappers, the public API/auth transport available to scripts, the canonical local runtime bootstrap/reset path, the complete §1.3 budget table and AC/objective split, and the exact §6 response fields/count thresholds.

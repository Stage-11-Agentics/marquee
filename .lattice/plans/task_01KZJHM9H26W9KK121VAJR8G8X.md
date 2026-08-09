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
Plan: filled in by delegator's plan phase

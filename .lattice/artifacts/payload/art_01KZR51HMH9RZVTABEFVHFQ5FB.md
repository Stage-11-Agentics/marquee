# Plan Review: MRQ-48 — Audit — speed report, AC-sourced versus objective

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the cycle-2 audit plan for MRQ-48 (A-6, speed-report audit) against the live codebase. The plan's factual claims all check out: `scripts/checks/speed-budgets.mjs` contains exactly seven `kind: "acceptance"` budgets sourced to AC-16/36/62/69/85/89/103 and seven `kind: "objective"` client-signed budgets; the checker's verdict logic (`fail` for acceptance breaches, `⚠ OBJECTIVE MISSED` warn for objective breaches) matches the client-ruling separation the ticket exists to protect; `speed-report.json`, `tests/unit/speed-budgets.test.ts`, the `tests/ac-claims/` manifest convention, and `npm run pr-gate` all exist as the plan assumes. The only concerns are minor: a small tension with the ticket's "shared files: none" declaration and a duplication risk against the existing count-based contract test.

## 3. Issues

**[MINOR] Expected artifacts — Guard risks duplicating the existing count-based contract test**
`tests/unit/speed-budgets.test.ts` already asserts "seven acceptance / seven objective" by count and that acceptance breaches fail while objective breaches warn. The plan's new guard (keyed on exact budget ids, AC sources, and kinds) is genuinely stronger — the count test would pass if someone swapped an AC-sourced budget for a reclassified objective one — but a careless implementation could add a parallel test that restates the counts rather than extending the file's existing CONTRACT structure.
**Recommendation:** Extend the existing CONTRACT block in `tests/unit/speed-budgets.test.ts` with the id/source/kind mapping assertion rather than adding a sibling test that overlaps the count assertions; keep one authoritative invariant per fact.

**[MINOR] Scope and non-goals — Tension with the ticket's "Shared files: none — audit artifact only"**
The ticket declares no shared files, but the plan touches `tests/unit/speed-budgets.test.ts` (a shared unit-test file) and adds `tests/ac-claims/MRQ-48.json`. This matches the audit-track convention established by MRQ-50 (which likewise added guards alongside its audit), and the file carries near-zero merge-conflict risk, so it is acceptable — but the deviation should be owned explicitly rather than passed silently.
**Recommendation:** Note in the PR description (or a Lattice comment) that the guard test extends a shared test file beyond the ticket's "audit artifact only" declaration, citing the A-8/MRQ-50 precedent, so the master validator doesn't flag it as undeclared shared-file contention.

**[MINOR] Expected artifacts — Conditional phrasing on the `tests/ac-claims/MRQ-48.json` manifest**
The plan says the no-auto-AC manifest will be added "if the existing trace convention requires it." The convention is real and populated (`tests/ac-claims/` holds per-ticket manifests for most MRQ tickets), so the conditional leaves a small ambiguity about whether the artifact ships.
**Recommendation:** Resolve the conditional during step 1: check `scripts/checks/trace-ac.mjs` / `trace-ac-core.mjs` for whether the gate requires a manifest for tickets with no owned ACs, and either commit `owns: []` or record in the validation evidence why none is needed. Don't leave it undecided at PR time.

## 4. Positive Observations

- **The plan is anchored to the one thing that matters.** The client ruling — AC-sourced budgets fail the run, objective budgets warn and never exit non-zero — is restated, and every method step serves it: the mapping exercise in step 1, the verdict-path confirmation, and the id/source-keyed machine guard in step 4. The cycle-1 resolution to key the guard on semantic ids/sources rather than line numbers or array positions is exactly right and is confirmed feasible against the actual manifest shape.
- **It audits the report, not the exit code.** Step 2's requirement to verify sample cardinality and the statistic named by each criterion (p95 vs median vs max vs completion boolean — which genuinely vary across the seven budgets in the manifest), and to label proxies "defensible or effectively unmeasured" rather than trusting green, is real auditor posture. This honors the binding rule that a passing number on a slow surface means the threshold is wrong.
- **Honest environment reporting and the MRQ-57 handoff** (step 3) keep local Wrangler/miniflare numbers from masquerading as deployed evidence, and make the remeasurement obligation explicit rather than implied.
- **Non-goals are crisp and correct for an audit ticket:** no product code or threshold changes; findings recorded with `file:line` and reproductions. This prevents the classic audit failure mode of quietly fixing what should be reported.
- **The status-gate section is a faithful, verifiable rendering of the Lattice lifecycle** — plan-only first commit, per-transition verification via `lattice show --json`, self-review of exact branch HEAD, validation evidence, and the mandatory `npm run pr-gate -- --ticket MRQ-48` (script confirmed present in `package.json`).
- Scope is realistic for the budgeted single hour on the fast-track workflow: the report generator, checker, and test scaffolding all already exist; the ticket is genuinely audit-plus-guard, not a build.

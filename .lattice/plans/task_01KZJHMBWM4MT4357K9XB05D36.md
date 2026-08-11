# MRQ-48: Audit — speed report, AC-sourced versus objective

BUILDPLAN: A-6 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Speed report — `speed-report.json` attached with actuals, AC-sourced vs objective separated.
Starts when (verbatim): After M-22.

The separation is the whole point (client ruling 2026-08-09): **AC-sourced budgets fail the run** (AC-16, AC-36, AC-62, AC-69 completion, AC-85, AC-89, AC-103); the client-signed *objective* budgets are reported with a ⚠ OBJECTIVE MISSED banner and never exit non-zero. An auditor who mixes the two either fails a green build or passes a red one.
Rule that still binds both kinds: if a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion.

ACs: — (backs gate 7; evidence for AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, AC-103)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-22
Plan: filled in by delegator's plan phase

## Audit plan

### Scope and non-goals

- Audit the generated `speed-report.json`, `scripts/checks/speed-budgets.mjs`, and `scripts/checks/speed.ts` against the seven client-ruling AC-sourced budgets: AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, and AC-103.
- Verify the seven remaining client-signed objective budgets remain warning-only, and verify the report's environment/deployment wording and MRQ-57 remeasurement handoff.
- Add a source/id-based unit guard for the AC-sourced classification invariant and add the explicit no-auto-AC manifest for MRQ-48 if the existing trace convention requires it.
- Do not change product code or thresholds. Findings about an unmeasured or proxy metric will be recorded as audit findings with `file:line` evidence and a concrete reproduction.

### Method

1. Read the budget manifest and checker, then map every AC ID to its budget id, declared metric, threshold, observed value, and verdict. Confirm the gate only fails for acceptance failures (plus missing measurements in gate mode), while objective misses emit `⚠ OBJECTIVE MISSED` and remain zero-exit.
2. Run the local speed harness and inspect the resulting report. For each AC budget, verify that the sample cardinality and selected statistic are the one named by the criterion: p95, median, max, or completion boolean. Inspect the measurement path and notes for proxy substitutions; label a proxy defensible or effectively unmeasured rather than treating a green number as proof.
3. Confirm `environment.kind`, runtime, and `deployed` state in the report are honest local Wrangler/miniflare evidence. Confirm the follow-up identifies the real-infrastructure checks MRQ-57 must repeat, including surfaces that are currently placeholders or source/API proxies.
4. Add and run a machine guard keyed only by budget ids and AC sources, asserting the exact seven AC-sourced budgets are `kind: "acceptance"`; do not key it on line numbers or array positions. Add no product behavior changes.
5. Re-run the focused speed-budget tests and the mandatory `npm run pr-gate -- --ticket MRQ-48` after the report/guard are complete. Preserve the command result for the validation comment and review artifact.

### Expected artifacts

- `speed-report.json`: fresh local actuals and explicit environment/deployment metadata, with objective warnings separated from acceptance failures.
- `tests/unit/speed-budgets.test.ts`: invariant guard covering the exact AC-sourced id/source/kind mapping, plus existing classification behavior.
- `tests/ac-claims/MRQ-48.json`: explicit `owns: []` declaration if MRQ-48 owns no automatic AC, with any exercised ACs documented according to the existing manifest convention.
- Lattice review/validation evidence: findings with `file:line` and concrete reproductions, the self-review verdict, and the mandatory PR-gate result.

### Verification and status gates

- First commit contains only this plan (and no product/report implementation); push it to `forgejo/mrq-48-audit-speed` before moving past planning.
- Transition `in_planning → planned → in_progress` with actor `agent:auditor-mrq-48`, verifying each transition with `lattice show MRQ-48 --json`.
- Before `pr_open`, self-review the exact branch HEAD, attach a PASS review artifact, enter `in_validation`, attach validation evidence (including N/A only where justified), run the mandatory gate, open the PR against `master`, attach its URL, and transition to `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review verdict: PASS. The plan pins the AC-sourced set by semantic ids/sources and kinds, requires actual report inspection rather than trusting exit status, preserves the local-versus-deployed distinction, and keeps product fixes out of scope.
- No unresolved plan findings.

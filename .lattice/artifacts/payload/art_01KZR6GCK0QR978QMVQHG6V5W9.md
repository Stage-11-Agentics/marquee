# MRQ-48 self-review

Task: MRQ-48 (A-6 — speed report: AC-sourced versus objective)
Reviewed commit: 73ec6c57e61bba6f0a4558c1e2c15116810f7702
Reviewer: agent:auditor-mrq-48
Verdict: PASS

## Scope and decision

This review audits the speed budget classification, measurement path, environment
label, and handoff. The implementation changes are limited to the speed-check
harness, its contract test, and the required no-auto-AC manifest. No product
code or speed threshold was changed.

The client ruling is preserved: the seven AC-sourced budgets are the only
acceptance failures, while the seven client-objective budgets warn. The new
guard is keyed by budget ids and source/kind values, not by array coordinates or
line numbers.

## Classification audit

`scripts/checks/speed-budgets.mjs:1-16` contains exactly these seven
AC-sourced acceptance budgets: AC-16, AC-36, AC-85, AC-62, AC-103, AC-89, and
AC-69. The remaining seven entries are `source: "client-objective"` and
`kind: "objective"`. `scripts/checks/speed-budgets.mjs:18-39` makes acceptance
breaches fail and objective breaches warn with `⚠ OBJECTIVE MISSED`.

`tests/unit/speed-budgets.test.ts:9-32` asserts the complete id-to-source/kind
mapping. It would fail if an AC source disappeared, if an AC budget changed
kind, or if an unexpected AC-sourced budget were added. The existing behavior
test at `tests/unit/speed-budgets.test.ts:34-48` separately proves acceptance
failure and objective warning semantics. `tests/ac-claims/MRQ-48.json:1-6`
records that this audit owns no automatic AC.

## Acceptance evidence

The attached `speed-report.json` is the final report from commit 73ec6c5. Every
entry below is `kind: "acceptance"`, has no acceptance failure, and was measured
on the named path:

| AC | Metric and sample | Observed | Path evidence |
| --- | --- | ---: | --- |
| AC-16 | p95, n=10 | 85.70 ms | Authenticated Playwright `/dashboard` render to `.dashboard-page` |
| AC-36 | p95, n=5 | 69.17 ms | Fresh contexts with cache disabled, exact seeded `/f/cfp` to `.public-form` |
| AC-85 | p95, n=5 | 48.36 ms | Fresh contexts with cache disabled, public `/agenda` to `main` |
| AC-62 | median, n=20 | 29.54 ms | Real reviewer save click through next-card identity change |
| AC-103 | p95, n=10 | 156.92 ms | Final keystroke through painted ready result, including misspellings and no-match |
| AC-89 | max, n=1 | 30,115.07 ms | API mutation then clean unauthenticated public embed polling |
| AC-69 | completed, 150 ids | true | Real bulk API, 150 selected/succeeded, 0 failed, durable completed state |

The AC-69 Long Tasks observation is reported separately as the client-objective
`bulk-accept-long-task` entry (0 ms); it does not replace the acceptance
completion criterion.

## Findings and concrete reproductions

1. **Several objective entries are honest source proxies, not rendered UI proof.**
   `scripts/checks/speed.ts:283-288` measures submissions filter/sort by a full
   page reload; `scripts/checks/speed.ts:329-340` measures agenda view switching
   through API snapshots; and `scripts/checks/speed.ts:342-348` measures the
   task-backed submissions API rather than a board render. The report notes say
   this explicitly, so the green objective values must not be read as deployed
   interaction or board-paint evidence. Reproduce with
   `MARQUEE_GATE=1 npm run check:speed`, then inspect
   `r.samples["agenda-view-switch"].method`,
   `r.samples["agenda-view-switch"].notes[0]`, and
   `r.samples["chase-board-load"].notes[0]` in `speed-report.json`.

2. **The speaker-portal objective is also only a local proxy.**
   `scripts/checks/speed.ts:302-304` now uses the seeded speaker session and
   `.portal-shell`, which is path-correct, but the report explicitly says it is
   an objective proxy for deployed-device performance. A local pass here is not
   device or hosted proof. Reproduce with the same `check:speed` command and
   inspect `speaker-portal-load`'s method.

3. **The objective route-transition budget caught a real outlier.**
   `scripts/checks/speed.ts:294-300` records ten authenticated admin navigations;
   the final report has p95 10,921.83 ms against 300 ms and the exact
   `⚠ OBJECTIVE MISSED` banner. The command still exits zero because the ruling
   makes this objective warning-only. This is the correct gate behavior, but
   the outlier remains an operator-facing performance finding.

4. **AC-89 is measured honestly but has only one observation.**
   `scripts/checks/speed.ts:350-353` performs the required mutation and clean
   unauthenticated polling and records 30,115.07 ms as the actual max. That is
   not unmeasured, but n=1 makes it weak evidence for repeatability; MRQ-57
   should repeat it on the deployed path.

5. **The deployed measurement gate remains open.**
   `scripts/checks/speed.ts:367-374` and
   `scripts/checks/check-speed.mjs:12-25` label the report
   `local-wrangler-dev` / `wrangler dev/miniflare` with `deployed: false` and
   name MRQ-57 as the production follow-up. No hosted number is claimed. MRQ-57
   must re-measure the seven AC paths on real infrastructure, plus the
   objective proxies' actual rendered/device behavior and production Long
   Tasks. Its current handoff explicitly names AC-16 deployed measurement but
   does not yet enumerate all seven speed ACs; this is an orchestrator handoff
   finding, not a reason to falsify this local report.

6. **The audit harness had and now fixes two path errors.** The initial exact
   gate run failed while waiting for `.page` on `/portal`; the installed portal
   shell is `.portal-shell`, while the admin shell owns `.page` (see
   `src/ui/shell/AppShell.tsx:68-82` and `src/ui/portal/PortalPage.tsx:459-474`).
   The previous CFP probe also used `/` as a proxy even though
   `src/routes/public-form.route.tsx:34-48` exposes `/f/:slug`; the final probe
   uses `/f/cfp` with `.public-form` at `scripts/checks/speed.ts:321-327`.
   Re-running `MARQUEE_GATE=1 npm run check:speed` at this reviewed commit
   passes and exercises those corrected paths. These are test-harness fixes;
   no product behavior was altered.

## Verification

- `MARQUEE_GATE=1 npm run check:speed` — pass; all seven acceptance entries pass; one objective warning; `shouldFail: false`; 65,867 ms under the 240,000 ms harness budget.
- `npm run pr-gate -- --ticket MRQ-48` — pass in 25,094 ms under the 45,000 ms budget.
- Final hermetic suite inside pr-gate — 34 files, 189 tests passed in 16.77 s, under the 30 s suite budget.
- Final merged AC trace inside pr-gate — pass; live 212, test files 81, claims 43, uncovered 0, errors 0.
- `git diff --check` — pass.
- Report environment — local Wrangler/miniflare only; `deployed: false` is intentional and truthful.

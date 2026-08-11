# MRQ-48 self-review — final head

Task: MRQ-48 (A-6 — speed report: AC-sourced versus objective)
Reviewed commit: 11d7a1972c82dc0145927de0a85935719f72de4c
Reviewer: agent:auditor-mrq-48
Verdict: PASS

The final head is a clean rebase of the reviewed implementation onto current
`forgejo/master`. The diff changes only the speed-check harness, its contract
test, and the required no-auto-AC manifest. No product code or speed threshold
was changed.

## Classification and acceptance audit

`scripts/checks/speed-budgets.mjs:1-16` contains exactly seven AC-sourced
budgets, all `kind: "acceptance"`: AC-16, AC-36, AC-85, AC-62, AC-103, AC-89,
and AC-69. The remaining seven entries are `source: "client-objective"` and
`kind: "objective"`. `scripts/checks/speed-budgets.mjs:18-39` makes acceptance
breaches fail and objective breaches warn with `⚠ OBJECTIVE MISSED`.

`tests/unit/speed-budgets.test.ts:9-32` asserts the complete id-to-source/kind
mapping by semantic ids rather than coordinates. The behavior checks at
`tests/unit/speed-budgets.test.ts:34-48` prove acceptance failure and objective
warning semantics, including the independent AC-69 completion and Long Tasks
objective entries. `tests/ac-claims/MRQ-48.json:1-6` records that MRQ-48 owns no
automatic AC.

The final attached report has no acceptance failures and these measured AC
values:

| AC | Metric / n | Observed | Path |
| --- | --- | ---: | --- |
| AC-16 | p95 / 10 | 88.10 ms | Authenticated Playwright `/dashboard` to `.dashboard-page` |
| AC-36 | p95 / 5 | 65.46 ms | Fresh cache-disabled contexts, exact `/f/cfp` to `.public-form` |
| AC-85 | p95 / 5 | 67.93 ms | Fresh cache-disabled contexts, public `/agenda` to `main` |
| AC-62 | median / 20 | 29.38 ms | Real reviewer save click through next-card identity change |
| AC-103 | p95 / 10 | 174.41 ms | Final keystroke through painted ready result, including misspellings and no-match |
| AC-89 | max / 1 | 30,008.39 ms | API mutation then clean unauthenticated public embed polling |
| AC-69 | completed / 150 ids | true | Real bulk API: 150 succeeded, 0 failed, durable completed state |

## Findings and concrete reproductions

1. **Some objective values are disclosed source proxies, not rendered UI proof.**
   `scripts/checks/speed.ts:283-288` measures filter/sort by full page reload;
   `scripts/checks/speed.ts:329-340` measures agenda API snapshots rather than
   a device paint; and `scripts/checks/speed.ts:342-348` measures the
   task-backed submissions API rather than a board render. Reproduce with
   `MARQUEE_GATE=1 npm run check:speed`, then inspect the `method` and `notes`
   for `agenda-view-switch` and `chase-board-load` in `speed-report.json`.
   These are honest local source measurements, but the named UI surfaces remain
   effectively unmeasured until the deployed rendered paths exist.

2. **The speaker portal objective is a local proxy.**
   `scripts/checks/speed.ts:302-304` uses the seeded speaker session and the
   correct `.portal-shell`, but explicitly labels the result as a proxy for
   deployed-device performance. Reproduce with the same speed command and
   inspect the `speaker-portal-load` method.

3. **AC-89 is honest but n=1.** `scripts/checks/speed.ts:350-353` performs the
   required API mutation and clean unauthenticated polling and records the
   actual max. It is measured, but not strong repeatability evidence; MRQ-57
   should repeat it on the deployed path.

4. **The deployed measurement gate is still open.**
   `scripts/checks/speed.ts:367-374` and `scripts/checks/check-speed.mjs:12-25`
   label every current number local Wrangler/miniflare with `deployed: false`
   and name MRQ-57 as the follow-up. No hosted number is claimed. MRQ-57 must
   repeat all seven AC paths on real infrastructure and measure the rendered or
   device behavior behind the objective proxies. Its current deployed comment
   explicitly names AC-16 but does not enumerate all seven speed ACs; this is a
   handoff finding, not a reason to reclassify any criterion.

5. **The harness path corrections are validated.** The initial audit run failed
   waiting for `.page` on `/portal`; the installed portal uses `.portal-shell`
   (`src/ui/shell/AppShell.tsx:68-82`, `src/ui/portal/PortalPage.tsx:459-474`).
   The final CFP probe uses the real `/f/cfp` route and `.public-form` at
   `scripts/checks/speed.ts:321-327`, matching
   `src/routes/public-form.route.tsx:34-48`. These are harness-only fixes.

An earlier pre-rebase local run emitted an objective-only
`admin-route-transition` warning at p95 10,921.83 ms; the final rebased run
measured p95 58.15 ms with no objective warning. Both outcomes preserve the
same warning-only semantics; the focused contract test remains the invariant
against accidental gate changes.

## Verification

- Final `MARQUEE_GATE=1 npm run check:speed`: pass; all seven acceptance entries pass, no missing measurements, `shouldFail: false`, 54,836 ms / 240,000 ms.
- Final `npm run pr-gate -- --ticket MRQ-48`: pass in 17,156 ms / 45,000 ms.
- Hermetic suite in final pr-gate: 34 files, 189 tests passed; 13,666 ms / 30,000 ms.
- Merged AC trace in final pr-gate: pass; live 212, testFiles 81, claims 43, uncovered 0, errors 0.
- `git diff --check`: pass.

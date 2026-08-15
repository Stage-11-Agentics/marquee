# Code Review: MRQ-187 — check:seed budget/hang-detector split

Reviewer: independent (did not write this code). Verified against the live tree:
the diff's before-state matches `main`'s `check-seed.mjs` exactly; `run-test.mjs`
picks up `tests/node/**/*.test.mjs` via `node --test` (so the new test runs in the
suite); `pr-gate.mjs` does **not** run `check:seed`, so no gate consumer parses its
new status vocabulary; nothing programmatically reads `speed-report.json` harness
verdicts; and the `check-speed.mjs` header claim was checked against
`speed-budgets.mjs:26` (acceptance → fail, objective → warn — accurate).

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and the core defect is
genuinely fixed, but the new timeout path orphans the wrangler dev child process
and leaks its temp directory, on a fleet-shared box, in the code path this PR
exists to create. The fix is small; one rework round.

## 2. Summary

The diff correctly gives `check-seed.mjs` the `run-test.mjs` split: an
over-budget healthy run now records `verdict: "warn"`, emits
`status: "pass-over-budget"`, prints loudly, and exits 0; only the new 390s
(13×) hard limit fails. All five ticket items are addressed, including the
written `check:speed` decision and a regression test that runs inside the
suite budget. The key finding is that the hard-limit path calls
`process.exit(1)` while `withLocalRuntime` is still holding a live
`wrangler dev` child — its `finally` cleanup never runs and `process.exit`
does not kill child processes, so a fired hang detector leaves an orphaned
wrangler server (port + CPU) and a seeded `marquee-mrq-23-*` temp D1 behind on
exactly the loaded machine that motivated the ticket.

## 3. Issues

**[MAJOR] scripts/checks/check-seed.mjs:113 (timeout branch) + scripts/checks/seed-verdict.mjs:29-33 — hard-limit timeout orphans the wrangler child and leaks the persist directory**
`runWithHardLimit` deliberately does not cancel the task; its doc comment says
"the caller owns cleanup and must terminate the process … so child processes
cannot keep a failed check alive." That claim is inverted: `process.exit(1)`
terminates only *this* node process. The hung work lives in
`withLocalRuntime` (`local-runtime.ts:122-193`), whose `finally` — `stopChild(worker)`
(SIGTERM→SIGKILL) and `rm(persistPath)` — is unreachable once `process.exit`
fires. The spawned `wrangler dev` server (or a hung vite build / migration
child from `requireCommand`) survives as an orphan holding a port and a temp
directory with a full seeded D1. Contrast `run-test.mjs:53-55`, whose hang
detector explicitly `child.kill("SIGTERM")`s its children before exiting.
Before this PR a genuine hang simply hung (bad but visible); after it, the
hang detector "succeeds" while quietly adding a resident wrangler process to
the load contention this ticket was filed about.
**Fix:** make the runtime's children reachable from the exit path. Simplest:
in `withLocalRuntime`, register a synchronous last-resort hook once the worker
is spawned — `process.once("exit", () => { if (worker && worker.exitCode === null) worker.kill("SIGKILL"); })`
(`kill` is synchronous, so it works under `process.exit`; the temp dir is then
at worst a stale tmpdir entry, which the OS owns). Alternatively follow
`run-test.mjs`'s shape: run the seed-check body in a spawned child process the
wrapper can SIGTERM on timeout. Also correct the `runWithHardLimit` comment so
it stops asserting cleanup that does not happen.

**[MINOR] scripts/checks/seed-verdict.mjs:34-50 — `runWithHardLimit` leaks its timer when the task rejects**
If `task` rejects (the *common* failure: a seed assertion or a wrangler boot
error), `await Promise.race(...)` throws and `clearTimeout(timeoutId)` on
line 48 is skipped. In `check-seed.mjs` the top-level await then rejects and
node exits 1 (behavior parity with the old script — acceptable), but any other
caller, including a future test, holds the event loop for up to `hardLimitMs`
(390s by default). The `(error) => Promise.reject(error)` rejection handler on
the task promise is also a no-op — identical to omitting the second argument.
**Fix:** wrap the race in `try { … } finally { clearTimeout(timeoutId); }` and
drop the no-op rejection handler.

**[MINOR] scripts/checks/seed-verdict.mjs:6-27 + check-seed.mjs:121-122 — the `fail` branch and `exitCodeForSeedStatus` are dead code in the shipped script**
Nothing ever passes `exitCode` to `classifySeedRun` (it defaults to 0), and an
assertion failure escapes `runSeedChecks` as an unhandled top-level rejection
*before* classification runs — so in `check-seed.mjs`, `status` can only be
`timeout`/`pass-over-budget`/`pass`, the `"fail"` branches are unreachable, and
the closing `const exitCode = exitCodeForSeedStatus(result.status); if (exitCode !== 0) …`
always assigns 0 (the timeout branch already `process.exit(1)`ed two lines
earlier — which is itself *necessary*, since with a hung child holding the
event loop `process.exitCode` alone would never terminate the process, and
that non-obvious constraint deserves a comment). Consequence: on an assertion
failure no `seed.json` report and no speed-harness entry are written. That
matches pre-PR behavior, so it is not a regression — but the code shape
implies a fail-classified report exists when it never does.
**Fix:** either wire the error path (catch, classify with `exitCode: 1`, write
the report, then rethrow/exit) or delete the `exitCode` parameter, the `"fail"`
branches, and the unreachable tail, and comment why the timeout branch must use
`process.exit` rather than `process.exitCode`.

**[MINOR] tests/node/check-seed-budget.MRQ-187.test.mjs — the tests pin the helpers, not the script's wiring**
Ticket item 5 asks that "an over-budget `check:seed` run exits 0 … and a hang
still exits 1." The tests prove this for `classifySeedRun` +
`exitCodeForSeedStatus` in a child process, which is the right trade against a
45s suite budget (running the real script boots vite + wrangler for ~30s). But
the wiring in `check-seed.mjs` — precisely where the original
`if (result.status === "fail") process.exitCode = 1` bug lived, and where the
dead-code issue above now lives — is unpinned; a regression that reintroduces
a stopwatch exit code in the script would pass both tests.
**Fix:** acceptable as-is given the budget; if the dead-code cleanup above
lands, consider one cheap guard (e.g., a test that the script's tail contains
no status-from-elapsed exit, or an injectable `main()` accepting a fake
`runSeedChecks`) rather than a real 30s run.

## 4. Positive Observations

- **The core defect is fixed exactly as specified.** Over budget →
  `pass-over-budget` + `verdict: "warn"` + exit 0 + the loud stdout print,
  mirroring `run-test.mjs`'s wording and philosophy; the hard limit is
  `30_000 × 13 = 390s`, faithfully following run-test's ~13× ratio rather than
  inventing one, with the ratio's rationale commented at the constant.
- **`recordSpeedHarness` keeps a meaningful verdict** (`warn`/`pass`/`timeout`
  instead of the old raw `fail`), satisfying ticket item 3; I confirmed
  nothing consumes the harness verdict programmatically, so the vocabulary
  change is safe, and the over-budget signal is preserved rather than lost.
- **The `check:speed` decision is written down and is accurate.** The new
  header states strictness is deliberate for AC-sourced measurements, and I
  verified the claim against `speed-budgets.mjs`: acceptance budgets fail,
  objective budgets warn-only via `classifySpeedMeasurements` — the comment
  matches the code it describes, including the contrast with check:seed's
  wrangler-boot-dominated wall clock. Behavior untouched, as the ticket
  required.
- **The refactor into `runSeedChecks()` is a faithful mechanical move** — all
  assertions, the room-overlap sweep, and the report payload fields
  (`buildings`, `pinned_buildings`, `transit_conflicts`, `api`, `environment`)
  survive intact, and the report gains `hardLimitMs`/`overBudget` without
  dropping any key an evidence reader relies on.
- **The tests are cheap, hermetic, and named to the contract** (`CONTRACT ·
  MRQ-187 · …`), run real child processes to pin real exit codes rather than
  asserting on internals, and land in `tests/node/` where the suite's
  `node --test` step genuinely picks them up — verified against
  `run-test.mjs:76-80`.

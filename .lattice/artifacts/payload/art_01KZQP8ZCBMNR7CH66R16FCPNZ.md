# Plan Review: MRQ-70 — Test harness: cut per-file Worker boot

## 1. Verdict

**FAIL (plan-level)** — one explicit task requirement (the speed-report *trend*) is not actually delivered by the plan as written, and the chosen approach's expected win is unquantified where the task explicitly demands measurement before choosing. Both are narrow, fast revisions; the rest of the plan is strong and should survive intact.

## 2. Summary

Reviewed the MRQ-70 plan (bounded `env.DB.batch()` of ordered schema statements in `tests/integration/apply-migrations.ts`, all isolation semantics preserved) against the task description and the live harness code (`apply-migrations.ts`, `run-test.mjs`, `pr-gate.mjs`, `lib/command.mjs`, `trace-ac.mjs`, `speed-report.json`). The plan is unusually evidence-driven — three pool-level experiments already run, two honestly rejected as negative results — and its scope discipline is exactly right for a repo with six concurrent test-file delegators. The key concern: step 4 says the pr-gate wall-clock will be added "through the existing report writer," but that writer (`recordSpeedHarness`, added by MRQ-23) already records `harness.pr_gate` and **overwrites it on every run** — so the step re-delivers what already exists and produces no trend, which the task names as a deliverable.

## 3. Issues

**[MAJOR] Implementation and proof steps (step 4) — The "trend" requirement is not satisfied by the existing report writer**
The task says: "add the pr-gate wall-clock trend to speed-report.json alongside the budget MRQ-23 already tracks." Verified against the code: `pr-gate.mjs` already calls `recordSpeedHarness("pr_gate", {observedMs, budgetMs, ...})` (landed in MRQ-23, commit `500c5c7`), and `recordSpeedHarness` in `scripts/checks/lib/command.mjs:49-67` replaces `harness.pr_gate` wholesale each run — `speed-report.json` holds exactly one latest measurement, no history. Step 4's commitment to go "through the existing report writer" therefore delivers a single overwritten number, which is the *current* behavior, not the trend the task asks for. A trend is what makes drift visible before the next breach; that's the point of the requirement.
**Recommendation:** Amend the plan to extend `recordSpeedHarness` (or add a sibling) so `harness.pr_gate` retains a bounded history — e.g., an appended `history: [{observedMs, budgetMs, verdict, recordedAt or commit}]` array with a small cap — while keeping the latest-value shape intact for existing readers. Name this as an explicit code change (it touches `scripts/checks/lib/command.mjs` and possibly `pr-gate.mjs`), since the plan currently claims `apply-migrations.ts` is the only file changed.

**[MAJOR] Chosen approach — The expected win of batching is asserted, not measured**
The task's instruction is "Options to evaluate and MEASURE before choosing." The plan measured three vitest-level options (`--fileParallelism=false`, `--isolate=false`, `--maxWorkers=4`) but never decomposed the ~5.4s per-file cost into Worker-isolate boot vs. schema apply. The `--isolate=false` result (12.25s) removes *both* costs at once, so it cannot support the plan's inference that "the cost is the repeated schema setup, not a reason to remove the Worker runtime." If the schema apply is, say, 1s of the 5.4s and isolate boot is the rest, batching under-delivers and the ticket doesn't buy the headroom the task exists to buy (master breached at 26-28s under concurrent load; this worktree's quiet baseline is 22.6s — that ~4-5s load sensitivity is the margin at stake).
**Recommendation:** Add a step 0: instrument `applyMigrations()` wall-time in one representative file (a few `performance.now()` lines, removed before commit) to report the schema-apply share of per-file cost before implementing. Also state a success threshold — e.g., `npm test` and pr-gate each with a named headroom margin under 30s — so "after" has a bar to clear, not just a delta to report. The plan already permits "a narrowly scoped runner/config adjustment" if measurement demands it; the decomposition measurement is what would trigger that branch honestly.

**[MINOR] Chosen approach — D1 `batch()` semantics for the DDL apply deserve one named check**
The existing `batch()` use is DELETE-only (the wipe path); the new use batches `CREATE TABLE`/`CREATE TRIGGER` DDL. D1 batches run as a transaction, and trigger bodies carry internal semicolons that `prepare()` handles today — both should carry over, but the plan should note that a chunk-boundary failure leaves a *partially applied* schema in that file's isolate (acceptable in tests since the run fails loudly, but worth stating), and confirm Miniflare's local D1 accepts DDL in `batch()` before committing to the approach.
**Recommendation:** Add one sentence acknowledging the transactional/partial-apply behavior and make "Miniflare accepts DDL in batch" the first thing implementation verifies.

**[MINOR] Scope and ownership — Two small factual drifts**
The task and plan say "983-line schema"; the four migration files total 993 lines (968 + 11 + 4 + 10). And the plan reports the 38 Node tests at 3.13s where the task says 1.4s — presumably load variance, but unexplained numbers in an A/B-driven ticket invite doubt.
**Recommendation:** Use the measured 993 (or "~1,000-line") figure and note the Node-suite variance in the evidence section so the completion report's numbers reconcile.

## 4. Positive Observations

- **Evidence before commitment.** Running and *rejecting* `--fileParallelism=false` (36.07s) and `--isolate=false` (broken tests, cross-file schema bleed) before writing the plan is exactly the discipline the task asked for, and reporting negative results plainly rather than burying them is the right culture.
- **Verified feasibility of the no-claims-file stance.** I confirmed `trace-ac.mjs` emits only a `missing-current-ticket-manifest` *warning* (not a failure) for a ticket with no claims file, so the "MRQ-70 owns no AC" position passes the merged-scope gate as planned.
- **Scope discipline under concurrency.** Declining file consolidation and `tests/node` migration specifically because six test-file delegators are active is a real coordination judgment, not scope-dodging — and the plan leaves the measured-follow-up door open rather than closing those options forever.
- **Guardrails named, not gestured at.** Auth, presign, demo-mode, reviewer isolation, hidden-field persistence, AC-259 transit are listed explicitly as untouchable, matching the task's do-not-weaken list verbatim.
- **Honest baseline provenance.** Recording the exact rebase point (the fetched `forgejo/master` HEAD), the orchestrator's stated cut point (`19f8f1d`), and the fact that the intervening commit is board-only protects the before/after comparison from silent drift.

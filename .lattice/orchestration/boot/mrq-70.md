FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-70-suite-speed" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-70** (test harness: cut per-file Worker boot so the fast suite stays under budget). Actor: `agent:delegator-mrq-70`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-70-suite-speed`, branch `mrq-70-suite-speed`, cut clean off `forgejo/master` (`19f8f1d`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQNGEKSJP5NVT826YR3K0FY.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## This one is urgent and narrow

Read the full ticket: `lattice show MRQ-70 --json`. **The fast suite already turned master red once tonight** — it breached the 30s budget under concurrent load right after a merge, and a re-run passed at 27.9s. Every remaining ticket adds integration files. Until you land, every merge is a coin flip.

**Measure first, then choose.** MRQ-23 set the standard here: it reported `npm test` 23.4s→14.6s and pr-gate 27.5s→21.8s for its batch fix. Do the same — an A/B for whatever you take, and a plainly stated negative result if an approach does not help.

The cost is **per-file, not per-test**: each integration file boots its own Miniflare isolate and applies the 983-line schema once. One file alone is ~5.4s; ~25 files together are ~12s only because vitest parallelises them. That parallelism is now saturated.

## Hard constraints

- **Do NOT raise the 30s budget.** It is a Stage 11 non-negotiable and the number is not the problem. `scripts/checks/run-test.mjs:54` enforces it; leave it enforcing.
- **Do NOT weaken, skip, or delete tests to make the clock.** Especially the guardrail tests — auth, presigns, demo-mode, reviewer event/track isolation, the hidden-field persistence proof in `public-form.AC-25-42-...`, and AC-259's transit assertions. If your change touches a test file, I will diff it and expect the assertions unchanged.
- **Six delegators are editing test files right now.** Prefer changes to the *harness* (`tests/integration/apply-migrations.ts`, `vitest.config.ts`, the runner) over sweeping edits across test files, which will conflict badly. If consolidating files is genuinely the best win, say so in your PR body and let me sequence it rather than doing it broadly yourself.

Approaches worth measuring: share one schema apply across files instead of per-file; tune vitest pool/isolate settings; move assertions that need no Worker runtime to `tests/node` (38 tests in 1.4s there); consolidate only the smallest integration files.

## Evidence required

`tests/ac-claims/MRQ-70.json` — if this ticket owns no AC directly, say so explicitly in the PR body rather than shipping an empty claims file. Report before/after for `npm test` and full `npm run pr-gate`, and add the pr-gate wall-clock to `speed-report.json` beside the budget MRQ-23 already tracks.

Before the PR: `npm run pr-gate -- --ticket MRQ-70`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-23-checks" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-23** (BUILDPLAN **M-22** — seed and speed check suites; the last Wave 1 ticket). Actor: `agent:delegator-mrq-23`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-23-checks`, branch `mrq-23-checks`, cut clean off `forgejo/master` (`07e0139`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHM9H26W9KK121VAJR8G8X.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-23-checks` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. **Write your plan to the plan file early and in rough form** — a compaction mid-planning loses the whole window.

## `check:seed` already exists — EXTEND it, do not rewrite it

**Read the ORCHESTRATOR NOTE comment on your ticket first: `lattice show MRQ-23 --json`.** MRQ-62 replaced the old stub with a real `scripts/checks/check-seed.mjs`, but it asserts **only the venue slice**: ≥2 pinned buildings, ≥1 non-zero `access_minutes`, `Online` stays unpinned, and ≥1 live Transit conflict. Those four are **AC-259's seed gate** — deleting or loosening any of them re-opens the exact defect MRQ-62 was minted to fix. Keep them, add yours alongside.

**The assertion that matters most is B-3:** the organizer demo persona's review queue returns **≥20 unreviewed candidates**. That is the check that keeps **walkthrough step 8 (evaluate) from going dead** — if the queue is empty, the judge hits a dead end on the step the whole evaluation module exists for. MRQ-5 seeded round-1 assignments across ~40 unreviewed submissions and MRQ-18 just merged the reviewer queue itself, so both halves now exist; your job is the assertion that proves they still line up.

Then the rest of SPEC §6: shape and scale over the public API, plus the **deliberate ugliness** — long diacritic names, truncating titles, a speaker on 3 submissions, a 4-person panel, an overdue task set, at least two visible double-bookings.

## The speed harness and its binding split

Measure every SPEC §1.3 budget against the real seed and emit `speed-report.json`.

**The split is a client ruling (EVALUATION §1.3, 2026-08-09) and is binding:**
- **AC-sourced budgets FAIL the run** — AC-16, AC-36, AC-62, AC-69 completion, AC-85, AC-89, AC-103.
- **The seven client-signed *objective* budgets WARN LOUDLY** with a `⚠ OBJECTIVE MISSED` banner in `speed-report.json` and **never exit non-zero**.

*"If a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion."* Reclassifying an AC-sourced budget to an objective to make a run green is the one thing this ticket must never do.

**Budgets on the checks themselves:** `check:seed` ≤30 s, `check:speed` ≤4 min. Speed is a graded feature (R7) and a slow default suite is a defect, so keep these hermetic and parallel.

**There is no live Cloudflare account this run** (deferred to **MRQ-57**). Build and run the harness against local `wrangler dev`/miniflare and the real seed. Anything measurable only on deployed infrastructure goes in your PR body as a **named MRQ-57 checklist item** — never fake a deployed number locally, and make `speed-report.json` state plainly which environment each number came from. A local number presented as a deployed one is worse than no number.

File surface: `scripts/checks/seed.ts`, `scripts/checks/speed.ts` (reconcile with the existing `scripts/checks/check-seed.mjs` rather than leaving two seed checks — say which you kept and why in your PR body).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-23.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`.

Before the PR: `npm run pr-gate -- --ticket MRQ-23`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

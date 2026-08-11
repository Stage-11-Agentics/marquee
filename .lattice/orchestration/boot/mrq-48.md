FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-48-audit-speed" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-48** (A-6 — speed report: AC-sourced versus objective). Actor: `agent:auditor-mrq-48`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-48-audit-speed`, branch `mrq-48-audit-speed`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBWM4MT4357K9XB05D36.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## Speed is a graded feature (R7) and the split is a client ruling

`scripts/checks/speed-budgets.mjs` classifies each budget as `acceptance` or `objective`, and `scripts/checks/speed.ts` fails the run only on acceptance failures. The binding ruling:

- **Seven AC-sourced budgets FAIL the run**: AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, AC-103.
- **Seven client-signed objective budgets WARN** with a `⚠ OBJECTIVE MISSED` banner and never exit non-zero.
- *"If a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion."*

**Verify the classification is honest.** Every AC-sourced criterion must be `kind: "acceptance"`; confirm none was quietly moved to `objective` to make a run green. That reclassification is the single forbidden move, and it would be invisible in a passing report.

**Then verify the measurements mean what they claim.** Check the metric matches the AC — p95 versus median versus max — and that each number is measured on the path the AC names rather than a convenient proxy. `scripts/checks/speed.ts` already annotates some samples honestly (for example noting a source-snapshot switch is not a deployed device paint); read those notes critically and say whether the proxy is defensible or whether the criterion is effectively unmeasured.

**`speed-report.json` must state plainly which environment each number came from.** There is no live Cloudflare deploy yet (MRQ-57 is not done), so every current number is local Wrangler/miniflare. A local number presented as a deployed one is worse than no number. Confirm `deployed:false` is honest and that MRQ-57's checklist names what must be re-measured on real infrastructure.

**Assume a green report over an unmeasured criterion until proven otherwise** — that shape has appeared five times on this run.

## What to produce

**Findings with `file:line` and a concrete reproduction.** Where you find nothing, name exactly which budgets you verified and how. **Add a machine guard** that pins the AC-sourced set to `kind: "acceptance"`, so a future ticket cannot reclassify one. **Key it on the invariant, not on coordinates** — assert ids and kinds, never line numbers; a guard that fails on unrelated drift gets silenced rather than heeded.

**Do not fix product code you are auditing** unless trivially safe and you say so.

## Standing rules

Suite ~16–20s against 30s; whole gate 45s. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-48.json`** — if you own no `auto` AC, say so explicitly. Before the PR: `npm run pr-gate -- --ticket MRQ-48`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

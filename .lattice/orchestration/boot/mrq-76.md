FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-76-pipeline-stage-derivation" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd via c11 send to workspace:9 surface:245 — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. **Remote is `github`, base branch `main`; Forgejo is retired — never reference it.** Your ticket: **MRQ-76**. Actor: `agent:delegator-mrq-76`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-76-pipeline-stage-derivation`, branch `mrq-76-pipeline-stage-derivation`, cut clean off `github/main @ ba22fb3`. Run `npm ci` before trusting any test result.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-76 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Commit and push your PLAN as your first commit, before any code.

## Scope of record

`lattice show MRQ-76 --json` carries the full description — that is your scope of record, and it is detailed. Read it completely before planning. It names every file, every line number, and the semantic rulings you must make. Evidence: `sequence/UX-SWEEP-FINDINGS.md` rows 1–2 and section 4b.

This is the **walkthrough blocker**: four surfaces report different counts for the same pipeline stage, one off by more than 10x, and a judge sees it in two clicks.

## HARD SCOPE BOUNDARY — read this twice

Three other delegators are live in parallel right now and own UI files you will be tempted to edit. **You are a derivation-layer ticket. You fix what the words MEAN in the query layer, not what the labels SAY.**

- **DO NOT TOUCH `src/ui/shell/route-table.ts`** — MRQ-74 owns it this cycle, and `check:design` asserts the seventeen route labels remain present, so editing it fails the gate anyway. The sidebar "Waved" entry STAYS exactly as written. Your job is to make `?status=waved` return actually-waved records, not to rename the link.
- **DO NOT TOUCH `src/ui/dashboard/DashboardPage.tsx`** — MRQ-73 owns it. Fix the counts in `src/routes/dashboard.routes.ts`; leave the component alone.
- **DO NOT TOUCH `src/ui/embeds/*` or `src/routes/embed.route.tsx`** — MRQ-75 owns them.

If your fix genuinely requires a label change in one of those files, **do not make it**. Implement the derivation correctly, and write the needed label change into your PR description as a named follow-up. Say exactly which file, which line, and what it should read. That hand-off is a complete deliverable; an edit that collides with a live branch is not.

## Constraints

Full list is in the ticket. The load-bearing ones: no migration; keep the landing page's single-D1-read property; `npm run check:speed` must stay green (speed is graded, R7); `check:design` must stay green.

## Evidence required

**No test anywhere currently pins the stage vocabulary** — `grep -rl waved tests/` returns nothing. The regression net is part of the deliverable. The invariant that makes this bug unrepeatable: **every dashboard tile's count equals the row count of the list its own href opens.** Build that test.

Validate for real against a running Worker. **Use port 8801** — `npx wrangler dev --port 8801`. Ports 8787 and 8863 are occupied by other agents' runs; do not touch them, do not run `npm run reset:demo` against anything but your own worktree's local D1. Drive the running app with the c11 embedded browser (load the `c11-browser` skill): walk `/` → `/dashboard` → `/board` → each `/submissions?status=` filter and prove every stage agrees across all four, that clicking any count opens a list whose "N matching records" matches, and that no pipeline stage links to an empty list. Attach that evidence with `--role validation`.

Before the PR: `npm run pr-gate -- --ticket MRQ-76`, paste the result into your completion comment. Then push, open the PR (`gh pr create --repo Stage-11-Agentics/marquee --base main`), bump `pr_open`, and c11-send your completion summary to **workspace:9 surface:245**.

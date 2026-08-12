FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-77-layout-fidelity" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd via c11 send to workspace:9 surface:245 — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. **Remote is `github`, base branch `main`; Forgejo is retired — never reference it.** Your ticket: **MRQ-77**. Actor: `agent:delegator-mrq-77`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-77-layout-fidelity`, branch `mrq-77-layout-fidelity`, cut clean off `github/main @ ba22fb3`. Run `npm ci` before trusting any test result.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-77 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Commit and push your PLAN as your first commit, before any code.

## Scope of record

`lattice show MRQ-77 --json` carries the full description — that is your scope of record. Read it completely before planning. Evidence: `sequence/UX-SWEEP-FINDINGS.md` rows 3–4, with screenshots at
`/private/tmp/claude-501/-Users-atin-Projects-Stage11-deployments-Marquee/e2059b77-e39b-431b-84df-d0c1dfa9db8f/scratchpad/sweep-shots/` — look at `A-organizer-evaluation-LAYOUT-BUG.png` and `A-organizer-submission-detail-published-OVERLAP-BUG.png` before you write a plan. This is a visual ticket; start by looking.

Two organizer screens render visibly broken. **They do NOT share a root cause** — the ticket explains why the original "one shared CSS defect" hypothesis was disproved by reading the components. Do not go looking for a unified fix.

- **Defect A (`/evaluation`) is already root-caused for you** down to the line: the grid is three columns, the JSX emits the arrow last, so Round 2 lands in the 34px arrow track. The binding prototype has it right. This is a small, surgical fidelity fix. Note the ticket's warning that "IdentitySep visible 8" is wrapped text, NOT an identifier leak — do not hunt for it.
- **Defect B (`/submissions/:id`) is NOT root-caused** and the authored CSS is provably sound. Reading that file harder will not find it. Diagnose it live in the browser with devtools; the ticket lists three specific candidates to rule out. Fix the actual cause — no `z-index` papering, no `overflow: hidden` that clips real content, no fixed height on the aside.

## Design authority

`DESIGN.md` and `PHILOSOPHY.md` bind. Prototype-to-product fidelity is a taste rule (SPEC.md preamble): for defect A the binding prototype **is** the spec — `prototypes/pipeline-v1.1/index.html` emits `[round card] [round-arrow] [round card]`. Match it rather than inventing a new arrangement. **Elements never jump.** `npm run check:design` must stay green.

## HARD SCOPE BOUNDARY

Three other delegators are live in parallel. You own **`src/ui/evaluation/*`, `src/ui/submissions/record.css`, `src/ui/submissions/SubmissionRecordPage.tsx`** and nothing else.

- **DO NOT TOUCH `src/routes/*`.** MRQ-76 owns `submission-record.routes.ts` and every count surface. You own the COMPONENT and the CSS; it owns the ROUTE. Do not cross that line.
- **DO NOT TOUCH** `src/ui/shell/route-table.ts` or `src/ui/dashboard/DashboardPage.tsx` (MRQ-74 / MRQ-73), or `src/ui/embeds/*` (MRQ-75).
- Layout only — no data, no API, no route changes. If a fix appears to need an API change, stop and say so in the PR.

## Evidence required

This is a visual defect and **only looking at it proves the fix**. Validate against a running Worker on **port 8802** — `npx wrangler dev --port 8802`. Ports 8787, 8801 and 8863 are occupied by other agents; do not touch them, and do not run `npm run reset:demo` against anything but your own worktree's local D1. Drive it with the c11 embedded browser (load the `c11-browser` skill) at 1316×924:

- `/evaluation` — equal-width round cards, arrow between them, no one-word-per-line wrapping. Re-check with Round 2 unconfigured to exercise the empty-round fallback.
- `/submissions/sub_agent-eng` — `WAVE` value fully visible, green schedule box showing its complete venue text with nothing drawn over it.
- `/submissions/sub_gemini-deep-research` — the previously-CORRECT tall record must STILL be correct. Guard against fixing short content by breaking tall.
- Both screens at their responsive breakpoints (record: 1000px / 760px; evaluation: 900px / 600px).

Attach before/after screenshots of both screens with `--role validation`.

Before the PR: `npm run pr-gate -- --ticket MRQ-77`, paste the result into your completion comment. Then push, open the PR (`gh pr create --repo Stage-11-Agentics/marquee --base main`), bump `pr_open`, and c11-send your completion summary to **workspace:9 surface:245**.

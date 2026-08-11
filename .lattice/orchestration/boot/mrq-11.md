FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-11-dashboard" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-11**. Actor: `agent:delegator-mrq-11`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-11-dashboard`, branch `mrq-11-dashboard`, off `forgejo/master`. Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Scope is in `lattice show MRQ-11 --json` — read it first.

Program dashboard — ACs **AC-14 – AC-16** and **AC-240**. This is the operator's home screen and the prototype's `#dashboard`: seven pipeline stages with counts and sub-labels, the attention strip, and the wave planner panel. Reproduce the binding prototype rather than reinventing the layout.

**AC-240 matters for the walkthrough:** every scheduled fixture shows day/time/room on list, record, portal, and board; unpublished items show "Not yet public" plus a publish affordance; the Scheduled and Published stage copy is exact.

Counts are gauges — monospaced tabular figures, and the numbers must agree with the seeded database rather than being computed twice by different rules.

## Standing rules

- **Route modules are `*.routes.ts`** so `_manifest.ts`'s glob registers them. A module under `src/routes/` named anything else silently misses the manifest and OpenAPI, and arms a `check:api` failure for someone else. This has already happened twice.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/<TICKET>.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` are the binding visual contract — reproduce, don't redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Headless plan-review and code-review are **suspended** — self-review inline and attach a standard-shape review naming your exact HEAD.
- Before the PR: `npm run pr-gate -- --ticket <TICKET>`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**. If `security find-internet-password` fails in your sandbox (exit 44), say so and I will open the PR for you.

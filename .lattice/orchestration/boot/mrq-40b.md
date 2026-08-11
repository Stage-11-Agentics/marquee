FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-40-readme" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — it is the binding delegator contract. Your ticket: **MRQ-40** (README, self-host path, extension points). Actor: `agent:delegator-mrq-40b`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-40-readme`, branch `mrq-40-readme`.

## You are RESUMING a ticket whose previous agent died

It got most of the way: `README.md` is written, `tests/node/readme.AC-160-162.test.mjs` and `tests/ac-claims/MRQ-40.json` exist, commit `eaacb17` is pushed, the gate passed and validation evidence is attached. Then the process exited before opening the PR. **Do not start over. Do not rewrite what is there** — read it first, it is good work. Claim the ticket (`lattice claim MRQ-40 --actor agent:delegator-mrq-40b`) and set status appropriately.

Three specific defects I found on review, then the PR:

**1. Internal ticket IDs leak into a PUBLIC README. Remove every one.** `MRQ-57` (line ~22), `MRQ-31` (~240), and `npm run pr-gate -- --ticket MRQ-40` (~285, ~301). A stranger cloning this repo has no idea what MRQ-57 is, and it advertises our internal tracker. Replace with plain descriptions of the state of the world — "deploying to a real Cloudflare account is not covered in this checkout", not "MRQ-57 is not done". If a documented command genuinely requires a ticket flag, either give a runnable example that works for an outsider or drop the command.

**2. The import section is now STALE, not just fixture-backed.** It says Sessionize import "is not built in this checkout" and that a future ticket will replace it. **Sessionize import MERGED** — mapping preview, relationships, scores, statuses, idempotent re-import (running the same export twice does not duplicate rows), and batch undo that leaves seeded data untouched. Read `src/routes/` and `tests/integration/api/sessionize-import.AC-110-113.test.ts` and describe what actually ships. One honest caveat to keep: the column fixture has not yet been checked against a real Sessionize export, so say the mapping is verified against a bundled fixture.

**3. Fold in what else landed since you started:** scoped API tokens with named scopes and an optional conference restriction, an API and CLI docs route linked from the sidebar, signed-webhook endpoints defined but delivery deferred. Your README leads with Cloudflare and the API bonus — that lead is now more true than when you wrote it, so make it concrete.

Keep everything else. The `demo_mode` section is exactly right — the affordance, the command to disable it, and the resulting `403 demo_disabled`. The Airtable framing is exactly right — "a deliberate asynchronous mirror, not a source-of-truth system" — do not soften or strengthen it.

Then: `npm run pr-gate -- --ticket MRQ-40`, push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**. Opening the PR is the step that was missed — do not stop before it.

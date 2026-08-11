FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-7-landing" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-7** (BUILDPLAN **M-05b** — public landing page with live pipeline preview; fast-track, ~2h). Actor: `agent:delegator-mrq-7`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-7-landing`, branch `mrq-7-landing`, off `forgejo/master`.

Fast-track inline: claim → plan (to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md`, absolute path) → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended.**

**This is the first thing a judge sees.** ACs: **AC-1, AC-2, AC-4**. Scope in `lattice show MRQ-7 --json`.

- `DESIGN.md` is binding (Flight Deck) and `prototypes/pipeline-v1.1/index.html` is the visual contract — reproduce it, do not redesign. Tokens live in `src/styles/tokens.css` from MRQ-6.
- The organizer's noun in UI copy is **"conference"**, never "event" (rename `9e8b425`). The wire API keeps `/api/v1/events/...` — deliberate, SPEC Amendment 13.
- Both demo logins (organizer and speaker) must be reachable from here — AC-2's demo route is merged and 403s outside `demo_mode`.
- Craft rules bind: elements never jump, monospaced tabular figures for every count, honest empty/loading states.

Evidence: an **AC-tagged test** plus **`tests/ac-claims/MRQ-7.json`**. After any rebase run `npm ci`. Route modules are `*.routes.ts`. Before the PR: `npm run pr-gate -- --ticket MRQ-7`, paste the result in your completion comment. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**.

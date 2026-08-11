FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-58-venue-geo" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-58** (venue geography migration; inline-full, ~2h). Actor: `agent:delegator-mrq-58`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-58-venue-geo`, branch `mrq-58-venue-geo`, off `forgejo/master`.

Full arc inline; **headless reviews suspended** — self-review, attach a standard-shape review naming your exact HEAD.

Read the full ticket: `lattice show MRQ-58 --json`. Summary: commit `13d37eb` makes building geography binding for travel-conflict detection, but `buildings` shipped with only `event_id`, `name`, `address`, `position`.

- **MRQ-2's `0001_init.sql` is merged and immutable — write `0002_venue_geography.sql`.** Do not edit the first migration.
- Add `lat`, `lng`, and access/travel minutes. **Read `13d37eb` before choosing the shape** — if the travel model is pairwise between buildings, a join table is right; if it is a simple walk-time from a hub, a column is right. State your choice and why in the PR body.
- Mirror the columns in `src/db/schema.ts`.
- Seed real coordinates for the three SPEC §6 buildings (Sheraton New York Times Square; the Workshop Annex at the same address; Online as virtual/null).

Evidence: an **AC-tagged test** if you claim an AC — if this ticket owns none directly, say so explicitly in the PR body rather than shipping an empty claims file. After any rebase run `npm ci`. Before the PR: `npm run pr-gate -- --ticket MRQ-58`. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**.

FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-10-settings" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-10**. Actor: `agent:delegator-mrq-10`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-10-settings`, branch `mrq-10-settings`, off `forgejo/master`. Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Scope is in `lattice show MRQ-10 --json` — read it first.

Event settings: details, formats, tracks, rooms, **and buildings** — ACs **AC-5 – AC-13** plus **AC-252/AC-253** (Amendment 11: buildings are first-class with name + address; every room belongs to one; rooms carry AV capability tags and free-text notes).

Two things already merged that you build on, not around: **MRQ-58** added `buildings.lat/lng/access_minutes` in `0002_venue_geography.sql` — surface them if the settings card needs them, but do not add columns. **MRQ-5** seeded the Sheraton-coherent trio (Sheraton New York Times Square, the Workshop Annex, Online). Room displays render "Room · Building" where schedulers and day-of staff read them.

The Buildings and Rooms settings cards span the full row (client ruling — legibility over grid symmetry). `Save event settings` confirms **in place with no page reload** (AC-7).

## Standing rules

- **Route modules are `*.routes.ts`** so `_manifest.ts`'s glob registers them. A module under `src/routes/` named anything else silently misses the manifest and OpenAPI, and arms a `check:api` failure for someone else. This has already happened twice.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/<TICKET>.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` are the binding visual contract — reproduce, don't redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Headless plan-review and code-review are **suspended** — self-review inline and attach a standard-shape review naming your exact HEAD.
- Before the PR: `npm run pr-gate -- --ticket <TICKET>`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**. If `security find-internet-password` fails in your sandbox (exit 44), say so and I will open the PR for you.

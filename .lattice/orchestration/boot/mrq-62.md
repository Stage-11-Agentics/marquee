FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-62-venue-map" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-62** (BUILDPLAN M-57 · AC-255 – AC-257 · SPEC Amendment 14 · US-77). Actor: `agent:delegator-mrq-62`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-62-venue-map`, branch `mrq-62-venue-map`, off `forgejo/master`.

**Read the ticket AND its comments first: `lattice show MRQ-62`.** The operator's venue ruling is recorded there and is binding.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Headless reviews are suspended.

## This ticket fixes a defect that is already merged and already inert in the demo

`scripts/seed/event.ts:151-152` seeds Sheraton New York Times Square and the Workshop Annex at **identical coordinates** (40.7625188, -73.9814528) with `access_minutes 0` on both. Every test passes and the Transit conflict class can never fire; the site map stacks two pins on one point. MRQ-58's migration is correct — the seed is the problem.

**Operator ruling (do not deviate):**
- Keep the 2026 Sheraton story. `Sheraton New York Times Square, 811 7th Ave` stays primary with its verified coordinate.
- Replace the same-address "Workshop Annex — Lower Conference Level" with a **real, verifiable Midtown venue ~8–12 minutes' walk away**, so `access_minutes` is genuinely non-zero.
- **Do NOT invent a venue.** Use a real place with a real street address and derive `lat`/`lng` from it. **If you cannot verify a coordinate, stop and report rather than guessing** — this repo goes public and a fake pin on a real map reads as sloppy.
- Do NOT use the 2025 building set (Times Center, Jay Suites, AWS JFK27): geographically real but chronologically wrong for a 2026 Sheraton conference, and it pairs Sheraton-native room names with 2025 buildings.
- `Online` stays unpinned — a virtual venue has no honest map position.

## The test that matters

**AC-259 must observe a LIVE Transit conflict in the seeded data** — `check:seed` asserting an actual conflict fires, not merely that a column is non-zero. A non-zero-column assertion would reproduce this exact defect one layer up: green test, dead feature.

## Scope you inherited from MRQ-10

**AC-252 and AC-253 moved to you.** MRQ-10 has been told to build no venue editors; it ships details/formats/tracks with a link through to `/settings/venues`, which is yours (AC-256 moves buildings *and* rooms authoring there). Rooms carry AV capability tags and free-text notes; room displays render "Room · Building" where schedulers and day-of staff read them.

## Prototype

`prototypes/pipeline-v1.1/index.html` at **v1.7** is the binding design contract and every surface here is built and driveable there — drive it rather than guessing. Design reasoning is in `sequence/venue-map-ux.md`. **v1.7 currently shows the 2025 buildings, which contradicts the ruling above — flag that to the Orchestrator when your change lands so prototype and build do not diverge.** Do not silently edit the prototype to match; that is a design-contract change and I decide it.

## Standing rules

- Route modules are `*.routes.ts` so the manifest glob registers them; anything else silently misses the OpenAPI document and arms a `check:api` failure.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an AC-tagged test plus `tests/ac-claims/MRQ-62.json`.
- UI copy says "conference", never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- Before the PR: `npm run pr-gate -- --ticket MRQ-62`, paste the result into your completion comment. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**. If the Forgejo keychain lookup fails in your sandbox (exit 44), say so and I will open the PR.

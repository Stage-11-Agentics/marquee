FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-20-agenda" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-20**. Actor: `agent:delegator-mrq-20`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-20-agenda`, branch `mrq-20-agenda`, off `forgejo/master`. Read the scope first: `lattice show MRQ-20 --json`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Headless reviews are suspended — self-review and attach a standard-shape review naming your exact HEAD.

## The agenda — data, pool, placement, and the day/list/week/room views

ACs **AC-70 – AC-74, AC-80, AC-82**, plus **AC-252/AC-253 agenda-side rendering** (Amendment 11): room headers show AV capability tags and notes in a tooltip/panel where placement decisions happen, and room displays render **"Room · Building"**.

**Coordinate with MRQ-62**, which is live and re-seeding building geography so travel-time conflicts can actually fire — do not duplicate its seed work, and read its ticket comments before touching buildings. **Agenda drag is the one place drag is legal** (AC-243 forbids it on the program board). Double-bookings are seeded deliberately (two are visible on load) — surface them honestly rather than hiding them.

## Standing rules

- Route modules are **`*.routes.ts`** declared through `defineApiRoute` so the manifest glob and OpenAPI pick them up. Anything else silently misses the schema and arms a `check:api` failure. This dodge has happened twice and is now fixed fleet-wide — do not reintroduce it.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/MRQ-20.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- **Never weaken an existing guardrail test to make your change pass.** If one breaks, your change is wrong. The orchestrator diffs prior guardrail tests against master and expects them empty.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` at **v1.7** are the binding visual contract — drive the prototype, reproduce it, do not redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Before the PR: `npm run pr-gate -- --ticket MRQ-20`, paste the result into your completion comment. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**. If the Forgejo keychain lookup fails in your sandbox (exit 44), say so and I will open the PR.

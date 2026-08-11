FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-19-decisions" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-19**. Actor: `agent:delegator-mrq-19`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-19-decisions`, branch `mrq-19-decisions`, off `forgejo/master`. Read the scope first: `lattice show MRQ-19 --json`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Headless reviews are suspended — self-review and attach a standard-shape review naming your exact HEAD.

## Bulk decisions and the cascade

ACs **AC-66 – AC-69, AC-114 – AC-117, AC-243**. MRQ-12 merged the demo-safe outbox — **use it; do not add a second send path.** AC-117 ("a repeated bulk action cannot notify twice") is already enforced by the outbox UNIQUE idempotency key; rely on that constraint rather than a pre-check that races.

**AC-243 is a client ruling with teeth:** no board card carries `draggable` or lifecycle controls; click/Enter/Space opens the exact record; consequential actions live on the detail screen behind a confirmation that names the cascade. Agenda drag still operates — that is the one place drag is legal.

Bulk selection is a **server-side selector** (ids *or* filter), which MRQ-8 already built — reuse it rather than materialising id lists in the client.

## Standing rules

- Route modules are **`*.routes.ts`** declared through `defineApiRoute` so the manifest glob and OpenAPI pick them up. Anything else silently misses the schema and arms a `check:api` failure. This dodge has happened twice and is now fixed fleet-wide — do not reintroduce it.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/MRQ-19.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- **Never weaken an existing guardrail test to make your change pass.** If one breaks, your change is wrong. The orchestrator diffs prior guardrail tests against master and expects them empty.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` at **v1.7** are the binding visual contract — drive the prototype, reproduce it, do not redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Before the PR: `npm run pr-gate -- --ticket MRQ-19`, paste the result into your completion comment. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**. If the Forgejo keychain lookup fails in your sandbox (exit 44), say so and I will open the PR.

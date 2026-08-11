FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-61-auth-manifest" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-61**. Actor: `agent:delegator-mrq-61`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-61-auth-manifest`, branch `mrq-61-auth-manifest`, off `forgejo/master`. Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Scope is in `lattice show MRQ-61 --json` — read it first.

**This is an armed `check:api` failure, and the worst-placed one.** `src/routes/auth.endpoints.ts` and `admin-ops.endpoints.ts` are raw Hono sub-apps mounted directly in `src/index.ts`, named outside the `*.routes.ts` glob, so `/api/v1/auth/*` and `/api/v1/admin/*` are absent from the manifest and OpenAPI. `check:api` fails on any non-GET path an e2e replay hits that is missing from the schema — and **walkthrough step 1 is a demo-login POST to `/api/v1/auth/demo`**.

Either bring them into the manifest convention, or — if they must stay raw sub-apps for cookie/session reasons — add an **explicit named allowlist** beside SPEC §4.2's three calendar/feed URLs, with a comment saying why. Record the decision; do not let a filename imply it.

**Do not weaken MRQ-3's guardrails to make this easier.** AC-2 (demo login 403s outside `demo_mode`, sets no cookie) and AC-214 (per-event reviewer scope, including the schema CHECK that rejects org-wide reviewer memberships) must all still pass unchanged. If one breaks, your change is wrong, not the test.

## Standing rules

- **Route modules are `*.routes.ts`** so `_manifest.ts`'s glob registers them. A module under `src/routes/` named anything else silently misses the manifest and OpenAPI, and arms a `check:api` failure for someone else. This has already happened twice.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/<TICKET>.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` are the binding visual contract — reproduce, don't redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Headless plan-review and code-review are **suspended** — self-review inline and attach a standard-shape review naming your exact HEAD.
- Before the PR: `npm run pr-gate -- --ticket <TICKET>`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**. If `security find-internet-password` fails in your sandbox (exit 44), say so and I will open the PR for you.

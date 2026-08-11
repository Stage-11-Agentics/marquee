FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-35-routing" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-35** (M-37 — category routing). Actor: `agent:delegator-mrq-35`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-35-routing`, branch `mrq-35-routing`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMANFBSR9HBSE6ZSEFCF3.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-35 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## Route submissions to the right reviewers without breaking isolation

Read the scope with \`lattice show MRQ-35 --json\`.

**Reviewer isolation is a guardrail I hand-review at merge.** Three merged layers now protect it and routing must extend, never bypass: MRQ-3's per-event scoping down to a database CHECK; MRQ-18's \`committee.event_id = submission.event_id\` tightening in \`src/lib/reviewer-scope.ts\`; and MRQ-33's pre-write guard \`reviewerCanBeAssignedToSubmission\` enforcing event membership, reviewer role, and track scope. Automatic routing is exactly the feature most likely to become the path around all three, because it assigns without a human in the loop.

Prove it: a routing rule that would place a submission outside a reviewer's track scope is **refused, and writes no \`round_assignments\` row** — assert the count before and after, with a positive control showing correct routing does write.

## Standing rules for this run

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts` (one condition evaluator, four consumers), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites — you are not a third**; `tests/node/comms.AC-250.test.mjs` machine-enforces that count and forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts` (`recipientsFor` — an explicitly empty selection is a deliberate no-op; preserve that), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written — and carry a **positive control** so they cannot pass vacuously.
- The suite is the fleet's inner-loop clock (~10–18s against 30s; whole gate 45s). Prefer `tests/node` for anything not needing a Worker runtime. After any rebase run `npm ci` and let it settle before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract; **elements never jump**. The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13). **This repo ships public** — no secrets, internal hostnames, or Stage 11 internals.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-35.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. Before the PR: `npm run pr-gate -- --ticket MRQ-35`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

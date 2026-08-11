FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-31-import" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-31** (BUILDPLAN **M-30** — Sessionize import). Actor: `agent:delegator-mrq-31`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-31-import`, branch `mrq-31-import`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMA97VNTJ6AC2WVKAB6X5.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-31 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## This is the migration story — it is why an organizer would switch

Scope: mapping preview, relationships/scores/statuses, **idempotent outcomes**, **batch undo**, and a named empty-state/README entry. ACs **AC-109 – AC-113**.

**Idempotency and undo are the whole trust proposition.** An organizer importing a year of real conference data needs to know that running it twice does not double their sessions, and that a bad import can be reversed. Prove both by row count, not by response status: import the same file twice and assert the row counts are identical; then batch-undo and assert the rows are gone and nothing unrelated was touched. That last clause matters — an undo that also deletes seeded data is worse than no undo.

## AC-109 is the plan's ONE `op-assist` criterion — do not fake it

AC-109 needs **one real Sessionize export from the operator** (sessions + speakers + evaluation results, any event). It is the only thing that proves our column fixture's names and status vocabulary match reality. I have flagged it to the operator; it is not yet in hand.

Build everything else against `fixtures/sessionize/{sessions,speakers}.csv`. **Do not invent a "realistic" export and treat it as validation** — a fixture we wrote cannot prove our fixture is right, and that circularity is exactly the failure this criterion exists to catch. If the real export does not arrive before you finish, say so plainly in your PR body as an outstanding `op-assist` item, name AC-109 as uncovered-pending-operator, and ship the rest.

## Downstream

**MRQ-40 (README) is in flight right now** and is writing its import section against the fixture, marked as fixture-backed. When you land, its text needs folding to your real behaviour — name in your PR body exactly what the README should say about import so that fold is mechanical rather than a rewrite.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/outbox.ts` (**exactly two `always_live` sites — you are not a third**; `tests/node/comms.AC-250.test.mjs` machine-enforces that count), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing**, with a positive control so they cannot pass vacuously.
- The suite is the fleet's inner-loop clock (currently ~12–18s against 30s). Prefer `tests/node` for anything that does not need a Worker runtime.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**. **Elements never jump** — a mapping preview must not reflow as columns are matched. The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-31.json`**. `trace:ac` blocks merge on uncovered `auto` ACs — AC-109 is `op-assist`, not `auto`, so declare it accordingly rather than claiming coverage you do not have.

Before the PR: `npm run pr-gate -- --ticket MRQ-31`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

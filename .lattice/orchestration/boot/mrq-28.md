FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-28-rounds" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-28** (M-27+M-46 — two-round funnel and comparison mode). Actor: `agent:delegator-mrq-28`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-28-rounds`, branch `mrq-28-rounds`, cut clean off `forgejo/master` (`8a39b4b`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMA06YP5Y3FM4X13C751G.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-28 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code** — `git add -A && git commit -m "MRQ-28 plan" && git push forgejo mrq-28-rounds`. Delegators on this run have repeatedly hit 90% context with a dozen modified files and zero commits.

## Extend the evaluation module MRQ-17 and MRQ-18 built

Per-round scorecard and evaluator set; bulk promote from a filtered round-1 list; both rounds' scores together on the record.

**Reviewer isolation is a guardrail I hand-review at merge.** MRQ-18 tightened `src/lib/reviewer-scope.ts` so a committee member cannot reach another conference's submissions (`committee.event_id = submission.event_id`), and MRQ-33 added the pre-write guard `reviewerCanBeAssignedToSubmission` enforcing event membership, reviewer role, and track scope. **Adding a second round must not become the path around either.** Prove it: assigning a round-2 reviewer outside their track scope is rejected AND no `round_assignments` row is written.

Bulk promote runs through MRQ-8's chunking helper and MRQ-19's bulk selector type — do not write a third bulk path. The record shows both rounds together; MRQ-33 owns the record surface, so extend it rather than creating a parallel view.

## Standing rules that bind every ticket on this run

- **Build on what is merged; never fork a shared seam.** `src/lib/form-conditions.ts` (condition evaluator), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/outbox.ts` (**exactly two `always_live` write sites — you are not a third**), `src/lib/venue-geometry.ts`, and MRQ-8's list contract and generated route manifest. If a helper does not express what you need, **add to it** and say so in your PR body.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, title, or row. A status-only assertion passes while the leak ships. Include a positive control so the assertions cannot pass vacuously.
- **The fast suite is at 26s against a hard 30s budget and already turned master red once tonight.** Keep integration tests lean; prefer `tests/node` for anything that does not need a Worker runtime, and do not add integration files you do not need.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump.** The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` deliberately (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-28.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. JSON route modules are named `*.routes.ts`; verify your paths reach the OpenAPI document (`check:api` fails a route that bypasses the manifest).

Before the PR: `npm run pr-gate -- --ticket MRQ-28`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

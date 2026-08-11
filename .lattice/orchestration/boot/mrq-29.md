FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-29-search" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-29** (M-28 — quick search). Actor: `agent:delegator-mrq-29`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-29-search`, branch `mrq-29-search`, cut clean off `forgejo/master` (`8a39b4b`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMA377D1W31X8NY6Q8FPB.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-29 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code** — `git add -A && git commit -m "MRQ-29 plan" && git push forgejo mrq-29-search`. Delegators on this run have repeatedly hit 90% context with a dozen modified files and zero commits.

## The affordance lives in the shell, not on screens

**AC-101 iterates EVERY admin route in the route manifest.** Put the affordance in MRQ-6's admin shell (`src/ui/shell/*`) so it is present everywhere by construction — bolting it onto individual screens will fail the AC the moment a route is added. Additive only: do not restyle the shell. Note MRQ-21 is concurrently editing the agenda, and the shell was recently touched by MRQ-16 and MRQ-33; rebase early rather than at PR time.

`/` and ⌘K open it **with no navigation** — the current screen must not change underneath the operator. One labelled result list across submissions, speakers, sessions, and forms; fuzzy on name and title.

**AC-103 is an AC-sourced speed budget and it FAILS the run: keystroke → results painted p95 ≤ 200 ms over ≥10 queries including misspellings.** MRQ-23 shipped the harness (`scripts/checks/speed.ts`) — measure against it rather than guessing. Speed is a graded feature (R7).

## Standing rules that bind every ticket on this run

- **Build on what is merged; never fork a shared seam.** `src/lib/form-conditions.ts` (condition evaluator), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/outbox.ts` (**exactly two `always_live` write sites — you are not a third**), `src/lib/venue-geometry.ts`, and MRQ-8's list contract and generated route manifest. If a helper does not express what you need, **add to it** and say so in your PR body.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, title, or row. A status-only assertion passes while the leak ships. Include a positive control so the assertions cannot pass vacuously.
- **The fast suite is at 26s against a hard 30s budget and already turned master red once tonight.** Keep integration tests lean; prefer `tests/node` for anything that does not need a Worker runtime, and do not add integration files you do not need.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump.** The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` deliberately (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-29.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. JSON route modules are named `*.routes.ts`; verify your paths reach the OpenAPI document (`check:api` fails a route that bypasses the manifest).

Before the PR: `npm run pr-gate -- --ticket MRQ-29`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

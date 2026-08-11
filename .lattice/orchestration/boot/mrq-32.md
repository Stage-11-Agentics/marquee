FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-32-comms" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-32** (M-34+M-35+M-31 — automated triggers, filtered group email, rejection at scale). Actor: `agent:delegator-mrq-32`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-32-comms`, branch `mrq-32-comms`, cut clean off `forgejo/master` (`8a39b4b`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMAC7VPR42038JY14BN09.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-32 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code** — `git add -A && git commit -m "MRQ-32 plan" && git push forgejo mrq-32-comms`. Delegators on this run have repeatedly hit 90% context with a dozen modified files and zero commits.

## One comms cluster on one module — everything rides MRQ-12's outbox

Seven toggleable templates plus a configurable pre-close cron; filtered group email; rejection at scale.

**This is the ticket most able to mail real people by accident.** Resend's free tier is 100/day and judging is imminent. Every send you add is `demo_safe` — `outbox.send_policy` has **exactly two** `always_live` write sites and neither is yours. Name in your PR body every send site you add and its policy.

**AC-117 idempotency: a repeated bulk action cannot notify twice.** `outbox.idempotency_key` is `sha256(template_key, entity_id, person_id)`, UNIQUE in the schema — rely on the constraint, never a pre-check that races. MRQ-25 added `entity_id` to the outbox insert, which is what makes this work. Prove it: fire the same action twice, assert one row and one delivery.

Merge-field rendering is shared across all three constituents — that is why they are one ticket. Define it once.

## Standing rules that bind every ticket on this run

- **Build on what is merged; never fork a shared seam.** `src/lib/form-conditions.ts` (condition evaluator), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/outbox.ts` (**exactly two `always_live` write sites — you are not a third**), `src/lib/venue-geometry.ts`, and MRQ-8's list contract and generated route manifest. If a helper does not express what you need, **add to it** and say so in your PR body.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, title, or row. A status-only assertion passes while the leak ships. Include a positive control so the assertions cannot pass vacuously.
- **The fast suite is at 26s against a hard 30s budget and already turned master red once tonight.** Keep integration tests lean; prefer `tests/node` for anything that does not need a Worker runtime, and do not add integration files you do not need.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump.** The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` deliberately (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-32.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. JSON route modules are named `*.routes.ts`; verify your paths reach the OpenAPI document (`check:api` fails a route that bypasses the manifest).

Before the PR: `npm run pr-gate -- --ticket MRQ-32`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

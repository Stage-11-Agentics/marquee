FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-36-cli" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-36** (M-38 — the marquee CLI and the shipped SKILL.md). Actor: `agent:delegator-mrq-36`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-36-cli`, branch `mrq-36-cli`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMARFC8S79E1P8M111SGQ.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-36 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## Agent-native by design is a PHILOSOPHY principle, and this is where it is true or not

Marquee claims to be agent-native. A shipped CLI and SKILL.md is the proof an evaluator can actually run. **MRQ-30 is landing scoped API tokens right now** (\`program:read/write\`, \`review:write\`, \`speaker:write\`, \`agenda:write\`, \`comms:send\`, \`mirror:write\`, optional event restriction, effective authority = grant INTERSECT membership). Your CLI authenticates with those tokens — do not invent a second auth path, and never instruct a user to paste a session cookie.

The SKILL.md ships **in the public repo** and is read by strangers and by other agents. Write it the way our own skills are written: short, principle-stating, timeless. No Stage 11 internals, no Lattice references, no orchestration vocabulary, no \"previously this required X\" backstory.

The CLI must be genuinely runnable from a clean checkout against a local \`wrangler dev\` — follow your own instructions and fix whatever breaks. MRQ-40 is writing the README concurrently; name in your PR body exactly what it should say about the CLI so that fold is mechanical.

## Standing rules for this run

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts` (one condition evaluator, four consumers), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites — you are not a third**; `tests/node/comms.AC-250.test.mjs` machine-enforces that count and forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts` (`recipientsFor` — an explicitly empty selection is a deliberate no-op; preserve that), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written — and carry a **positive control** so they cannot pass vacuously.
- The suite is the fleet's inner-loop clock (~10–18s against 30s; whole gate 45s). Prefer `tests/node` for anything not needing a Worker runtime. After any rebase run `npm ci` and let it settle before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract; **elements never jump**. The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13). **This repo ships public** — no secrets, internal hostnames, or Stage 11 internals.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-36.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. Before the PR: `npm run pr-gate -- --ticket MRQ-36`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-64-arrival" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-64** (M-59 — arrival instructions: portal location card, place merge fields, ICS GEO). Actor: `agent:delegator-mrq-64`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-64-arrival`, branch `mrq-64-arrival`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQAGWB5YGHDZ98ZK5JG2NN0.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-64 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## Geography becomes something a speaker can act on

MRQ-62 shipped venue geography, MRQ-63 surfaced Transit conflicts, MRQ-16 shipped the portal, MRQ-25 shipped ICS. You join them: the speaker sees **where to go and when to leave**.

Three surfaces: the portal **location card**, **place merge fields** in comms, and **ICS GEO**. All three read the same building record — \`access_note\`, \`lat\`/\`lng\`, \`access_minutes\` — through \`src/lib/venue-geometry.ts\`. Do not re-derive walking time; \`walkingMinutes()\` exists and is haversine x 1.3 / 80, floored at 1.

**The disclosure rule is the trap.** \`access_note\` is operator-facing on ADMIN surfaces and is deliberately kept off the public site (AC-253, enforced by MRQ-22's test asserting the public agenda never contains \"Photo ID required\"). But the **confirmed speaker's own portal** is exactly where that instruction belongs — that is the point of this ticket. Do not leak it to the public agenda while adding it to the portal; prove both in one test: present on the authenticated portal, absent from the public page.

Merge fields go through the master-resident renderer (\`mergeTemplate\` / \`mergeDataForRecipient\`). Never write a second one.

## Standing rules for this run

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts` (one condition evaluator, four consumers), `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites — you are not a third**; `tests/node/comms.AC-250.test.mjs` machine-enforces that count and forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts` (`recipientsFor` — an explicitly empty selection is a deliberate no-op; preserve that), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written — and carry a **positive control** so they cannot pass vacuously.
- The suite is the fleet's inner-loop clock (~10–18s against 30s; whole gate 45s). Prefer `tests/node` for anything not needing a Worker runtime. After any rebase run `npm ci` and let it settle before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract; **elements never jump**. The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13). **This repo ships public** — no secrets, internal hostnames, or Stage 11 internals.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-64.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. Before the PR: `npm run pr-gate -- --ticket MRQ-64`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

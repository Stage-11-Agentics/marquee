FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-47-audit-cookie" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-47** (A-5 — audit: cookie scope and session issuance). Actor: `agent:auditor-mrq-47`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-47-audit-cookie`, branch `mrq-47-audit-cookie`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBSMK6CGGRJBQ45MGQGD.md` → `planned` → `in_progress` → work → self-review → PR → `pr_open`. Read the full scope with `lattice show MRQ-47 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any other work.** **Opening the PR is the final step and it is not optional** — one agent on this run finished everything, passed its gate, and died before opening the PR.

## Sessions are the perimeter

Verify independently: cookie attributes (\`HttpOnly\`, \`Secure\`, \`SameSite\`, \`Path\`, and no over-broad \`Domain\`); session issuance and expiry; that a session cannot be minted or extended by an unauthenticated caller; and that magic-link tokens are single-use and time-bounded.

**Demo login is a \`demo_mode\`-only affordance** and the README now documents disabling it. Confirm the route genuinely 403s with \`demo_disabled\` when \`demo_mode = 0\` — the README makes that promise to self-hosters in public, so it must be true.

MRQ-30 added **scoped API tokens** (bearer, hashed at rest, effective authority = grant INTERSECT membership, optional conference restriction, immediate revocation). Those share the credential resolver with cookie sessions. Check the two paths agree: a bearer token must not obtain authority a cookie session would be denied, and vice versa.

**Report findings with \`file:line\` and a concrete failure input**, and add a machine guard where one could recur.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts`, `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts`, MRQ-8's list contract and generated route manifest.
- **The mail guardrail is now machine-enforced by an AST inventory** in `tests/node/comms.AC-250.test.mjs`: no production module may import a Resend client, only `src/jobs/mail/consumer.ts` may reference the endpoint, and exactly **two** live-policy writes exist, both in `outbox.ts`. If your work trips it, you have introduced a third — fix your code, never the guard.
- **Guardrail tests assert the status code AND the absence of the thing** (no leaked ID, no row written — check counts before and after) **and carry a positive control** so they cannot pass vacuously.
- Suite ~10–18s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci` and let it settle ~20s before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**; wire API keeps `/api/v1/events/...`. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-47.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-47`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

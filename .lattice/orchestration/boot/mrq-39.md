FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-39-mobile" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-39** (M-43 + M-44 — mobile reviewer pass and optional AI first pass). Actor: `agent:delegator-mrq-39`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-39-mobile`, branch `mrq-39-mobile`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/$u.md` (uuid from `lattice show MRQ-39 --json`) → `planned` → `in_progress` → work → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## Read the scope carefully — the AI half is explicitly OPTIONAL

\`lattice show MRQ-39 --json\` has the full scope. The mobile reviewer pass is the real deliverable; the AI first pass is marked optional and you should treat it as cuttable. **If the AI pass would compromise the mobile work or the suite budget, cut it and say so explicitly in your PR body** — EVALUATION gate 19 requires any cut to be NAMED, and a named cut is a legitimate outcome. Do not half-build it.

**Mobile reviewer pass**: the reviewer queue and record at 375 px, driven by thumb. MRQ-18 built the queue and MRQ-28 the two-round funnel and comparison mode; you are making them usable one-handed, not redesigning them. **Elements never jump** matters more on mobile than anywhere else — a control that moves as you reach for it is the difference between a demo that feels solid and one that feels broken.

Blind review still binds: MRQ-50's audit shipped a guard asserting identity is null-selected when a round is anonymized, and that exactly one module queries identity. Do not add a mobile path that reintroduces identity — the guard will catch you, and it should.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs` which also forbids a direct `api.resend.com` fetch), `src/lib/venue-geometry.ts`, `src/lib/venue-disclosure.ts`, `src/lib/auth/auth-middleware.ts` (cookie and bearer BOTH org-filter via `loadMembershipsForOrg` — do not diverge them again), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing** — no leaked ID, no row written, counts before and after — **with a positive control** so they cannot pass vacuously.
- **Any guard you add keys on the invariant, never on coordinates.** Assert files/counts/ids, never line numbers; a guard that fails on unrelated drift gets silenced rather than heeded.
- Suite ~19–27s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-39.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-39`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.

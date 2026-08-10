FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-3-auth" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-3** (BUILDPLAN **M-03** — auth, demo entry, and reset-demo; inline-full, ~4h). Actor: `agent:delegator-mrq-3`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-3-auth`, branch `mrq-3-auth`, cut clean off `forgejo/master`.

Run the full arc yourself: claim → `in_planning` → write the plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-3 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Skip the headless `lattice plan-review` and `lattice code-review`** — both are suspended for this run; self-review inline and attach a standard-shape review with `--role review` naming your exact HEAD.

**Scope** is in `lattice show MRQ-3 --json` (verbatim from BUILDPLAN). ACs: **AC-1, AC-2, AC-107, AC-214, AC-230**. Master already has MRQ-1's skeleton (`src/index.ts`, cookie helper with no `Domain` attribute), MRQ-2's complete D1 schema, and MRQ-6's design system + check harness — build on all three, do not reinvent them.

**Security guardrails — non-negotiable, and the reason this ticket gets orchestrator eyes at merge:**
- **Demo auth must 403 unless `demo_mode` is on.** A demo login route live in production is the single worst outcome of this ticket. Name the test that proves it fails closed.
- Magic links are roll-your-own: single-use, expiring, constant-time compared, and never logged.
- Session cookies scope to the **exact subdomain** — never a parent domain (cross-project leak).
- `reset:demo` is **manual-invocation only** — no cron, no unattended trigger.

There is no real Cloudflare account this run (deferred to MRQ-57), so validate locally with `wrangler dev` + curl and attach that evidence.

Before the PR: `npm run pr-gate -- --ticket MRQ-3`, and paste the result into your completion comment — private Forgejo has no CI runner. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at workspace:9 surface:60.

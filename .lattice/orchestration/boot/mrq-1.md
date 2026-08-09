FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-1-platform-skeleton" || { echo "FATAL: wrong cwd"; exit 99; }`
On failure HALT and report — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-1** (BUILDPLAN **M-01**, inline-full, ~3h). Actor: `agent:delegator-mrq-1`. Worktree branch: `mrq-1-platform-skeleton`.

**Mission:** the walking skeleton — everything in your ticket description (`lattice show MRQ-1 --json`): repo scaffold, `wrangler.jsonc` with every binding (D1, R2, KV, Queue, cron, Turnstile secrets), Vite + TS, Hono entry, health route, session cookie helper with no `Domain` attribute, `https://` only. Design tokens land later (MRQ-6); do not gold-plate.

**Cloudflare specifics:**
- Target account: **Stage11 Projects**. `CLOUDFLARE_ACCOUNT_ID` is in `/Users/atin/Projects/Stage11/code/holodeck/.env` — read it at runtime; **never commit it** (repo goes public). Wrangler reads it from the environment; keep `account_id` out of `wrangler.jsonc` and document the env requirement in a README stub.
- **Deploy gate:** the operator has not yet run `wrangler login` on this machine. Check `npx wrangler whoami` when you reach the deploy step. If unauthenticated: complete everything else, prove the skeleton with `wrangler dev` locally (curl the health route, attach evidence), open the PR with a prominent **"DEPLOY PENDING — operator wrangler login"** section, bump `pr_open`, and report the blocker to the Orchestrator via c11 send. If authenticated: deploy for real (the account must be on Workers Paid — if the deploy errors on plan, that is an operator blocker, report it), then wire the custom domain `marquee.stage11.dev` (a `CLOUDFLARE_DNS_TOKEN` for the stage11.dev zone is in the same holodeck `.env` if a DNS record is needed; Workers custom domains via wrangler config preferred). `.dev` is HSTS-preloaded — https only.

Phases per COMMON: plan → plan-review → implement → code-review → validate → PR → `pr_open` → report. Your ticket sits at the head of the CP-1 critical chain — MRQ-2 (schema) is planning in parallel right now and unblocks the moment you reach `review`, so do not sit on a finished phase.

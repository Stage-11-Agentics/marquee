FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-59-route-manifest" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-59** (port uploads routes onto the generated route manifest; fast-track, ~1h). Actor: `agent:delegator-mrq-59`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-59-route-manifest`, branch `mrq-59-route-manifest`, off `forgejo/master`.

Fast-track inline; **headless reviews suspended**.

Read the full ticket: `lattice show MRQ-59 --json`. **This is an armed gate failure, not cosmetics.** MRQ-14 named its module `src/routes/uploads.direct.ts` specifically so it would miss `_manifest.ts`'s `import.meta.glob("./**/*.routes.ts")`. Its endpoints are `/api/v1/...` POSTs, and `check:api` collects every non-GET request from an e2e replay and **fails on any path absent from the public schema**. Nothing fails today only because e2e does not yet exercise uploads.

- Bring the module into the glob (rename to `uploads.routes.ts` or equivalent) and register its routes through the manifest like every other API module.
- Confirm the served OpenAPI document then contains the upload paths and `check:api` still passes.
- If any upload route genuinely must stay out of the versioned public schema, that is an **explicit named allowlist entry** alongside SPEC §4.2's three calendar/feed URLs — never a filename that quietly misses a glob.
- Keep MRQ-14's guardrails intact: AC-231 presign fails closed, AC-232 type/size/magic-byte/rate-limit/origin isolation. **Do not weaken a test to make the port easier** — if a guardrail test breaks, the port is wrong, not the test.

After any rebase run `npm ci`. Before the PR: `npm run pr-gate -- --ticket MRQ-59`, paste the result. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**.

# MRQ-1: Platform skeleton and first real deploy

BUILDPLAN: M-01 — Wave 0, walking skeleton (§3)

Scope (verbatim): Repo, `wrangler.jsonc` with every binding (D1, R2, KV, Queue, cron, Turnstile secrets), Vite + TS, Hono entry, health route, custom domain `marquee.stage11.dev`, **deploy to the Paid plan before anything else lands**. `https://` only; session cookie helper with **no `Domain` attribute**.

Why it goes first (§2): deploying to the real Workers Paid plan on day one is the only way to discover the 10 ms CPU ceiling (trap 2) and a lapsed R2 entitlement (trap 4) while there is still time — neither is visible in local dev. Trap 15 (`.dev` is HSTS-preloaded; parent-domain cookies leak) dies here too: the session cookie carries no `Domain` attribute and guardrail G6 asserts it.

File surface: `wrangler.jsonc`, `package.json`, `vite.config.ts`, `src/index.ts`, `src/lib/cookies.ts`

ACs: — (no AC directly claimed; underwrites AC-1/AC-2's deployed URL and guardrail G6)
Hours: 3
Workflow: inline-full
Shared files: `wrangler.jsonc` — M-01 OWNS it (§7). All bindings are declared up front so no later ticket needs to touch it; any addition serializes through the orchestrator. `package.json` is created here but its **script table is M-06's** — do not register commands.
Deps: none (root of the corrected Wave 0 critical chain M-01 → M-02 → M-07 → M-08 = 15 h to CP-1)
Human precondition: Workers Paid enabled and verified; R2 entitlement probed (§8 items 1–2)
## Plan

### Baseline and constraints

- Work from `mrq-1-platform-skeleton`, rebased on `forgejo/master` at `bed8486d65220ef12539c65e4916313dc2dd9223` before edits.
- Keep the Worker account-neutral in git: omit `account_id`; Wrangler receives `CLOUDFLARE_ACCOUNT_ID` from the operator environment. No secret values, account IDs, private paths, real emails, or Stage 11 internals enter committed files.
- M-01 owns the complete `wrangler.jsonc` binding surface. It creates `package.json`, but registers no scripts because M-06 owns the script table. M-05a/MRQ-6 owns design tokens and shell work; this ticket adds no visual system.
- Keep every account resource unresolved for the deferred operator deploy: D1/KV resource IDs use obvious `REPLACE_ME-<binding>` values; D1/R2/Queue resource names use schema-valid `replace-me-*` placeholders, each under a `TODO-OPERATOR (MRQ-57)` comment. Named queues are declared as both producers and consumers. No real account resource is created in this run.

### Implementation

1. Scaffold the TypeScript/Vite Worker:
   - `package.json`: private ESM package with runtime `hono`; development dependencies for the Cloudflare Vite plugin, Worker types, TypeScript, Vite, and Wrangler; deliberately no `scripts` field.
   - `vite.config.ts`: the official Cloudflare Vite plugin only.
   - `tsconfig.json`: strict Workers-compatible TypeScript configuration.
   - Minimal client entry asset only if required for Vite to materialize the static-assets binding; no product design or tokens.
2. Author `wrangler.jsonc` as the durable binding contract:
   - Worker `marquee`, `src/index.ts`, current compatibility date, custom domain `marquee.stage11.dev`, `workers_dev: false`, and static assets binding `ASSETS`.
   - D1 `DB`, R2 `MEDIA`, and KV `CACHE`, using obvious operator-fill placeholders and no `account_id`.
   - Queue producer/consumer pairs for mail, Airtable mirror, operations/reset, and outbound webhook delivery: `MAIL_QUEUE`, `MIRROR_QUEUE`, `OPERATIONS_QUEUE`, `WEBHOOK_QUEUE` with stable `marquee-*` queue names.
   - Cron triggers for hourly pre-close work, daily mirror-webhook keepalive, and nightly orphan cleanup; the scheduled handler will later route by the exact cron expression.
   - Required secret bindings for Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) with names only in config. An untracked `.dev.vars` and committed `.dev.vars.example` carry only Cloudflare's published always-pass Turnstile test pair.
3. Build the Hono walking skeleton in `src/index.ts`:
   - Define the complete binding type surface so downstream tickets consume stable names.
   - Redirect non-local HTTP requests to the equivalent HTTPS URL and emit HSTS on production responses.
   - Serve `GET /health` as a small JSON liveness response.
   - Export inert queue and scheduled handlers so every declared trigger has a valid Worker handler without implementing downstream jobs.
4. Add `src/lib/cookies.ts`:
   - `mq_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`.
   - Set and clear helpers omit `Domain` structurally; no caller can broaden the cookie to the parent domain.
5. Add a public-safe README stub documenting install/build/dev/deploy commands without package scripts, the `CLOUDFLARE_ACCOUNT_ID` environment requirement, Wrangler login prerequisite, automatic resource provisioning, required secret names, and the HTTPS custom domain. Extend `.gitignore` for build/Wrangler state and local secret files.

### Verification and delivery

1. Install dependencies and commit the lockfile. Run `npx tsc --noEmit`, `npx vite build`, and `npx wrangler deploy --dry-run` with local non-secret placeholder values where required.
2. Run focused executable assertions against the cookie helper's emitted `Set-Cookie` header: required attributes present and case-insensitive `Domain=` absent.
3. Start `npx wrangler dev` on an ephemeral localhost port, curl `/health`, record the status/body/headers, and probe an external-host HTTP request to prove HTTPS redirect behavior without using production traffic.
4. Run secret/account-ID/internal-path scans over owned source and configuration before commit. Apply the worktree-root guard, commit, and push to `forgejo/mrq-1-platform-skeleton`; verify remote branch SHA equals local HEAD.
5. Do not run `wrangler whoami`, create Cloudflare resources, deploy, alter DNS, or block on credentials. Deployment is deferred by operator ruling to MRQ-57.
6. Inline-full lifecycle: independent plan review and triage; implementation; exact-HEAD code review with PASS artifact; local `wrangler dev` validation evidence; Forgejo PR citing MRQ-1/M-01 and guardrail G6 whose body opens with the exact deploy-deferred operator checklist; attach PR and stop at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Review artifact: `art_01KZJJWV7MF9MYJ4T1DCQAV34F` — **PASS**.

1. **README ownership [MAJOR] — RESOLVED BY BOOT-PROMPT PRECEDENCE, DEVIATE-WITH-FLAG.** BUILDPLAN §7 assigns the eventual full README to M-45, but MRQ-1's operator boot prompt explicitly requires the `CLOUDFLARE_ACCOUNT_ID` requirement to be documented "in a README stub," and COMMON says the boot prompt wins conflicts. M-01 will therefore create only the minimal environment/deploy stub, with no broader self-hosting or product documentation. The Orchestrator is notified so M-45 treats it as an owned precursor rather than a surprise collision.
2. **Queue provisioning [MAJOR] — SUPERSEDED BY OPERATOR RULING.** MRQ-1 creates no account resources. All D1/KV IDs and D1/R2/Queue names stay as obvious operator-fill placeholders; MRQ-57 owns real creation and deploy.
3. **Secret binding mechanism [MINOR] — RESOLVED WITH CURRENT WRANGLER CONTRACT AND OPERATOR RULING.** Current Wrangler supports `secrets.required` in `wrangler.jsonc`; use that names-only block and mirror the names in the TypeScript `Env`. Commit `.dev.vars.example` and create ignored `.dev.vars`, both carrying only Cloudflare's published always-pass test pair: sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`. Production replacement is MRQ-57's job.
4. **Cookie assertion ownership [MINOR] — ACCEPTED.** The verification is an ad-hoc, uncommitted executable probe against the real Hono helper. M-01 will not add Vitest config, a check script, package script, or dormant test file; M-06 retains its entire harness surface.
5. **Critical-chain arithmetic [MINOR] — ACCEPTED.** The durable plan header now carries the intake-corrected 15 h chain through M-07 rather than the stale 13 h chain through M-04a.

## Operator Ruling — Deploy Deferred to MRQ-57 (AUTHORITATIVE)

- No auth check, Cloudflare mutation, DNS action, or deployment occurs in MRQ-1. Merge is not gated on deploy.
- `wrangler.jsonc` remains structurally deploy-ready but every account-specific resource value is an obvious placeholder with `TODO-OPERATOR (MRQ-57)`; `account_id` remains absent.
- Local validation is the gate: run `wrangler dev` with local D1/KV/R2/Queue emulation, curl `/health`, curl the localhost-only cookie-contract route, and attach the transcript as `--role validation`.
- The PR body must open with `DEPLOY DEFERRED — see MRQ-57` and list exactly: `wrangler login` as `projects@stage11.ai`; confirm Workers Paid; create real D1/KV/R2/Queue resources; fill placeholders; deploy; wire `marquee.stage11.dev`.
- Green local validation plus an exact-HEAD PASS review is sufficient to reach `pr_open`.

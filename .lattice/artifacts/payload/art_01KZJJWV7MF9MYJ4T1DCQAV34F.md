# Plan Review: MRQ-1 (M-01 — Platform skeleton & first real deploy)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed, with the issues below applied at triage (none changes the approach; two require a concrete adjustment before the corresponding step executes).

## 2. Summary

Reviewed the delegator's plan for M-01 against the BUILDPLAN §3 ticket row, §7 shared-file ownership, §8 human preconditions, and SPEC §2.1/§4.1/G6. The plan is strong: it covers the full binding surface, respects the M-06 script-table boundary, handles the deploy gate with an honest authenticated/unauthenticated fork, and structurally enforces the no-`Domain` cookie rule. Two issues need correction at triage — a README ownership violation against §7, and an unexamined assumption that Wrangler auto-provisions Queues at deploy.

## 3. Issues

**[MAJOR] Implementation step 5 — README stub violates §7 single-author ownership**
The plan adds "a public-safe README stub documenting install/build/dev/deploy commands…". BUILDPLAN §7 names `README.md` as M-45-owned, single author: "other tickets file notes into `docs/notes/<ticket>.md` for M-45 to fold in." M-45 is a 🔒 gate-backing ticket (gate 14, `check:readme`), and a stub minted here creates exactly the shared-file collision the ownership table exists to prevent. An implementer following the plan verbatim commits a file another ticket owns.
**Recommendation:** Write the same content to `docs/notes/mrq-1.md` (deploy prerequisites, `CLOUDFLARE_ACCOUNT_ID` requirement, secret names, provisioning behavior) for M-45 to fold in. Do not create `README.md`. The `.gitignore` extension in the same step is fine and stays.

**[MAJOR] Verification step 5 / Baseline — "let Wrangler provision/bind resources" over-assumes automatic provisioning covers Queues**
The plan's account-neutral strategy leans on Wrangler's automatic resource provisioning (declare binding names, omit IDs). That mechanism covers D1, KV, and R2, but Queues are not part of it — a `wrangler.jsonc` that declares producers and consumers for four queues that don't exist yet will fail at deploy, and a consumer on a missing queue is a hard error, not a provisioning trigger. Since the day-one real deploy is this ticket's entire reason for existing (traps 2/4/15), a stalled deploy gate here is a critical-chain stall (M-01 roots the 15 h chain to CP-1).
**Recommendation:** Add an explicit step at the deploy gate: `npx wrangler queues create marquee-<name>` for each of the four queues before the first deploy. Queue creation is by name, not ID, so it stays fully account-neutral and nothing account-specific enters git. Also verify during the dry-run step that `wrangler deploy --dry-run` accepts the ID-less provisioning shape for D1/KV/R2 — if the installed Wrangler version rejects it, that's a plan-shape discovery to surface to the orchestrator, not to work around ad hoc, because `wrangler.jsonc` is the durable contract every later ticket reads.

**[MINOR] Implementation step 2 — mechanism for "secret bindings" in `wrangler.jsonc` is unspecified**
Plain Worker secrets (`wrangler secret put`) are not declarable in `wrangler.jsonc` — the config format has no names-only secrets block. The task requires the config to carry the Turnstile secret surface, so the plan should state the concrete mechanism rather than leave it to improvisation: a JSONC comment block enumerating required secret names, the names typed in the `Env` interface in `src/index.ts`, and a committed `.dev.vars.example` (with `.dev.vars` gitignored) together satisfy "declared, names only, no values."
**Recommendation:** Name the mechanism in the plan. Also note `TURNSTILE_SITE_KEY` is client-visible by design and could live in `vars`; keeping it alongside the secret key is acceptable but should be a stated choice.

**[MINOR] Verification step 2 — cookie assertions must not encroach on M-06's file surface**
"Focused executable assertions" against the `Set-Cookie` header is the right check (it underwrites G6), but M-06 owns `vitest.config.ts`, `scripts/checks/*`, and the script table. If this ticket commits a test runner config or check script to make the assertion runnable, it collides with M-06's surface; if it commits a bare `cookies.test.ts` with no runner, it commits dead weight until M-06 lands.
**Recommendation:** Run the assertion as an ad-hoc node script at verification time (evidence attached to the PR, script not committed), or commit `src/lib/cookies.test.ts` only — no runner config, no script registration — and note in the PR that M-06's harness will pick it up. Either is fine; pick one explicitly.

**[MINOR] Header block — stale critical-chain figure copied from the task description**
The plan carries "M-01 → M-02 → M-04a → M-08 = 13 h" verbatim, but the intake correction (2026-08-09, BUILDPLAN §3 note) rebased the chain to M-01 (3) → M-02 (4) → M-07 (4) → M-08 (4) = 15 h. Cosmetic — it changes nothing this ticket does — but the plan is a durable artifact and shouldn't propagate a superseded number.
**Recommendation:** Correct the figure or drop the chain arithmetic from the plan header.

## 4. Positive Observations

- **The deploy-gate fork is the best part of the plan.** The authenticated/unauthenticated branch (step V5) is honest about what an agent can and cannot do, refuses credential workarounds explicitly, and still drives the lifecycle to terminal `pr_open` with `needs-human` flagged rather than stalling — exactly the failure mode the BUILDPLAN's human-track items 1–2 anticipate.
- **Shared-file discipline is otherwise excellent.** The plan correctly treats `wrangler.jsonc` as the complete up-front binding contract, refuses to register scripts in `package.json` (M-06's table), and stays out of M-05a's design surface. The four-queue enumeration (mail, mirror, operations/reset, webhook) correctly reads the whole SPEC — including the §3.9 reset queue and M-54's outbound webhooks — so no later ticket needs to touch the config.
- **Structural enforcement over test-only enforcement for G6.** Building the cookie helpers so no caller *can* pass a `Domain` attribute kills trap 15 by construction; the header assertion then verifies rather than being the sole line of defense.
- **Account-neutrality as a standing constraint** (no `account_id`, no secret values, `CLOUDFLARE_ACCOUNT_ID` from the operator environment, secret-scan before commit) is exactly right for a repo that ships public open source under guardrail G1.
- **Inert queue/scheduled handler exports** — declaring every trigger with a valid handler so the config and the code never disagree — is the correct walking-skeleton move, and routing scheduled work by exact cron expression sets up a clean contract for the downstream cron tickets.

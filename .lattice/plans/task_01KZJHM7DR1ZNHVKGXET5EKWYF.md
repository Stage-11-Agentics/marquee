# MRQ-1: Platform skeleton and first real deploy

BUILDPLAN: M-01 — Wave 0, walking skeleton (§3)

Scope (verbatim): Repo, `wrangler.jsonc` with every binding (D1, R2, KV, Queue, cron, Turnstile secrets), Vite + TS, Hono entry, health route, custom domain `marquee.stage11.dev`, **deploy to the Paid plan before anything else lands**. `https://` only; session cookie helper with **no `Domain` attribute**.

Why it goes first (§2): deploying to the real Workers Paid plan on day one is the only way to discover the 10 ms CPU ceiling (trap 2) and a lapsed R2 entitlement (trap 4) while there is still time — neither is visible in local dev. Trap 15 (`.dev` is HSTS-preloaded; parent-domain cookies leak) dies here too: the session cookie carries no `Domain` attribute and guardrail G6 asserts it.

File surface: `wrangler.jsonc`, `package.json`, `vite.config.ts`, `src/index.ts`, `src/lib/cookies.ts`

ACs: — (no AC directly claimed; underwrites AC-1/AC-2's deployed URL and guardrail G6)
Hours: 3
Workflow: inline-full
Shared files: `wrangler.jsonc` — M-01 OWNS it (§7). All bindings are declared up front so no later ticket needs to touch it; any addition serializes through the orchestrator. `package.json` is created here but its **script table is M-06's** — do not register commands.
Deps: none (root of the Wave 0 critical chain M-01 → M-02 → M-04a → M-08 = 13 h to CP-1)
Human precondition: Workers Paid enabled and verified; R2 entitlement probed (§8 items 1–2)
Plan: filled in by delegator's plan phase

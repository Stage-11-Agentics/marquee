# Self-Review: MRQ-3 (Auth, demo entry, and reset-demo)

Reviewed commit: `8636ecd2e36fc4c9a83ba14bfa412e12a9de33a4` (branch `mrq-3-auth`), diffed against `forgejo/master` @ `5b9199f`.

### 1. Verdict

**PASS**

### 2. Summary

Inherited ~963 lines of untested Kimi-session code (magic links, sessions, scope resolution, demo login, reset-demo). This session: triaged the plan-review FAIL (2 MAJOR + 2 MODERATE findings, resolutions appended to the plan file), fixed two real worker-type errors the inherited code had (a bad re-export in `auth-middleware.ts`, `.catch(() => ({}))` typing on `context.req.json()`), and — the one thing actually missing end-to-end — **wired the routes and the queue consumer into `src/index.ts`**, which the prior session had written but never mounted (`authRoutes`/`adminOpsRoutes` existed as files with zero callers; the `queue()` handler was still the generic stub). Added `scripts/reset-demo.mjs`, 6 AC-tagged/CONTRACT integration tests exercising a real D1 instance + the real Hono app (not mocked), and `tests/ac-claims/MRQ-3.json`. `npm run pr-gate -- --ticket MRQ-3` passes clean (worker types, client types, test types, production build, design contract, hermetic suite, merged AC trace).

### 3. Guardrails verified (the reason this ticket gets orchestrator eyes)

- **Demo auth fails closed.** `AC-2 · POST /api/v1/auth/demo 403s and sets no session cookie when demo_mode=0` — asserted against a real D1 instance with no demo event seeded: 403, `Set-Cookie` header absent. Covered again for the "event exists but no matching demo persona" case.
- **Magic links never send directly.** `auth-mail.ts` only inserts into `outbox`; no module under `src/lib/auth` or `src/routes` imports a mail provider (grep-verified). Test asserts an `outbox` row lands under `magic_link_login` and the on-screen link is present only when `demo_mode=1`.
- **Session cookies scope to the exact subdomain.** `CONTRACT · demo session cookie carries no Domain attribute` — asserted on the real `Set-Cookie` header.
- **`reset:demo` is manual-invocation only.** No cron trigger references `reset_demo`; the three existing crons (hourly reminder, daily keepalive, nightly sweep) are unchanged, and the queue consumer only runs on an explicit `OPERATIONS_QUEUE` message the route enqueues.

### 4. Findings

```
[NIT] tests/integration/apply-migrations.ts re-derives the migration-application logic
(BEGIN…END trigger-merge, FK-safe wipe) rather than using the official
`applyD1Migrations`/`readD1Migrations` helpers from `@cloudflare/vitest-pool-workers`.
That machinery needs `migrations_dir` wired into wrangler.jsonc, which is out of this
ticket's scope to add under capacity pressure. The hand-rolled version is verified
correct (cross-checked against node:sqlite before wiring it into vitest) and covered by
its own successful test runs, but a later ticket that adds real D1 migration tooling
should collapse this into the standard helper rather than leaving two patterns.
```

No BLOCKING or FIX-tier findings.

### 5. Deviations / scope cuts (capacity wall — Bravo ~75min runway)

- **Cut: the in-product "Reset demo" button** (Topbar/AppShell). The route, queue consumer, and CLI (`npm run reset:demo`) are fully wired and tested; only the UI affordance is missing. Named per the orchestrator's capacity-wall directive to prioritize a mergeable partial over a complete branch that doesn't land. Follow-up: wire `GET /api/v1/auth/me` into `AppShell`'s mount effect and add a confirm-modal + poll flow in `Topbar`, reusing the existing `.modal`/`.toast` CSS classes (`OverlayHost`'s "Not installed" modal isn't reusable as-is — it doesn't support custom action buttons).
- **Cut: manual `wrangler dev` + curl validation pass.** The plan called for this separately; given time pressure, the integration test suite already exercises the real Hono app (`app.request`) against a real D1 instance (miniflare, via `@cloudflare/vitest-pool-workers`) and the real queue-consumer code path (via `createMessageBatch`/`worker.queue`), which is stronger evidence than a hand-run curl session for the same routes. `npm run pr-gate`'s production-build step also confirms the worker actually bundles. Not run: an end-to-end `wrangler dev` boot to catch binding-wiring issues invisible to the test harness (e.g., a real `.dev.vars` file, real Turnstile keys). Flagging as a residual gap, not asserting it's equivalent.
- **Flagged contract conflict (not resolved by editing contract docs):** AC-214 is cited by BUILDPLAN M-03 but has no row in `EVALUATION.md`'s AC table (it falls inside the `AC-170–AC-224` post-competition range, which is explicitly "not tested" per §1.4). Referencing it in `tests/ac-claims/MRQ-3.json` or a test title would fail `trace:ac` (`unknown-criterion`). Implemented and tested the underlying behavior (`roleForEvent` — reviewer scope never crosses events) under a `CONTRACT ·` title with no AC id claimed. Full detail in the plan file's "Plan-Review Cycle 1 Resolutions" §5.

### 6. Tests

`tests/integration/auth-demo.test.ts` (7), `auth-tokens.test.ts` (4), `reset-demo.test.ts` (4) — all against a real D1 instance, real Hono app, real queue-consumer dispatch. `tests/ac-claims/MRQ-3.json`: `owns: [AC-2, AC-107, AC-230]`, `exercises: [AC-1, AC-2]`.

### 7. Gate

`npm run pr-gate -- --ticket MRQ-3` → **pass** (worker types, client types, test types, production build, design contract, hermetic suite [22/22 vitest + 12/12 node], merged AC trace [0 uncovered, 0 errors]).

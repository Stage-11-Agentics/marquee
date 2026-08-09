# MRQ-3: Auth, demo entry, and reset-demo

BUILDPLAN: M-03 — Wave 0 (§3) · also delivers Tier B rank 3 (US-73)

Scope (verbatim): Magic links (256-bit random, hash stored, single-use, 15-min TTL), session cookie middleware, bearer-token middleware, scope resolution from `memberships`, **one-click organizer/speaker demo login — `POST /api/v1/auth/demo` 403s and sets no cookie unless the target event's `demo_mode = 1`** (SPEC §4.1, guardrail G6/A-5), on-screen magic link in demo mode, **auth mail (`magic_link_login`, `draft_resume`, `task_link`) enqueues an `outbox` row and never calls Resend directly — the queue consumer is the only sender (G3/A-3)**, `POST /admin/reset-demo` + product button + `npm run reset:demo` (idempotent, safe mid-judging, never partially-reset — **US-73 ranks in Tier B but is built here**, because the demo logins need it from the first deploy). **The route enqueues the reseed to a Queue and returns a job id the button polls**, and the reseed writes with `suppress_mirror` so it does not re-queue the entire Airtable base, enqueuing **one** reconcile job at the end (§3.9/§4.1).

File surface: `src/routes/auth.routes.ts`, `src/lib/auth/*`, `src/routes/admin-ops.routes.ts`

ACs: AC-1, AC-2, AC-107, AC-214, **AC-230**
Hours: 4
Workflow: inline-full
Shared files: none — module-local (§7 keyword-safe naming: no `utils.ts`, no bare `index.ts`, no `helpers.ts`). The `reset:demo` script name is registered by M-06, not here.
Deps: M-02
Audits that key off this ticket: A-5 (cookie scope + session issuance), A-11 (reset drill)
Plan: filled in by delegator's plan phase

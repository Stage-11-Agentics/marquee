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

---

## Plan (delegator, inline-full; headless plan/code review suspended this run — self-review inline)

Working against forgejo/master @ f4aafeaa2467b619cf0421384114f1c08cf0ecb9 (rebased).

### Design decisions

1. **Token primitives** — `src/lib/auth/random-token.ts`: 256-bit `crypto.getRandomValues` tokens rendered base64url; SHA-256 hex digest via `crypto.subtle`; constant-time hex compare helper. Magic links store only the hash (`magic_links.token_hash`, unique index); lookup is by hash (indexed equality), with the constant-time helper anywhere a raw compare occurs. Tokens are never logged.
2. **Magic links** — `src/lib/auth/magic-links.ts`: `login` purpose TTL 15 min (SPEC §3); consume is one atomic `UPDATE … SET used_at WHERE id=? AND used_at IS NULL AND expires_at>?` checked via `meta.changes` — single-use and expiry race-free. `redirect_to` restricted to same-origin paths (`/…`, no `//`) to kill open-redirect.
3. **Sessions** — `src/lib/auth/auth-sessions.ts`: 256-bit session id, 30-day expiry, `user_agent_hash` (SHA-256 of UA), instant revocation in D1. Cookie via MRQ-1's `setSessionCookie` (no `Domain` — G6/trap 15; a test asserts no `Domain=` in `Set-Cookie`).
4. **Scope resolution** — `src/lib/auth/scope-resolution.ts`: memberships → role ladder `public < speaker < reviewer < ops < program_lead < owner`. Reviewer scope is per event by construction (AC-214): schema CHECK already forbids org-wide reviewer rows; `roleFor(eventId)` returns null for any other event.
5. **Middleware** — `src/lib/auth/session-middleware.ts` (cookie → session → person + scope) and `src/lib/auth/bearer-middleware.ts` (`Authorization: Bearer mq_…` → `api_tokens` hash lookup, revoked → 401, works with no cookie — AC-107). Both populate a shared `AuthContext` var; `requireRole(role, eventId)` guard helper used by admin routes.
6. **Auth routes** — `src/routes/auth.routes.ts`:
   - `POST /api/v1/auth/magic-link` `{email, event_id}` — generic 200 always (no account enumeration); if the person exists: mint link, **enqueue `outbox` row `magic_link_login` (never sends — G3/A-3)**, and only when the event has `demo_mode = 1` also return the link in the JSON body (on-screen demo affordance).
   - `GET /api/v1/auth/exchange?token=…` — atomic consume, session mint, cookie set, 302 to validated `redirect_to`.
   - `POST /api/v1/auth/demo` `{role: "organizer"|"speaker"}` — **fails closed**: resolves the target event as the single `demo_mode = 1` event; absent → 403 and no cookie (AC-2, G6/A-5). Maps organizer→`owner`, speaker→`speaker`; requires an `is_demo = 1` person with that membership; mints session + cookie. This is the named fail-closed proof: test `AC-2 · POST /api/v1/auth/demo 403s and sets no session cookie when demo_mode=0`.
   - `POST /api/v1/auth/logout` — revoke session, clear cookie.
   - `GET /api/v1/auth/me` — session or bearer identity + scope (doubles as the AC-107/AC-214 probe surface).
7. **Reset-demo** — `src/routes/admin-ops.routes.ts` (route path per SPEC §4.2 Ops table: `/api/v1/admin/reset-demo`):
   - `POST /api/v1/admin/reset-demo` — **403 unless the target event has `demo_mode = 1`** (same fail-closed discipline as demo login), and requires a session with `owner`/`program_lead` on that event **or** the loopback-only `x-marquee-local-validation` header (pattern established by MRQ-1's skeleton; undefined in production → closed). Enqueues `{type: "reset_demo", job_id}` to `OPERATIONS_QUEUE`, records job status in `CACHE` KV, returns `{job_id}`.
   - `GET /api/v1/admin/reset-demo/:jobId` — job status for the button to poll.
   - Queue consumer (`src/index.ts`): `reset_demo` → run the reseed, then enqueue **exactly one** `{type: "mirror_reconcile"}` to `MIRROR_QUEUE` (consumer stub-acks until M-25). Unknown message types keep the existing warn+retry. **No cron trigger touches reset** — manual invocation only (the three crons in wrangler.jsonc are reminders/keepalive/sweep; reset is wired to none).
   - `src/lib/reset-demo/demo-fixture.ts` — deterministic minimal demo fixture (org, one `demo_mode = 1` event, demo organizer + speaker persons, memberships). MRQ-14's full seed extends this module.
   - `src/lib/reset-demo/reseed-demo.ts` — wipe (FK-safe order) + fixture insert in **one `db.batch()` transaction** → concurrent readers see old state or new state, never partial (AC-230). Writes carry `last_write_source='marquee'`; the module enqueues zero `mirror_outbox` rows (suppress_mirror, §3.9). Idempotent by construction.
   - `src/lib/reset-demo/reset-jobs.ts` — job id + KV status (`queued|running|done|failed`).
8. **npm run reset:demo** — `scripts/reset-demo.mjs`: POSTs the endpoint against `--url` (default `https://localhost:8787`) with the local-validation header read from env/`.dev.vars`, polls the job, exits non-zero on failure. package.json keeps the M-06-registered `reset:demo` name, target swapped from the stub to this script (see deviation D1).
9. **Product button** — AppShell fetches `GET /api/v1/auth/me` on mount; when `demo_mode` and role ≥ `program_lead`, Topbar shows a **Reset demo** button → confirm modal → POST → poll job → ToastHost result. Minimal intrusion into the MRQ-6 shell; `check:design` contracts untouched.
10. **Tests** (`tests/integration/`, cloudflare vitest pool, migrations applied via `?raw` import + `env.DB.exec`):
    - `auth-demo.test.ts` — **AC-2**: 403 + no cookie at `demo_mode=0` (fail-closed proof); 200 + cookie at `demo_mode=1`; `Set-Cookie` carries no `Domain=`; magic link single-use, 15-min expiry enforced, hash-only storage; outbox row enqueued under `magic_link_login`, on-screen link only in demo mode.
    - `auth-tokens.test.ts` — **AC-107**: bearer authenticates with no cookie; revoke → next call 401. **AC-214**: reviewer of event A resolves to no role on event B (403); org-wide reviewer row rejected by CHECK. `CONTRACT` unit tests for token entropy/compare/redirect validation.
    - `reset-demo.test.ts` — **AC-230**: mutate fixture → reset restores exact counts; run twice (idempotent); zero `mirror_outbox` rows + exactly one mirror-reconcile enqueue; route 403 at `demo_mode=0`; unauthenticated → 401/403; job poll transitions to `done`.
    - `tests/ac-claims/MRQ-3.json` — `owns: [AC-2, AC-107, AC-214, AC-230]`, `exercises: [AC-1]` (AC-1 is `felt`; its e2e belongs to M-05b's landing page).

### Deviations to flag in completion comment

- **D1** — `reset:demo` script name: the ticket says M-06 registered the name; scope explicitly includes delivering the working command. Kept the name, replaced the stub target. The authoritative full-seed fingerprint remains MRQ-14's (its stub message says so); this ticket ships the reset machinery against the M-03 minimal demo fixture.
- **D2** — Route path: BUILDPLAN writes `POST /admin/reset-demo`; SPEC §4.2's route table places Ops under `/api/v1`. Implemented `/api/v1/admin/reset-demo`.
- **D3** — Mirror reconcile consumer is a stub ack; the real reconcile is M-25/M-26.
- **D4** — Remote (non-loopback) `npm run reset:demo` auth: deferred — no Cloudflare account this run (MRQ-57); judges use the in-product button (session path).

### Validation plan

`wrangler d1 migrations apply --local` + `wrangler dev`, then curl: health; demo 403 at `demo_mode=0`; flip flag; demo 200 + cookie (assert no `Domain=`); magic-link enqueue + on-screen link; exchange; `/auth/me` cookie and bearer; reset-demo POST → poll job → counts restored; run twice. Attach as `--role validation`.

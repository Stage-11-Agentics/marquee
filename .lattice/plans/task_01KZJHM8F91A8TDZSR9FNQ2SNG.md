# MRQ-12: Email core and demo-safe outbox

BUILDPLAN: M-11 — Wave 1 (§4) ⚠️ LANDS BEFORE ANY SEND PATH

Scope (verbatim): Template store, `{{merge}}` renderer, `outbox` table writes with `idempotency_key`, queue consumer as **the single choke point** that calls Resend, demo-safe allowlist enforced *in the consumer* as one rule — **suppress unless `send_policy='always_live'` or `to_email` ∈ allowlist** — with `always_live` written by exactly two call sites (the public-form confirmation for an address typed in that request, and the `smoke:mail`/`smoke:ics` harness); the auth trigger keys `magic_link_login`, `draft_resume`, `task_link` exist from the first commit so **no route ever has a reason to call Resend directly**; `Idempotency-Key` header, two send paths from the start (**batch for plain bulk, single-send ≤10/s for anything carrying an ICS** — trap 14), comms log screen with rendered previews.

Guardrail G3 (audited by A-3): no module imports Resend but the consumer; exactly two `always_live` write sites; all seven triggers plus bulk suppressed under demo mode.
Trap 3: Resend Free is 100 sends/day — the outbox and demo-safe allowlist are built either way.

File surface: `src/jobs/mail/*`, `src/routes/comms.routes.ts`, `src/ui/comms/*`

ACs: AC-33, AC-117, AC-125 – AC-131 foundation
Hours: 6
Workflow: inline-full
Shared files: none — module-local. The **queue consumer is the single Resend call site** for the whole codebase; every other ticket enqueues.
Deps: M-02, M-07
Audit that keys off this ticket: A-3 (mail containment), from CP-2
Plan: filled in by delegator's plan phase

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

## Plan — MRQ-12 / M-11

### Contract and boundaries

- Keep `migrations/0001_init.sql` and `src/db/schema.ts` as the existing source
  of truth for `email_templates`, `outbox`, `send_policy`, and the unique
  `idempotency_key`; do not add a second mail schema or edit contract docs.
- Use the SPEC sender exactly as written: `Marquee <marquee@stage11.systems>`.
  No real Resend account is assumed locally. The provider boundary is one
  module under `src/jobs/mail/`, with an injectable sender for hermetic tests
  and a Resend HTTP adapter only in that module.
- Preserve G3: enqueue paths never call a provider; the consumer is the only
  Resend import/call site; demo-mode suppression is one consumer rule using
  `always_live` or the event's `demo_safe_allowlist`.
- The only production writes that can select `always_live` are (1) the public
  form confirmation helper for the address typed in that request and (2) the
  smoke mail/ICS harness helper. Generic/auth/bulk enqueue paths use the
  schema default or explicit `demo_safe`; no other path may use the live
  policy.

### Implementation slices

1. Add mail-domain primitives in `src/jobs/mail/`: canonical template keys and
   defaults, merge rendering for the SPEC fields, SHA-256 idempotency-key
   construction, transactional/constraint-first outbox insertion, selector
   resolution, and the seven-trigger/scheduled enqueue helpers. Render
   subject/html/text at enqueue time. Make duplicate inserts harmless by
   catching the UNIQUE constraint and returning the existing row; never add a
   racing pre-check.
2. Add the Queue consumer and Resend adapter. Claim queued rows atomically,
   skip scheduled rows until eligible, apply the single demo-safe allowlist
   rule, send plain batches through the provider and ICS-bearing rows through
   a single-send path capped at 10/s, and persist `sent`, `suppressed`, or
   `failed` plus provider id/error. Send `Idempotency-Key` on every provider
   request. Add the worker queue branch and hourly scheduled trigger without
   making request paths call third parties.
3. Add `src/routes/comms.routes.ts` with manifest-compliant `*.routes.ts`
   naming for template CRUD, preview, send, outbox log, and person messages.
   Enforce authenticated `comms:send`/admin authorization, exact template vs
   ad-hoc subject/body choice, recipient filtering/counts, and per-recipient
   outbox logging. Keep the route's job enqueue-only and use the shared API
   route factory/OpenAPI registry.
4. Add the comms UI under `src/ui/comms/` and mount it at the existing
   `/communications` shell route: templates/triggers, demo-safe status,
   recipient count, one-recipient rendered preview, rendered outbox history,
   delivery/suppression labels, and person message history. Keep it honest when
   no live provider is configured.
5. Add `tests/integration/mail.test.ts` (or equivalent under `tests/`) with
   explicit `AC-33`, `AC-117`, `AC-125`–`AC-131` titles. Cover templates and
   merge fields, all seven triggers and disabled triggers, scheduled reminder
   timing, filtered bulk/preview/logging, demo suppression and allowlist/live
   exceptions, provider boundary/header, ICS path/rate, and the duplicate
   bulk-action race at the D1 UNIQUE constraint. Add
   `tests/ac-claims/MRQ-12.json` mapping the owned ACs and capture the MRQ-57
   real-Resend/Cloudflare checklist as a PR limitation rather than faking it.

### Verification and handoff

- After plan write, move MRQ-12 to `planned`, verify, then to `in_progress`.
- At phase boundaries fetch `forgejo`; before commits verify the repository
  root is exactly this worktree. Commit meaningful slices as they stabilize.
- Run focused mail tests, `npm test`, type checks/build as needed, and
  `wrangler dev`/local Queue+D1 probes for the actual enqueue/consume flow.
  Distinguish test proof, observed local runtime proof, and inference.
- Move through `review` and `in_validation`; perform the inline self-review
  requested by the orchestrator, write a standard-shape PASS review naming the
  exact branch HEAD, and attach it as the review artifact. Headless plan/code
  review calls are intentionally suspended for this ticket.
- Run `npm run pr-gate -- --ticket MRQ-12`, preserve its exact result in the
  completion comment, push `mrq-12-email` to `forgejo`, verify remote HEAD,
  open the Forgejo PR against `master`, attach its URL, and finish at
  `pr_open` with a c11 message to workspace:9/surface:60. The Orchestrator
  owns merge/done.

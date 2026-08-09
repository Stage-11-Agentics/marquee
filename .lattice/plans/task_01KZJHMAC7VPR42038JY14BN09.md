# MRQ-32: Automated triggers, filtered group email, and rejection at scale

BUILDPLAN: M-34 (rank 15, US-46) + M-35 (rank 16, US-45) + M-31 (rank 12, US-34) — Wave 2 (§5) · MERGED at mint (3 + 4 + 2 = 9 h; one comms cluster on one module — every constituent is a templated-send surface riding M-11's outbox, and splitting them puts merge-field rendering across three PRs)

**M-34 — Automated triggers** (3 h, ACs AC-125 – AC-127, dep M-11)
Scope (verbatim): seven toggleable templates; configurable pre-close cron.

**M-35 — Filtered group email** (4 h, ACs AC-128 – AC-131, AC-250, dep M-11)
Scope (verbatim): counted selector, real-recipient preview, per-recipient record logging; **owns the single send route `POST /events/:id/comms/send` `{selector, template_key?, subject?, body?}` — exactly-one-of enforced server-side, merge fields render in both, ad-hoc sends log identically** (there is no `/messages/send`; one operation, one path).
AC-250 (Amendment 9): an external LLM/agent may compose the nudge text; Marquee provides the rails and builds no LLM features itself. The CLI half of AC-250 is M-38's.

**M-31 — Rejection at scale** (2 h, ACs AC-114 – AC-117, dep M-18)
Scope (verbatim): merge fields, real rendered preview, portal outcome, double-send impossible.

ACs (union): AC-114 – AC-117, AC-125 – AC-131, **AC-250** (send-surface half)
Hours: 9 (3 + 4 + 2)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local under `src/routes/comms.routes.ts` / `src/ui/comms/*` (M-11's module; add files, do not rewrite). **No module here imports Resend** — everything enqueues to M-11's outbox and the queue consumer sends (G3, audited by A-3).
Deps: M-11, M-18
Route discipline: exactly **one** send route. `/messages/send` must not appear anywhere — `check:api`'s registry parity is built to catch that alias at gate time.
Plan: filled in by delegator's plan phase

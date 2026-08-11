# MRQ-74: Delivery and system health surface — operational truth in the organizer's language

Delivery and system health, in the organizer's language. The operational truth surface: a dedicated screen that tells a conference organizer what the system is actually doing on their behalf, and what it has silently failed to do.

## Why this exists

In a conference tool the failures that hurt DO NOT THROW. A speaker who is never told they were accepted is a catastrophe, and it produces no exception, no 500, no stack trace. No error tracker — ours or a vendor's — would ever see it. Concretely:

- an acceptance email that bounced, or was suppressed, so a speaker never learns they were accepted
- the Resend free-tier 100/day cap eaten mid-wave (run-state 2026-08-11 makes this a HARD constraint, not a cushion)
- a calendar invite a speaker's client rejected
- the Airtable mirror falling behind
- the hourly pre-close reminder cron that silently did not fire
- webhooks retrying into a wall

## The key finding

The failure data ALREADY EXISTS IN D1 and is surfaced nowhere. `outbox` carries `status`, `suppressed_reason`, `error`, `attempts`, `provider_message_id`, `idempotency_key`, `scheduled_for`, `sent_at`, `send_policy`. `webhook_deliveries` carries `attempts`. `mirror_outbox` carries `attempts`. This ticket is mostly a READ over columns we already populate, not new plumbing.

The product also already does this once, correctly: `decided_not_notified` on the dashboard (`src/routes/dashboard.routes.ts:221`, rendered at `src/ui/dashboard/DashboardPage.tsx:93`) is exactly the pattern — an operational failure expressed in organizer language rather than as an exception. Extend that precedent; do not invent a new idiom.

## Scope

### A. The health surface
A dedicated screen in `src/ui/shell/route-table.ts` (operator ruling: dedicated screen, not an attention row — the ledger needs the room). `check:design` requires only that the existing seventeen route labels remain present, so adding one is safe.

Two halves:

1. CAPABILITY STATUS — green/amber/red per capability, in organizer words: submissions accepting, email sending, calendar invites, uploads, mirror sync, scheduled jobs. Each states what it means and what to do, never a status code. A non-technical organizer must be able to read this and know whether their conference is fine.

2. DELIVERY LEDGER — what was sent, what bounced, what was suppressed and why, and WHO IS OWED A MESSAGE AND HAS NOT RECEIVED ONE. That last one is the whole point of the screen. Every row opens the record behind it, matching how the dashboard's counts already work.

Plus a quota read: how close this conference is to the 100/day send cap, BEFORE a wave goes out rather than after.

### B. The read layer
- `src/lib/delivery-health.ts` — the derivations, unit-testable without a Worker.
- `src/routes/health-surface.routes.ts` — new API routes via `defineApiRoute`. Authenticated, appropriate grants, `read` rate bucket.
- Consumes MRQ-73's `GET /api/v1/telemetry/diagnostics` for infrastructure verdicts (D1/KV/R2/queues/cron heartbeats). Until MRQ-73 merges, build against a fixture shaped to its documented response and do not block.

### C. Entry point
The sidebar route only. MRQ-73 owns `DashboardPage.tsx` this cycle — do NOT edit it. A dashboard link to this screen is a follow-up, not this ticket.

## Design
DESIGN.md / Flight Deck tokens, reproducing the prototype idiom one-to-one. The house rule applies with force here because this screen's states change under the reader: ELEMENTS NEVER JUMP. Reserve space for swapped text, fixed widths on toggles, constant row counts (render an em dash rather than removing a row), tabular numerals on every changing number. A status screen that reflows as it refreshes is a defect.

Amber and red must be earned. A screen that cries wolf gets ignored, and this one is read when someone is already anxious.

## Contract position
No new ACs and no SPEC/EVALUATION amendment; ship `tests/ac-claims/MRQ-74.json` with `owns: []` and a note, as MRQ-72 did. `trace:ac` treats a missing ticket manifest as a warning, not a failure.

## Constraints
- Adding any API route obligates `npx vite build && node cli/generate-api-registry.mjs`. `check:api` asserts EXACT registry parity plus a document SHA match.
- No new D1 tables and no migration. This is a read over existing columns. If you believe a column is genuinely missing, say so in the PR rather than adding one.
- The fast suite has a 29s hard kill and a 30s budget. Worker-free unit tests in `tests/unit`, Worker-backed in `tests/integration`.
- Do NOT edit `package.json` — BUILDPLAN section 7 reserves it and MRQ-73 owns it this cycle.
- Shipped files must avoid the repo-policy denied vocabulary (`scripts/checks/repo-policy.mjs`): no company name, no absolute /Users/ paths, no real email addresses, no internal tooling vocabulary.
- Never surface a raw error string, stack, or SQL to an organizer. Speaker PII appears only where that person's record would already be visible to this reader.

## File ownership (MRQ-73 and MRQ-74 run in parallel)
MRQ-74 OWNS: `src/ui/health/*`, `src/lib/delivery-health.ts`, `src/routes/health-surface.routes.ts`, `src/ui/shell/route-table.ts`, its own styles.
MRQ-74 MUST NOT TOUCH: `src/ui/dashboard/DashboardPage.tsx`, `src/ui/shell/AppShell.tsx`, `src/api/router.ts`, `src/index.ts`, `src/lib/observability/*`, `cli/`, `SKILL.md`, `wrangler.jsonc`, `package.json`, `README.md`.
Both regenerate `cli/api-registry.json`; a conflict there is expected and the resolution is always rebase, rebuild, regenerate. MRQ-73 merges FIRST — rebase onto main after it lands and regenerate before opening or updating the PR.

## Verification
1. Unit tests on the derivations: owed-but-not-notified, suppressed versus bounced versus failed, quota arithmetic near the cap, the amber/red thresholds. Fixture-driven, no Worker.
2. Integration test on the new routes: authorization, event scoping, the shape.
3. `npm run pr-gate -- --ticket MRQ-74` — all eight checks green.
4. REAL-ARTIFACT SMOKE, non-negotiable. `wrangler dev` against seeded data, drive the screen in a browser. Then MANUFACTURE FAILURE — mark outbox rows suppressed/bounced, push the quota near the cap, stale a cron heartbeat — and confirm the screen tells the truth, in organizer language, with every row opening the right record. A green screen against healthy seed data proves nothing; the whole value is what it says when something is wrong.

## Delivery
Own git worktree, branch `mrq-74-delivery-health`. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

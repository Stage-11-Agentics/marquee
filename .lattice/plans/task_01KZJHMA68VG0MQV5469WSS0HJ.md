# MRQ-30: API surface completion and signed outbound webhooks

BUILDPLAN: M-29 (Tier B rank 7, US-68) + M-54 (Tier B rank 7, US-68) — Wave 2 (§5) · MERGED at mint (5 h + 4 h = 9 h; one story, one API module, identical ticket-level dependency {M-07})

**M-29 — API surface completion** (5 h, ACs AC-105 – AC-108, AC-242, dep M-07)
Scope (verbatim): scoped token UI and effective grant∩membership, docs route linked from sidebar, `check:api` route-manifest parity.
AC-242: tokens issued with named scopes (`program:read/write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`) and optional event restriction; effective authority is grant ∩ membership; the secret is shown once and stored only as a hash; revocation is immediate.

**M-54 — Signed outbound webhooks** (4 h, AC-241, deps M-07 + CP-2)
Scope (verbatim): endpoint CRUD/test/log, six-event allowlist, queue retry/backoff, HMAC over `id.timestamp.body`, replay idempotency; **cannot begin until CP-2/Tier A is green**.
Six-event allowlist: `submission.created|updated|status_changed`, `person.updated`, `speaker_task.completed`, `agenda.published`.

**SEQUENCING (binding, read before planning):** CP-2 is a checkpoint, not a ticket, so it cannot be linked — the webhook half must not start until Tier A is green. **Land the token/docs half first**: M-38+M-39 (the 🔒 gate-12 CLI + SKILL pair) depends on this ticket, and gate 12 cannot be waived. If Tier A is not yet green when this ticket is claimed, ship the M-29 half, open the PR, and take the webhook half as the second pass.

ACs (union): AC-105 – AC-108, **AC-241, AC-242**
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — routes register by glob (M-07's generated `_manifest.ts`); **never hand-edit a route registry**. Docs, CLI, and SKILL all derive from that one registry — `check:api` asserts operation counts and content hashes match across served JSON and rendered docs (Amendment 6; this is what beats the incumbent's 177-vs-18 docs drift).
Deps: M-07 · plus the CP-2 gate on the webhook half (recorded here; no ticket to link)
Plan: filled in by delegator's plan phase

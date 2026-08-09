# MRQ-45: Audit — mail containment and demo-safe suppression

BUILDPLAN: A-3 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Mail containment — no module imports Resend but the consumer; **exactly two `send_policy='always_live'` write sites**; all seven triggers + bulk suppressed under demo mode.
Starts when (verbatim): **From CP-2** (M-11 landed).

The two legal `always_live` write sites (B-8): the public-form confirmation for an address typed in that request, and the `smoke:mail`/`smoke:ics` harness. A third is a finding, not a judgement call.
This is guardrail G3, and trap 3 (Resend Free = 100 sends/day) is why it exists.

ACs: — (protects AC-38's live path and every demo-safe assertion)
Hours: 2
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-11
Plan: filled in by delegator's plan phase

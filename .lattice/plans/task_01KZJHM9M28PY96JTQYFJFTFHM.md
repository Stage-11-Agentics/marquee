# MRQ-24: Chase board and slide upload

BUILDPLAN: M-23 (Tier B rank 1, US-44) + M-40 (Tier B rank 21, US-41) — Wave 2 (§5) · MERGED at mint (6 h + 2 h = 8 h ≤ 10 h; one coherent scope — the organizer's live view of what speakers owe and what they have delivered. M-40's "live organizer view" of an upload *is* the chase board's task matrix cell.)

**M-23 — Chase board** (6 h, ACs AC-91 – AC-94, deps M-15/M-11)
Scope (verbatim): accepted-speaker × task matrix with state glyphs, live filter chips with counts, task-type and track filters, select-all → fixed-width `Send reminder (N)`, per-row Nudge, compose drawer with template + merge preview + per-recipient outbox rows and per-speaker send log, speaker context drawer (tasks, message history, sessions, bio), live update as speakers complete tasks.
House UI rule, called out in the plan's own words: the `Send reminder (N)` button is **fixed-width** — relabelling must not move anything.

**M-40 — Slide upload** (2 h, ACs AC-146 – AC-148, AC-232, dep M-13)
Scope (verbatim): file types/limit/progress/recovery/live organizer view; upload safety from M-13.

ACs (union): AC-91 – AC-94, AC-146 – AC-148, **AC-232**
Hours: 8 (6 + 2)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local. Sends go through M-11's outbox; **never call Resend** (G3).
Deps: M-15, M-11, M-13
Speed: the chase board (~150 speakers × task matrix) carries a *proposed objective* budget — p95 ≤ 1000 ms, measured and reported by `check:speed`, never a gate. It is our strongest screen and the heaviest table.
Plan: filled in by delegator's plan phase

# MRQ-22: Public event site, permalinks, and embeds

BUILDPLAN: M-20 + M-21 — Wave 1 (§4) · MERGED at mint (same public-surface module, M-21 depends only on M-20, 5 h + 4 h = 9 h ≤ 10 h)

**M-20 — Public event site + permalinks** (5 h, ACs AC-83 – AC-86, AC-240; files `src/routes/public-agenda.route.tsx`, `src/ui/public/agenda/*`)
Scope (verbatim): Logged-out agenda with times/rooms/tracks/speakers, day + track + search controls, session and speaker permalinks cross-linked, published-only with no URL-guess leakage, scheduled-but-unpublished distinction, 375 px, cold <1 s.
Amendment 11 fold (SPEC.md): public session pages render "Room · Building" (AC-252). AV capabilities and room notes stay **off** public surfaces (AC-253).

**M-21 — Embeds** (4 h, ACs AC-87 – AC-90; files `src/routes/embed.routes.tsx`, `src/ui/embeds/*`)
Scope (verbatim): Config screen → copyable snippet + live preview, agenda and speaker-gallery embeds filterable by track and status, responsive, configured colors, **KV TTL 30 s with explicit purge on publish** so the 60 s budget has headroom.
Recorded decision F-7: embed KV TTL is 30 s against AC-89's 60 s budget.
Open dependency 2 (EVALUATION §6): Discord ruling Q2 on the embeddable gallery. If struck, **AC-87 – AC-90 move to non-goals** and gate 6's embed steps drop. We build them by default; the video overrides the brief's strikethrough.
Guardrail A-5: **embed routes never read `mq_session`.**

ACs (union): AC-83 – AC-90, **AC-240** · **AC-252** (public "Room · Building")
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined — max of the constituents' modes)
Shared files: none — module-local under `src/routes/` and `src/ui/public/`, `src/ui/embeds/`.
Deps: M-19a (M-21's dependency on M-20 is internal to this ticket)
Speed: AC-85 is an AC-sourced budget (public agenda cold interactive p95 ≤ 1000 ms); AC-89 is AC-sourced (embed reflects a source change ≤ 60 s, actual recorded).
Plan: filled in by delegator's plan phase

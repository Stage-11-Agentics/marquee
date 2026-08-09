# MRQ-31: Sessionize import

BUILDPLAN: M-30 — Tier B rank 11 (US-66), Wave 2 (§5)

Scope (verbatim): mapping preview, relationships/scores/statuses, idempotent outcomes, batch undo, named empty-state/README entry.

AC-109 is the plan's **single `op-assist` criterion**: it needs one real Sessionize export from the operator (any event: sessions + speakers + evaluation results) — the only thing that proves our column fixture's names and status vocabulary match reality. Everything else runs against `fixtures/sessionize/{sessions,speakers}.csv`.
When this lands, fold its real text back into M-45's README import section (which was written against the fixture).

ACs: AC-109 – AC-113
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `README.md` is **M-45's** — file the import section as `docs/notes/M-30.md` for M-45 to fold in (§7).
Deps: M-08
Human precondition: one real Sessionize export (§8 item 8, EVALUATION §1.6 item 6)
Plan: filled in by delegator's plan phase

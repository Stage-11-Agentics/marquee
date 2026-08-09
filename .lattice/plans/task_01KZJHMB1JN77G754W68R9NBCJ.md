# MRQ-39: Mobile reviewer pass and optional AI first pass

BUILDPLAN: M-44 (rank 25, US-27) + M-47 (rank 28, US-32) — Wave 2 (§5) · MERGED at mint (3 h + 3 h = 6 h; identical dependency set {M-17}, same reviewer module)

**M-44 — Mobile reviewer pass** (3 h, ACs AC-158/AC-159, dep M-17)
Scope (verbatim): mobile reviewer pass.
AC-159: the reviewer surface contains no admin navigation and no admin route is reachable from it.

**M-47 — Optional AI first pass** (3 h, ACs AC-167 – AC-169, dep M-17)
Scope (verbatim): off, aid-only language, zero status changes, absent from demo path.
AC-169: a crawler from both demo entries reaches **no** AI surface without explicitly enabling the flag. AC-168: the pass over 50 submissions with a stubbed model makes zero status transitions.

ACs (union): AC-158, AC-159, AC-167 – AC-169
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: none — module-local under `src/ui/review/*` (M-17's module; add files, do not rewrite).
Deps: M-17
Cut-line note: M-47 is **rank 28 — the bottom of the band, the first thing cut.** If cut, the merged ticket ships its M-44 half and gate 19 names US-32 with AC-167 – AC-169 and the reason.
Plan: filled in by delegator's plan phase

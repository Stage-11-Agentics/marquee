# MRQ-37: Co-speaker flow and the mobile submit pass

BUILDPLAN: M-41 (rank 22, US-21) + M-43 (rank 24, US-18) — Wave 2 (§5) · MERGED at mint (4 h + 3 h = 7 h; identical dependency set {M-14}, same public-form module)

**M-41 — Co-speaker** (4 h, ACs AC-149 – AC-151, dep M-14)
Scope (verbatim): max enforcement, notification, own-profile completion.
AC-151: the co-speaker supplies bio and headshot via their link **without the abstract becoming editable**.

**M-43 — Mobile submit pass** (3 h, ACs AC-155 – AC-157, dep M-14)
Scope (verbatim): mobile submit pass.
AC-156's method: `scrollWidth ≤ clientWidth` at every step; the on-screen keyboard is modelled as a 375×340 visual viewport and the focused field's box must stay inside it. Real-device confirmation at **C6**, which is the tiebreaker if the two disagree.

ACs (union): AC-149 – AC-151, AC-155 – AC-157
Hours: 7 (4 + 3)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local under `src/ui/public/form/*` (M-14's module; add files, do not rewrite).
Deps: M-14
Note: AC-155 – AC-157 are also claimed in M-14's AC list (the plan assigns the mobile pass its own ticket at rank 24). `trace:ac` needs one owner — **this ticket owns the mobile ACs**; M-14 owns the desktop path.
Plan: filled in by delegator's plan phase

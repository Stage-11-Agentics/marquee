# MRQ-33: Admin create, the submission record, and the program board

BUILDPLAN: M-32 (rank 13, US-22) + M-53 (rank 10, US-75) — Wave 2 (§5) · MERGED at mint (5 h + 4 h = 9 h; M-53 depends on M-32 plus their shared M-08, and AC-243 makes the board a thin read-only surface **onto** the record — "the record owns every stage-appropriate action")

**M-32 — Admin create + record** (5 h, ACs AC-118 – AC-120, AC-240, AC-243, dep M-08)
Scope (verbatim): abstract/session, bypass, origin, participants/answers/scores/routing/history, scheduled slot visibility, stage actions on record.
Amendment 10 fold (SPEC.md, post-BUILDPLAN-v1.4 — flagged to the orchestrator; SPEC allocates +1 h): the record's **evaluation panel** lists its current reviewers per round with coverage counts; an admin can assign or remove a specific reviewer there (writing `round_assignments`), the affected reviewer's queue updates, and track-scope rules are still enforced. API/CLI equivalent is `/rounds/:id/assignments` CRUD. **AC-251.** *(SPEC tags the UI "beyond v1.5 prototype — acknowledged divergence, build per spec.")*

**M-53 — Read-only Program board** (4 h, ACs AC-238, AC-243, deps M-08/M-32)
Scope (verbatim): every non-draft submission once across seven stages, full filters/count/reset, card click/Enter/Space to record, no drag/actions on cards, record owns confirmations/cascades; virtualized at seed scale.
AC-243 is a client ruling (Amendment 7), replacing struck AC-239: **no card drags, no lifecycle action on cards.** Consequential actions belong on the detail screen, deliberately. Agenda drag/drop is unchanged. `trace:ac` fails if AC-239 is treated as live or reused.

ACs (union): AC-118 – AC-120, **AC-238, AC-240, AC-243** · **AC-251** (Amendment 10 fold)
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local.
Deps: M-08
Speed: the board must stay inside the full-seed *objective* budget (measured and reported, not a gate); virtualization is the stated mechanism.
Plan: filled in by delegator's plan phase

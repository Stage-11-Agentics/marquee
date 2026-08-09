# MRQ-38: Role confirm/decline and decision feedback

BUILDPLAN: M-42 (rank 23, US-37) + M-52 (rank 9, US-74) — Wave 2 (§5) · MERGED at mint (3 h + 3 h = 6 h; both are the speaker-response surface written across `src/ui/portal/*` and the submission record — the two tickets the portal ticket (M-15) deliberately did **not** own)

**M-42 — Confirm / decline** (3 h, ACs AC-152 – AC-154, dep M-15)
Scope (verbatim): visible to lead, per role, decline notifies/flags agenda.
AC-153: a person holding two roles on one submission confirms each independently; one response does not settle the other.

**M-52 — Decision feedback + email from record/review** (3 h, ACs AC-235/AC-236, deps M-11/M-15/M-17/M-32)
Scope (verbatim): **sole owner of AC-235/236 end to end** — the `submission_decisions` write, the render-once into the outbox, the portal display from that same row, and the record log. M-15 renders the slot and M-18 calls the write; neither claims the IDs. One-off templated email logged on the record.
AC-235's headline assertion: bulk-accept 3 records → 3 `submission_decisions` rows exist and all 3 portals render from them. **The demo's headline action must not use a second render path.**

ACs (union): AC-152 – AC-154, **AC-235, AC-236**
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: `src/ui/portal/*` is shared with M-15 — **one file per concern**; M-15 rendered the slots, this ticket fills them. Do not restructure M-15's files.
Deps: M-15, M-11, M-17, M-32+M-53
Plan: filled in by delegator's plan phase

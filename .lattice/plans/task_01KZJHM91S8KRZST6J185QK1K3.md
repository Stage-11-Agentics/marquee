# MRQ-18: Reviewer queue

BUILDPLAN: M-17 — Wave 1 (§4), walkthrough step 8

Scope (verbatim): Own shell; queue constrained by track intersection; one card opens full evaluator-visible fields/files and returns to the same index; primary **Approve/Maybe/Deny** recommendation saves without a numeric score; optional scorecard; resume/advance; blind identity stripped in query layer; **`GET /rounds/:id/export?format=csv` ships (+1 h) — AC-64 and AC-246 both assert over "every export" and there was no reviewer export route to scan**; detail/file/export/write routes all use M-16's helper.

Amendment 8: the recommendation maps to organizer-facing accepted/waitlisted/rejected **decision proposals without changing lifecycle status** until an authorized program lead acts.
Blind review: identity stripping happens **in the query layer**, not the view — A-8 byte-scans every reviewer-visible response *and export* for seeded identity strings.
Seed dependency (B-3): M-04b seeds the demo organizer a reviewer membership, track scopes over every track, and ~40 round-1 assignments, so this queue opens populated and AC-62's 20-advance speed run has material.

File surface: `src/routes/review.routes.ts`, `src/ui/review/*`

ACs: AC-59 – AC-65, AC-158, AC-159, **AC-244–246**
Hours: 9
Workflow: sub-agent-full (≥7 h)
Shared files: none owned — consumes `src/lib/reviewer-scope.ts` (M-16's) on **every** route including the export.
Deps: M-16
Speed: AC-62 is an AC-sourced budget — score submitted → next card interactive, median ≤ 300 ms over ≥20 consecutive advances.
Audits that key off this ticket: A-8 (anonymity scan), A-9 (reviewer isolation)
Plan: filled in by delegator's plan phase

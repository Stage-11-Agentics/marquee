# Plan Review: MRQ-114 — Task authoring: templates and assignment

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the MRQ-114 plan (including its cycle-1 self-review resolutions) against the task description, spec section T-E, the cross-cutting facts, the file-ownership rules, and the actual code at the stated base `23a06b0`. Every checkable claim held up under verification: the current `task-templates.routes.ts` is indeed GET + file-config-only PATCH, `TaskTemplatesPage.tsx` filters to `kind === 'file'` with an empty state that names a control it doesn't offer, the `task_templates`/`speaker_tasks` CHECK constraints and `cancelled_at` (migration 0004) are as described, `onboarding.queries.ts` is memberships-derived and drops zero-owed speakers (`owedCount === 0 → continue`), the cascade mints tasks via `COALESCE(tt.due_at, now + offset)`, and the proposed `route-table.ts` row matches the real `RouteDefinition` shape (`sidebar?: boolean`, group `"modules"` exists). The only concerns are minor: the offset-mode (`due_offset_days`) semantics for ad-hoc assignment and PATCH propagation are underspecified, and PATCH's merged-state validation of the due-mode CHECK deserves the same explicitness the POST got.

## 3. Issues

**[MINOR] API endpoint 4 / Cycle-1 resolution 1 — Offset anchor for direct assignment is undefined**
`speaker_tasks.due_at` is `NOT NULL`, and endpoint 4's `due_at` is optional. For an offset-based template assigned ad-hoc (bypassing acceptance), there is no decision timestamp to anchor `due_offset_days` — the cascade anchors on decision time (`decisions.ts`), which doesn't exist here. The shared `assignmentStatements` helper is the right place to define this, but the plan never says what it computes.
**Recommendation:** State the rule explicitly in the helper: ad-hoc assignment of an offset template resolves `due_at = now + offset_days`, or require the caller to pass `due_at` when the template is offset-based (422 otherwise). Either is fine; pick one before coding so the route and UI agree. The eval path uses fixed dates, so this is correctness hygiene, not rubric risk.

**[MINOR] Cycle-1 resolution 3 — Due-date propagation is only well-defined for fixed-date templates**
PATCH propagates "resolved `due_at`" to open tasks. That's crisp when the patch sets a literal `due_at`; when the patch changes `due_offset_days`, each open task's anchor (its acceptance/decision time) isn't stored on `speaker_tasks`, and ad-hoc assignments have no anchor at all — so "resolved" is ambiguous per-row.
**Recommendation:** Scope propagation: propagate when the template ends up in fixed-date mode; for offset-only changes either recompute from each task's `created_at` (documented as the approximation it is) or skip propagation and say so in the response. Don't invent per-row anchors silently.

**[MINOR] API endpoint 2 — PATCH must validate the due-mode CHECK against merged state, with swap semantics**
The plan promises Zod-before-SQLite for POST, but PATCH with all-optional fields can violate `(due_at IS NULL) <> (due_offset_days IS NULL)` only after merging with the existing row — e.g., a patch setting `due_offset_days` on a template that already has `due_at`. Unless the route explicitly clears the other column on a mode switch, the CHECK fires as a 500, the exact failure mode the plan says it's avoiding.
**Recommendation:** State the merge rule: setting one due mode nulls the other; setting both in one body is a 422; validate the merged row before writing.

**[MINOR] Date convention — end-of-day UTC renders as the next day on surfaces that format locally**
`23:59:59.999Z` formatted with UTC accessors round-trips correctly on the plan's own page. But `speaker_tasks.due_at` is also displayed by pre-existing surfaces (onboarding board, speaker portal); if any of those format with local-time accessors, an east-of-Greenwich browser shows `2027-05-02`. The rubric evidence comes from the plan's own list, so this doesn't threaten CNT-01/SPK-05, but a portal showing a different due date than the organizer page is the "control that lies" pattern.
**Recommendation:** During implementation, grep how existing consumers of `due_at` format it and align (or note the discrepancy in the PR). Cheap check, prevents a cross-surface inconsistency.

**[MINOR] Task description item (2) vs endpoint 4 — "title" is satisfied by a different endpoint; say so in the PR**
The ticket asks for "POST for direct speaker-task assignment: title, due date, MULTI-speaker select." Endpoint 4 takes `template_id`, not `title` — title only enters via endpoint 1's create-with-`assign_to`. This is the right design (`speaker_tasks.template_id` is `NOT NULL`, so a template-less titled task is impossible without a migration the ticket doesn't authorize), and the judge's SPK-S1 flow is fully served by the create form. But a reviewer diffing against the ticket text will see a missing field.
**Recommendation:** No plan change needed. Carry one sentence into the PR description explaining that the schema makes "titled ad-hoc task" = "template created with assignees in one atomic action," so the deviation is visibly deliberate.

## 4. Positive Observations

- **Every factual claim checks out.** I verified the routes file contents, the page's `:173` filter and `:183` empty state, both tables' CHECK constraints, `cancelled_at`'s migration, the onboarding queries' memberships join and zero-owed drop, the cascade's due computation, the route-table shape, and the ownership rules — all accurate, with correct line references. This is the standard plans should meet and rarely do.
- **The load-bearing decision is the right one, for the right reason.** Recognizing that the memberships-derived onboarding board can silently hide judge-created speakers (register row 24n) — and therefore giving the task page its own `speaker_tasks`-derived list — protects the entire CNT-01 w3 from an upstream data gap the ticket didn't spell out.
- **The onboarding.routes.ts deviation is flagged, reasoned, and safe.** T-E owns that file, so relocating the assignment route into the file the ticket owns outright reduces collision surface to zero while changing nothing observable. Deviations declared this clearly are how ownership rules stay trustworthy.
- **Rubric-first sizing.** The plan reads the pass lines (fixture names, literal 2027 dates, multi-speaker requirement, "no file-request type required") and shapes the UI turn budget around them — inline form, auto-expanded empty state, exact sidebar noun — per cross-cutting facts 2 and 3.
- **Evidence-preserving destructive semantics.** DELETE refusing over `done` rows while sweeping open-including-cancelled rows, and `kind` immutability once assigned, both show the plan thinking about what the rows *mean*, not just referential integrity.
- **The cycle-1 self-review was real work:** the shared assignment helper, the all-submissions assignee union, and stale-due propagation are genuine catches, each with a stated rationale.
